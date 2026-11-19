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

/** 门面的替身：主对话已在、归属对；`hold` 每次按 `holds` 里排好的结果交回（可以是挂着的 Promise）。 */
function agent(holds: Array<HoldResult | Promise<HoldResult>>): {readonly service: AgentService; readonly calls: string[]} {
    const calls: string[] = [];
    const service = {
        header: async () => ({ok: true, value: {owner: {plugin: "nbook.bots", id: "lyra"}}}),
        create: async () => {
            calls.push("create");
            return {ok: false, code: "session-exists"};
        },
        hold: async (id: string) => {
            calls.push(`hold:${id}`);
            return holds.shift() ?? {ok: false, code: "session-busy"};
        },
        session: () => ({snapshot: async () => ({head: 42})}),
    } as unknown as AgentService;

    return {service, calls};
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
        expect(calls).toEqual(["hold:bot-lyra"]);
    });
});
