/**
 * 窗口一侧的任务仓库（docs/specs/workbench/background-tasks.md 输出 12 到 14）：真实服务端入口、经 JSON 编解码的远程链路，
 * 每个窗口一份仓库。通知服务换成记录调用的替身：合同只有 `notify` 交回带 `dismiss` 的句柄（workbench/notifications.md 输入），
 * 这里断言的是发了什么、撤回了哪条。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {NotificationInput, Notifications} from "nbook/plugins/workbench/shared/contracts";

import {PUSH_INTERVAL_MS} from "./backend/remote";
import {tasksText} from "./shared/text";
import {tasksWorld} from "./testing/world";
import type {TasksWorld} from "./testing/world";
import type {ProvidedRow, RowsPayload, StopOutcome, TaskProvider} from "./shared/contracts";
import {createRowsStore} from "./web/rows";
import type {RowsStore} from "./web/rows";
import {createTasksStore} from "./web/store";
import type {TasksStore} from "./web/store";

let root = "";
let counter = 0;
const worlds: TasksWorld[] = [];
const stops: AbortController[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-tasks", "store");
});
afterEach(async () => {
    for (const stop of stops.splice(0)) stop.abort();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

interface Sent {
    readonly input: NotificationInput;
    dismissed: boolean;
}

/** 记录发出的通知与撤回。 */
function recorder(): Notifications & {readonly sent: Sent[]} {
    const sent: Sent[] = [];
    return {
        sent,
        notify: (input) => {
            const entry: Sent = {input, dismissed: false};
            sent.push(entry);
            return {id: `n-${String(sent.length)}`, update: () => undefined, dismiss: () => void (entry.dismissed = true)};
        },
    };
}

async function world(): Promise<TasksWorld> {
    counter += 1;
    const created = await tasksWorld(join(root, `world-${String(counter)}`));
    worlds.push(created);
    return created;
}

/** 一个窗口的仓库，已经订阅并取到第一份清单。 */
async function windowStore(w: TasksWorld, id: string): Promise<{store: TasksStore; notifications: ReturnType<typeof recorder>; reports: string[]}> {
    const notifications = recorder();
    const reports: string[] = [];
    const store = createTasksStore(await w.window(id), notifications, (message) => reports.push(message));
    const stop = new AbortController();
    stops.push(stop);
    await store.start(stop.signal);
    return {store, notifications, reports};
}

/** 推着时钟等仓库看到某个状态：推送只在时钟到点时发。 */
async function settled(w: TasksWorld, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        w.settings.clock.advance(PUSH_INTERVAL_MS);
        return check();
    });
}

describe("任务仓库", () => {
    test("窗口取到第一份清单时已经结束的算看过、不发通知（输出 13、14）", async () => {
        const w = await world();
        const failed = w.tasks.start({title: "初始化 Skill pdf-tools", retry: () => undefined});
        failed.fail({message: "超时"});
        const done = w.tasks.start({title: "导出"});
        done.succeed();
        const {store, notifications} = await windowStore(w, "a");
        expect(store.items.value).toHaveLength(2);
        expect(store.unseenFailure.value).toBe(false);
        expect(notifications.sent).toEqual([]);
    });

    test("连着时转为失败：发常驻的错误通知，带“重试”与原文；条目有没看过的失败，视图可见后算看过（输出 12 到 14）", async () => {
        const w = await world();
        const {store, notifications} = await windowStore(w, "a");
        const handle = w.tasks.start({title: "初始化 Skill pdf-tools", retry: () => undefined});
        await settled(w, "仓库看到在跑的任务", () => store.running.value.length === 1);
        handle.fail({message: "连不上 registry.npmjs.org（超时）", detail: `  ${"x".repeat(9000)}`});
        await settled(w, "发出失败通知", () => notifications.sent.length === 1);
        const sent = notifications.sent[0]!.input;
        expect(sent).toMatchObject({tone: "error", title: "初始化 Skill pdf-tools", message: "连不上 registry.npmjs.org（超时）", detailTruncated: true});
        expect(sent.detail).toHaveLength(8000);
        expect(sent.action?.label).toEqual(tasksText("list.retry"));
        expect(store.unseenFailure.value).toBe(true);
        store.setViewVisible(true);
        expect(store.unseenFailure.value).toBe(true);
        store.setShown(new Set([handle.id]));
        expect(store.unseenFailure.value).toBe(false);
    });

    test("成功发按时消失的通知，正文没有时写“完成”；已取消、已中断的不发（输出 14）", async () => {
        const w = await world();
        const {store, notifications} = await windowStore(w, "a");
        const ok = w.tasks.start({title: "导出《雾港》"});
        const cancelled = w.tasks.start({title: "导出 PDF", cancellable: true});
        await settled(w, "看到两件在跑", () => store.running.value.length === 2);
        ok.succeed();
        cancelled.cancelled();
        await settled(w, "两件都结束", () => store.running.value.length === 0);
        expect(notifications.sent.map((entry) => entry.input)).toEqual([{tone: "success", title: "导出《雾港》", message: tasksText("outcome.succeeded")}]);
        expect(store.finished.value.map((item) => item.state)).toEqual(expect.arrayContaining(["succeeded", "cancelled"]));
    });

    test("两个窗口各发一条；在一个窗口里重试，两边的失败通知都撤回，新任务顶替旧行（输出 6、14）", async () => {
        const w = await world();
        const a = await windowStore(w, "a");
        const b = await windowStore(w, "b");
        let again: string | null = null;
        const first = w.tasks.start({title: "初始化 Skill pdf-tools", retry: () => {
            again = w.tasks.start({title: "初始化 Skill pdf-tools"}).id;
        }});
        await settled(w, "两个窗口看到在跑", () => a.store.running.value.length === 1 && b.store.running.value.length === 1);
        first.fail({message: "超时"});
        await settled(w, "两个窗口各发一条", () => a.notifications.sent.length === 1 && b.notifications.sent.length === 1);
        await a.store.retry(first.id);
        await settled(w, "两边看到新任务", () => again !== null && [a, b].every((side) => side.store.running.value.some((item) => item.id === again)));
        expect(a.notifications.sent[0]!.dismissed).toBe(true);
        expect(b.notifications.sent[0]!.dismissed).toBe(true);
        expect(b.store.items.value.some((item) => item.id === first.id)).toBe(false);
    });

    test("两次推送之间开始又失败、没有原文的任务照样发失败通知（输出 14 的“上一份里没有它”）", async () => {
        const w = await world();
        const {notifications} = await windowStore(w, "a");
        const handle = w.tasks.start({title: "初始化 Skill docx"});
        handle.fail({message: "registry 拒绝连接"});
        await settled(w, "发出失败通知", () => notifications.sent.length === 1);
        expect(notifications.sent[0]!.input).toMatchObject({tone: "error", title: "初始化 Skill docx", message: "registry 拒绝连接"});
    });

    test("视图可见时，视图画成终态的那几件才算看过；页面不在前台时不算（输出 13、28）", async () => {
        const w = await world();
        const {store} = await windowStore(w, "a");
        store.setViewVisible(true);
        const handle = w.tasks.start({title: "初始化 Skill docx"});
        await settled(w, "看到在跑", () => store.running.value.length === 1);
        handle.fail({message: "超时"});
        await settled(w, "看到失败", () => store.finished.value.length === 1);
        // 分组行还画着它在跑：不算看过。
        expect(store.unseenFailure.value).toBe(true);
        store.setViewVisible(false);
        store.setShown(new Set([handle.id]));
        expect(store.unseenFailure.value).toBe(true);
        store.setViewVisible(true);
        expect(store.unseenFailure.value).toBe(false);
    });

    test("断线期间结束的任务：重连后重取到的清单只建基线、算看过，不发通知（输出 13、14）", async () => {
        const w = await world();
        const {store, notifications} = await windowStore(w, "a");
        const handle = w.tasks.start({title: "初始化 Skill docx"});
        await settled(w, "看到在跑", () => store.running.value.length === 1);
        w.link("a").disconnect();
        handle.fail({message: "超时"});
        expect(await w.link("a").reconnect()).toMatchObject({ok: true});
        await settled(w, "重连后看到失败", () => store.finished.value.length === 1);
        expect(notifications.sent).toEqual([]);
        expect(store.unseenFailure.value).toBe(false);
        // 基线建好以后照常比较：之后结束的发通知。
        w.tasks.start({title: "导出"}).succeed();
        await settled(w, "之后的成功发通知", () => notifications.sent.length === 1);
    });

    test("订阅建好之前入口就停了：退订，不取清单、不再接收推送", async () => {
        const w = await world();
        const client = await w.window("a");
        const store = createTasksStore(client, recorder(), () => undefined);
        const stop = new AbortController();
        stop.abort();
        await store.start(stop.signal);
        w.tasks.start({title: "导出"});
        for (let step = 0; step < 4; step += 1) w.settings.clock.advance(PUSH_INTERVAL_MS);
        // 同一条链路上的消息按序到达：这次调用的回应到了，之前排上的推送也都送到了。
        expect((await client.own({})).ok).toBe(true);
        expect(store.items.value).toEqual([]);
    });

    test("在跑的按开始时刻、结束的按结束时刻，各自新的在前；取消与移除交给服务端", async () => {
        const w = await world();
        const {store} = await windowStore(w, "a");
        const older = w.tasks.start({title: "早开始的", cancellable: true});
        w.settings.clock.advance(1_000);
        const newer = w.tasks.start({title: "晚开始的"});
        const ended = w.tasks.start({title: "先结束的"});
        ended.succeed();
        w.settings.clock.advance(1_000);
        const later = w.tasks.start({title: "后结束的"});
        later.succeed();
        await settled(w, "看到四件", () => store.items.value.length === 4);
        expect(store.running.value.map((item) => item.id)).toEqual([newer.id, older.id]);
        expect(store.finished.value.map((item) => item.id)).toEqual([later.id, ended.id]);
        await store.cancel(older.id);
        expect(older.signal.aborted).toBe(true);
        await store.remove(ended.id);
        await settled(w, "移除推到窗口", () => !store.items.value.some((item) => item.id === ended.id));
        await store.clearFinished();
        await settled(w, "清除推到窗口", () => store.finished.value.length === 0);
    });
});

describe("分组行的仓库（输出 22–26）", () => {
    const row = (id: string, over: Partial<ProvidedRow> = {}): ProvidedRow => ({id, title: `行 ${id}`, state: "running", kind: "work", kindLabel: "工作", form: "once", owner: {kind: "app"}, startedAt: 1_000, stoppable: true, ...over});

    /** 一家测试提供方：`answer` 定停止的结果。 */
    function provider(rows: readonly ProvidedRow[], answer: (id: string) => Promise<StopOutcome>): TaskProvider {
        return {rows: () => rows, subscribe: () => () => undefined, stop: (id) => answer(id)};
    }

    async function rowsStore(w: TasksWorld, project: string | null, commands: {source: (id: string) => string | null; failing?: string} = {source: () => null}) {
        const notifications = recorder();
        const reports: string[] = [];
        const executed: string[] = [];
        const rows = createRowsStore({
            remote: await w.window("a"),
            project,
            commands: {
                get: (id) => {
                    const source = commands.source(id);
                    return source === null ? {ok: false, code: "unknown-command", reason: "没有这条命令"} : {ok: true, value: {id, source} as never};
                },
                execute: async (id) => {
                    executed.push(id);
                    return id === commands.failing ? {ok: false, code: "execution-error", reason: "会话打不开"} : {ok: true, value: null};
                },
            },
            notifications,
            report: (message) => void reports.push(message),
        });
        const stop = new AbortController();
        stops.push(stop);
        rows.start(stop.signal);
        return {rows, notifications, reports, executed};
    }

    const keys = (payload: RowsPayload | null): string[] => (payload?.groups ?? []).flatMap((group) => [...(group.kind === "session" && group.head !== null ? [group.head.key] : []), ...group.rows.map((item) => item.key)]);

    async function payloadWhere(w: TasksWorld, rows: RowsStore, description: string, check: (payload: RowsPayload) => boolean): Promise<RowsPayload> {
        await settled(w, description, () => rows.payload.value !== null && check(rows.payload.value));
        return rows.payload.value!;
    }

    test("视图可见时才订阅；范围换成全部项目时换一代订阅，别的项目的行出现、elsewhere 归零", async () => {
        const w = await world();
        w.tasks.start({title: "雾港的", owner: {kind: "project", project: "p-fog", title: "雾港"}});
        w.tasks.start({title: "长夜的", owner: {kind: "project", project: "p-night", title: "长夜"}});
        const {rows} = await rowsStore(w, "p-fog");
        for (let step = 0; step < 4; step += 1) w.settings.clock.advance(PUSH_INTERVAL_MS);
        expect(rows.payload.value).toBeNull();
        rows.setVisible(true);
        const current = await payloadWhere(w, rows, "当前项目的行", (payload) => payload.groups.length === 1);
        expect(current).toMatchObject({elsewhere: 1, groups: [{kind: "project", project: "p-fog"}]});
        rows.setAll(true);
        const all = await payloadWhere(w, rows, "全部项目的行", (payload) => payload.groups.length === 2);
        expect(all.elsewhere).toBe(0);
        expect(all.groups.map((group) => (group as {project: string}).project)).toEqual(["p-fog", "p-night"]);
        rows.setAll(false);
        await payloadWhere(w, rows, "回到当前项目", (payload) => payload.groups.length === 1);
    });

    test("停止：被拒写提供方给的原因，结果未知与已不在各写一句；结果回来之前记在 stopping 里", async () => {
        const w = await world();
        let release: ((value: StopOutcome) => void) | null = null;
        (await w.owner("a")).tasks.provide(provider([row("no"), row("slow"), row("gone")], (id) => (id === "no" ? Promise.resolve({kind: "rejected", reason: "已经结束"}) : id === "slow" ? new Promise((resolve) => {
            release = resolve;
        }) : Promise.resolve({kind: "accepted"}))));
        const {rows, notifications} = await rowsStore(w, null);
        rows.setVisible(true);
        const payload = await payloadWhere(w, rows, "三行", (next) => keys(next).length === 3);
        const key = (id: string) => keys(payload).find((item) => item.endsWith(`:${id}`))!;
        await rows.stop(key("no"), "行 no");
        expect(notifications.sent.at(-1)!.input).toMatchObject({tone: "warning", title: "行 no", message: "已经结束"});
        // 提供方迟迟不给结果的那 10 秒由 providers.test.ts 测（这里推时钟会让测试场地的链路心跳到期）；这里让它自己交回未知。
        const slow = rows.stop(key("slow"), "行 slow");
        expect(rows.stopping.value.has(key("slow"))).toBe(true);
        await waitUntil("提供方收到停止", () => release !== null);
        release!({kind: "unknown"});
        await slow;
        expect(rows.stopping.value.has(key("slow"))).toBe(false);
        expect(notifications.sent.at(-1)!.input).toMatchObject({tone: "warning", message: tasksText("stop.unknown")});
        await rows.stop(key("gone").replace(/:gone$/u, ":missing"), "没有的行");
        expect(notifications.sent.at(-1)!.input).toMatchObject({tone: "info", message: tasksText("stop.gone")});
    });

    test("打开：只执行提供方自己贡献的命令；命令失败写它给的原因", async () => {
        const w = await world();
        const {rows, notifications, executed} = await rowsStore(w, null, {source: (id) => (id.startsWith("nbook.agent.") ? "nbook.agent" : id.startsWith("test.") ? "test.other" : null), failing: "nbook.agent.broken"});
        await rows.open({command: "nbook.agent.spoofed"}, "test.tasks-owner-a", "冒名的");
        expect(executed).toEqual([]);
        expect(notifications.sent.at(-1)!.input).toMatchObject({tone: "warning", title: "冒名的", message: tasksText("open.unavailable")});
        await rows.open({command: "nbook.agent.focus-session", args: {sessionId: "s1"}}, "nbook.agent", "第十二章修订");
        expect(executed).toEqual(["nbook.agent.focus-session"]);
        const before = notifications.sent.length;
        await rows.open({command: "nbook.agent.broken"}, "nbook.agent", "坏的");
        expect(notifications.sent.length).toBe(before + 1);
        expect(notifications.sent.at(-1)!.input).toMatchObject({tone: "warning", title: "坏的", message: "会话打不开"});
    });
});
