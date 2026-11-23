/**
 * 后台任务服务端的合同测试（docs/specs/workbench/background-tasks.md 输出 1–9、17、“输入与前置条件”“失败与恢复”、验收 3、5）：
 * 真实服务端入口与经 JSON 编解码的远程链路，发起方经真实的按调用方门面登记；推送的合并按注入的手动时钟推进。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PUSH_INTERVAL_MS} from "./backend/remote";
import type {TaskItem} from "./shared/contracts";
import {tasksWorld} from "./testing/world";
import type {TasksClient, TasksWorld} from "./testing/world";

let root = "";
let counter = 0;
const worlds: TasksWorld[] = [];

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-tasks", "service");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function world(): Promise<TasksWorld> {
    counter += 1;
    const created = await tasksWorld(join(root, `world-${String(counter)}`));
    worlds.push(created);
    return created;
}

function value<T>(result: {readonly ok: true; readonly value: T} | {readonly ok: false; readonly code: string}): T {
    if (!result.ok) throw new Error(`remote call failed: ${result.code}`);
    return result.value;
}

async function list(client: TasksClient): Promise<TaskItem[]> {
    return value(await client.own({})).tasks;
}

function item(items: readonly TaskItem[], id: string): TaskItem | undefined {
    return items.find((entry) => entry.id === id);
}

/** 订阅推送；交回收到的每一份清单。 */
async function pushes(client: TasksClient): Promise<TaskItem[][]> {
    const seen: TaskItem[][] = [];
    const subscribed = await client.events.ownChanged.subscribe({}, (payload) => void seen.push(payload.tasks));
    expect(subscribed.ok).toBe(true);
    return seen;
}

/** 推着时钟等推送满足条件：合并器只在时钟到点时推。 */
async function pushed(w: TasksWorld, seen: TaskItem[][], description: string, check: (latest: TaskItem[]) => boolean): Promise<void> {
    await waitUntil(description, () => {
        w.settings.clock.advance(PUSH_INTERVAL_MS);
        const latest = seen.at(-1);
        return latest !== undefined && check(latest);
    });
}

function diagnostics(w: TasksWorld, event: string): unknown[] {
    return w.settings.diagnostics("hub").query({}).records.filter((record) => record.event === event);
}

describe("登记、进展与推送（输出 1、2、9）", () => {
    test("登记后窗口取到在跑的任务；订阅一建立就推当前清单，之后的进展照推", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "初始化 Skill epub-export", message: "正在准备"});
        const entry = item(await list(client), handle.id);
        expect(entry).toMatchObject({title: "初始化 Skill epub-export", message: "正在准备", state: "running", progress: null, cancellable: false, cancelRequested: false, retryable: false, hasDetail: false, endedAt: null});
        expect(Number.isNaN(Date.parse(entry?.startedAt ?? ""))).toBe(false);

        const seen = await pushes(client);
        await pushed(w, seen, "订阅后的第一份清单", (latest) => item(latest, handle.id) !== undefined);
        handle.report({message: "正在安装 23 个包", progress: 40});
        await pushed(w, seen, "进展推到窗口", (latest) => item(latest, handle.id)?.progress === 40);
        expect(item(seen.at(-1) ?? [], handle.id)?.message).toBe("正在安装 23 个包");
    });

    test("进度不是有限数当作不确定，超出范围的夹到 0 到 100；message: null 去掉进展", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "t", message: "m", progress: 150});
        expect(item(await list(client), handle.id)?.progress).toBe(100);
        handle.report({progress: Number.NaN});
        expect(item(await list(client), handle.id)?.progress).toBeNull();
        handle.report({progress: -5, message: null});
        expect(item(await list(client), handle.id)).toMatchObject({progress: 0, message: null});
    });

    test("连续的变化合并：两次推送之间至少隔 250 毫秒，推的是最后的值", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "t", progress: 0});
        const seen = await pushes(client);
        // 订阅后的第一次推送排在 0 毫秒之后；之后不再推时钟，推送时刻就是此刻。
        w.settings.clock.advance(0);
        await waitUntil("第一份清单", () => seen.length === 1);
        for (let progress = 10; progress <= 90; progress += 10) handle.report({progress});
        w.settings.clock.advance(PUSH_INTERVAL_MS - 1);
        // 一次往返：在它之前推出的事件都已到达。
        await client.own({});
        expect(seen).toHaveLength(1);
        w.settings.clock.advance(1);
        await waitUntil("合并后的那一次推送", () => seen.length > 1);
        await client.own({});
        expect(seen).toHaveLength(2);
        expect(item(seen[1] ?? [], handle.id)?.progress).toBe(90);
    });
});

describe("结束（输出 3）", () => {
    test("成功、失败、已取消；只有第一次结束算数，之后句柄的调用不起作用", async () => {
        const w = await world();
        const client = await w.window("a");
        const ok = w.tasks.start({title: "a", message: "正在装"});
        ok.succeed();
        ok.fail({message: "晚到的失败"});
        ok.report({message: "晚到的进展"});
        const failed = w.tasks.start({title: "b"});
        failed.fail({message: "连不上 registry.npmjs.org（超时）"});
        const cancelled = w.tasks.start({title: "c"});
        cancelled.cancelled("用户取消了");
        const items = await list(client);
        expect(item(items, ok.id)).toMatchObject({state: "succeeded", message: null, progress: null});
        expect(item(items, ok.id)?.endedAt).not.toBeNull();
        expect(item(items, failed.id)).toMatchObject({state: "failed", message: "连不上 registry.npmjs.org（超时）", hasDetail: false});
        expect(item(items, cancelled.id)).toMatchObject({state: "cancelled", message: "用户取消了"});
    });

    test("详情去掉首尾空白，至多留 8000 个码元并注明截断；空白的等于没有", async () => {
        const w = await world();
        const client = await w.window("a");
        const long = w.tasks.start({title: "a"});
        long.fail({message: "x", detail: `  ${"y".repeat(9000)}  `});
        const blank = w.tasks.start({title: "b"});
        blank.fail({message: "x", detail: "  \n "});
        const detail = value(await client.detail({id: long.id}));
        expect(detail?.truncated).toBe(true);
        expect(detail?.text.length).toBe(8000);
        expect(item(await list(client), blank.id)?.hasDetail).toBe(false);
        expect(value(await client.detail({id: blank.id}))).toBeNull();
        expect(await client.detail({id: "task-missing"})).toMatchObject({ok: false, code: "unknown-task"});
    });
});

describe("取消（输出 4）", () => {
    test("用户取消：signal 以 cancelled abort，任务仍在跑直到发起方结束；重复取消照样成功", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "a", cancellable: true});
        expect(value(await client.cancel({id: handle.id}))).toBeNull();
        expect(handle.signal.aborted).toBe(true);
        expect(handle.signal.reason).toBe("cancelled");
        expect(item(await list(client), handle.id)).toMatchObject({state: "running", cancelRequested: true});
        expect(value(await client.cancel({id: handle.id}))).toBeNull();
        handle.cancelled();
        expect(item(await list(client), handle.id)?.state).toBe("cancelled");
        expect(await client.cancel({id: handle.id})).toMatchObject({ok: false, code: "not-running"});
    });

    test("不可取消的得 not-cancellable，没有这件的得 unknown-task", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "a"});
        expect(await client.cancel({id: handle.id})).toMatchObject({ok: false, code: "not-cancellable"});
        expect(handle.signal.aborted).toBe(false);
        expect(await client.cancel({id: "task-missing"})).toMatchObject({ok: false, code: "unknown-task"});
    });
});

describe("重试（输出 6）", () => {
    test("先移出失败的那一行再调用发起方的 retry，它登记的新任务顶替这一行", async () => {
        const w = await world();
        const client = await w.window("a");
        let again: string | null = null;
        const retry = (): void => {
            again = w.tasks.start({title: "初始化 Skill pdf-tools"}).id;
        };
        const first = w.tasks.start({title: "初始化 Skill pdf-tools", retry});
        first.fail({message: "超时"});
        expect(item(await list(client), first.id)?.retryable).toBe(true);
        expect(value(await client.retry({id: first.id}))).toBeNull();
        const items = await list(client);
        expect(item(items, first.id)).toBeUndefined();
        expect(again).not.toBeNull();
        expect(item(items, again ?? "")?.state).toBe("running");
        expect(await client.retry({id: first.id})).toMatchObject({ok: false, code: "unknown-task"});
    });

    test("retry 抛错或返回的 Promise 失败：记诊断，旧行已移出", async () => {
        const w = await world();
        const client = await w.window("a");
        const throwing = w.tasks.start({title: "a", retry: () => {
            throw new Error("boom");
        }});
        throwing.fail({message: "x"});
        const rejecting = w.tasks.start({title: "b", retry: async () => {
            throw new Error("later");
        }});
        rejecting.fail({message: "x"});
        const seen = await pushes(client);
        await pushed(w, seen, "第一份清单有两件", (latest) => latest.length === 2);
        expect(value(await client.retry({id: throwing.id}))).toBeNull();
        expect(value(await client.retry({id: rejecting.id}))).toBeNull();
        expect(await list(client)).toEqual([]);
        // 发起方没登记新任务，移出旧行本身也要推到窗口。
        await pushed(w, seen, "旧行移出推到窗口", (latest) => latest.length === 0);
        await waitUntil("两条重试失败的诊断", () => diagnostics(w, "tasks.retry-failed").length === 2);
    });

    test("成功的、没给 retry 的失败任务不能重试", async () => {
        const w = await world();
        const client = await w.window("a");
        const done = w.tasks.start({title: "a", retry: () => undefined});
        done.succeed();
        const bare = w.tasks.start({title: "b"});
        bare.fail({message: "x"});
        expect(await client.retry({id: done.id})).toMatchObject({ok: false, code: "not-retryable"});
        expect(await client.retry({id: bare.id})).toMatchObject({ok: false, code: "not-retryable"});
        expect(item(await list(client), bare.id)?.retryable).toBe(false);
    });
});

describe("移除与上限（输出 7、8，验收 5）", () => {
    test("移除结束的、清除已结束；在跑的不能移除", async () => {
        const w = await world();
        const client = await w.window("a");
        const running = w.tasks.start({title: "a"});
        const one = w.tasks.start({title: "b"});
        one.succeed();
        const two = w.tasks.start({title: "c"});
        two.fail({message: "x"});
        const three = w.tasks.start({title: "d"});
        three.cancelled();
        expect(await client.remove({id: running.id})).toMatchObject({ok: false, code: "running"});
        expect(value(await client.remove({id: one.id}))).toBeNull();
        expect(await client.remove({id: one.id})).toMatchObject({ok: false, code: "unknown-task"});
        expect(value(await client.clearFinished({}))).toEqual({removed: 2});
        expect((await list(client)).map((entry) => entry.id)).toEqual([running.id]);
        expect(value(await client.clearFinished({}))).toEqual({removed: 0});
    });

    test("第 51 件结束时移出结束最早的那件", async () => {
        const w = await world();
        const client = await w.window("a");
        const ids: string[] = [];
        for (let index = 0; index < 51; index += 1) {
            const handle = w.tasks.start({title: `t${String(index)}`});
            ids.push(handle.id);
            handle.succeed();
        }
        const items = await list(client);
        expect(items).toHaveLength(50);
        expect(item(items, ids[0] ?? "")).toBeUndefined();
        expect(item(items, ids[1] ?? "")).toBeDefined();
        expect(item(items, ids[50] ?? "")).toBeDefined();
    });
});

describe("输入（输入与前置条件）", () => {
    test("字面字符串截短；不合格的文字让 start 同步抛 TypeError、不登记", async () => {
        const w = await world();
        const client = await w.window("a");
        const long = w.tasks.start({title: "题".repeat(300), message: "进".repeat(600)});
        const entry = item(await list(client), long.id);
        expect(entry?.title).toBe("题".repeat(200));
        expect(entry?.message).toBe("进".repeat(500));
        expect(() => w.tasks.start({title: {kind: "text", key: "no-namespace"}})).toThrow(TypeError);
        expect(() => w.tasks.start({title: {kind: "text", ns: "nbook.tasks", key: "k", params: {flag: true as unknown as string}}})).toThrow(TypeError);
        expect(() => w.tasks.start({title: {"zh-CN": "长".repeat(400), "en-US": "x"}})).toThrow(TypeError);
        expect(() => w.tasks.start({title: "ok", message: 42 as unknown as string})).toThrow(TypeError);
        expect(() => w.tasks.start({title: "ok", retry: true as unknown as () => void})).toThrow(TypeError);
        expect(await list(client)).toHaveLength(1);
    });

    test("截短不切开代理对：第 200 个码元是高位代理时退一位", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: `a${"😀".repeat(150)}`});
        expect(item(await list(client), handle.id)?.title).toBe(`a${"😀".repeat(99)}`);
    });

    test("文字引用与语言映射存的是副本：发起方之后改手里的对象，清单不变", async () => {
        const w = await world();
        const client = await w.window("a");
        const message = {kind: "text" as const, ns: "nbook.tasks", key: "progress", params: {count: 1} as Record<string, unknown>};
        const handle = w.tasks.start({title: "a", message: message as never});
        message.params.count = true;
        handle.report({progress: 10});
        expect(item(await list(client), handle.id)).toMatchObject({message: {kind: "text", ns: "nbook.tasks", key: "progress", params: {count: 1}}, progress: 10});
    });

    test("句柄方法的文字不合格：这次调用不起作用，记诊断", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "a", message: "原来的"});
        handle.report({message: {kind: "text", key: "no-namespace"}, progress: 50});
        handle.fail({message: {kind: "text", key: "no-namespace"}});
        expect(item(await list(client), handle.id)).toMatchObject({state: "running", message: "原来的", progress: null});
        await waitUntil("两条输入不合格的诊断", () => diagnostics(w, "tasks.invalid-input").length === 2);
        // 参数不是对象、详情不是字符串：同样不起作用、不抛错。
        handle.report(undefined as never);
        handle.fail({message: "x", detail: 42 as unknown as string});
        expect(item(await list(client), handle.id)).toMatchObject({state: "running", message: "原来的"});
        await waitUntil("四条输入不合格的诊断", () => diagnostics(w, "tasks.invalid-input").length === 4);
        handle.report({message: {kind: "text", ns: "nbook.tasks", key: "progress", params: {count: 23}}});
        expect(item(await list(client), handle.id)?.message).toEqual({kind: "text", ns: "nbook.tasks", key: "progress", params: {count: 23}});
    });
});

describe("发起方停止（输出 5，验收 3）", () => {
    test("发起方入口单独停止：在跑的转为已中断并推到窗口，signal 以 interrupted abort，句柄作废，它的失败任务不能再重试", async () => {
        const w = await world();
        const client = await w.window("a");
        const owner = await w.owner("a");
        const running = owner.tasks.start({title: "跑着的", cancellable: true});
        const failed = owner.tasks.start({title: "失败的", retry: () => undefined});
        failed.fail({message: "x"});
        const others = w.tasks.start({title: "别的发起方"});
        expect(item(await list(client), failed.id)?.retryable).toBe(true);
        const seen = await pushes(client);
        await pushed(w, seen, "第一份清单", (latest) => item(latest, running.id) !== undefined);

        await owner.stop();
        await pushed(w, seen, "已中断推到窗口", (latest) => item(latest, running.id)?.state === "interrupted");
        expect(running.signal.aborted).toBe(true);
        expect(running.signal.reason).toBe("interrupted");
        running.succeed();
        running.report({message: "晚到的"});
        const items = await list(client);
        expect(item(items, running.id)).toMatchObject({state: "interrupted", retryable: false});
        expect(item(items, failed.id)?.retryable).toBe(false);
        expect(await client.retry({id: failed.id})).toMatchObject({ok: false, code: "not-retryable"});
        expect(item(items, others.id)?.state).toBe("running");
        expect(await client.cancel({id: running.id})).toMatchObject({ok: false, code: "not-running"});
    });
});

describe("整体关停（时序与寿命）", () => {
    test("服务停止：订阅以 provider-stopped 结束、不再推送；在跑的 signal 以 interrupted abort，最后一份清单里仍是在跑", async () => {
        const w = await world();
        const client = await w.window("a");
        const handle = w.tasks.start({title: "跑着的"});
        const seen: TaskItem[][] = [];
        const ended: string[] = [];
        expect(await client.events.ownChanged.subscribe({}, (payload) => void seen.push(payload.tasks), {onEnd: (reason) => void ended.push(reason)})).toMatchObject({ok: true});
        await pushed(w, seen, "第一份清单", (latest) => item(latest, handle.id) !== undefined);
        expect(await w.settings.hub.stop()).toMatchObject({status: "closed"});
        await waitUntil("订阅结束", () => ended.length > 0);
        expect(ended).toEqual(["provider-stopped"]);
        expect(handle.signal.reason).toBe("interrupted");
        const count = seen.length;
        for (let step = 0; step < 4; step += 1) w.settings.clock.advance(PUSH_INTERVAL_MS);
        expect(seen).toHaveLength(count);
        expect(item(seen.at(-1)!, handle.id)?.state).toBe("running");
        expect(diagnostics(w, "tasks.push-failed")).toEqual([]);
    });
});

describe("关闭服务前报出（输出 17）", () => {
    test("在跑的任务每件一项、写它的标题（文字引用原样），结束的不报；入口停止后不再报", async () => {
        const w = await world();
        const title = {kind: "text" as const, ns: "nbook.tasks", key: "install", params: {name: "lint"}};
        w.tasks.start({title: "导出全书"});
        const done = w.tasks.start({title: "已结束的"});
        w.tasks.start({title});
        done.succeed();
        expect(w.work.collect()).toEqual({items: [{plugin: "nbook.tasks", text: "导出全书"}, {plugin: "nbook.tasks", text: title}], failed: []});
        expect(await w.settings.hub.stop()).toMatchObject({status: "closed"});
        expect(w.work.collect()).toEqual({items: [], failed: []});
    });
});

describe("清单太大（失败与恢复）", () => {
    test("整份清单超过 512 KiB：list 得 too-large、推送跳过，都记诊断", async () => {
        const w = await world();
        const client = await w.window("a");
        // 每件的进展 500 个汉字（1500 字节），400 件约 600 KiB。
        for (let index = 0; index < 400; index += 1) w.tasks.start({title: `t${String(index)}`, message: "长".repeat(500)});
        expect(await client.own({})).toMatchObject({ok: false, code: "too-large"});
        const seen = await pushes(client);
        await waitUntil("推送跳过的诊断", () => {
            w.settings.clock.advance(PUSH_INTERVAL_MS);
            return diagnostics(w, "tasks.list-too-large").length >= 2;
        });
        await client.own({});
        expect(seen).toEqual([]);
    });
});
