/**
 * `nbook.explorer` 浏览器入口（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：贡献侧栏视图
 * `nbook.explorer`、资源管理器的命令与公开状态。会话在激活时建立，视图第一次挂上时才打开偏好记录、列出文件，所以
 * 直接打开 Lab 的窗口不读产品偏好、不列目录。
 */

import {computed, watch} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey, completeMenuItemDeclaration, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import {documentCoordinatorKey} from "nbook/plugins/editor/shared/contracts";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import type {PublicStateRead} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {PROJECT_VIEW_CONTAINER, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {EXPLORER_CONTEXT_POINT, validateExplorerContextItem} from "../shared/contracts";
import {EXPLORER_SECTION, EXPLORER_SECTION_DECLARATION, hideMarkdownExtensionSetting, indentGuidesSetting} from "../shared/settings";
import type {ExplorerContextItemDeclaration} from "../shared/contracts";
import {COLLAPSE_ALL_COMMAND, EXPLORER_COMMAND_DECLARATIONS, explorerCommands, NEW_FILE_COMMAND, NEW_FOLDER_COMMAND, REFRESH_FILES_COMMAND, TOGGLE_MANIFESTS_COMMAND} from "./commands";
import {explorerStoreFor} from "./preferences";
import {createExplorerSession} from "./session";
import {explorerState, explorerStateValues} from "./state";
import {createExplorerViewHost} from "./view-host";

export const EXPLORER_VIEW_ID = "nbook.explorer";

/** 视图标题上的五个动作（docs/specs/workbench/files-explorer.md 的“新应用的插件、命令与界面”）：外壳画按钮、执行命令。 */
const VIEW: WrittenViewDeclaration = {
    icon: "i-lucide-files",
    location: "sidebar",
    order: 0,
    layout: "fill",
    container: PROJECT_VIEW_CONTAINER,
    actions: [
        {command: NEW_FILE_COMMAND, icon: "i-lucide-file-plus"},
        {command: NEW_FOLDER_COMMAND, icon: "i-lucide-folder-plus"},
        {command: REFRESH_FILES_COMMAND, icon: "i-lucide-refresh-cw", args: "instance"},
        {command: COLLAPSE_ALL_COMMAND, icon: "i-lucide-copy-minus"},
        {command: TOGGLE_MANIFESTS_COMMAND, icon: "i-lucide-file-code", toggled: "nbook.explorer/showManifests"},
    ],
};

/**
 * 打开作品时揭示一次编辑器恢复出的活动文件（docs/specs/workbench/files-explorer.md）。等资源管理器的控制器与编辑器区都建好，
 * 再等一个微任务：继续写作在编辑器区建好的同一刻打开它的文件，要读这之后的活动标签。那一刻没有活动标签就不揭示；之后切换
 * 标签也不跟着揭示，免得树跟着乱跳。没有装编辑器时 `nbook.editor/ready` 未声明，什么都不做。
 */
function revealOnOpen(state: {read(key: string): PublicStateRead}, controller: () => {reveal(address: string): void} | null, signal: AbortSignal): void {
    const editorReady = (): boolean => {
        const read = state.read("nbook.editor/ready");
        return read.status === "ready" && read.value === true;
    };
    let done = false;
    const stop = watch(() => controller() !== null && editorReady(), (both) => {
        if (!both || done) return;
        done = true;
        queueMicrotask(() => {
            stop();
            const active = state.read("nbook.editor/activeDocument");
            if (signal.aborted || active.status !== "ready" || typeof active.value !== "string" || active.value === "") return;
            controller()?.reveal(active.value);
        });
    }, {immediate: true});
    signal.addEventListener("abort", stop, {once: true});
}

/**
 * 系统剪贴板：只在安全上下文里有（本机服务的 http://127.0.0.1 算）；没有时“复制路径”不可用。这个文件也由不带 DOM 类型的
 * tsc 检查，所以按需要的那一个方法取，不引用 `Navigator` 的完整类型。
 */
function systemClipboard(): {writeText(text: string): Promise<void>} | undefined {
    return (globalThis as {readonly navigator?: {readonly clipboard?: {writeText(text: string): Promise<void>}}}).navigator?.clipboard;
}

export const explorerBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    // 右键菜单的贡献点：菜单项只有声明，同工作台的菜单位置交空实现（docs/specs/workbench/menus.md）。
    contributionPoints: [{id: EXPLORER_CONTEXT_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateExplorerContextItem, idPrefix: "plugin"}],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        // 编辑器的文档协调是可选的：编辑器没有加载时复制、移动、删除直接放行。
        dependencies: [{key: diagnosticsKey}, {key: filesKey}, {key: commandServiceKey}, {key: storageKey}, {key: windowProjectKey}, {key: settingsKey}, {key: publicStateKey}, {key: documentCoordinatorKey, required: false}, {key: windowTextKey, required: false}],
        receives: [EXPLORER_CONTEXT_POINT],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: EXPLORER_VIEW_ID, declaration: VIEW},
            ...Object.entries(EXPLORER_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...explorerState.contributions,
        ],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const storage = context.services.require(storageKey);
            const settings = context.services.require(settingsKey);
            const bound = context.services.require(windowProjectKey).project !== null;
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const report = (error: unknown): void => {
                diagnostics.record({level: "error", event: "explorer.error", message: error instanceof Error ? error.message : String(error), error, source: {plugin: descriptor.id}});
            };
            const documents = await context.services.resolve(documentCoordinatorKey);
            const session = createExplorerSession({
                files: context.services.require(filesKey),
                ...(documents.status === "resolved" ? {documents: documents.instance} : {}),
                ...(systemClipboard() === undefined ? {} : {clipboard: systemClipboard()}),
                commands,
                bound,
                createStore: () => explorerStoreFor(bound).create(context, {storage, diagnostics}),
                report,
            });
            context.signal.addEventListener("abort", () => session.dispose(), {once: true});
            // 偏好记录的首读与视图代码的下载都在激活时开始，与工作台外壳的挂载同时进行；控制器仍等视图第一次挂上
            // （打开项目到可操作的文件树，files-explorer 的性能标准，w00017 t72 的测量）。
            session.prepare();
            if (bound) revealOnOpen(context.services.require(publicStateKey), () => session.controller.value, context.signal);
            const importView = (): Promise<typeof import("./components/FilesExplorerView.vue")> => import("./components/FilesExplorerView.vue");
            let viewModule: ReturnType<typeof importView> | null = importView();
            // 预取失败只丢掉这次的结果，`load` 再 import 一次，失败照常由视图宿主原位显示。Chrome 把同一地址的模块下载失败记在
            // 页面的模块表里，再 import 仍然失败，原位重试救不回下载失败，要重新载入页面（所有按需加载的视图都一样，见 w00017
            // 待确认清单）。
            viewModule.catch(() => {
                viewModule = null;
            });
            const contextMenu = new MenuItemRegistry(context.declarations.list<ExplorerContextItemDeclaration>(EXPLORER_CONTEXT_POINT), context.signal);
            const view: ViewImplementation = {
                load: async () => createExplorerViewHost((await (viewModule ?? importView())).default, {
                    session,
                    commands,
                    state: context.services.require(publicStateKey),
                    contextMenu,
                    text,
                    projectTitle: context.services.require(windowProjectKey).project?.title ?? null,
                    display: computed(() => ({indentGuides: settings.get(indentGuidesSetting), hideMarkdownExtension: settings.get(hideMarkdownExtensionSetting)})),
                    report: (id, reason) => diagnostics.record({level: "warn", event: "explorer.command", message: `${id} 执行失败：${reason}`, source: {plugin: descriptor.id}}),
                }),
            };
            const published = bindingsOf(explorerState, explorerStateValues(session.controller));
            return {
                receivers: {[EXPLORER_CONTEXT_POINT]: contextMenu.receiver()},
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[EXPLORER_VIEW_ID]: view},
                    [COMMANDS_POINT]: explorerCommands(session, text),
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                },
            };
        },
    })],
};
