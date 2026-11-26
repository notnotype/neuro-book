/**
 * 选窗口与通道失败的换算（docs/specs/agent/page-agent.md 输出 1、2、14）：真实服务端与几个窗口实例经进程内链路连上路由，
 * 窗口一侧是按同一份合同交出状态的测试插件（`testing/window-side.ts`）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import type {WindowInfo} from "../shared/contracts";
import {hubCaller, testWindow, testWindowState} from "../testing/window-side";
import type {TestWindowState} from "../testing/window-side";
import {callFailure, createWindowSelector, PROBE_TIMEOUT_MS, RECENT_WINDOW_MS} from "./windows";
import type {WindowSelector} from "./windows";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-page-agent", "select-window");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Setup {
    readonly world: SettingsWorld;
    readonly selector: WindowSelector;
    readonly states: Readonly<Record<string, TestWindowState>>;
}

/** 几个窗口：`book` 是作品 P，别的短名是另一部作品，`null` 不绑定作品；`plain` 不带本插件（相当于没刷新的旧页面）。 */
async function setup(windows: Readonly<Record<string, {readonly project: string | null; readonly info?: Partial<WindowInfo>; readonly plain?: boolean}>>): Promise<Setup> {
    counter += 1;
    const hub = hubCaller();
    const world = await settingsWorld(join(tmp, `case-${String(counter)}`), [hub.plugin]);
    worlds.push(world);
    const states: Record<string, TestWindowState> = {};
    for (const [id, spec] of Object.entries(windows)) {
        const state = testWindowState({name: id, ...spec.info});
        states[id] = state;
        const options = spec.project === null ? {bound: false} : {project: spec.project};
        await world.window(id, spec.plain === true ? [] : [testWindow(state)], options);
    }
    return {world, selector: createWindowSelector(hub.remote, () => world.clock.now()), states};
}

const signal = () => new AbortController().signal;

describe("选窗口（输出 1）", () => {
    it("只选打开会话所属作品的窗口；不属于作品的会话只选不绑定作品的窗口", async () => {
        const {selector} = await setup({mine: {project: "book", info: {lastInputAt: 1}}, other: {project: "other", info: {focused: true, lastInputAt: 9}}, shelf: {project: null, info: {lastInputAt: 5}}});
        expect(await selector.select({id: "s1", project: "P"}, signal())).toMatchObject({ok: true, id: "mine"});
        expect(await selector.select({id: "s2"}, signal())).toMatchObject({ok: true, id: "shelf"});
        const none = await selector.select({id: "s3", project: "project-missing"}, signal());
        expect(none).toMatchObject({ok: false, code: "no-window"});
        if (!none.ok) expect(none.message).toContain("没有打开这部作品的窗口");
    });

    it("依次取：上次用的（看得见、2 分钟内用过）、有焦点的、看得见里最近有输入的；都看不见时取最近有输入的", async () => {
        const {world, selector, states} = await setup({a: {project: "book", info: {lastInputAt: 10}}, b: {project: "book", info: {lastInputAt: 20}}, c: {project: "book", info: {visible: false, lastInputAt: 30}}});
        const session = {id: "s", project: "P"};
        expect(await selector.select(session, signal())).toMatchObject({id: "b"});
        // 用户切到 a 并有了焦点：b 仍看得见、2 分钟内用过，不跟过去。
        states.a!.info = {...states.a!.info, focused: true, lastInputAt: 40};
        expect(await selector.select(session, signal())).toMatchObject({id: "b"});
        // 2 分钟没用之后改选有焦点的。
        world.clock.advance(RECENT_WINDOW_MS + 1);
        expect(await selector.select(session, signal())).toMatchObject({id: "a"});
        // 上次用的转后台：不再优先。
        states.a!.info = {...states.a!.info, focused: false, visible: false};
        expect(await selector.select(session, signal())).toMatchObject({id: "b"});
        states.b!.info = {...states.b!.info, visible: false};
        expect(await selector.select({id: "fresh", project: "P"}, signal())).toMatchObject({id: "a"});
    });

    it("子会话自己选，不继承父会话上次用的窗口", async () => {
        const {selector, states} = await setup({a: {project: "book", info: {focused: true}}, b: {project: "book", info: {lastInputAt: 5}}});
        expect(await selector.select({id: "parent", project: "P"}, signal())).toMatchObject({id: "a"});
        states.a!.info = {...states.a!.info, focused: false};
        states.b!.info = {...states.b!.info, focused: true};
        expect(await selector.select({id: "child", project: "P"}, signal())).toMatchObject({id: "b"});
        expect(await selector.select({id: "parent", project: "P"}, signal())).toMatchObject({id: "a"});
    });

    it("同一会话的两次选择串行：第一次还没选完时焦点变了，第二次仍用第一次选中的窗口", async () => {
        const {selector, states} = await setup({a: {project: "book", info: {focused: true}}, b: {project: "book"}});
        let open = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            open = resolve;
        });
        states.a!.gate = gate;
        states.b!.gate = gate;
        const first = selector.select({id: "s", project: "P"}, signal());
        while (states.a!.asked + states.b!.asked < 2) await Promise.resolve();
        // 第一次已经问过两个窗口（a 有焦点），这时第二次发出、焦点切到 b：不串行的话第二次自己问到的是 b 有焦点。
        const second = selector.select({id: "s", project: "P"}, signal());
        states.a!.info = {...states.a!.info, focused: false};
        states.b!.info = {...states.b!.info, focused: true};
        open();
        expect(await first).toMatchObject({id: "a"});
        expect(await second).toMatchObject({id: "a"});
    });
});

describe("没有可用的窗口与通道失败（输出 2、14）", () => {
    it("候选都不提供窗口合同：no-window，请用户刷新", async () => {
        const {selector} = await setup({old: {project: "book", plain: true}});
        const result = await selector.select({id: "s", project: "P"}, signal());
        expect(result).toMatchObject({ok: false, code: "no-window", cause: "not-provided"});
    });

    it("候选在时限里不应答、又没有别的可用候选：window-unresponsive", async () => {
        const {world, selector, states} = await setup({slow: {project: "book"}, old: {project: "book", plain: true}});
        states.slow!.gate = new Promise(() => undefined);
        let settled = false;
        const pending = selector.select({id: "s", project: "P"}, signal()).finally(() => {
            settled = true;
        });
        // 探测的计时在列完实例之后才登记：让出几轮微任务、每轮把时钟拨过时限，直到选择结束。
        for (let round = 0; round < 50 && !settled; round += 1) {
            await Promise.resolve();
            world.clock.advance(PROBE_TIMEOUT_MS + 1);
        }
        expect(await pending).toMatchObject({ok: false, code: "window-unresponsive", cause: "timeout"});
    });

    it("调用阶段的换算：target-gone 得 window-gone，not-provided 得 no-window，其余得 window-unresponsive，原码在 cause", () => {
        expect(callFailure({ok: false, code: "target-gone"})).toMatchObject({code: "window-gone", cause: "target-gone"});
        expect(callFailure({ok: false, code: "version-changed"})).toMatchObject({code: "no-window", cause: "version-changed"});
        for (const code of ["timeout", "provider-error", "unavailable"] as const) {
            expect(callFailure({ok: false, code})).toMatchObject({code: "window-unresponsive", cause: code});
        }
    });
});
