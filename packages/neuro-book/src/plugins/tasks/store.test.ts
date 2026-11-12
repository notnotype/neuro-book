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

    test("视图可见时结束的任务立即算看过（输出 13）", async () => {
        const w = await world();
        const {store} = await windowStore(w, "a");
        store.setViewVisible(true);
        const handle = w.tasks.start({title: "初始化 Skill docx"});
        await settled(w, "看到在跑", () => store.running.value.length === 1);
        handle.fail({message: "超时"});
        await settled(w, "看到失败", () => store.finished.value.length === 1);
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
        expect((await client.list({})).ok).toBe(true);
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
