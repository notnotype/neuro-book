/**
 * 主对话的持有（docs/specs/bots/main-conversation.md 输出 2、6 与“时序与寿命”）：长会话的指标与停止。打开耗时要真的超过 2 秒、在途的
 * `hold` 要卡在停止信号的两边，真实会话造不出这两种时刻，所以 `agentKey` 用照门面合同写的替身：`header`、`create`、`hold` 与
 * `session(id).snapshot()` 的交回形状与真实门面相同（真实门面的持有与打开耗时由 `agent.test.ts`、`kit/sessions/table.test.ts` 测）。
 */

import {describe, expect, test} from "bun:test";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {AgentService, HoldResult} from "nbook/plugins/agent/shared/contracts";

import {BotsStopping, BUSY_RETRY_MS, MainConversations, SLOW_OPEN_MS} from "./main";
import type {BotRecord} from "./store";

const BOT: BotRecord = {id: "lyra", name: "星璃", preset: "nbook.bots.lyra", profile: "nbook.bots.companion", createdAt: 1};

/** 手动时钟；`pending` 是还排着、没取消的回调数。 */
function manualClock(): RuntimeClock & {advance(ms: number): void; pending(): number} {
    let now = 0;
    const pending: {at: number; callback: () => void; cancelled: boolean}[] = [];
    return {
        now: () => now,
        pending: () => pending.filter((item) => !item.cancelled).length,
        schedule: (callback, ms) => {
            const item = {at: now + ms, callback, cancelled: false};
            pending.push(item);
            return () => {
                item.cancelled = true;
            };
        },
        advance: (ms) => {
            now += ms;
            for (const item of pending.splice(0)) {
                if (item.cancelled) continue;
                if (item.at <= now) item.callback();
                else pending.push(item);
            }
        },
    };
}

type Header = {readonly ok: true; readonly value: {readonly owner?: {readonly plugin: string; readonly id: string}}} | {readonly ok: false; readonly code: string};
const OWNED: Header = {ok: true, value: {owner: {plugin: "nbook.bots", id: "lyra"}}};

/**
 * 门面的替身：`header` 按 `headers` 里排好的结果依次交回（排完了交回归属对的会话头），`create` 交回 `created`，`hold` 每次按 `holds`
 * 里排好的结果交回（可以是挂着的 Promise）。`calls` 记下调用的先后。
 */
function agent(holds: Array<HoldResult | Promise<HoldResult>>, options: {readonly headers?: Header[]; readonly created?: {readonly ok: boolean; readonly code?: string}} = {}): {readonly service: AgentService; readonly calls: string[]} {
    const calls: string[] = [];
    const headers = [...(options.headers ?? [])];
    const service = {
        header: async () => {
            calls.push("header");
            return headers.shift() ?? OWNED;
        },
        create: async () => {
            calls.push("create");
            return options.created ?? {ok: false, code: "session-exists"};
        },
        hold: async (id: string) => {
            calls.push(`hold:${id}`);
            return holds.shift() ?? {ok: false, code: "session-busy"};
        },
        session: () => ({snapshot: async () => ({head: 42})}),
    } as unknown as AgentService;
    return {service, calls};
}

/** 等重试那一轮走完（替身的调用都是立即完成的 Promise）。 */
async function waitUntilHeld(main: MainConversations): Promise<void> {
    for (let round = 0; round < 50 && main.state("lyra").state !== "held"; round += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(main.state("lyra")).toEqual({state: "held"});
}

const held = (opened: number | null, released: string[]): HoldResult => ({ok: true, value: {opened, release: () => released.push("released")}});

describe("主对话的持有", () => {
    test("输出 6：实际打开了才记 bots.main-opened（事件数取快照的 head），超过 2 秒另记 bots.main-open-slow；复用已开的不记", async () => {
        for (const [opened, expected] of [[SLOW_OPEN_MS + 1, ["info:main-opened", "warn:main-open-slow"]], [SLOW_OPEN_MS, ["info:main-opened"]], [null, []]] as const) {
            const reports: string[] = [];
            const data: unknown[] = [];
            const released: string[] = [];
            const main = new MainConversations({agent: agent([held(opened, released)]).service, clock: manualClock(), changed: () => undefined, report: (level, code, _message, detail) => {
                reports.push(`${level}:${code}`);
                data.push(detail);
            }});
            expect(await main.ensure(BOT)).toEqual({ok: true, sessionId: "bot-lyra"});
            expect(reports).toEqual([...expected]);
            if (opened !== null) expect(data[0]).toEqual({bot: "lyra", session: "bot-lyra", events: 42, ms: opened});
        }
    });

    test("输出 2：session-busy 记进状态、5 秒后重试；停止信号之后不再重试", async () => {
        const clock = manualClock();
        const {service, calls} = agent([{ok: false, code: "session-busy"}, {ok: false, code: "session-busy"}]);
        const main = new MainConversations({agent: service, clock, changed: () => undefined, report: () => undefined});
        expect(await main.ensure(BOT, {create: false})).toMatchObject({ok: false, code: "session-busy"});
        expect(main.state("lyra")).toEqual({state: "failed", code: "session-busy"});
        clock.advance(BUSY_RETRY_MS);
        await Promise.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        expect(calls.filter((call) => call.startsWith("hold"))).toHaveLength(2);
        expect(clock.pending()).toBe(1);
        main.seal();
        expect(clock.pending()).toBe(0);
        clock.advance(BUSY_RETRY_MS * 3);
        await new Promise((resolve) => setImmediate(resolve));
        expect(calls.filter((call) => call.startsWith("hold"))).toHaveLength(2);
        await expect(main.ensure(BOT)).rejects.toBeInstanceOf(BotsStopping);
    });

    test("时序与寿命：停止信号之后才交回的持有立即放掉；stop 等在途的一步，再放掉已有的持有", async () => {
        let answer!: (result: HoldResult) => void;
        const late = new Promise<HoldResult>((resolve) => {
            answer = resolve;
        });
        const released: string[] = [];
        const main = new MainConversations({agent: agent([late]).service, clock: manualClock(), changed: () => undefined, report: () => undefined});
        const ensuring = main.ensure(BOT);
        await new Promise((resolve) => setImmediate(resolve));
        const stopping = main.stop();
        answer(held(10, released));
        await expect(ensuring).rejects.toBeInstanceOf(BotsStopping);
        await stopping;
        expect(released).toEqual(["released"]);

        const releasedLater: string[] = [];
        const other = new MainConversations({agent: agent([held(null, releasedLater)]).service, clock: manualClock(), changed: () => undefined, report: () => undefined});
        expect(await other.ensure(BOT)).toMatchObject({ok: true});
        expect(releasedLater).toEqual([]);
        await other.stop();
        expect(releasedLater).toEqual(["released"]);
    });

    test("输出 1：同一个 bot 并发的 ensure 依次跑，后到的看到已持有就交回同一个结果，只 hold 一次", async () => {
        const released: string[] = [];
        const {service, calls} = agent([held(null, released)]);
        const main = new MainConversations({agent: service, clock: manualClock(), changed: () => undefined, report: () => undefined});
        const same = {ok: true, sessionId: "bot-lyra"} as const;
        expect(await Promise.all([main.ensure(BOT), main.ensure(BOT), main.ensure(BOT)])).toEqual([same, same, same]);
        expect(calls).toEqual(["header", "hold:bot-lyra"]);
    });
    test("输出 1：会话不在就建；建时得 session-exists（别处刚建了）就回去读会话头，归属对再持有", async () => {
        const released: string[] = [];
        const {service, calls} = agent([held(null, released)], {headers: [{ok: false, code: "session-not-found"}], created: {ok: false, code: "session-exists"}});
        const main = new MainConversations({agent: service, clock: manualClock(), changed: () => undefined, report: () => undefined});
        expect(await main.ensure(BOT)).toEqual({ok: true, sessionId: "bot-lyra"});
        expect(calls).toEqual(["header", "create", "header", "hold:bot-lyra"]);
    });

    test("输出 1、3：会话头读不懂时交回那个码、记进状态，不当成会话不在去建", async () => {
        const {service, calls} = agent([], {headers: [{ok: false, code: "log-corrupt"}]});
        const main = new MainConversations({agent: service, clock: manualClock(), changed: () => undefined, report: () => undefined});
        expect(await main.ensure(BOT)).toMatchObject({ok: false, code: "log-corrupt"});
        expect(main.state("lyra")).toEqual({state: "failed", code: "log-corrupt"});
        expect(calls).toEqual(["header"]);
    });

    test("输出 2、3：hold 得别的码只记进状态、不排重试；下一次 ensure 经 opening 再持有", async () => {
        const clock = manualClock();
        const released: string[] = [];
        const states: string[] = [];
        const {service} = agent([{ok: false, code: "log-broken"}, held(null, released)]);
        const main = new MainConversations({agent: service, clock, changed: () => states.push(main.state("lyra").state), report: () => undefined});
        expect(await main.ensure(BOT)).toMatchObject({ok: false, code: "log-broken"});
        expect(main.state("lyra")).toEqual({state: "failed", code: "log-broken"});
        expect(clock.pending()).toBe(0);
        states.length = 0;
        expect(await main.ensure(BOT)).toEqual({ok: true, sessionId: "bot-lyra"});
        expect(states).toEqual(["opening", "held"]);
    });

    test("输出 6：先得 session-busy、重试后打开：打开耗时只算成功那一次，重试的等待不算进去", async () => {
        const clock = manualClock();
        const released: string[] = [];
        const data: unknown[] = [];
        const {service} = agent([{ok: false, code: "session-busy"}, held(120, released)]);
        const main = new MainConversations({agent: service, clock, changed: () => undefined, report: (_level, code, _message, detail) => {
            if (code === "main-opened") data.push(detail);
        }});
        expect(await main.ensure(BOT, {create: false})).toMatchObject({ok: false, code: "session-busy"});
        clock.advance(BUSY_RETRY_MS);
        await waitUntilHeld(main);
        expect(data).toEqual([{bot: "lyra", session: "bot-lyra", events: 42, ms: 120}]);
    });
});
