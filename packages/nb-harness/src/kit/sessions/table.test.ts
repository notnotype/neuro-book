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

/** 手动时钟：`advance` 把到点的回调按到点先后、同时到点的按登记先后同步执行；回调里登记的、到点也在这次推进内的照样执行。 */
function manualClock(): SessionTableClock & {advance(ms: number): void} {
    let now = 0;
    let order = 0;
    const pending: {at: number; order: number; callback: () => void; cancelled: boolean}[] = [];
    return {
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

async function setup() {
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
    const table = new SessionTable({host, clock, beforeOpen: async () => undefined, closed: (id) => closed.push(id), report: (code) => reports.push(code)});
    const created = await table.create({profile: defaultTestProfile.id, id: "s-1"});
    if (!created.ok) throw new Error(created.code);
    return {table, clock, model, closed, reports};
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
