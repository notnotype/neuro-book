/**
 * `nbook.desktop` 的浏览器入口（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）。
 *
 * - 公开状态 `nbook.desktop/inDesktop` 总是声明：浏览器里为 false，桌面里为 true。缩放命令拿它作 `when`；不声明的话，它们每次
 *   启动都会报“未声明的键”。
 * - 在桌面壳的窗口里，把本插件各项的有效值交给壳（激活时一次，之后每次有效值变化、每次改缩放）。几个窗口各交一次，壳按值去重。
 *   设置的拥有者是服务端的 `nbook.settings`：直接改设置文件时它监视到变化、推给窗口，这里同样收到。
 * - 缩放的快捷键与 Ctrl+滚轮只在桌面里接管（`zoom.ts`）；浏览器里留给浏览器自己的缩放。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {notificationsKey} from "nbook/plugins/workbench/shared/contracts";
import type {DesktopSettingValues} from "nbook/shared/desktop-bridge";
import {windowDesktopKey} from "nbook/shared/host";
import {createWheelAccumulator} from "nbook/shared/wheel-steps";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {desktopSettings} from "../shared/contracts";
import {createZoomController, zoomKeyAction} from "./zoom";
import type {ZoomAction, ZoomKey} from "./zoom";

export const desktopState = definePublicState(descriptor.id, {
    inDesktop: {type: "boolean", unready: false, reason: {"zh-CN": "只在 NeuroBook 桌面版里可用", "en-US": "Only available in the NeuroBook desktop app"}},
});

/** 内置命令的 id 是 `nbook.<域>.<动作>`（commands.md），缩放属于视图域；旧桌面菜单的 `view.zoom-*` 落到这三条。 */
export const ZOOM_IN_COMMAND = "nbook.view.zoom-in";
export const ZOOM_OUT_COMMAND = "nbook.view.zoom-out";
export const RESET_ZOOM_COMMAND = "nbook.view.zoom-reset";

const ZOOM_COMMANDS: ReadonlyArray<{readonly id: string; readonly action: ZoomAction; readonly declaration: WrittenCommandDeclaration}> = [
    {id: ZOOM_IN_COMMAND, action: "in", declaration: zoomCommand({"zh-CN": "放大", "en-US": "Zoom In"}, "Zoom every desktop window in by one step.")},
    {id: ZOOM_OUT_COMMAND, action: "out", declaration: zoomCommand({"zh-CN": "缩小", "en-US": "Zoom Out"}, "Zoom every desktop window out by one step.")},
    {id: RESET_ZOOM_COMMAND, action: "reset", declaration: zoomCommand({"zh-CN": "重置缩放", "en-US": "Reset Zoom"}, "Reset the zoom of every desktop window to 100%.")},
];

function zoomCommand(title: {readonly "zh-CN": string; readonly "en-US": string}, description: string): WrittenCommandDeclaration {
    return {
        title,
        category: {"zh-CN": "视图", "en-US": "View"},
        description,
        args: Type.Object({}, {additionalProperties: false}),
        effect: "write",
        when: {requires: [desktopState.key("inDesktop")]},
        expose: {agent: "never"},
    };
}

export const desktopEntry = defineEntry({
    id: "browser",
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: windowDesktopKey, required: false}, {key: notificationsKey, required: false}],
    contributions: [...desktopState.contributions, ...ZOOM_COMMANDS.map(({id, declaration}) => ({capability: COMMANDS_POINT, id, declaration}))],
    activate: async (context) => {
        const settings = context.services.require(settingsKey);
        const diagnostics = context.services.require(diagnosticsKey);
        const resolved = await context.services.resolve(windowDesktopKey);
        const desktop = resolved.status === "resolved" && resolved.instance.available ? resolved.instance : null;
        const notifications = await context.services.resolve(notificationsKey);
        const zoom = createZoomController({
            settings,
            report: (values) => report(values),
            failed: (detail) => {
                diagnostics.record({level: "warn", event: "desktop.zoom.write-failed", message: "Writing the zoom setting failed", data: {detail}});
                if (notifications.status === "resolved") void notifications.instance.notify({tone: "error", title: {"zh-CN": "缩放没有保存", "en-US": "Zoom was not saved"}, message: {"zh-CN": "界面缩放回到了之前的值。", "en-US": "The zoom is back to its previous value."}, detail});
            },
            schedule: (callback, ms) => {
                const timer = setTimeout(callback, ms);
                return () => clearTimeout(timer);
            },
        });
        context.scope.register({kind: "desktop-zoom", label: `${descriptor.id} zoom`, value: zoom, release: (value) => value.dispose()});
        // 用户层此刻不可用或无效时（连接还没建立、文件写坏了）读到的是缺省值，交给壳会被当真：复位缩放、删掉开机自启。
        // 等它恢复后有效值一变，这里会再交。
        function report(values: DesktopSettingValues): void {
            if (desktop === null || settings.inspect(desktopSettings.zoom).user.status !== "ok") return;
            desktop.reportSettings(values);
        }
        if (desktop !== null) {
            const keys = new Set(Object.values(desktopSettings).map((setting) => setting.key));
            report(zoom.values());
            const stop = settings.onDidChange((changed) => {
                if ([...changed].some((key) => keys.has(key))) report(zoom.values());
            });
            const onPageHide = (): void => zoom.flush();
            // 这个文件在后端的类型检查范围里，没有 DOM 类型：监听挂在 globalThis 上，事件只取用到的成员。keydown、wheel 派发的
            // 就是 KeyboardEvent、WheelEvent，所以按这几个成员读是成立的。
            // 捕获阶段：先于编辑器与工作台的键位处理；认到的组合不再往下传。
            const onKeydown = (event: Event): void => {
                const action = zoomKeyAction(event as unknown as ZoomKey);
                if (action === null) return;
                event.preventDefault();
                event.stopPropagation();
                zoom.apply(action);
            };
            // 冒泡阶段、先看别人处理过没有：图片查看器自己用 Ctrl+滚轮缩放图片（ImageViewer.vue）。
            const wheel = createWheelAccumulator();
            const onWheel = (event: Event): void => {
                const scroll = event as unknown as {readonly ctrlKey: boolean; readonly deltaY: number};
                if (!scroll.ctrlKey || event.defaultPrevented) return;
                event.preventDefault();
                const action = wheel(scroll.deltaY);
                if (action !== null) zoom.apply(action);
            };
            globalThis.addEventListener("pagehide", onPageHide);
            globalThis.addEventListener("keydown", onKeydown, true);
            globalThis.addEventListener("wheel", onWheel, {passive: false});
            context.scope.register({
                kind: "desktop-zoom-input",
                label: `${descriptor.id} zoom input`,
                value: null,
                release: () => {
                    stop();
                    globalThis.removeEventListener("pagehide", onPageHide);
                    globalThis.removeEventListener("keydown", onKeydown, true);
                    globalThis.removeEventListener("wheel", onWheel);
                },
            });
        }
        const published = bindingsOf(desktopState, {inDesktop: {value: desktop !== null}});
        return {
            contributions: {
                [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                [COMMANDS_POINT]: Object.fromEntries(ZOOM_COMMANDS.map(({id, action}) => [id, {run: () => {
                    zoom.apply(action);
                    return {ok: true as const, value: undefined};
                }}])),
            },
        };
    },
});

export const desktopBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [desktopEntry],
};
