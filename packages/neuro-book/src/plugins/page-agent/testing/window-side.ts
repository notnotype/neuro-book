/**
 * 页面一侧的测试替身：按窗口合同 `nbook.page-agent/window` 交出状态的测试插件（真实的窗口一侧要页面引擎挂在 DOM 上，Bun 里
 * 没有），与拿服务端远程入口的测试插件。只由测试使用。
 */

import type {Locator} from "@notnotype/nb-page-agent/api";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {PAGE_AGENT_PLUGIN, pageAgentWindowContract} from "../shared/contracts";
import type {PageFailureDetail, WindowInfo} from "../shared/contracts";

/** 截图的答复：成功时窗口自己报的尺寸，失败时窗口合同里的码。 */
export type CaptureReply =
    | {readonly ok: true; readonly target: "window" | "element"; readonly width: number; readonly height: number}
    | {readonly ok: false; readonly code: "stale-ref" | "ambiguous" | "not-found" | "invalid-locator" | "window-hidden" | "capture-failed"; readonly detail: PageFailureDetail};

export interface TestWindowState {
    info: WindowInfo;
    /** 在时扣住 `info` 的回复（回复的是被问到那一刻的状态）。 */
    gate?: Promise<void>;
    /** `info` 被问了几次。 */
    asked: number;
    /** 截图怎么答；不给时答 capture-failed。 */
    capture?: (input: {readonly token: string; readonly of?: Locator}) => Promise<CaptureReply>;
    /** 截图被调了几次。 */
    captured: number;
}

export const windowInfo = (over: Partial<WindowInfo> = {}): WindowInfo => ({name: "a1", title: "NeuroBook", path: "/", width: 1280, height: 800, visible: true, focused: false, lastInputAt: null, ...over});

export function testWindowState(over: Partial<WindowInfo> = {}): TestWindowState {
    return {info: windowInfo(over), asked: 0, captured: 0};
}

export function testWindow(state: TestWindowState): PluginDefinition {
    return {
        id: PAGE_AGENT_PLUGIN,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            remoteProvides: [pageAgentWindowContract],
            activate: () => ({
                remote: [provideRemote(pageAgentWindowContract, () => ({
                    methods: {
                        info: async (_input, call) => {
                            const answer = state.info;
                            state.asked += 1;
                            await state.gate;
                            return call.ok(answer);
                        },
                        snapshot: (_input, call) => call.fail("not-found", {message: "测试窗口不做快照"}),
                        find: (_input, call) => call.ok({window: state.info, entries: []}),
                        capture: async (input, call) => {
                            state.captured += 1;
                            if (state.capture === undefined) return call.fail("capture-failed", {message: "测试窗口不截图"});
                            const reply = await state.capture(input);
                            if (reply.ok) return call.ok({window: state.info, target: reply.target, width: reply.width, height: reply.height});
                            switch (reply.code) {
                                case "stale-ref": return call.fail("stale-ref", reply.detail);
                                case "ambiguous": return call.fail("ambiguous", reply.detail);
                                case "not-found": return call.fail("not-found", reply.detail);
                                case "invalid-locator": return call.fail("invalid-locator", reply.detail);
                                case "window-hidden": return call.fail("window-hidden", reply.detail);
                                case "capture-failed": return call.fail("capture-failed", reply.detail);
                            }
                        },
                    },
                }))],
            }),
        }],
    };
}

/** 服务端的测试插件：只拿远程入口，测试据此建选窗口器与工具实现。 */
export function hubCaller(): {readonly plugin: PluginDefinition; remote(): ActivationContext["remote"]} {
    let remote: ActivationContext["remote"] | null = null;
    return {
        plugin: {id: "test.page-agent-hub", entries: [{id: "server", location: "server", activationEvents: ["onStartup"], activate: (context) => {
            remote = context.remote;
            return {};
        }}]},
        remote: () => {
            if (remote === null) throw new Error("服务端的测试插件还没激活");
            return remote;
        },
    };
}
