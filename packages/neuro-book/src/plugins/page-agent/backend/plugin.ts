/**
 * `nbook.page-agent` 的服务端入口：贡献 `ui` 的方法工具，选窗口并经远程合同调窗口里的页面引擎（docs/specs/agent/page-agent.md）。
 */

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {TOOLS_POINT} from "nbook/plugins/agent/shared/contracts";
import {clockKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {FIND_TOOL, HIGHLIGHT_TOOL, SCREENSHOT_TOOL, SNAPSHOT_TOOL} from "../shared/contracts";
import {createCaptureStore} from "./captures";
import {createActiveHighlights, highlightImplementation, highlightTool} from "./highlight";
import {findImplementation, findTool, screenshotImplementation, screenshotTool, snapshotImplementation, snapshotTool} from "./tools";
import {createWindowSelector} from "./windows";

export const pageAgentBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: clockKey}, {key: diagnosticsKey}],
        activationEvents: [snapshotTool.activationEvent, findTool.activationEvent, screenshotTool.activationEvent, highlightTool.activationEvent],
        contributions: [snapshotTool.contribution, findTool.contribution, screenshotTool.contribution, highlightTool.contribution, {capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
        activate: (context) => {
            const clock = context.services.require(clockKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const remote = () => context.remote;
            const captures = createCaptureStore(clock, (message) => {
                diagnostics.record({level: "warn", event: "page-agent.capture-upload", message, source: {plugin: descriptor.id}});
            });
            const highlights = createActiveHighlights();
            // 插件停止时作废全部截图凭证、取消正在读的上传（截图状态表）；正在等的高亮以 window-gone 结束（状态与转换）。
            context.signal.addEventListener("abort", () => {
                captures.dispose();
                highlights.stopAll();
            }, {once: true});
            const deps = {remote, windows: createWindowSelector(remote, () => clock.now()), captures, clock, active: highlights};
            return {
                contributions: {
                    [TOOLS_POINT]: {
                        [SNAPSHOT_TOOL]: snapshotImplementation(deps),
                        [FIND_TOOL]: findImplementation(deps),
                        [SCREENSHOT_TOOL]: screenshotImplementation(deps),
                        [HIGHLIGHT_TOOL]: highlightImplementation(deps),
                    },
                    [HTTP_ROUTES_POINT]: {[descriptor.id]: captures.routes},
                },
            };
        },
    })],
};
