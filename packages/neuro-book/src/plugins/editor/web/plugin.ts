/**
 * `nbook.editor` 浏览器入口（docs/specs/workbench/editor.md）：贡献工作台的编辑器槽、编辑器的命令与公开状态，提供文档
 * 协调服务；向宿主登记终态时的抢救与离开页面前的确认。编辑器区在激活时建立（命令随时可能到，例如资源管理器打开
 * 文件），绑定项目的窗口先读会话记录。
 */

import {computed, defineAsyncComponent, defineComponent, h, watch} from "vue";
import type {Component, PropType} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {WORKBENCH_EDITOR_AREA_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {EditorAreaContext, EditorAreaImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey, windowNavigationKey, windowRescueKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {documentCoordinatorKey} from "../shared/contracts";
import {CLOSE_COMMAND, EDITOR_COMMAND_DECLARATIONS, editorCommands, SAVE_COMMAND, SPLIT_RIGHT_COMMAND} from "./commands";
import {continueRequestOf, withoutContinueParams} from "./continue-writing";
import type {EditorKind} from "./groups/groups";
import {editorSessionStore} from "./session-record";
import {createEditorSession} from "./session";
import {editorState, editorStateValues} from "./state";
import {EDITOR_STATUS_ITEMS, editorStatusItems} from "./status-items";

export const EDITOR_AREA_ID = "nbook.editor.area";

/** 编辑器区内键位的意图对应的命令。 */
const INTENTS = {"save": SAVE_COMMAND, "close": CLOSE_COMMAND, "split-right": SPLIT_RIGHT_COMMAND} as const;

export const editorBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: filesKey}, {key: commandServiceKey}, {key: storageKey}, {key: windowProjectKey}, {key: settingsKey}, {key: clockKey}, {key: windowNavigationKey}, {key: windowRescueKey, required: false}],
        provides: [documentCoordinatorKey],
        contributions: [
            {capability: WORKBENCH_EDITOR_AREA_POINT, id: EDITOR_AREA_ID, declaration: {order: 0}},
            ...Object.entries(EDITOR_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...editorState.contributions,
            ...Object.entries(EDITOR_STATUS_ITEMS).map(([id, declaration]) => ({capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const storage = context.services.require(storageKey);
            const settings = context.services.require(settingsKey);
            const project = context.services.require(windowProjectKey).project;
            const locale = computed(() => displayLocale(settings));
            const report = (error: unknown): void => {
                diagnostics.record({level: "error", event: "editor.error", message: error instanceof Error ? error.message : String(error), error, source: {plugin: descriptor.id}});
            };
            const session = createEditorSession({
                files: context.services.require(filesKey),
                clock: context.services.require(clockKey),
                project,
                createStore: project === null ? null : () => editorSessionStore.create(context, {storage, diagnostics}),
                report,
            });
            context.signal.addEventListener("abort", () => session.dispose(), {once: true});

            // 继续写作（输出 29）：地址参数一读到就去掉；等编辑器区建好（会话记录读完）再打开并定位。
            const navigation = context.services.require(windowNavigationKey);
            const request = continueRequestOf(navigation.currentUrl());
            if (request !== null) {
                navigation.replaceUrl(withoutContinueParams(navigation.currentUrl()));
                let done = false;
                const stop = watch(session.area, (area) => {
                    if (area === null || done) return;
                    done = true;
                    if (project === null || !request.address.startsWith("project://")) {
                        area.notify(`不能打开 ${request.address}：继续写作只能打开项目里的文件`);
                        diagnostics.record({level: "warn", event: "editor.continue", message: `地址参数指向的不是项目里的资源：${request.address}`, source: {plugin: descriptor.id}});
                        return;
                    }
                    const opened = area.open(request.address, {mode: "permanent", ...(request.reveal === null ? {} : {reveal: request.reveal})});
                    if (!opened.ok) diagnostics.record({level: "warn", event: "editor.continue", message: `按地址参数打开失败：${opened.reason}`, source: {plugin: descriptor.id}});
                }, {immediate: true});
                if (done) stop();
                else context.signal.addEventListener("abort", () => stop(), {once: true});
            }

            // 终态时的抢救：宿主在停止插件之前同步调用。
            const rescue = await context.services.resolve(windowRescueKey);
            if (rescue.status === "resolved") {
                const release = rescue.instance.register(() => session.area.value?.documents.rescue() ?? []);
                context.signal.addEventListener("abort", release, {once: true});
            }
            // 离开页面前：结算全部视图输入，有需要结算的文档时请求浏览器的离开确认。
            const beforeUnload = (event: Event): void => {
                if (session.area.value?.needsLeaveConfirm() !== true) return;
                // 现在的浏览器以 preventDefault 请求离开确认（Chrome 119 起不再要求 returnValue）。
                event.preventDefault();
            };
            globalThis.addEventListener("beforeunload", beforeUnload);
            context.signal.addEventListener("abort", () => globalThis.removeEventListener("beforeunload", beforeUnload), {once: true});

            const execute = (command: string): void => {
                void commands.execute(command, {}, {source: "user"}).then((result) => {
                    if (!result.ok) diagnostics.record({level: "warn", event: "editor.command", message: `${command} 执行失败：${result.reason}`, source: {plugin: descriptor.id}});
                });
            };
            const area: EditorAreaImplementation = {
                load: async (): Promise<Component> => {
                    const {default: EditorArea} = await import("./components/EditorArea.vue");
                    // 源码编辑器（Monaco）第一次挂上源码控件时才加载，首屏不含它。
                    const MonacoControl = defineAsyncComponent(() => import("./components/MonacoControl.vue"));
                    // Markdown 富文本（Tiptap）同样第一次挂上时才加载。
                    const MarkdownControl = defineAsyncComponent(() => import("./components/MarkdownControl.vue"));
                    const controls: Readonly<Record<EditorKind, Component>> = {markdown: MarkdownControl, code: MonacoControl};
                    const control = (kind: EditorKind): Component => controls[kind];
                    return defineComponent({
                        name: "EditorAreaHost",
                        props: {context: {type: Object as PropType<EditorAreaContext>, required: true}},
                        setup: () => () => (session.area.value === null ? null : h(EditorArea, {area: session.area.value, locale: locale.value, control, onIntent: (intent: "save" | "close" | "split-right") => {
                            // 控件有输入延迟：先把活动视图里还没交出的输入交给文档，命令的 `when`（例如保存要求 dirty）才看得到它。
                            session.area.value?.activeHandle.value?.flushPendingChange();
                            execute(INTENTS[intent]);
                        }})),
                    });
                },
            };
            const published = bindingsOf(editorState, editorStateValues(session.area));
            return {
                services: [provide(documentCoordinatorKey, session.coordinator)],
                contributions: {
                    [WORKBENCH_EDITOR_AREA_POINT]: {[EDITOR_AREA_ID]: area},
                    [COMMANDS_POINT]: editorCommands(session.area),
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                    [WORKBENCH_STATUSBAR_ITEMS_POINT]: editorStatusItems(session.area, locale),
                },
            };
        },
    })],
};
