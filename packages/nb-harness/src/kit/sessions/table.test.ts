/**
 * 会话的句柄表（docs/specs/agent/sessions.md 输出 5、6、14、20）：同时到达的打开得到同一个会话；没有引用、没有运行满 30 秒才关；
 * 引用期间不关；停止之后的调用被拒。真实内核宿主加内存存储；计时口是测试里的手动时钟，语义与运行时的 `RuntimeClock.schedule`
 * 相同：取消同步生效，一次推进里到点的回调按登记先后同步执行。
 */

import {describe, expect, test} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createAgentHost, createMemoryStore} from "../../kernel/index.js";
import {createTestClock, createTestModel, defaultTestProfile} from "../../kernel/testing/index.js";
import {IDLE_CLOSE_MS, SessionTable, SessionTableStopping} from "./table.js";
import type {SessionTableClock} from "./table.js";
import type {AgentHost} from "../../kernel/contracts.js";

/** 手动时钟：`advance` 把到点的回调按到点先后、同时到点的按登记先后同步执行；回调里登记的、到点也在这次推进内的照样执行。 */
function manualClock(): SessionTableClock & {advance(ms: number): void} {
    let now = 0;
    let order = 0;
    const pending: {at: number; order: number; callback: () => void; cancelled: boolean}[] = [];
    return {
        now: () => now,
        schedule: (callback, ms) => {
            const item = {at: now + ms, order: (order += 1), callback, cancelled: false};
            pending.push(item);
            return () => {
                item.cancelled = true;
            };
        },
        advance: (ms) => {
            const until = now + ms;
            for (;;) {
                const due = pending.filter((item) => !item.cancelled && item.at <= until).sort((a, b) => a.at - b.at || a.order - b.order)[0];
                if (due === undefined) break;
                now = due.at;
                due.cancelled = true;
                due.callback();
            }
            now = until;
        },
    };
}

/** `wrapHost`：在宿主的方法上做手脚（暂缓、推时钟），其余照真实宿主。 */
async function setup(options: {readonly wrapHost?: (host: AgentHost, clock: ReturnType<typeof manualClock>) => AgentHost; readonly refuse?: ConstructorParameters<typeof SessionTable>[0]["refuse"]} = {}) {
    const clock = manualClock();
    const model = createTestModel();
    const closed: string[] = [];
    const reports: string[] = [];
    const host = createAgentHost({
        store: createMemoryStore(),
        profiles: {resolve: (key) => (key === defaultTestProfile.id ? defaultTestProfile : undefined)},
        models: model.port,
        tools: {declarations: () => [], create: (id) => Promise.reject(new Error(`no tool ${id}`))},
        resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
        sessions: {get: (id) => Promise.reject(new Error(`no session ${id}`))},
        clock: createTestClock(),
        approve: async () => ({verdict: "allow", by: "test-policy"}),
    });
    const table = new SessionTable({host: options.wrapHost?.(host, clock) ?? host, clock, beforeOpen: async () => undefined, closed: (id) => closed.push(id), ...(options.refuse === undefined ? {} : {refuse: options.refuse}), report: (code) => reports.push(code)});
    const created = await table.create({profile: defaultTestProfile.id, id: "s-1"});
    if (!created.ok) throw new Error(created.code);
    return {table, clock, model, closed, reports, host};
}

/** 等排着的微任务走完：`view` 的调用在第一次 await 之后才放引用。 */
const settle = async (): Promise<void> => {
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
};

describe("会话的句柄表", () => {
    test("输出 5、6：同时到达的打开得到同一个会话；没有引用满 30 秒才关，视图下次调用时重新打开", async () => {
        const {table, clock, closed} = await setup();
        const [a, b] = await Promise.all([table.view("s-1").snapshot(), table.view("s-1").snapshot()]);
        expect(a.header.id).toBe(b.header.id);
        clock.advance(IDLE_CLOSE_MS - 1);
        await settle();
        expect(closed).toEqual([]);
        clock.advance(1);
        await waitUntil("空闲后关闭", () => closed.length === 1);
        expect((await table.view("s-1").snapshot()).header.id).toBe("s-1");
        await table.stop();
    });

    test("输出 6：引用期间（订阅）不关，放掉之后才开始空闲计时", async () => {
        const {table, clock, closed} = await setup();
        const subscribed = await table.subscribeOpened("s-1", {kind: "user"}, () => undefined);
        if (!subscribed.ok) throw new Error(subscribed.code);
        clock.advance(IDLE_CLOSE_MS * 2);
        await settle();
        expect(closed).toEqual([]);
        subscribed.release();
        clock.advance(IDLE_CLOSE_MS);
        await waitUntil("放掉之后关闭", () => closed.length === 1);
        await table.stop();
    });

    test("输出 6：同一次推进里，到点之前别的回调来了引用：空闲计时被同步取消，放掉之后重新计满 30 秒才关", async () => {
        const {table, clock, closed} = await setup();
        // 这个回调先登记，与随后放引用时登记的空闲计时同一刻到点、排在它前面：它来取会话，同步取消了空闲计时。
        clock.schedule(() => {
            void table.view("s-1").snapshot();
        }, IDLE_CLOSE_MS);
        await table.view("s-1").snapshot();
        await settle();
        clock.advance(IDLE_CLOSE_MS);
        await settle();
        expect(closed).toEqual([]);
        clock.advance(IDLE_CLOSE_MS - 1);
        await settle();
        expect(closed).toEqual([]);
        clock.advance(1);
        await waitUntil("重新计满之后关闭", () => closed.length === 1);
        await table.stop();
    });

    test("输出 20：后台会话在跑时只进含后台的活动查询，前台活动不含它", async () => {
        const {table, model} = await setup();
        const created = await table.create({profile: defaultTestProfile.id, id: "s-bg", background: true});
        if (!created.ok) throw new Error(created.code);
        model.script({text: "半句话", hold: true});
        const sent = await table.view("s-bg").send({commandId: "c-1", input: {text: "你好"}});
        expect(sent.ok).toBe(true);
        await waitUntil("后台会话开始运行", () => table.activityWithBackground().length === 1);
        expect(table.activityWithBackground()).toEqual([{id: "s-bg", state: "running"}]);
        expect(table.activity()).toEqual([]);
        await table.stop();
    });

    test("输出 15：用户停止留下的话进活动（held）；空闲关闭之后再打开会话，打开时就算出来", async () => {
        const {table, model, clock, closed} = await setup();
        model.script({text: "半句话", hold: true});
        const view = table.view("s-1");
        const sent = await view.send({commandId: "c-1", input: {text: "你好"}});
        expect(sent.ok).toBe(true);
        await waitUntil("开始运行", () => table.activity().length === 1);
        expect((await view.enqueue({commandId: "c-2", input: {text: "排着的"}, mode: "followup"})).ok).toBe(true);
        expect((await view.abort({commandId: "c-3", keepQueue: true})).ok).toBe(true);
        await waitUntil("停下后留着", () => table.activity()[0]?.state === "held");
        clock.advance(IDLE_CLOSE_MS);
        await waitUntil("空闲后关闭", () => closed.length === 1);
        expect(table.activity()).toEqual([]);
        const subscribed = await table.subscribeOpened("s-1", {kind: "user"}, () => undefined);
        if (!subscribed.ok) throw new Error(subscribed.code);
        expect(table.activity()).toEqual([{id: "s-1", state: "held"}]);
        subscribed.release();
        await table.stop();
    });

    test("输出 14：停止关掉打开着的会话，之后的调用以 unavailable 被拒", async () => {
        const {table, closed} = await setup();
        await table.view("s-1").snapshot();
        await table.stop();
        expect(closed).toEqual(["s-1"]);
        expect(table.stopping).toBe(true);
        const refused = await table.view("s-1").snapshot().catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(SessionTableStopping);
        expect((refused as SessionTableStopping).code).toBe("unavailable");
    });
});

/** 可以手动放行的暂缓点。 */
function gate(): {readonly promise: Promise<void>; open(): void} {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return {promise, open};
}

/** 把 `s-1` 空闲关掉，之后的打开是冷打开。 */
async function closeIdle(context: {readonly clock: ReturnType<typeof manualClock>; readonly closed: string[]}): Promise<void> {
    const before = context.closed.length;
    context.clock.advance(IDLE_CLOSE_MS);
    await waitUntil("空闲后关闭", () => context.closed.length > before);
}

describe("持有、会话头与按会话拒绝", () => {
    test("输出 24：持有期间不空闲关闭；release 重复调只放一次，另一份持有还在时不关；都放掉之后照常关", async () => {
        const {table, clock, closed} = await setup();
        const a = await table.hold("s-1");
        const b = await table.hold("s-1");
        if (!a.ok || !b.ok) throw new Error("hold failed");
        // 刚建出来的会话已经开着：复用，不算打开。
        expect([a.value.opened, b.value.opened]).toEqual([null, null]);
        clock.advance(IDLE_CLOSE_MS * 2);
        await settle();
        expect(closed).toEqual([]);
        a.value.release();
        a.value.release();
        clock.advance(IDLE_CLOSE_MS);
        await settle();
        expect(closed).toEqual([]);
        b.value.release();
        clock.advance(IDLE_CLOSE_MS);
        await waitUntil("都放掉之后关闭", () => closed.length === 1);
        await table.stop();
    });

    test("输出 24：冷打开的 hold 交回这次打开的耗时；同时到达、等同一次打开的那份与复用已开的为 null；打不开交回码", async () => {
        const context = await setup({wrapHost: (host, clock) => ({...host, open: async (id) => {
            clock.advance(2_500);
            return host.open(id);
        }})});
        await closeIdle(context);
        const {table} = context;
        const [first, second] = await Promise.all([table.hold("s-1"), table.hold("s-1")]);
        if (!first.ok || !second.ok) throw new Error("hold failed");
        expect([first.value.opened, second.value.opened]).toEqual([2_500, null]);
        const third = await table.hold("s-1");
        expect(third).toMatchObject({ok: true, value: {opened: null}});
        expect(await table.hold("nope")).toMatchObject({ok: false, code: "session-not-found"});
        await table.stop();
    });

    test("输出 24、14：停止期间到的 hold 得 unavailable；打开在停止开始之后才交回的先放掉、得 unavailable，停止照常关掉会话", async () => {
        const opening = gate();
        const arrived = gate();
        let pause = false;
        const context = await setup({wrapHost: (host) => ({...host, open: async (id) => {
            const opened = await host.open(id);
            if (pause) {
                arrived.open();
                await opening.promise;
            }
            return opened;
        }})});
        await closeIdle(context);
        const {table, closed} = context;
        pause = true;
        const holding = table.hold("s-1");
        await arrived.promise;
        const stopping = table.stop();
        expect(await table.hold("s-1")).toEqual({ok: false, code: "unavailable"});
        opening.open();
        expect(await holding).toEqual({ok: false, code: "unavailable"});
        await stopping;
        expect(closed).toEqual(["s-1", "s-1"]);
    });

    test("打开失败只摘自己那个表项：打开期间建出同 id 的会话，晚回的失败不丢掉新表项，持有放掉之后才空闲关闭", async () => {
        const failing = gate();
        const arrived = gate();
        const context = await setup({wrapHost: (host) => ({...host, open: async (id) => {
            const opened = await host.open(id);
            if (id === "s-2") {
                arrived.open();
                await failing.promise;
            }
            return opened;
        }})});
        const {table, clock, closed} = context;
        const competing = table.hold("s-2");
        await arrived.promise;
        expect(await table.accept(() => table.create({profile: defaultTestProfile.id, id: "s-2"}))).toMatchObject({ok: true});
        const pin = await table.hold("s-2");
        if (!pin.ok) throw new Error(pin.code);
        failing.open();
        expect(await competing).toMatchObject({ok: false, code: "session-not-found"});
        expect(table.isOpen("s-2")).toBe(true);
        clock.advance(IDLE_CLOSE_MS * 2);
        await settle();
        expect(closed).not.toContain("s-2");
        pin.value.release();
        clock.advance(IDLE_CLOSE_MS);
        await waitUntil("放掉之后关闭", () => closed.includes("s-2"));
        await table.stop();
    });

    test("输出 28：header 只读会话头，不打开会话；不在得 session-not-found", async () => {
        const context = await setup();
        await closeIdle(context);
        const {table} = context;
        expect(await table.header("s-1")).toMatchObject({ok: true, value: {id: "s-1", profile: defaultTestProfile.id}});
        expect(table.isOpen("s-1")).toBe(false);
        expect(await table.header("nope")).toMatchObject({ok: false, code: "session-not-found"});
        await table.stop();
    });

    test("输出 26：refuse 拒绝的改写历史的指令不进内核、不打开会话；读会话头失败交回那个码；没拒绝的与别的指令照常执行", async () => {
        const context = await setup({refuse: (header) => (header.owner === undefined ? null : "owned-session")});
        const {table} = context;
        expect(await table.accept(() => table.create({profile: defaultTestProfile.id, id: "s-own", owner: {plugin: "test.owner", id: "a"}}))).toMatchObject({ok: true});
        await closeIdle(context);
        await waitUntil("有归属的会话也空闲关闭", () => !table.isOpen("s-own"));
        const owned = table.view("s-own");
        expect(await owned.archive({commandId: "a-1", archived: true})).toMatchObject({ok: false, code: "owned-session"});
        expect(await owned.switchBranch({commandId: "a-2", node: "n"})).toMatchObject({ok: false, code: "owned-session"});
        expect(await owned.rewind({commandId: "a-3", to: null})).toMatchObject({ok: false, code: "owned-session"});
        expect(table.isOpen("s-own")).toBe(false);
        expect(await table.view("nope").archive({commandId: "a-4", archived: true})).toMatchObject({ok: false, code: "session-not-found"});
        expect(table.isOpen("nope")).toBe(false);
        // 有归属的会话只能往后写：别的指令照常。
        expect(await owned.setTitle({commandId: "a-5", title: "主对话"})).toMatchObject({ok: true});
        expect(await table.view("s-1").archive({commandId: "a-6", archived: true})).toMatchObject({ok: true});
        await table.stop();
    });

    test("输出 26：读会话头得到“不在”之后、交回之前建出同 id 有归属的会话：交回 session-not-found，不执行、不写日志", async () => {
        const reading = gate();
        const arrived = gate();
        const context = await setup({refuse: (header) => (header.owner === undefined ? null : "owned-session"), wrapHost: (host) => ({...host, header: async (id) => {
            const read = await host.header(id);
            if (id === "s-late") {
                arrived.open();
                await reading.promise;
            }
            return read;
        }})});
        const {table} = context;
        const archiving = table.view("s-late").archive({commandId: "l-1", archived: true});
        await arrived.promise;
        expect(await table.accept(() => table.create({profile: defaultTestProfile.id, id: "s-late", owner: {plugin: "test.owner", id: "late"}}))).toMatchObject({ok: true});
        const head = (await table.view("s-late").snapshot()).head;
        reading.open();
        expect(await archiving).toMatchObject({ok: false, code: "session-not-found"});
        expect((await table.view("s-late").snapshot()).head).toBe(head);
        await table.stop();
    });
});
