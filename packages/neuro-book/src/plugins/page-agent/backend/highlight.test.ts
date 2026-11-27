/**
 * `ui.highlight` 的服务端（docs/specs/agent/page-agent.md 输出 9、11、14 与“时序与寿命”）：真实服务端与窗口实例经进程内链路连上
 * 路由，选窗口器与工具实现都是真的；窗口一侧是按同一份合同收订阅、由测试推事件的测试插件（`testing/window-side.ts`）。
 * 时钟是测试场地的手动时钟：截止与等用户的上限都靠 `advance` 到点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Value} from "typebox/value";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {ToolContext, ToolResult} from "@notnotype/nb-harness/kernel/contracts";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import type {WindowInfo} from "../shared/contracts";
import {hubCaller, testWindow, testWindowState} from "../testing/window-side";
import type {TestWindowState} from "../testing/window-side";
import {createCaptureStore} from "./captures";
import {createActiveHighlights, highlightImplementation, highlightTool, INSTALL_TIMEOUT_MS} from "./highlight";
import {createWindowSelector} from "./windows";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-page-agent", "highlight");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const installed = {kind: "installed" as const, window: testWindowState({name: "w1"}).info, target: {ref: "w1.3", role: "button", name: "保存"}, warnings: []};

async function setup(info: Partial<WindowInfo> = {}) {
    counter += 1;
    const hub = hubCaller();
    const world = await settingsWorld(join(tmp, `case-${String(counter)}`), [hub.plugin]);
    worlds.push(world);
    const state: TestWindowState = testWindowState({name: "w1", focused: true, ...info});
    const window = await world.window("w1", [testWindow(state)], {project: "book"});
    const active = createActiveHighlights();
    const implementation = highlightImplementation({
        remote: hub.remote,
        windows: createWindowSelector(hub.remote, () => world.clock.now()),
        captures: createCaptureStore(world.clock, () => undefined),
        clock: world.clock,
        active,
    });
    const tool = await implementation.create({sessionId: "s1", profile: "test", project: "P"}, {} as never);
    /** 每次调用自报的等用户：promise 还没结算时就是在等。 */
    const waits: Array<{settled: boolean}> = [];
    const start = (args: Readonly<Record<string, unknown>>, signal: AbortSignal = new AbortController().signal): Promise<ToolResult> => {
        counter += 1;
        const context: ToolContext = {
            signal, callId: `c${String(counter)}`, invocation: `i${String(counter)}`, sessionId: "s1", initial: null, read: () => undefined, leafMoves: 0,
            waitingForUser: <T,>(promise: Promise<T>): Promise<T> => {
                const wait = {settled: false};
                waits.push(wait);
                void promise.finally(() => {
                    wait.settled = true;
                });
                return promise;
            },
        };
        return (async () => {
            const result = await tool.execute(args, context);
            if (typeof result === "string") throw new Error(`高亮工具交回了纯文字：${result}`);
            // 失败详情要合声明的 errors，代码里才拿得到（agent/eval.md 输出 8）。
            if (result.status === "error" && result.details !== undefined) {
                const declared = highlightTool.contribution.declaration.errors?.[result.code!];
                expect(declared === undefined ? `${result.code!} 没有声明 errors` : Value.Check(declared as never, result.details)).toBe(true);
            }
            return result;
        })();
    };
    /** 等窗口收到第 n 个高亮订阅（从 1 起）。 */
    const subscription = async (n = 1) => {
        await waitUntil("窗口收到这个高亮订阅", () => state.highlights.length >= n);
        return state.highlights[n - 1]!;
    };
    return {world, window, state, start, subscription, waits, active};
}

describe("结局与等用户（输出 9、11）", () => {
    it("窗口画好之后才开始等用户；页面上的结局原样交回，带窗口与问题；交回后订阅退订（窗口那边撤掉）", async () => {
        const {start, subscription, waits} = await setup();
        const pending = start({at: {command: "workbench.settings"}, message: "点这里", until: "next", step: 1, total: 2});
        const sub = await subscription();
        expect(sub.filter).toEqual({at: {target: "command", key: "workbench.settings"}, message: "点这里", until: "next", step: 1, total: 2});
        expect(waits).toEqual([]);
        sub.emit(installed);
        await waitUntil("自报开始等用户", () => waits.length === 1);
        expect(waits[0]!.settled).toBe(false);
        sub.emit({kind: "outcome", outcome: {outcome: "asked", question: "主题在哪？"}});
        const result = await pending;
        expect(result.details).toMatchObject({outcome: "asked", question: "主题在哪？", window: {name: "w1"}});
        expect(result.status).toBeUndefined();
        await waitUntil("窗口那边被退订、等用户收回", () => sub.signal.aborted && waits[0]!.settled);
    });

    it("点错的结局带点到的控件；上一步、替换等其余结局照样交回", async () => {
        const {start, subscription} = await setup();
        const first = start({at: {text: "保存"}, message: "点保存", until: "click"});
        const one = await subscription(1);
        one.emit(installed);
        one.emit({kind: "outcome", outcome: {outcome: "missed", clicked: {ref: "w1.9", role: "button", name: "取消"}}});
        expect((await first).details).toMatchObject({outcome: "missed", clicked: {ref: "w1.9", role: "button", name: "取消"}});
        const second = start({at: {text: "保存"}, message: "看这里", until: "next", back: true});
        const two = await subscription(2);
        two.emit(installed);
        two.emit({kind: "outcome", outcome: {outcome: "back"}});
        expect((await second).details).toMatchObject({outcome: "back"});
    });

    it("等用户的上限从画好时算起，由服务端的时钟计：到点结局是 timeout，窗口那边被退订", async () => {
        const {world, start, subscription, waits} = await setup();
        let done = false;
        const pending = start({at: {text: "保存"}, message: "点保存", until: "click", timeout: 2}).then((result) => {
            done = true;
            return result;
        });
        const sub = await subscription();
        // 画好之前过了 5 秒：不算进等用户的上限（装上的截止是 10 秒，也还没到）。
        world.clock.advance(5000);
        sub.emit(installed);
        await waitUntil("自报开始等用户", () => waits.length === 1);
        world.clock.advance(1999);
        await Promise.resolve();
        expect(done).toBe(false);
        world.clock.advance(1);
        expect((await pending).details).toMatchObject({outcome: "timeout"});
        await waitUntil("窗口那边被退订、等用户收回", () => sub.signal.aborted && waits[0]!.settled);
    });

    it("窗口 10 秒里没画出来得 window-unresponsive；页面上的失败（定位）原样交回带候选；写错的定位是参数错误；页面画不出来按窗口出错", async () => {
        const {world, start, subscription} = await setup();
        const slow = start({at: {text: "保存"}, message: "点保存", until: "click"});
        const one = await subscription(1);
        world.clock.advance(INSTALL_TIMEOUT_MS);
        expect(await slow).toMatchObject({status: "error", code: "window-unresponsive", details: {cause: "timeout"}});
        await waitUntil("窗口那边被退订", () => one.signal.aborted);

        const ambiguous = start({at: {text: "保存"}, message: "点保存", until: "click"});
        const two = await subscription(2);
        two.emit({kind: "failed", code: "ambiguous", detail: {message: "命中 2 个", candidates: [{ref: "w1.1", role: "button", name: "保存"}, {ref: "w1.2", role: "button", name: "保存"}]}});
        expect(await ambiguous).toMatchObject({status: "error", code: "ambiguous", details: {candidates: [{ref: "w1.1"}, {ref: "w1.2"}]}});

        const invalid = start({at: {text: "保存"}, message: "点保存", until: "click"});
        const three = await subscription(3);
        three.emit({kind: "failed", code: "invalid-locator", detail: {message: "定位只能给一种主定位"}});
        expect(await invalid).toMatchObject({status: "error", code: "invalid-arguments"});

        const broken = start({at: {text: "保存"}, message: "点保存", until: "click"});
        const four = await subscription(4);
        four.emit({kind: "failed", code: "guide-failed", detail: {message: "画高亮时出错：文字表坏了"}});
        expect(await broken).toMatchObject({status: "error", code: "window-unresponsive", details: {cause: "guide-failed"}});
        expect(await start({at: {command: "a", text: "b"}, message: "x", until: "click"})).toMatchObject({status: "error", code: "invalid-arguments"});
    });

    it("结局在订阅确认之前就到了：照样交回，拿到订阅的句柄就退订", async () => {
        const {start, state} = await setup();
        state.highlightAtOnce = [installed, {kind: "outcome", outcome: {outcome: "dismissed"}}];
        expect((await start({at: {text: "保存"}, message: "点保存", until: "next"})).details).toMatchObject({outcome: "dismissed"});
        await waitUntil("窗口那边被退订", () => state.highlights[0]?.signal.aborted);
    });

    it("选中的窗口看不见时不订阅，得 window-hidden", async () => {
        const {start, state} = await setup({visible: false});
        expect(await start({at: {text: "保存"}, message: "点保存", until: "click"})).toMatchObject({status: "error", code: "window-hidden"});
        expect(state.highlights).toEqual([]);
    });
});

describe("窗口断开、插件停止与停止 eval（输出 14、时序与寿命）", () => {
    it("画好之后窗口断开：结局 window-gone；画好之前断开：失败 window-gone", async () => {
        const first = await setup();
        const waiting = first.start({at: {text: "保存"}, message: "点保存", until: "click"});
        (await first.subscription()).emit(installed);
        await waitUntil("自报开始等用户", () => first.waits.length === 1);
        first.window.disconnect();
        expect((await waiting).details).toMatchObject({outcome: "window-gone"});
        await waitUntil("等用户收回", () => first.waits[0]!.settled);

        const second = await setup();
        const early = second.start({at: {text: "保存"}, message: "点保存", until: "click"});
        await second.subscription();
        second.window.disconnect();
        expect(await early).toMatchObject({status: "error", code: "window-gone", details: {cause: "target-gone"}});
    });

    it("插件停止时正在等的高亮以 window-gone 结束，等用户收回；停止 eval 时结局是 cancelled，窗口那边被退订", async () => {
        const {start, subscription, waits, active} = await setup();
        const waiting = start({at: {text: "保存"}, message: "点保存", until: "click"});
        (await subscription(1)).emit(installed);
        await waitUntil("自报开始等用户", () => waits.length === 1);
        active.stopAll();
        expect((await waiting).details).toMatchObject({outcome: "window-gone"});
        expect(waits[0]!.settled).toBe(true);

        const controller = new AbortController();
        const stopped = start({at: {text: "保存"}, message: "点保存", until: "click"}, controller.signal);
        const sub = await subscription(2);
        sub.emit(installed);
        await waitUntil("第二次调用自报开始等用户", () => waits.length === 2);
        controller.abort();
        expect((await stopped).details).toMatchObject({outcome: "cancelled"});
        await waitUntil("窗口那边被退订、等用户收回", () => sub.signal.aborted && waits[1]!.settled);
    });
});
