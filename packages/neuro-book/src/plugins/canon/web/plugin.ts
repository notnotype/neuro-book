/**
 * `nbook.canon` 的浏览器入口：不存世界，按调用方提供世界客户端，以调用方的身份经远程服务转给本窗口绑定的项目实例
 * （docs/specs/canon/project.md 输出 1）。没有绑定项目的窗口调用得到 `no-project`。
 *
 * 作者界面（docs/specs/canon/author-ui.md）也在这里：侧栏视图“设定”、底部面板的“待处理”与“改动记录”、条目页、回执页、变更详情页、
 * 数据分页的贡献点 `canon.component-views`（canon 自己给人物、面板各交一个界面）、状态栏的“待处理 N”与公开状态
 * `nbook.canon/hasPending`、命令，以及挂还原对话框的页面浮层。界面用本入口自己的身份建一份读取层（`world.ts`）：状态栏条数要
 * 一直读“待处理”一组，所以窗口绑定了项目时启动就建（就订阅世界），窗口停止时释放。视图、页面与命令的实现要在启动时交出，所以
 * 入口在启动时激活。保存后的提示与还原的对话框在窗口里各一份，几种页面共用。
 */

import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {computed, defineComponent, h, shallowRef, watch} from "vue";
import type {PropType} from "vue";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandResult} from "nbook/plugins/commands/shared/contracts";
import {editorComponentsKey, EDITOR_LANGUAGES_POINT, EDITOR_PAGES_POINT} from "nbook/plugins/editor/shared/contracts";
import {filesKey, formatResource} from "nbook/plugins/files/shared/contracts";
import {IMAGE_FOLDER_DEFAULT, imageFolderSetting} from "nbook/plugins/editor/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey, WORKBENCH_OVERLAYS_POINT, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration, OverlayDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation, WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";
import type {Written} from "nbook/shared/convention-keys";
import {windowProjectKey} from "nbook/shared/projects";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {CANON_COMPONENT_VIEWS_POINT, componentViewsPoint} from "../shared/component-views";
import {CANON_ENTRY_TABS_POINT, entryTabsPoint} from "../shared/entry-tabs";
import {CANON_ENTRY_KINDS_POINT, entryKindsPoint, mergeEntryKinds} from "../shared/entry-kinds";
import {createCanonImages} from "./images";
import type {EntryKindDeclaration} from "../shared/entry-kinds";
import type {EntryTabDeclaration} from "../shared/entry-tabs";
import type {ComponentViewDeclaration} from "../shared/component-views";
import {componentsPoint, LOOK_COMPONENT, PERSON_COMPONENT} from "../shared/components";
import {canonClientKey, canonReadsKey, canonWorldContract} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import {canonText} from "../shared/text";
import {createCanonClient} from "./client";
import {BINDER_DIR, chapterFileName} from "../shared/binder-files";
import {createChangePage} from "./change-page";
import {CANON_COMMAND_DECLARATIONS, canonCommands, CHANGE_PAGE, EDITOR_OPEN_COMMAND, ENTRY_PAGE, NEW_ENTRY_COMMAND, OPEN_CHANGE_COMMAND, OPEN_ENTRY_COMMAND, OPEN_RECEIPT_COMMAND, PENDING_VIEW, PICK_LINE_COMMAND, RECEIPT_PAGE, REVISIONS_VIEW, SHOW_PENDING_COMMAND, SHOW_REVISIONS_COMMAND} from "./commands";
import {ComponentViewRegistry} from "./component-views";
import type {ComponentViewContext, ComponentViewImplementation} from "./component-views";
import {createEntriesViewHost, entriesViewState, startNewEntry} from "./entries-view";
import {ENTRY_LANGUAGE, ENTRY_LANGUAGE_DECLARATION, entryLanguageDefinition} from "./entry-language";
import {createEntryPage, ENTRY_PAGE_ICON, originsFetcher} from "./entry-page";
import {createTextDrafts} from "./text-drafts";
import {createNotices} from "./notices";
import {createPendingCount} from "./pending-count";
import {createPendingView, pendingViewState, pickFirstPending} from "./pending-view";
import {createReceiptPage} from "./receipt-page";
import {createCanonReads} from "./reads-service";
import {createRevertRequests} from "./revert";
import {createRevisionsView, revisionsViewState} from "./revisions-view";
import {createWindowLine} from "./window-line";
import type {WindowLine} from "./window-line";
import {createCanonWorld} from "./world";
import type {CanonWorld} from "./world";

export const ENTRIES_VIEW_ID = "nbook.canon.entries";
/** 底部面板的待处理、改动记录视图（author-ui.md 输出 23、24）；回执页的面包屑指着改动记录。 */
export const PENDING_VIEW_ID = PENDING_VIEW;
export const REVISIONS_VIEW_ID = REVISIONS_VIEW;
/** 状态栏的“待处理 N”（输出 25）。 */
export const PENDING_COUNT_ITEM = "nbook.canon.pending-count";
/** 状态栏的“故事线：……”（输出 34）。 */
export const LINE_ITEM = "nbook.canon.line";
/** 选线时“按章节自动”那一项的 id；线的项是 `line:<线 id>`，不会与它撞。 */
const FOLLOW_ITEM = "follow";
/** 挂还原对话框的页面浮层。 */
const REVERT_OVERLAY = "nbook.canon.revert";
const REVERT_OVERLAY_DECLARATION: OverlayDeclaration = {};

/** author-ui.md 的“输入与前置条件”：侧栏，排在文件资源管理器（`order: 0`）之后。标题由约定键补（`views.<id>.title`）。 */
const ENTRIES_VIEW: WrittenViewDeclaration = {icon: "i-lucide-book", location: "sidebar", order: 10, layout: "fill", actions: [{command: NEW_ENTRY_COMMAND, icon: "i-lucide-plus"}]};
/**
 * 底部面板的两个视图（author-ui.md 输出 33）：不写容器，各是一个隐式容器，入口条上各是一个入口；不因它们让底部面板默认显示，
 * 经状态栏条目、入口条、命令与回执页的面包屑打开（workbench/views.md 输出 18）。`order` 排在后台任务（10）与通知（20）前面，
 * 两个挨着。
 */
const PENDING_VIEW_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-circle-alert", location: "panel", order: 5, layout: "fill", revealRegion: false};
const REVISIONS_VIEW_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-history", location: "panel", order: 6, layout: "fill", revealRegion: false};

/** 公开状态 `nbook.canon/hasPending`：状态栏条目的 `when`（输出 25）。 */
export const canonState = definePublicState("nbook.canon", {
    hasPending: {type: "boolean", unready: false, reason: canonText("state.hasPending.reason")},
    /** 窗口在看的线（输出 34）：空串是按章节自动。 */
    line: {type: "string", unready: ""},
    lineReady: {type: "boolean", unready: false, reason: canonText("state.lineReady.reason")},
});
/** 状态栏左侧；标题由约定键补（`statusItems.pending-count.title`）。 */
const PENDING_COUNT_DECLARATION: Written<ItemDeclaration, "title"> = {alignment: "left", order: 10, priority: 40, command: {id: SHOW_PENDING_COMMAND}, when: {requires: [canonState.key("hasPending")]}};
/** 状态栏右侧；标题由约定键补（`statusItems.line.title`）。线表读到以后才显示。 */
const LINE_DECLARATION: Written<ItemDeclaration, "title"> = {alignment: "right", order: 50, priority: 30, command: {id: PICK_LINE_COMMAND}, when: {requires: [canonState.key("lineReady")]}};

/** 状态栏上的“故事线：……”（输出 34）：只有主线时说主线；有几条线时按章节自动就说按章节自动，选了线说线名。 */
function lineItemText(line: WindowLine) {
    const options = line.options.value;
    const chosen = options.find((option) => option.id === line.line.value);
    if (options.length <= 1 || chosen?.name === null) return canonText("statusItems.line.main");
    if (chosen === undefined) return canonText("statusItems.line.follow");
    return canonText("statusItems.line.named", {name: chosen.name});
}

/** 条目页：每个条目一个标签，刷新后恢复（author-ui.md 的“输入与前置条件”）。标题由约定键补（`editorPages.entry.title`）。 */
const ENTRY_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> = {icon: ENTRY_PAGE_ICON, instances: true, restore: true};
/** 回执页：每次修订一个标签，刷新后恢复。标题由约定键补（`editorPages.receipt.title`）。 */
const RECEIPT_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> = {icon: "i-lucide-receipt-text", instances: true, restore: true};
/** 变更详情页：每条剧情变更一个标签，刷新后恢复。标题由约定键补（`editorPages.change.title`）。 */
const CHANGE_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> = {icon: "i-lucide-milestone", instances: true, restore: true};

/** canon 自己的内置类型的数据分页界面；标题由约定键补（`componentViews.<本地 id>.title`），图标各一个（author-ui.md 输出 9）。 */
const PANEL_TYPE = "nbook.canon.panel";
const PERSON_VIEW: ComponentViewDeclaration = {uses: [LOOK_COMPONENT], icon: "i-lucide-user-round"};
const LOOK_VIEW: ComponentViewDeclaration = {icon: "i-lucide-shirt"};
const PANEL_VIEW: ComponentViewDeclaration = {icon: "i-lucide-gauge"};

/** 把一个收 `{context}` 的组件交成数据分页的界面；`extra` 是固定给它的别的属性。 */
function componentView(load: () => Promise<{default: unknown}>, extra: Record<string, unknown> = {}): ComponentViewImplementation {
    return {
        load: async () => {
            const component = (await load()).default as Parameters<typeof h>[0];
            return defineComponent({
                props: {context: {type: Object as PropType<ComponentViewContext>, required: true}},
                setup: (props) => () => h(component, {context: props.context, ...extra}),
            });
        },
    };
}

export const canonBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    // 贡献点在每个有本插件的实例里都定义：内置类型是顶层声明，各实例都登记它们（plugin-manifest.md 输出 11）。
    contributionPoints: [componentsPoint, componentViewsPoint, entryTabsPoint, entryKindsPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        // 命令服务可选：只装世界客户端的窗口（测试场地、别的插件的测试）没有工作台，也没有命令。
        // 通知可选：没有工作台的窗口里保存后的提示只留在页面顶上那一份。
        // 文件服务可选：变更详情页的“打开这一章”要列活页夹目录找章节文件，没有时找不到。
        // 选线可选：没有工作台的窗口里没有快速选择，选线命令得到 `unavailable`。
        // Storage 可选：没有时主文字的稿只在内存里（author-ui.md 输出 45）。编辑器的组件可选：没有时整篇编辑用普通文本框。
        // 设置可选：没有时设定里的图片存进缺省的图片文件夹（输出 53）。
        dependencies: [{key: windowProjectKey}, {key: commandServiceKey, required: false}, {key: notificationsKey, required: false}, {key: filesKey, required: false}, {key: quickPickKey, required: false}, {key: storageKey, required: false}, {key: editorComponentsKey, required: false}, {key: settingsKey, required: false}],
        provides: [canonClientKey, canonReadsKey],
        receives: [CANON_COMPONENT_VIEWS_POINT, CANON_ENTRY_TABS_POINT],
        remoteDelegates: [canonWorldContract],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: ENTRIES_VIEW_ID, declaration: ENTRIES_VIEW},
            {capability: WORKBENCH_VIEWS_POINT, id: PENDING_VIEW_ID, declaration: PENDING_VIEW_DECLARATION},
            {capability: WORKBENCH_VIEWS_POINT, id: REVISIONS_VIEW_ID, declaration: REVISIONS_VIEW_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: PENDING_COUNT_ITEM, declaration: PENDING_COUNT_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: LINE_ITEM, declaration: LINE_DECLARATION},
            ...canonState.contributions,
            {capability: EDITOR_PAGES_POINT, id: ENTRY_PAGE, declaration: ENTRY_PAGE_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: RECEIPT_PAGE, declaration: RECEIPT_PAGE_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: CHANGE_PAGE, declaration: CHANGE_PAGE_DECLARATION},
            {capability: EDITOR_LANGUAGES_POINT, id: ENTRY_LANGUAGE, declaration: ENTRY_LANGUAGE_DECLARATION},
            {capability: WORKBENCH_OVERLAYS_POINT, id: REVERT_OVERLAY, declaration: REVERT_OVERLAY_DECLARATION},
            // 人物的立绘读自同一条目上的形象这一组（author-ui.md 输出 49）。
            {capability: CANON_COMPONENT_VIEWS_POINT, id: PERSON_COMPONENT, declaration: PERSON_VIEW},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: LOOK_COMPONENT, declaration: LOOK_VIEW},
            {capability: CANON_COMPONENT_VIEWS_POINT, id: PANEL_TYPE, declaration: PANEL_VIEW},
            ...Object.entries(CANON_COMMAND_DECLARATIONS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
        ],
        activate: async (context) => {
            const bound = context.services.require(windowProjectKey).project !== null;
            const resolved = await context.services.resolve(commandServiceKey);
            const commands = resolved.status === "resolved" ? resolved.instance : null;
            // 界面用的那一份客户端与读取层：状态栏的“待处理 N”一开始就要，绑定了项目的窗口在启动时就建（下面的 `pendingCount`）。
            let client: CanonClient | null = null;
            let world: CanonWorld | null = null;
            const clientOf = (): CanonClient => (client ??= createCanonClient(() => context.remote));
            const worldOf = (): CanonWorld | null => {
                if (!bound || context.signal.aborted) return null;
                world ??= createCanonWorld(clientOf());
                return world;
            };
            const pendingCount = createPendingCount(worldOf());
            const windowLine = createWindowLine(worldOf());
            context.signal.addEventListener("abort", () => {
                pendingCount.release();
                windowLine.release();
                world?.dispose();
            }, {once: true});
            const publicState = bindingsOf(canonState, {hasPending: computed(() => (pendingCount.count.value ?? 0) > 0), line: computed(() => windowLine.line.value), lineReady: windowLine.ready});
            const lineItem: ItemImplementation = {
                text: () => lineItemText(windowLine),
                icon: () => ({name: "i-lucide-git-branch"}),
            };
            const quickPick = await context.services.resolve(quickPickKey);
            const pickLine = async (): Promise<CommandResult<unknown>> => {
                if (quickPick.status !== "resolved") return {ok: false, code: "unavailable", reason: "no quick pick in this window"};
                const lost = windowLine.lost.value;
                windowLine.acknowledge();
                const result = await quickPick.instance.pick({
                    title: canonText(lost ? "line.lostTitle" : "line.pickTitle"),
                    placeholder: canonText("line.placeholder"),
                    items: [
                        {id: FOLLOW_ITEM, label: canonText("line.follow")},
                        ...windowLine.options.value.map((option) => ({id: `line:${option.id}`, label: `${"\u3000".repeat(option.depth)}${option.name ?? ""}` || canonText("line.main")})),
                    ],
                });
                if (result.kind === "item") windowLine.set(result.id === FOLLOW_ITEM ? "" : result.id.slice("line:".length));
                return {ok: true, value: null};
            };
            const pendingItem: ItemImplementation = {
                text: () => canonText("statusItems.pending-count.text", {count: pendingCount.count.value ?? 0}),
                icon: () => ({name: "i-lucide-circle-alert"}),
                state: () => "warning",
            };
            const notifications = await context.services.resolve(notificationsKey);
            const execute = (id: string, args: unknown): void => void commands?.execute(id, args);
            const call: CanonClient["call"] = (method, input) => clientOf().call(method, input);
            // 登记的条目种类（输入一节的 `canon.entry-kinds`）：顶层声明，现读；新建对话框与条目页的分页顺序用。
            const entryKinds = () => mergeEntryKinds(context.declarations.list<EntryKindDeclaration>(CANON_ENTRY_KINDS_POINT));
            const views = new ComponentViewRegistry();
            const entryTabs = new ComponentViewRegistry<EntryTabDeclaration>();
            const notices = createNotices({
                workbench: notifications.status === "resolved" ? notifications.instance : null,
                receipt: (revision) => execute(OPEN_RECEIPT_COMMAND, {revision}),
                revisions: () => execute(SHOW_REVISIONS_COMMAND, {}),
            });
            // Agent 改了设定：交给提示的 Agent 那一格（author-ui.md 的 Agent 提示）。作者自己的写入不在这里提示（保存后的提示另有）。
            const stopAgentNotices = worldOf()?.onRevision((revision) => {
                if (revision.by.kind === "agent") notices.agentRevised({revision: revision.revision, title: revision.title});
            });
            context.signal.addEventListener("abort", () => stopAgentNotices?.(), {once: true});
            const revert = createRevertRequests();
            // 还原的确认框开着时，作者的提示不自己收起（author-ui.md 输出 18）：对话框与提示都是窗口里一份，暂停接在这一级，
            // 不在各页的宿主里接（几个页面同时挂着会各接一次）。
            let releaseNotice: (() => void) | null = null;
            const stopRevertHold = watch(() => revert.target.value !== null, (open) => {
                if (open && releaseNotice === null) releaseNotice = notices.hold();
                if (!open && releaseNotice !== null) {
                    releaseNotice();
                    releaseNotice = null;
                }
            });
            context.signal.addEventListener("abort", () => stopRevertHold(), {once: true});
            const state = entriesViewState();
            const storage = await context.services.resolve(storageKey);
            const editorComponents = await context.services.resolve(editorComponentsKey);
            const drafts = createTextDrafts({storage: storage.status === "resolved" ? storage.instance : null, world: worldOf, call});
            const files = await context.services.resolve(filesKey);
            // 设定里的图片（输出 53）：存进作品设置里的图片文件夹；没有设置服务时用缺省的文件夹。
            const settings = await context.services.resolve(settingsKey);
            const images = createCanonImages(files.status === "resolved" ? files.instance : null, () => (settings.status === "resolved" ? settings.instance.get(imageFolderSetting) : IMAGE_FOLDER_DEFAULT));
            const page = createEntryPage({
                drafts,
                sourceInput: editorComponents.status === "resolved" ? editorComponents.instance.components.CodeInput : null,
                world: worldOf,
                fetchOrigins: originsFetcher((input) => clientOf().call("origins", input)),
                call,
                views,
                entryTabs,
                notices,
                revert,
                execute,
                entriesView: ENTRIES_VIEW_ID,
                windowLine: windowLine,
                shown: (entry) => {
                    state.selected.value = entry;
                },
                entryKinds,
                images,
            });
            const receiptPage = createReceiptPage({world: worldOf, notices, revert, execute, entriesView: ENTRIES_VIEW_ID, revisionsView: REVISIONS_VIEW_ID});
            // “打开这一章”：章节文件名里带标题，按编号在活页夹目录里找（与项目实例读正文认同一个文件）。
            const openChapter = async (chapter: string): Promise<boolean> => {
                if (files.status !== "resolved") return false;
                const listed = await files.instance.list(formatResource({scheme: "project", path: BINDER_DIR}));
                const name = listed.ok ? chapterFileName(listed.value.entries.filter((entry) => entry.kind === "file").map((entry) => entry.name), chapter) : undefined;
                if (name === undefined) return false;
                execute(EDITOR_OPEN_COMMAND, {address: formatResource({scheme: "project", path: `${BINDER_DIR}/${name}`}), mode: "permanent"});
                return true;
            };
            const changePage = createChangePage({world: worldOf, call, notices, revert, execute, openChapter, entriesView: ENTRIES_VIEW_ID});
            // 还原的对话框：第一次有人要还原时才挂上（才建读取层），之后留着，关的时候有收起的动画。
            const overlay: WorkbenchOverlayImplementation = {
                load: async () => {
                    const Host = (await import("./components/RevertHost.vue")).default;
                    return defineComponent({
                        name: "CanonRevertOverlay",
                        setup() {
                            const used = shallowRef(false);
                            watch(() => revert.target.value, (target) => {
                                if (target !== null) used.value = true;
                            }, {immediate: true});
                            return () => {
                                const world = used.value ? worldOf() : null;
                                return world === null ? null : h(Host, {world, client: {call}, requests: revert, notices});
                            };
                        },
                    });
                },
            };
            const pendingState = pendingViewState();
            const revisionsView = createRevisionsView({world: worldOf, state: revisionsViewState(), revert, receipt: (revision) => execute(OPEN_RECEIPT_COMMAND, {revision})});
            const pendingView: ViewImplementation = {
                ...createPendingView({
                    world: worldOf,
                    state: pendingState,
                    open: (target) => {
                        if (target.kind === "receipt") execute(OPEN_RECEIPT_COMMAND, {revision: target.id});
                        else execute(target.kind === "entry" ? OPEN_ENTRY_COMMAND : OPEN_CHANGE_COMMAND, {id: target.id});
                    },
                    openChapter: (chapter) => void openChapter(chapter),
                }),
                // 入口条与面板头上的计数（workbench/views.md 输出 17）：与状态栏的“待处理 N”同一个读取，两处的数一样。
                badge: () => pendingCount.count.value,
            };
            const view: ViewImplementation = {
                load: async () => createEntriesViewHost((await import("./components/EntryTree.vue")).default, {
                    world: worldOf(),
                    state,
                    open: (id) => execute(OPEN_ENTRY_COMMAND, {id}),
                    create: {dialog: (await import("./components/NewEntryDialog.vue")).default, call, notices, kinds: entryKinds},
                }),
            };
            return {
                services: [
                    provideServicePerConsumer(canonClientKey, (consumer) => createCanonClient(bound ? () => context.remote.on(consumer) : null)),
                    // 读取层整个窗口一份（用本入口自己的身份读世界）；门面按调用方给，只为把它的插件 id 放进外部读取的键里。
                    provideServicePerConsumer(canonReadsKey, (consumer) => createCanonReads(worldOf(), consumer.plugin ?? "unknown", windowLine)),
                ],
                receivers: {[CANON_COMPONENT_VIEWS_POINT]: views.receiver(), [CANON_ENTRY_TABS_POINT]: entryTabs.receiver()},
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[ENTRIES_VIEW_ID]: view, [PENDING_VIEW_ID]: pendingView, [REVISIONS_VIEW_ID]: revisionsView},
                    [WORKBENCH_STATUSBAR_ITEMS_POINT]: {[PENDING_COUNT_ITEM]: pendingItem, [LINE_ITEM]: lineItem},
                    [PUBLIC_STATE_POINT]: Object.fromEntries(publicState.bindings),
                    [EDITOR_PAGES_POINT]: {[ENTRY_PAGE]: page, [RECEIPT_PAGE]: receiptPage, [CHANGE_PAGE]: changePage},
                    [EDITOR_LANGUAGES_POINT]: {[ENTRY_LANGUAGE]: {load: () => Promise.resolve(entryLanguageDefinition)}},
                    [WORKBENCH_OVERLAYS_POINT]: {[REVERT_OVERLAY]: overlay},
                    [CANON_COMPONENT_VIEWS_POINT]: {
                        [PERSON_COMPONENT]: componentView(() => import("./components/CharacterView.vue")),
                        [LOOK_COMPONENT]: componentView(() => import("./components/LookView.vue")),
                        [PANEL_TYPE]: componentView(() => import("./components/PanelDataView.vue")),
                    },
                    [COMMANDS_POINT]: canonCommands(commands, {newEntry: (parent) => startNewEntry(state, parent), pendingShown: () => pickFirstPending(pendingState), pickLine}),
                },
            };
        },
    })],
};
