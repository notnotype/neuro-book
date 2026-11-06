/**
 * `nbook.editor` 浏览器入口（docs/specs/workbench/editor.md）：贡献工作台的编辑器槽、编辑器的命令与公开状态，提供文档
 * 协调服务，拥有页面贡献点 `editor.pages`（输出 33）；向宿主登记终态时的抢救与离开页面前的确认。编辑器区在激活时建立（命令随时可能到，例如资源管理器打开
 * 文件），绑定项目的窗口先读会话记录。
 */

import {computed, defineAsyncComponent, defineComponent, h, provide as provideToChildren, reactive, shallowRef, watch} from "vue";
import type {Component, PropType} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey, completeMenuItemDeclaration, currentKeyPlatform, menuImplementations, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import {filesKey} from "nbook/plugins/files/shared/contracts";
import {dialectTable, MARKDOWN_DIALECTS_POINT, markdownKey} from "nbook/plugins/markdown/shared/contracts";
import type {DialectDeclaration, MarkdownService} from "nbook/plugins/markdown/shared/contracts";
import {diagnosticText} from "nbook/shared/localized-text";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {breadcrumbsSetting, codeSettings, enablePreviewSetting, markdownToolbarPlacementSetting, markdownToolbarSetting, wrapTabsSetting} from "../shared/settings";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {quickPickKey, WORKBENCH_EDITOR_AREA_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_TITLEBAR_MENU_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {EditorAreaContext, EditorAreaImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey, windowNavigationKey, windowRescueKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {CODE_EDITOR, completeEditorDeclaration, completeEditorPageDeclaration, documentCoordinatorKey, editorMenusKey, EDITOR_BLOCK_POINT, EDITOR_BODY_CONTEXT_POINT, EDITOR_SELECTION_POINT, EDITOR_SLASH_POINT, EDITOR_TOOLBAR_POINT, validateEditorBlockItem, validateEditorBodyContextItem, validateEditorSelectionItem, validateEditorSlashItem, validateEditorToolbarItem, EDITOR_EDITORS_POINT, EDITOR_LANGUAGES_POINT, EDITOR_PAGES_POINT, EDITOR_TAB_CONTEXT_POINT, EDITOR_TITLE_POINT, MARKDOWN_EDITOR, validateEditorContribution, validateEditorPageContribution, validateEditorTabContextItem, validateEditorTitleItem, validateLanguageContribution} from "../shared/contracts";
import type {EditorImplementation, EditorTabContextItemDeclaration, EditorTitleItemDeclaration} from "../shared/contracts";
import {editorText} from "../shared/text";
import {editorLanguagesKey, LanguageRegistry, monacoLanguageImplementation} from "./code/languages";
import {codeEditorOptionsKey} from "./code/options";
import type {CodeEditorOptions} from "./code/options";
import {MONACO_LANGUAGES} from "./code/monaco-languages";
import {CLOSE_COMMAND, copyTabPath, EDITOR_COMMAND_DECLARATIONS, editorCommands, SAVE_COMMAND, SPLIT_RIGHT_COMMAND} from "./commands";
import {EditorPageRegistry} from "./pages";
import {continueRequestOf, withoutContinueParams} from "./continue-writing";
import {emptyTips} from "./empty-tips";
import {EditorRegistry} from "./editor-registry";
import {BUILTIN_EDITORS} from "./editors";
import {editorRecentStore} from "./recent-record";
import {editorSessionStore} from "./session-record";
import {createEditorSession} from "./session";
import {editorState, editorStateValues} from "./state";
import {EDITOR_STATUS_ITEMS, editorStatusItems} from "./status-items";
import {createEditorTabMenu} from "./tab-menu";
import {createEditorTitleActions} from "./title-actions";
import {EDITING_COMMAND_DECLARATIONS, editingCommands, TOGGLE_TOOLBAR_COMMAND} from "./editing-commands";
import {createEditorMenus} from "./editing-menus";
import {EDITOR_TITLEBAR_MENU_ITEMS} from "./titlebar-menu";

export const EDITOR_AREA_ID = "nbook.editor.area";

type BuiltinEditor = typeof MARKDOWN_EDITOR | typeof CODE_EDITOR;

/**
 * 内置编辑器的组件：编辑器区直接持有，不等交付（`editor-registry.ts`）。Markdown 控件由 `nbook.markdown` 的服务给出，源码
 * 控件是自己的；都在第一次挂上时才加载 Tiptap 与 Monaco，首屏不含它们。
 */
const builtinComponents = (markdown: MarkdownService): Readonly<Record<BuiltinEditor, Component>> => ({
    [MARKDOWN_EDITOR]: markdown.components.MarkdownControl,
    [CODE_EDITOR]: defineAsyncComponent(() => import("./components/MonacoControl.vue")),
});

/** 内置编辑器投给自己贡献点的实现：交付的组件与直接持有的是同一个，给统一的交付状态用。 */
const builtinImplementation = (components: Readonly<Record<BuiltinEditor, Component>>, id: BuiltinEditor): EditorImplementation => ({load: async () => components[id]});

/** 编辑器区内键位的意图对应的命令。 */
const INTENTS = {"save": SAVE_COMMAND, "close": CLOSE_COMMAND, "split-right": SPLIT_RIGHT_COMMAND} as const;

export const editorBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [
        {id: EDITOR_PAGES_POINT, implementation: "required", complete: completeEditorPageDeclaration, validate: validateEditorPageContribution, idPrefix: "plugin"},
        // 编辑区标题的菜单项只有声明，同工作台的菜单位置交空实现（docs/specs/workbench/menus.md）。
        {id: EDITOR_TITLE_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorTitleItem, idPrefix: "plugin"},
        // 标签右键的菜单项（输出 57）：同上，只有声明。
        {id: EDITOR_TAB_CONTEXT_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorTabContextItem, idPrefix: "plugin"},
        // Markdown 编辑器的五个菜单位置（docs/specs/workbench/markdown-editing.md）：同上，只有声明。
        {id: EDITOR_TOOLBAR_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorToolbarItem, idPrefix: "plugin"},
        {id: EDITOR_SELECTION_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorSelectionItem, idPrefix: "plugin"},
        {id: EDITOR_SLASH_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorSlashItem, idPrefix: "plugin"},
        {id: EDITOR_BLOCK_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorBlockItem, idPrefix: "plugin"},
        {id: EDITOR_BODY_CONTEXT_POINT, implementation: "required", complete: completeMenuItemDeclaration, validate: validateEditorBodyContextItem, idPrefix: "plugin"},
        // 编辑器（docs/specs/workbench/editor.md 输出 36）：内置的两个也声明在这里。
        {id: EDITOR_EDITORS_POINT, implementation: "required", complete: completeEditorDeclaration, validate: validateEditorContribution, idPrefix: "plugin"},
        // 语言（输出 43）：源码编辑器（Monaco）自带的也声明在这里。
        {id: EDITOR_LANGUAGES_POINT, implementation: "required", validate: validateLanguageContribution},
    ],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: filesKey}, {key: commandServiceKey}, {key: storageKey}, {key: windowProjectKey}, {key: settingsKey}, {key: clockKey}, {key: windowNavigationKey}, {key: publicStateKey}, {key: markdownKey}, {key: windowRescueKey, required: false}, {key: quickPickKey, required: false}, {key: windowTextKey, required: false}],
        provides: [documentCoordinatorKey],
        receives: [EDITOR_PAGES_POINT, EDITOR_TITLE_POINT, EDITOR_TAB_CONTEXT_POINT, EDITOR_TOOLBAR_POINT, EDITOR_SELECTION_POINT, EDITOR_SLASH_POINT, EDITOR_BLOCK_POINT, EDITOR_BODY_CONTEXT_POINT, EDITOR_EDITORS_POINT, EDITOR_LANGUAGES_POINT],
        contributions: [
            {capability: WORKBENCH_EDITOR_AREA_POINT, id: EDITOR_AREA_ID, declaration: {order: 0}},
            ...Object.entries(EDITOR_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...Object.entries(EDITING_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            ...editorState.contributions,
            ...EDITOR_TITLEBAR_MENU_ITEMS.map(({id, declaration}) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id, declaration})),
            ...Object.entries(EDITOR_STATUS_ITEMS).map(([id, declaration]) => ({capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id, declaration})),
            ...Object.entries(BUILTIN_EDITORS).map(([id, declaration]) => ({capability: EDITOR_EDITORS_POINT, id, declaration})),
            ...MONACO_LANGUAGES.map(({id, declaration}) => ({capability: EDITOR_LANGUAGES_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const storage = context.services.require(storageKey);
            const settings = context.services.require(settingsKey);
            const project = context.services.require(windowProjectKey).project;
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const codeOptions = computed((): CodeEditorOptions => ({
                fontFamily: settings.get(codeSettings["code.fontFamily"]),
                fontSize: settings.get(codeSettings["code.fontSize"]),
                lineHeight: settings.get(codeSettings["code.lineHeight"]),
                tabSize: settings.get(codeSettings["code.tabSize"]),
                detectIndentation: settings.get(codeSettings["code.detectIndentation"]),
                lineNumbers: settings.get(codeSettings["code.lineNumbers"]),
                minimap: settings.get(codeSettings["code.minimap"]),
                wordWrap: settings.get(codeSettings["code.wordWrap"]),
            }));
            const report = (error: unknown): void => {
                diagnostics.record({level: "error", event: "editor.error", message: error instanceof Error ? error.message : String(error), error, source: {plugin: descriptor.id}});
            };
            const builtins = builtinComponents(context.services.require(markdownKey));
            const editors = new EditorRegistry(context.declarations, builtins);
            const languages = new LanguageRegistry(context.declarations, (error, language) => {
                diagnostics.record({level: "error", event: "editor.language", message: `Rules for language ${language} failed to load; showing it as plain text: ${error instanceof Error ? error.message : String(error)}`, error, data: {language}, source: {plugin: descriptor.id}});
            });
            const session = createEditorSession({
                editors: editors.catalog,
                conflict: (address, ids) => diagnostics.record({level: "warn", event: "editor.editors.conflict", message: `${address} matches ${String(ids.length)} default editors at the same level; using ${ids[0] ?? ""}`, data: {address, editors: ids}, source: {plugin: descriptor.id}}),
                files: context.services.require(filesKey),
                clock: context.services.require(clockKey),
                project,
                createStore: project === null ? null : () => editorSessionStore.create(context, {storage, diagnostics}),
                createRecentStore: project === null ? null : () => editorRecentStore.create(context, {storage, diagnostics}),
                enablePreview: () => settings.get(enablePreviewSetting),
                report,
            });
            context.signal.addEventListener("abort", () => session.dispose(), {once: true});
            const pages = new EditorPageRegistry(context.declarations);
            // 页面组件收到的上下文：最近打开随记录变化（reactive 把 computed 拆成值）。
            const pageContext = reactive({recent: computed(() => session.recent?.state.recent.display.addresses ?? [])});

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
                        area.notify(editorText("notice.continueOutsideProject", {address: request.address}));
                        diagnostics.record({level: "warn", event: "editor.continue", message: `The address parameter does not point to a project resource: ${request.address}`, source: {plugin: descriptor.id}});
                        return;
                    }
                    const opened = area.open(request.address, {mode: "permanent", ...(request.reveal === null ? {} : {reveal: request.reveal})});
                    if (!opened.ok) diagnostics.record({level: "warn", event: "editor.continue", message: `Opening the address parameter failed: ${diagnosticText(opened.reason)}`, source: {plugin: descriptor.id}});
                }, {immediate: true});
                if (done) stop();
                else context.signal.addEventListener("abort", () => stop(), {once: true});
            }

            // 这部作品第一次在本窗口打开：编辑器区建好后打开声明 `openOnFirstVisit` 的页面，交付晚到的等它交付（输出 33）。
            // 继续写作带来的不算第一次：用户要的是那个文件。
            if (request === null) {
                const opened = new Set<string>();
                const stopFirst = watch(() => (session.firstVisit.value && session.area.value !== null ? pages.firstVisitPages() : []), (ids) => {
                    for (const id of ids) {
                        if (opened.has(id)) continue;
                        opened.add(id);
                        const result = session.area.value?.openPage(id);
                        if (result !== undefined && !result.ok) diagnostics.record({level: "warn", event: "editor.page", message: `Opening page ${id} automatically failed: ${diagnosticText(result.reason)}`, source: {plugin: descriptor.id}});
                    }
                }, {immediate: true});
                context.signal.addEventListener("abort", () => stopFirst(), {once: true});
            }

            const quickPick = await context.services.resolve(quickPickKey);
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
                    if (!result.ok) diagnostics.record({level: "warn", event: "editor.command", message: `${command} failed: ${diagnosticText(result.reason)}`, source: {plugin: descriptor.id}});
                });
            };
            // 空编辑组的提示：命令增减不经响应式通知，记一个版本号在渲染时读，命令有增减就重算；可用性读公开状态，渲染时求值即可。
            const commandsVersion = shallowRef(0);
            const stopCommands = commands.onDidChange(() => {
                commandsVersion.value += 1;
            });
            context.signal.addEventListener("abort", stopCommands, {once: true});
            const platform = currentKeyPlatform();
            const tips = () => {
                void commandsVersion.value;
                return emptyTips(commands, text, platform);
            };
            const titleItems = new MenuItemRegistry(context.declarations.list<EditorTitleItemDeclaration>(EDITOR_TITLE_POINT), context.signal);
            const tabMenuItems = new MenuItemRegistry(context.declarations.list<EditorTabContextItemDeclaration>(EDITOR_TAB_CONTEXT_POINT), context.signal);
            const toolbarItems = new MenuItemRegistry(context.declarations.list<MenuItemDeclaration>(EDITOR_TOOLBAR_POINT), context.signal);
            const selectionItems = new MenuItemRegistry(context.declarations.list<MenuItemDeclaration>(EDITOR_SELECTION_POINT), context.signal);
            const slashItems = new MenuItemRegistry(context.declarations.list<MenuItemDeclaration>(EDITOR_SLASH_POINT), context.signal);
            const blockItems = new MenuItemRegistry(context.declarations.list<MenuItemDeclaration>(EDITOR_BLOCK_POINT), context.signal);
            const bodyContextItems = new MenuItemRegistry(context.declarations.list<MenuItemDeclaration>(EDITOR_BODY_CONTEXT_POINT), context.signal);
            const commandSources = {files: context.services.require(filesKey), clipboard: systemClipboard()};
            const tabMenuModel = createEditorTabMenu({
                area: () => session.area.value,
                commands,
                state: context.services.require(publicStateKey),
                items: () => tabMenuItems.items(),
                platform,
                copy: (tab, relative) => copyTabPath(commandSources, tab, relative),
                report: (action, reason) => diagnostics.record({level: "warn", event: "editor.tab-menu", message: `Tab menu action ${action} did not complete: ${reason}`, data: {action}, source: {plugin: descriptor.id}}),
            });
            // 命令增减不经响应式通知：菜单在渲染时读一次版本号（同标题动作）。
            const tabMenu = {
                entries: (tabId: string) => {
                    void commandsVersion.value;
                    return tabMenuModel.entries(tabId, text);
                },
                identity: (tabId: string) => tabMenuModel.identity(tabId),
            };
            const titles = createEditorTitleActions({area: () => session.area.value, commands, state: context.services.require(publicStateKey), items: () => titleItems.items(), platform});
            // 命令增减不经响应式通知：标题动作在渲染与组的 computed 里求值时都读一次版本号。
            const titleActions = () => {
                void commandsVersion.value;
                const current = titles.current(text);
                return current === null ? null : {...current, model: (maxButtons: number) => {
                    void commandsVersion.value;
                    return current.model(maxButtons);
                }};
            };
            const toolbarVisible = computed(() => settings.get(markdownToolbarSetting));
            const menus = createEditorMenus({
                area: () => session.area.value,
                commands,
                state: context.services.require(publicStateKey),
                items: {
                    [EDITOR_TOOLBAR_POINT]: () => toolbarItems.items(),
                    [EDITOR_SELECTION_POINT]: () => selectionItems.items(),
                    [EDITOR_SLASH_POINT]: () => slashItems.items(),
                    [EDITOR_BLOCK_POINT]: () => blockItems.items(),
                    [EDITOR_BODY_CONTEXT_POINT]: () => bodyContextItems.items(),
                },
                platform,
                text,
                version: commandsVersion,
                toolbarVisible,
                toolbarPlacement: computed(() => settings.get(markdownToolbarPlacementSetting)),
                notify: (message) => session.area.value?.notify(message),
                report,
            });
            const area: EditorAreaImplementation = {
                load: async (): Promise<Component> => {
                    const {default: EditorArea} = await import("./components/EditorArea.vue");
                    const control = (editor: string) => editors.state(editor);
                    return defineComponent({
                        name: "EditorAreaHost",
                        props: {context: {type: Object as PropType<EditorAreaContext>, required: true}},
                        setup: () => {
                            provideToChildren(editorLanguagesKey, languages);
                            provideToChildren(codeEditorOptionsKey, codeOptions);
                            provideToChildren(editorMenusKey, menus);
                            return () => (session.area.value === null ? null : h(EditorArea, {area: session.area.value, control, pages: pages.source(pageContext), emptyTips: tips(), titleActions: titleActions(), tabMenu, wrapTabs: settings.get(wrapTabsSetting), breadcrumbs: settings.get(breadcrumbsSetting), workTitle: project?.title ?? null, onTabMenu: (tabId: string, key: string) => {
                            session.area.value?.activeHandle.value?.flushPendingChange();
                            tabMenuModel.run(tabId, key);
                        }, onRunTip: execute, onTitleAction: (key: string) => {
                            session.area.value?.activeHandle.value?.flushPendingChange();
                            titles.run(key);
                        }, onIntent: (intent: "save" | "close" | "split-right") => {
                            // 控件有输入延迟：先把活动视图里还没交出的输入交给文档，命令的 `when`（例如保存要求 dirty）才看得到它。
                            session.area.value?.activeHandle.value?.flushPendingChange();
                            execute(INTENTS[intent]);
                        }}));
                        },
                    });
                },
            };
            const published = bindingsOf(editorState, editorStateValues(session.area, toolbarVisible));
            return {
                services: [provideService(documentCoordinatorKey, session.coordinator)],
                receivers: {[EDITOR_PAGES_POINT]: pages.receiver(), [EDITOR_TITLE_POINT]: titleItems.receiver(), [EDITOR_TAB_CONTEXT_POINT]: tabMenuItems.receiver(), [EDITOR_TOOLBAR_POINT]: toolbarItems.receiver(), [EDITOR_SELECTION_POINT]: selectionItems.receiver(), [EDITOR_SLASH_POINT]: slashItems.receiver(), [EDITOR_BLOCK_POINT]: blockItems.receiver(), [EDITOR_BODY_CONTEXT_POINT]: bodyContextItems.receiver(), [EDITOR_EDITORS_POINT]: editors.receiver(), [EDITOR_LANGUAGES_POINT]: languages.receiver()},
                contributions: {
                    [WORKBENCH_EDITOR_AREA_POINT]: {[EDITOR_AREA_ID]: area},
                    [COMMANDS_POINT]: {...editingCommands(session.area, {toggleToolbar: () => settings.update(markdownToolbarSetting, !settings.get(markdownToolbarSetting))}), ...editorCommands(session.area, {pages, editors: editors.catalog, languages, pick: quickPick.status === "resolved" ? quickPick.instance : null, ...commandSources})},
                    [EDITOR_EDITORS_POINT]: {[MARKDOWN_EDITOR]: builtinImplementation(builtins, MARKDOWN_EDITOR), [CODE_EDITOR]: builtinImplementation(builtins, CODE_EDITOR)},
                    [EDITOR_LANGUAGES_POINT]: Object.fromEntries(MONACO_LANGUAGES.map((entry) => [entry.id, monacoLanguageImplementation(entry)])),
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                    [WORKBENCH_STATUSBAR_ITEMS_POINT]: editorStatusItems(session.area, context.services.require(clockKey), languages, dialectTable(context.declarations.list<DialectDeclaration>(MARKDOWN_DIALECTS_POINT)), text),
                    [WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(EDITOR_TITLEBAR_MENU_ITEMS),
                },
            };
        },
    })],
};

/** 浏览器的系统剪贴板；不在安全上下文、或不是浏览器时没有。 */
function systemClipboard(): {writeText(text: string): Promise<void>} | null {
    return (globalThis as {readonly navigator?: {readonly clipboard?: {writeText(text: string): Promise<void>}}}).navigator?.clipboard ?? null;
}
