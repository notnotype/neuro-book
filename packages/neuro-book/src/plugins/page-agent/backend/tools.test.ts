/**
 * 截图工具的整条流程（docs/specs/agent/page-agent.md 输出 8、12、14 与截图状态）：真实服务端与窗口实例经进程内链路连上路由，
 * 工具实现、选窗口器与上传路由都是真的；窗口一侧是按同一份合同交出状态的测试插件（`testing/window-side.ts`），它像真实的
 * 窗口那样凭拿到的凭证把图传给路由。
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

import {CAPTURE_TOKEN_HEADER} from "../shared/contracts";
import type {WindowInfo} from "../shared/contracts";
import {JPEG_64X40} from "../testing/images";
import {hubCaller, testWindow, testWindowState} from "../testing/window-side";
import type {TestWindowState} from "../testing/window-side";
import {createCaptureStore} from "./captures";
import {screenshotImplementation, screenshotTool} from "./tools";
import {createWindowSelector} from "./windows";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-page-agent", "screenshot");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function toolContext(signal: AbortSignal): ToolContext {
    counter += 1;
    return {signal, callId: `c${String(counter)}`, invocation: `i${String(counter)}`, sessionId: "s1", initial: null, read: () => undefined, leafMoves: 0};
}

async function setup(info: Partial<WindowInfo> = {}) {
    counter += 1;
    const hub = hubCaller();
    const world = await settingsWorld(join(tmp, `case-${String(counter)}`), [hub.plugin]);
    worlds.push(world);
    const state: TestWindowState = testWindowState({name: "w1", title: "NeuroBook", focused: true, ...info});
    await world.window("w1", [testWindow(state)], {project: "book"});
    const reports: string[] = [];
    const captures = createCaptureStore(world.clock, (message) => reports.push(message));
    const implementation = screenshotImplementation({remote: hub.remote, windows: createWindowSelector(hub.remote, () => world.clock.now()), captures});
    const tool = await implementation.create({sessionId: "s1", profile: "test", project: "P"}, {} as never);
    const run = async (args: Readonly<Record<string, unknown>>, signal: AbortSignal = new AbortController().signal): Promise<ToolResult> => {
        const result = await tool.execute(args, toolContext(signal));
        if (typeof result === "string") throw new Error(`截图工具交回了纯文字：${result}`);
        // 失败详情要合声明的 errors，代码里才拿得到（agent/eval.md 输出 8）；不合的会被 eval 丢掉。
        if (result.status === "error" && result.details !== undefined) {
            const declared = screenshotTool.contribution.declaration.errors?.[result.code!];
            expect(declared === undefined ? `${result.code!} 没有声明 errors` : Value.Check(declared as never, result.details)).toBe(true);
        }
        return result;
    };
    /** 像窗口那样上传：凭证在请求头里。 */
    const upload = async (token: string, bytes: Uint8Array): Promise<number> => (await captures.routes.request("/captures", {method: "PUT", headers: {[CAPTURE_TOKEN_HEADER]: token}, body: bytes})).status;
    return {world, state, run, upload, implementation, reports};
}

describe("截图（输出 8）", () => {
    it("窗口传上来的图进结果：一张 JPEG，尺寸按文件头而不是窗口自报的；结果写明截的是哪个窗口、是窗口还是控件", async () => {
        const {state, run, upload} = await setup();
        const received: Array<{token: string; of?: unknown}> = [];
        state.capture = async (input) => {
            received.push(input);
            expect(await upload(input.token, JPEG_64X40)).toBe(204);
            return {ok: true, target: input.of === undefined ? "window" : "element", width: 999, height: 999, warnings: input.of === undefined ? [] : ["rebound: w1.3 -> w1.7"]};
        };
        const whole = await run({});
        expect(whole.status).toBeUndefined();
        expect(whole.images).toEqual([{data: Buffer.from(JPEG_64X40).toString("base64"), mime: "image/jpeg", width: 64, height: 40}]);
        expect(whole.details).toMatchObject({window: {name: "w1", title: "NeuroBook"}, target: "window", width: 64, height: 40, warnings: []});
        expect(whole.text).toContain("w1");

        const element = await run({of: {role: "button", name: "保存"}});
        // 按 of 定位时窗口交来的警告（输出 4 的 rebound）随结果交回。
        expect(element.details).toMatchObject({target: "element", warnings: ["rebound: w1.3 -> w1.7"]});
        expect(received[1]!.of).toEqual({role: "button", name: "保存"});
        // 每次截图一个新凭证。
        expect(received[0]!.token).not.toBe(received[1]!.token);
    });

    it("审批的判定对象按有没有 of 分 window 与 element", async () => {
        const {implementation} = await setup();
        expect(implementation.subjects?.({})).toEqual([{kind: "screen", value: "window"}]);
        expect(implementation.subjects?.({of: {text: "保存"}})).toEqual([{kind: "screen", value: "element"}]);
    });

    it("窗口说截好了、服务端没收到图：window-unresponsive，cause 是 capture-missing，没有图", async () => {
        const {state, run} = await setup();
        state.capture = async () => ({ok: true, target: "window", width: 64, height: 40});
        const result = await run({});
        expect(result).toMatchObject({status: "error", code: "window-unresponsive", details: {cause: "capture-missing"}});
        expect(result.images).toBeUndefined();
    });

    it("调用被停止后窗口才交来的图被拒收（410），结果里没有图", async () => {
        const {state, run, upload} = await setup();
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        // 赋值在回调里，写成 as 免得类型收窄成 null。
        let lateStatus = null as number | null;
        state.capture = async (input) => {
            await gate;
            lateStatus = await upload(input.token, JPEG_64X40);
            return {ok: true, target: "window", width: 64, height: 40};
        };
        const call = new AbortController();
        const pending = run({}, call.signal);
        await waitUntil("窗口收到截图调用", () => state.captured === 1);
        call.abort();
        const result = await pending;
        expect(result.status).toBe("error");
        expect(result.images).toBeUndefined();
        release();
        await waitUntil("窗口上传完", () => lateStatus);
        expect(lateStatus).toBe(410);
    });

    it("调用以失败结束后凭证随之作废：窗口这时才传的图得 410", async () => {
        const {state, run, upload} = await setup();
        let token = "";
        state.capture = async (input) => {
            token = input.token;
            return {ok: false, code: "capture-failed", detail: {message: "画到一半出错"}};
        };
        expect(await run({})).toMatchObject({status: "error", code: "window-unresponsive"});
        expect(await upload(token, JPEG_64X40)).toBe(410);
    });

    it("选中的窗口看不见：window-hidden，不调窗口截图", async () => {
        const {state, run} = await setup({visible: false});
        expect(await run({})).toMatchObject({status: "error", code: "window-hidden"});
        expect(state.captured).toBe(0);
    });

    it("of 写错（两种主定位）：invalid-arguments，不选窗口也不截图", async () => {
        const {state, run} = await setup();
        expect(await run({of: {text: "保存", role: "button"}})).toMatchObject({status: "error", code: "invalid-arguments"});
        expect(state.asked).toBe(0);
        expect(state.captured).toBe(0);
    });

    it("窗口交回的失败：页面里的码原样（带候选），画不出来换成 window-unresponsive、cause 是 capture-failed", async () => {
        const {state, run} = await setup();
        const candidates = [{ref: "a1:3", role: "button", name: "保存"}];
        state.capture = async () => ({ok: false, code: "ambiguous", detail: {message: "命中两个", candidates}});
        expect(await run({of: {text: "保存"}})).toMatchObject({status: "error", code: "ambiguous", details: {candidates}});
        state.capture = async () => ({ok: false, code: "not-found", detail: {message: "没有"}});
        expect(await run({of: {text: "保存"}})).toMatchObject({status: "error", code: "not-found"});
        state.capture = async () => ({ok: false, code: "not-found", detail: {message: "没有", layers: ["base", "dialog \"添加服务商\""], covered: {layer: "dialog \"添加服务商\""}}});
        expect(await run({of: {text: "保存"}})).toMatchObject({status: "error", code: "not-found", details: {layers: ["base", "dialog \"添加服务商\""], covered: {layer: "dialog \"添加服务商\""}}});
        state.capture = async () => ({ok: false, code: "window-hidden", detail: {message: "窗口转后台了"}});
        expect(await run({})).toMatchObject({status: "error", code: "window-hidden"});
        state.capture = async () => ({ok: false, code: "capture-failed", detail: {message: "要截的元素没有大小"}});
        const failed = await run({of: {text: "保存"}});
        expect(failed).toMatchObject({status: "error", code: "window-unresponsive", details: {cause: "capture-failed"}});
        expect(failed.text).toContain("要截的元素没有大小");
    });
});
