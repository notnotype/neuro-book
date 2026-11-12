<script setup lang="ts">
/**
 * 产品的工作台外壳（同名 .md）：布局文档的 store 接到表面，标题栏、活动栏、面板头、状态栏与视图内容，按钮接到命令，拖放接到 `layout-drag`。
 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason, ContextMenuItem} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {findTab, findTreeNode, isFloating, isPanelShown, isSectionCollapsed, layoutDropKey, regionOf, sectionCollapseBlock, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridExtent, LayoutDoc} from "@notnotype/nb-layout";
import {FloatWindowHandles, useDropTarget} from "@notnotype/nb-layout/vue";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {TextParams} from "@notnotype/nb-ui/text";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {buttonBudget, NO_TITLE_ACTIONS} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import {WORKBENCH_FILE_DROP} from "../../shared/contracts";
import type {WorkbenchFileDrop, WorkbenchFileDropHost} from "../../shared/contracts";
import {editorTabIdOf} from "../../shared/editor-panels";
import {DOCK_COMMAND, FLOAT_COMMAND, SET_PANEL_COLLAPSED_COMMAND, TOGGLE_PANEL_MAXIMIZED_COMMAND} from "../commands/panel-commands";
import {MOVE_VIEW_COMMAND} from "../commands/view-commands";
import {workbenchText} from "../../shared/text";
import type {WorkbenchTextKey} from "../../shared/text";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {canResetContainer, containerHomeRegion, containerRegion, regionContainers, viewSection} from "../state/containers";
import {canResetView, containerEntries, focusLandings, moveTargetsOf, panelTitle, sidebarVisible, titleOnlyPanels, toolEntryIntent, viewIdOf, viewKey} from "../state/layout-present";
import type {FocusLanding} from "../state/layout-present";
import {createLayoutPolicy, panelConstraints} from "../state/layout-constraints";
import type {DropSplit} from "../state/layout-constraints";
import type {PaneFocusMover} from "../commands/pane-focus-commands";
import {presentDrag} from "../drag-presentation";
import {createLayoutDrag} from "../layout-drag";
import type {LayoutDrag, LayoutDragDrop} from "../layout-drag";
import type {WorkbenchDragSource} from "../entry-drop";
import type {ViewSource} from "../views/registry";
import {useViewInstances} from "../views/view-instances";
import type {EditorAreaContext, EditorTabDrag, PanelFrameControl} from "../contracts";
import {mountEditorArea} from "../editor-area";
import type {EditorAreaSource} from "../editor-area";
import {SHELL_TITLEBAR_HEIGHT} from "../shell/sizes";
import WorkbenchDragFeedback from "./WorkbenchDragFeedback.vue";
import WorkbenchPanelHead from "./WorkbenchPanelHead.vue";
import type {PanelFrameAction, PanelHeadTab} from "./WorkbenchPanelHead.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";
import WorkbenchSurface from "./WorkbenchSurface.vue";
import WorkbenchTitleBar from "./WorkbenchTitleBar.vue";
import WorkbenchToolStrip from "./WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "./WorkbenchToolStrip.vue";
import WorkbenchViewFrame from "./WorkbenchViewFrame.vue";
import type {ShellChrome, ViewInstanceRef} from "../titlebar/titlebar-source";
import {SET_PART_HIDDEN_COMMAND} from "../commands/part-commands";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";

defineOptions({name: "WorkbenchShell"});

const props = defineProps<{
    /** 外壳挂上时交出移动焦点的实现，返回撤销（`commands/pane-focus-commands.ts`）。 */
    attachPaneFocus?: (move: PaneFocusMover) => () => void;
    layout: LayoutDocStore;
    commands: CommandService;
    views: ViewSource;
    /** 编辑器槽的提供者；没有时（或没有贡献）槽里是欢迎文字。 */
    editorArea?: EditorAreaSource;
    /** 标题栏的菜单与搜索、两侧的条目；没有时标题栏只有品牌与项目名。 */
    chrome?: ShellChrome;
    project: string | null;
    /** 拖动时画不画落点分区（设置 `nbook.workbench/dropSectors`）；缺省画。 */
    dropSectors?: boolean;
    /** 拖动的手感（设置 `nbook.workbench/dragFeel`）；缺省实时布局。 */
    dragFeel?: "live" | "indicator";
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）；缺省离开标签条就缩。 */
    dragCardShrink?: "strip" | "panel";
    /** 拖到四周时怎么分（设置 `nbook.workbench/dropSplit`）；缺省只分本窗口。 */
    dropSplit?: DropSplit;
}>();

const resolver = useText();
const text = (value: DisplayText): string => resolver.t(value);
/** 外壳自己的目录文字（命名空间 `nbook.workbench`）；语言随窗口的端口切换。 */
const message = (key: WorkbenchTextKey, params?: TextParams): string => resolver.t(workbenchText(key, params));
const welcome = computed(() => (props.project === null ? message("shell.welcome.noProject") : message("shell.welcome.withProject", {name: props.project})));

const state = computed(() => props.layout.state);
const doc = computed(() => props.layout.actions.document());
/**
 * 画出来的文档：拖动中可能是实时布局的预览。表面、面板头读它：预览里新拆的面板不在 `doc` 里。命令、菜单、实例、活动栏、拖动判定读 `doc`：预览不改可见性，活动栏不跟预览，落点才稳。
 */
const renderedDoc = computed(() => props.layout.actions.rendered());
const catalog = computed(() => state.value.catalog);

function run(id: string, args: Record<string, unknown> = {}): void {
    void props.commands.execute(id, args, {source: "user"});
}

// ── 编辑器 ────────────────────────────────────────────────────────────────

const editorArea = computed(() => {
    const provider = props.editorArea?.current.value ?? null;
    return provider === null ? null : {id: provider.id, ...mountEditorArea(provider, resolver)};
});

/** 区级组件挂上时交出来（`EditorAreaHostProps`）；还没交时编辑器标签不起拖。 */
const editorTabs = shallowRef<EditorTabDrag | null>(null);
function attachEditorDrag(next: EditorTabDrag | null): void {
    editorTabs.value = next;
    props.layout.actions.acceptEditorDrag(next);
}

/** 每块编辑组一份：别的面板最大化时盖住它，对提供者就是不可见。 */
const editorContexts = new Map<string, EditorAreaContext>();
function editorContextOf(panelId: string): EditorAreaContext {
    let context = editorContexts.get(panelId);
    if (context === undefined) {
        // 浮动窗盖在最大化的面板上面，不算被盖住。
        context = {visible: computed(() => state.value.maximized === null || state.value.maximized === panelId || isFloating(doc.value, panelId))};
        editorContexts.set(panelId, context);
    }
    return context;
}

// ── 视图 ──────────────────────────────────────────────────────────────────

const visibleViews = computed(() => new Set([...state.value.visibleTabs].flatMap((key) => viewIdOf(key) ?? [])));
const placedViews = computed(() => new Set(Object.values(doc.value.panels).flatMap((panel) => panel.tabs.flatMap((tab) => (tab.kind === "view" ? [tab.viewId] : [])))));
const panelOfView = (viewId: string): string | null => findTab(doc.value, viewKey(viewId))?.panel ?? null;

const instances = useViewInstances({
    source: props.views,
    visible: () => visibleViews.value,
    placed: () => placedViews.value,
    location: (viewId) => {
        const panel = panelOfView(viewId);
        return panel === null ? null : regionOf(doc.value, panel);
    },
});

function layoutOfView(viewId: string): "scroll" | "fill" {
    return catalog.value.get(viewId)?.layout ?? "scroll";
}

/**
 * 内容层里一个标签该画的视图外框（`WorkbenchViewFrame` 的属性与事件）。编辑器标签、声明不在的视图、还没建实例的视图
 * 都没有外框，返回 null：前两种由模板单独成支，最后一种什么也不画，等实例建好再画。
 */
function viewFrameOf(contentKey: string) {
    const viewId = viewIdOf(contentKey);
    const instance = viewId === null ? undefined : instances.instances.get(viewId);
    if (viewId === null || instance === undefined || !catalog.value.has(viewId)) return null;
    return {
        props: {viewId, layout: layoutOfView(viewId), delivery: props.views.delivery(viewId), status: instance.status, error: instance.error, component: instance.component, context: instances.contextOf(viewId), generation: instance.generation, busy: instance.busy},
        on: {
            retryEntry: () => instances.retryEntry(viewId),
            reload: () => instances.reload(viewId),
            retryRender: () => instances.retryRender(viewId),
            renderError: (generation: number, reason: string) => instances.renderError(viewId, generation, reason),
        },
    };
}

const instanceOf = (viewId: string): ViewInstanceRef | null => {
    const generation = instances.generations.value.get(viewId);
    return generation === undefined ? null : {viewId, generation};
};

/** 面板头里除了动作之外要留多宽：一个截断的标签、其余只留图标（标签带的第二档），加框架按钮与内边距。动作透明时也占位（hover-actions.css），不让出来标签带就只剩“更多”。 */
const TAB_TRUNCATED_PX = 96;
const TAB_ICON_PX = 28;
const FRAME_BUTTON_PX = 26;
const HEAD_PADDING_PX = 20;
/**
 * 横向分支里收起就是零宽，和隐藏重复，无名面板还找不回来：只有上下排的面板有收起按钮（输出 20）。
 * 带容器的区域里再问库：底部面板的分节、区域此刻唯一显示的分节收不成标题行（输出 11），也没有按钮。和 `setPanelCollapsed` 拒绝的是同一个判定。
 */
const collapsibleHere = (panelId: string): boolean => findTreeNode(renderedDoc.value.tree.root, panelId)?.parent?.orientation === "vertical" && sectionCollapseBlock(renderedDoc.value, panelId) === null;
function headReserved(panelId: string): number {
    const panel = renderedDoc.value.panels[panelId];
    // 浮动窗只有“回到停靠”；树里是最大化、浮动，加上收起。
    const frames = isFloating(renderedDoc.value, panelId) ? 1 : 2 + (collapsibleHere(panelId) ? 1 : 0);
    const others = titleOnlyPanelIds.value.has(panelId) ? 0 : Math.max(0, (panel?.tabs.length ?? 1) - 1);
    return TAB_TRUNCATED_PX + TAB_ICON_PX * others + FRAME_BUTTON_PX * frames + HEAD_PADDING_PX;
}

/** 视图的标题动作（docs/specs/workbench/views.md 输出 10、11）；Lab 里没有命令服务（没有 chrome）时没有。 */
function viewActionsOf(viewId: string, panelId: string): TitleActionsModel {
    // 浮动窗不在呈现尺寸里：按它记录里的矩形算。不读画出来的那份：缩放时它每帧变，所有面板头都要跟着重算。
    const width = doc.value.floats.find((float) => float.panel === panelId)?.rect.width ?? state.value.presented[panelId]?.width ?? null;
    return props.chrome?.viewActions(viewId, catalog.value.get(viewId)?.actions ?? [], resolver, instanceOf(viewId), buttonBudget(width, headReserved(panelId), Number.POSITIVE_INFINITY)) ?? NO_TITLE_ACTIONS;
}

/** 视图所在面板、交付状态与实例代际任一变化，已打开的菜单就关闭（输出 23）。 */
const viewIdentity = (viewId: string): string => `${viewId}|${panelOfView(viewId) ?? ""}|${props.views.delivery(viewId).kind}|${String(instances.generations.value.get(viewId) ?? 0)}`;

function runViewAction(viewId: string, key: string): void {
    props.chrome?.runViewAction(viewId, catalog.value.get(viewId)?.actions ?? [], key, instanceOf(viewId));
}

// ── 面板头 ────────────────────────────────────────────────────────────────

function tabsIn(source: LayoutDoc, panelId: string): PanelHeadTab[] {
    return (source.panels[panelId]?.tabs ?? []).map((tab) => {
        const declaration = tab.kind === "view" ? catalog.value.get(tab.viewId) : undefined;
        // 声明消失的视图没有标题：标签写它的 id，占位写原因（输出 4）。
        return {id: tabKey(tab), label: declaration === undefined ? (viewIdOf(tabKey(tab)) ?? tabKey(tab)) : text(declaration.title), icon: declaration?.icon ?? "i-lucide-circle-help"};
    });
}

const titleOnlyPanelIds = computed(() => titleOnlyPanels(doc.value));
const headTabs = (panelId: string): PanelHeadTab[] => tabsIn(renderedDoc.value, panelId);

const DOCK_ICON = "i-lucide-panel-top";

/** 浮动的编辑组的框架按钮：编辑组的头是编辑器画的，只能交给它。 */
function editorFrameActions(panelId: string): ReadonlyArray<PanelFrameControl> {
    return isFloating(renderedDoc.value, panelId) ? [{id: DOCK_COMMAND, icon: DOCK_ICON, label: message("commands.nbook.view.dock.title"), run: () => run(DOCK_COMMAND, {panelId})}] : [];
}

/**
 * 框架按钮（输出 20）：可用性问命令系统；先读布局状态，让按钮随它重新求值（命令系统的可用性变化不通知）。
 * 没有“隐藏”：能隐藏的是区域，记在锚上，锚没有头；画头的工具面板是分节或浮动窗。
 */
function frameActionsOf(panelId: string): PanelFrameAction[] {
    const panel = renderedDoc.value.panels[panelId];
    void [state.value.ready, state.value.maximized];
    const describe = (id: string, icon: string, title: WorkbenchTextKey, pressed?: boolean): PanelFrameAction => {
        const enabled = props.commands.isEnabled(id);
        return {id, icon, label: message(title), disabled: !(enabled.ok && enabled.value), ...(enabled.ok ? {} : {reason: resolver.t(enabled.reason)}), ...(pressed === undefined ? {} : {pressed})};
    };
    if (isFloating(renderedDoc.value, panelId)) return [describe(DOCK_COMMAND, DOCK_ICON, "commands.nbook.view.dock.title")];
    const viewId = viewIdOf(panel?.active ?? "");
    const floatable = viewId !== null && catalog.value.get(viewId)?.floatable !== false && catalog.value.get(viewId)?.movable !== false;
    return [
        ...(floatable ? [describe(FLOAT_COMMAND, "i-lucide-picture-in-picture-2", "commands.nbook.view.float.title")] : []),
        ...(collapsibleHere(panelId) ? [describe(SET_PANEL_COLLAPSED_COMMAND, "i-lucide-chevrons-down", "commands.nbook.view.set-panel-collapsed.title", isSectionCollapsed(renderedDoc.value, panelId))] : []),
        describe(TOGGLE_PANEL_MAXIMIZED_COMMAND, "i-lucide-maximize-2", "commands.nbook.view.toggle-panel-maximized.title", state.value.maximized === panelId),
    ];
}

/** 面板头的动作区是活动视图的；没有动作的面板不在表里。 */
const headActions = computed(() => new Map(Object.entries(doc.value.panels).flatMap(([panelId, panel]) => {
    const viewId = viewIdOf(panel.active ?? "");
    if (viewId === null) return [];
    const model = viewActionsOf(viewId, panelId);
    return model.buttons.length > 0 || model.menu.length > 0 ? [[panelId, {viewId, model}] as const] : [];
})));

// ── “移动到” ──────────────────────────────────────────────────────────────

const moveMenu = shallowRef<{readonly viewId: string; readonly x: number; readonly y: number; readonly identity: string} | null>(null);

function openMoveMenu(key: string, at: {readonly x: number; readonly y: number}): void {
    const viewId = viewIdOf(key);
    if (viewId === null || catalog.value.get(viewId)?.movable === false) return;
    moveMenu.value = {viewId, ...at, identity: viewIdentity(viewId)};
}

watch(() => (moveMenu.value === null ? null : viewIdentity(moveMenu.value.viewId)), (identity) => {
    if (moveMenu.value !== null && identity !== moveMenu.value.identity) moveMenu.value = null;
});

/** 键盘关掉或选完之后，焦点回到打开它的标签（选完时标签可能已经在别的面板）；标签不在界面上时回活动栏里它那个容器的入口。点到外面时焦点归点到的地方。 */
function closeMoveMenu(reason: ContextMenuCloseReason): void {
    const opened = moveMenu.value;
    moveMenu.value = null;
    if (opened === null || reason === "outside") return;
    void nextTick(() => {
        const root = hostEl.value;
        (root?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(viewKey(opened.viewId))}"]`) ?? root?.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(viewSection(doc.value, opened.viewId)?.container ?? "")}"]`))?.focus({preventScroll: true});
    });
}

const moveMenuItems = computed((): ContextMenuItem[] => {
    const opened = moveMenu.value;
    if (opened === null) return [];
    const targets = moveTargetsOf(doc.value, opened.viewId) ?? [];
    const into = targets.flatMap((target): ContextMenuItem[] => (target.kind !== "panel" ? [] : [{label: text(panelTitle(doc.value, catalog.value, target.panel)), action: () => run(MOVE_VIEW_COMMAND, {viewId: opened.viewId, target: target.panel})}]));
    const beside = targets.flatMap((target): ContextMenuItem[] => (target.kind !== "new-panel" ? [] : [{label: message("viewCommands.newPanelNextTo", {panel: text(panelTitle(doc.value, catalog.value, target.nextTo))}), action: () => run(MOVE_VIEW_COMMAND, {viewId: opened.viewId, newPanelNextTo: target.nextTo})}]));
    const reset: ContextMenuItem[] = canResetView(doc.value, catalog.value, opened.viewId, state.value.containers) ? [{label: message("views.resetLocation"), action: () => props.layout.actions.resetView(opened.viewId)}] : [];
    // 已经独占一个窗的再浮动没有意义。
    const home = panelOfView(opened.viewId);
    const alone = home !== null && isFloating(doc.value, home) && doc.value.panels[home]?.tabs.length === 1;
    const float: ContextMenuItem[] = catalog.value.get(opened.viewId)?.floatable === false || alone ? [] : [{label: message("commands.nbook.view.float.title"), action: () => run(FLOAT_COMMAND, {tab: viewKey(opened.viewId)})}];
    const sections = [into, beside, float, reset].filter((section) => section.length > 0);
    return sections.flatMap((section, index) => (index === 0 ? section : [{separator: true}, ...section]));
});

// ── 活动栏 ────────────────────────────────────────────────────────────────

/** 活动栏说的“侧栏可见”（输出 22）：入口的按下态与点了做什么都问它。 */
const sidebarShowing = computed(() => sidebarVisible(doc.value, {removed: state.value.collapse.removed, maximized: state.value.maximized}, state.value.visibleTabs as ReadonlySet<string>));

/** 视图的标题；声明消失的视图写它的 id，和面板头的标签一样（输出 4）。 */
const viewTitle = (viewId: string): string => {
    const declaration = catalog.value.get(viewId);
    return declaration === undefined ? viewId : text(declaration.title);
};

/** 上段的入口：侧栏里的容器，按入口顺序（输出 22、41）。成员是声明消失的视图时照样有入口，点了能看到占位。 */
const toolEntries = computed((): ToolStripEntry[] => containerEntries(renderedDoc.value, catalog.value, state.value.containers).map((entry) => {
    const label = text(entry.label.title);
    const views = entry.views.map(viewTitle);
    // 容器的名称就是它唯一那个视图的标题时，悬停文字不把同一个词写两遍。
    const tooltip = views.length === 1 && views[0] === label ? label : message("viewContainers.entryTooltip", {name: label, views: views.join(message("viewContainers.viewSeparator"))});
    return {id: entry.id, label, icon: entry.label.icon, tooltip, viewId: entry.views.length === 1 ? (entry.views[0] ?? null) : null, current: entry.current, pressed: entry.current && sidebarShowing.value};
}));

const stripItems = computed<ToolStripItem[]>(() => (props.chrome?.activityEntries(resolver) ?? []).map((item) => ({id: item.id, title: item.title, icon: item.icon, interactive: item.command !== null, pressed: item.pressed, disabledReason: item.disabledReason})));

const hostEl = ref<HTMLElement | null>(null);

/** 点入口（输出 22）。焦点不在这里管：鼠标点不抢焦点，原处看不见了由下面“焦点”一节的规则接走（输出 42）。 */
function selectEntry(container: string): void {
    const intent = toolEntryIntent(doc.value, container, {sidebarVisible: sidebarShowing.value});
    if (intent.kind === "show") props.layout.actions.showContainer(intent.container);
    if (intent.kind === "hide") run(SET_PART_HIDDEN_COMMAND, {part: "sidebar", hidden: true});
}

// ── 入口的右键菜单 ────────────────────────────────────────────────────────

const containerMenu = shallowRef<{readonly container: string; readonly x: number; readonly y: number} | null>(null);

/** 容器的菜单（输出 44）。现在只有“重置”：容器有声明的区域、此刻不在那里时才有这一项。 */
function containerMenuItemsOf(container: string): ContextMenuItem[] {
    const home = containerHomeRegion(container, catalog.value, state.value.containers);
    if (home === null || !canResetContainer(doc.value, container, catalog.value, state.value.containers)) return [];
    return [{label: message("viewContainers.reset"), action: () => props.layout.actions.moveContainer(container, home)}];
}

const containerMenuItems = computed(() => (containerMenu.value === null ? [] : containerMenuItemsOf(containerMenu.value.container)));

/** 一项都没有时不开：空菜单只会吃掉一次按键。 */
function openContainerMenu(container: string, at: {readonly x: number; readonly y: number}): void {
    if (containerMenuItemsOf(container).length > 0) containerMenu.value = {container, ...at};
}

// 开着的时候菜单项没了（容器被别的途径搬回去了、成员走光了）：关掉，不留一个空菜单。
watch(() => containerMenu.value !== null && containerMenuItems.value.length === 0, (stale) => {
    if (stale) containerMenu.value = null;
});

/** 键盘关掉或选完之后，焦点回到打开它的入口；容器搬出侧栏后入口不在了，去它第一个分节的标题。点到外面时焦点归点到的地方。 */
function closeContainerMenu(reason: ContextMenuCloseReason): void {
    const opened = containerMenu.value;
    containerMenu.value = null;
    if (opened === null || reason === "outside") return;
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const region = containerRegion(doc.value, opened.container);
        const first = region === null ? undefined : regionContainers(doc.value, region).find((container) => container.id === opened.container)?.sections[0];
        const candidates = [landingElement(root, {kind: "entry", container: opened.container}), first === undefined ? null : landingElement(root, {kind: "tab", panel: first})];
        candidates.find(reachable)?.focus({preventScroll: true});
    });
}

// ── 标题栏与状态栏 ────────────────────────────────────────────────────────

/** “打开项目”的命令 id：项目插件的公开合同，工作台不为它依赖项目插件的模块。 */
const OPEN_PROJECT_COMMAND = "nbook.project.open";

const titleMenus = computed(() => props.chrome?.menus(resolver) ?? []);
const panelVisible = computed(() => props.layout.actions.partVisible("panel"));
/** 标题栏三个布局按钮的按下态：区域此刻看得见，与视图菜单的勾选同一判断。 */
const layoutButtons = computed(() => ({
    sidebar: {pressed: props.layout.actions.partVisible("sidebar"), disabled: !state.value.ready},
    panel: {pressed: panelVisible.value, disabled: !state.value.ready},
    auxiliarybar: {pressed: props.layout.actions.partVisible("auxiliarybar"), disabled: !state.value.ready},
}));
const titlebarHeight = `${String(SHELL_TITLEBAR_HEIGHT)}px`;
/** 状态栏只认一条记录：整棵文档是一条，`record` 没有别的取值。 */
const statusProblems = computed(() => state.value.problems.map((problem) => ({record: "layout", kind: problem.kind, code: problem.code})));

// ── 焦点 ──────────────────────────────────────────────────────────────────

const surface = useTemplateRef<InstanceType<typeof WorkbenchSurface>>("surface");

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** 在界面上、能接焦点：画出来了，也不在停放的内容里。 */
const reachable = (element: HTMLElement | null | undefined): element is HTMLElement => element != null && element.offsetParent !== null && element.closest("[inert]") === null;

/** 落点在界面上对应的元素；不保证看得见，调用方用 `reachable` 筛。 */
function landingElement(root: HTMLElement, landing: FocusLanding): HTMLElement | null {
    if (landing.kind === "entry") return root.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(landing.container)}"]`);
    const tab = root.querySelector<HTMLElement>(`[data-panel-head="${CSS.escape(landing.panel)}"] [data-panel-tab][tabindex="0"]`);
    if (landing.kind === "tab") return tab;
    // 切到的分节：里面第一个能聚焦的；内容还没加载出来、或它收成了标题行时给它的标题。
    const key = doc.value.panels[landing.panel]?.active ?? null;
    const inner = key === null ? null : root.querySelector(`[data-content="${CSS.escape(key)}"]`)?.querySelector<HTMLElement>(FOCUSABLE);
    return reachable(inner) ? inner : tab;
}

/**
 * 焦点所在的内容或面板头看不见了（输出 16、42）：`candidates` 按先后给落点，取第一个接得住焦点的，都没有时外壳根。焦点已经去了别处（菜单、对话框、别的面板、活动栏的入口）时不抢。
 * 判断焦点丢了要等渲染之后：面板头被移走时焦点回到 body，内容停放时焦点还在 `inert` 的元素上。
 */
function recoverFocus(candidates: (root: HTMLElement) => ReadonlyArray<HTMLElement | null>): void {
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const active = root.ownerDocument.activeElement;
        if (active !== null && active !== root.ownerDocument.body && active.closest("[inert]") === null) return;
        (candidates(root).find(reachable) ?? root).focus({preventScroll: true});
    });
}

/** 工具面板的落点按 `focusLandings`：同一面板看得见的标签，切走容器后新容器的第一个分节，活动栏里它那个容器的入口。 */
const panelLandings = (panel: string) => (root: HTMLElement): ReadonlyArray<HTMLElement | null> => focusLandings(doc.value, panel).map((landing) => landingElement(root, landing));

/** 内容被停放时焦点在里面（表面报上来的）。编辑器的内容没有所属的活动栏入口，去活动编辑组的活动标签。 */
function onContentParked(key: string): void {
    const viewId = viewIdOf(key);
    if (viewId === null) {
        recoverFocus((root) => [root.querySelector<HTMLElement>('[data-editor-group-head-active] [data-panel-tab][tabindex="0"]')]);
        return;
    }
    recoverFocus(panelLandings(panelOfView(viewId) ?? ""));
}

// 面板头里的焦点没有人报：头随面板一起从界面上拿走，不是停放。所以这里不看是哪个按钮、哪条命令、哪个快捷键改的文档，只问“焦点所在的面板还显示吗”。
// `focusedPanel` 是表面按焦点事件记的；文档刚变、界面还没重画，它指的还是焦点原来所在的面板。
watch(doc, (next) => {
    const panel = state.value.focusedPanel;
    if (panel !== null && next.panels[panel] !== undefined && !isPanelShown(next, panel)) recoverFocus(panelLandings(panel));
});

let detachPaneFocus: (() => void) | undefined;
onMounted(() => {
    detachPaneFocus = props.attachPaneFocus?.((direction) => {
        surface.value?.moveFocus(direction);
    });
});
onBeforeUnmount(() => detachPaneFocus?.());

// ── 拖放 ──────────────────────────────────────────────────────────────────

const POLICY = createLayoutPolicy({dropSplit: () => props.dropSplit ?? "half"});

function onExtent(next: GridExtent | null): void {
    props.layout.actions.acceptExtent(next);
}

const drag = shallowRef<LayoutDrag | null>(null);
onMounted(() => {
    drag.value = createLayoutDrag({
        root: hostEl.value!,
        doc: () => doc.value,
        catalog: () => catalog.value,
        policy: () => POLICY,
        projection: () => props.layout.actions.projectionOptions(),
        extent: () => state.value.extent,
        maximized: () => state.value.maximized,
        enabled: () => state.value.ready,
        editorTabs: () => editorTabs.value,
        titleOnly: (panel) => titleOnlyPanelIds.value.has(panel),
        sectors: () => props.dropSectors !== false,
        feel: () => props.dragFeel ?? "live",
        cardShrink: () => props.dragCardShrink ?? "strip",
        settleMotion: () => surface.value?.settleMotion(),
        showPreview: (next) => props.layout.actions.setLivePreview(next),
        placeCard: (rect) => surface.value?.placeLifted(rect),
        moveGhost: (point) => feedback.value?.moveGhost(point),
        floats: () => props.layout.actions.floats(),
        markFloatMove: (panel, rect) => props.layout.actions.previewFloat(panel, rect ?? null, "move"),
        placeFloat: (panel, offset) => surface.value?.placeFloat(panel, offset),
        floatMinimum: (source) => {
            const home = findTab(doc.value, source.tab)?.panel;
            const panel = home === undefined ? undefined : doc.value.panels[home];
            // 只有这个标签的约束：工具视图按它声明的，不按来源面板别的标签的并。
            return panel === undefined ? {width: 0, height: 0} : panelConstraints({role: panel.role, tabs: panel.tabs.filter((tab) => tabKey(tab) === source.tab), active: source.tab}, null, catalog.value, state.value.extent?.width ?? 0).minimumSize;
        },
        commit: (source, action, part, keyboard) => props.layout.actions.commitDrop(source, action, part, keyboard),
    });
});
onBeforeUnmount(() => drag.value?.dispose());

const feedback = useTemplateRef<InstanceType<typeof WorkbenchDragFeedback>>("feedback");

/** 手势每帧发布；这里只取慢的两样，它们不变下游就不重算，整个外壳不跟着指针重渲染。 */
const dragSource = computed(() => drag.value?.session.state.value?.source ?? null);
const dragDrop = computed(() => drag.value?.session.state.value?.drop ?? null);

// 资源树的文件拖出树（输出 39）：那一场是资源树自己的会话，判定与反馈还在这里，同一份。
const fileDrops = new WeakMap<WorkbenchFileDrop, LayoutDragDrop>();
const shownFileDrop = shallowRef<LayoutDragDrop | null>(null);
// 只建一个：资源树按它的身份判断换没换外壳。
const fileDropHost: WorkbenchFileDropHost = {
    resolve: (point, top) => {
        const drop = drag.value?.fileDrop(point, top instanceof Element ? top : null) ?? null;
        if (drop === null) return null;
        const file: WorkbenchFileDrop = {action: drop.action, ...(drop.part === undefined ? {} : {part: drop.part}), key: JSON.stringify([layoutDropKey(drop.action), drop.part ?? null]), label: dropLabel(drop)};
        fileDrops.set(file, drop);
        return file;
    },
    show: (drop) => {
        shownFileDrop.value = drop === null ? null : (fileDrops.get(drop) ?? null);
    },
    commit: (drop, addresses) => props.layout.actions.commitFiles(addresses, drop.action, drop.part),
};
useDropTarget(hostEl, [WORKBENCH_FILE_DROP], () => fileDropHost);

function ghostOf(source: WorkbenchDragSource): {readonly label: string; readonly icon?: string; readonly fileIcon?: CatppuccinIcon | null} | null {
    // 整窗本身就在跟手，没有拖影。
    if (source.kind === "panel") return null;
    if (source.kind === "container") {
        const entry = toolEntries.value.find((item) => item.id === source.container);
        return entry === undefined ? null : {label: entry.label, ...(entry.icon === null ? {} : {icon: entry.icon})};
    }
    const editorTab = editorTabIdOf(source.tab);
    if (editorTab !== null) return editorTabs.value?.ghost(editorTab) ?? null;
    const viewId = viewIdOf(source.tab);
    const declaration = viewId === null ? undefined : catalog.value.get(viewId);
    return declaration === undefined ? null : {label: text(declaration.title), icon: declaration.icon};
}

/**
 * 拖动中画什么，只在这里取。这个对象在指针下的落点变了就换（浮动的矩形每帧变），模板和插槽要读下面拆开的几个：
 * 插槽在 NestedGrid 的渲染里跑，直接读它的话每帧都是整个网格和所有面板头重渲染。
 */
const dragView = computed(() => presentDrag({
    live: drag.value?.live.active.value === true,
    source: dragSource.value,
    drop: dragDrop.value ?? shownFileDrop.value,
    lifted: drag.value?.live.card.value != null,
    shownAction: drag.value?.live.shownAction.value ?? null,
    rendered: renderedDoc.value,
    rejected: drag.value?.rejected.value === true,
}));

const dragPlaceholder = computed(() => dragView.value.placeholder);
const dragSlotPanel = computed(() => dragView.value.slotPanel);
const mergeTarget = computed(() => dragView.value.mergeTarget);
const mergeEntry = computed(() => dragView.value.mergeEntry);
const feedbackSectors = computed(() => dragView.value.feedbackSectors);
const feedbackPreview = computed(() => {
    const {preview} = dragView.value.feedback;
    return preview === null ? null : {...preview, entryRect: preview.entryRect ?? null};
});
const feedbackKind = computed(() => dragView.value.feedback.kind);
const feedbackLabel = computed(() => {
    const {label} = dragView.value.feedback;
    return label === null ? "" : dropLabel(label);
});
/** 读屏与卡片头的落点文字。 */
const liveLabel = computed(() => {
    const {announce} = dragView.value.feedback;
    return announce === null ? "" : announce === "rejected" ? message("shell.drop.rejected") : dropLabel(announce);
});

/** 跟手的卡片：内容项拿起来了，拖影就不画了。 */
const liftedCard = computed(() => {
    const card = drag.value?.live.card.value ?? null;
    return card === null ? null : {...card, home: findTab(doc.value, card.key)?.panel ?? null};
});
const cardTitle = computed(() => (dragSource.value === null ? null : ghostOf(dragSource.value)));
const wantsGhost = computed(() => dragView.value.ghost);
/** 拖影的身份；位置经 `moveGhost` 写。 */
const dragGhost = computed(() => (dragSource.value === null || !wantsGhost.value ? null : ghostOf(dragSource.value)));
/** 正被拖着、活动栏上留着位置的入口：只含被拖视图的那个容器的。 */
const toolPlaceholder = computed(() => {
    const viewId = dragPlaceholder.value === null ? null : viewIdOf(dragPlaceholder.value);
    return viewId === null ? null : (toolEntries.value.find((entry) => entry.viewId === viewId)?.id ?? null);
});
/** 并入的盖层：矩形按预览算，来源收起时目标会动，盖层跟着过渡。 */
const mergeRect = computed(() => {
    const panel = mergeTarget.value;
    return panel === null ? null : (drag.value?.panelRectIn(renderedDoc.value, panel) ?? null);
});
const mergeStyle = computed(() => {
    const rect = mergeRect.value;
    return rect === null ? {} : {transform: `translate(${String(rect.left)}px, ${String(rect.top)}px)`, width: `${String(rect.right - rect.left)}px`, height: `${String(rect.bottom - rect.top)}px`};
});
const slotStyle = computed(() => {
    const slot = drag.value?.live.slot.value ?? null;
    return slot === null ? {} : {transform: `translate(${String(slot.x)}px, ${String(slot.y)}px)`, width: `${String(slot.width)}px`, height: `${String(slot.height)}px`};
});

function dropLabel(drop: LayoutDragDrop): string {
    if (drop.inPlace) return message("shell.drop.inPlace");
    const {action} = drop;
    if (action.kind === "new-container") return message("shell.drop.newContainer");
    if (action.kind === "move-entry") return message("shell.drop.insert");
    if (action.kind === "join-container") return message("shell.drop.joinContainer", {part: toolEntries.value.find((entry) => entry.id === action.container)?.label ?? action.container});
    if (action.kind === "reveal") return message("shell.drop.reveal", {part: text(panelTitle(doc.value, catalog.value, action.panel))});
    if (action.kind === "strip") return message("shell.drop.insert");
    if (action.kind === "center") return message("shell.drop.addTab");
    if (action.kind === "float") return message("shell.drop.float");
    return message(action.target.kind === "between" ? "shell.drop.between" : "shell.drop.split");
}

const sectorLabels = computed(() => ({
    left: message("shell.drop.sector.left"),
    right: message("shell.drop.sector.right"),
    top: message("shell.drop.sector.top"),
    bottom: message("shell.drop.sector.bottom"),
    center: message("shell.drop.addTab"),
}));

/** 呈现降级写在外壳根上（“失败与恢复”）：被收走的面板，压到编辑组时再加一条；记录不合骨架回落了也写一条。 */
const diagnostics = computed(() => {
    const {removed, squeezed} = state.value.collapse;
    return [...removed].map((panel) => `放不下，收走 ${panel}`).concat(squeezed ? ["放不下，压缩编辑组"] : [], state.value.outsideSkeleton ? ["布局记录不合骨架，已用默认布局"] : []).join(" | ");
});

/** 布局里的面板，给外壳根写个数：e2e 和排障用。 */
const panelCount = computed(() => treeLeaves(doc.value.tree.root).filter((leaf) => doc.value.panels[leaf.id] !== undefined).length);
</script>

<template>
    <div ref="hostEl" class="workbench-shell-host" tabindex="-1">
        <div class="workbench-shell" data-workbench-shell :data-layout-diagnostics="diagnostics" :data-panel-count="panelCount">
            <div class="workbench-shell__titlebar-slot" data-shell-titlebar :style="{height: titlebarHeight}">
                <WorkbenchTitleBar
                    v-if="chrome !== undefined"
                    :project="project"
                    :menus="titleMenus"
                    :search-shortcut="chrome.searchShortcut()"
                    :layout="layoutButtons"
                    :items="chrome.titleEntries(resolver)"
                    @run="(command, args) => run(command, {...args})"
                    @search="run(OPEN_COMMANDS_ID)"
                    @toggle-part="(part) => run(SET_PART_HIDDEN_COMMAND, {part})"
                    @open-project="run(OPEN_PROJECT_COMMAND)"
                    @run-item="(id) => chrome?.runItem(id)"
                />
                <div v-else class="workbench-shell__titlebar">
                    <span class="workbench-shell__app">NeuroBook</span>
                    <span v-if="project !== null" class="workbench-shell__project">{{ project }}</span>
                </div>
            </div>
            <WorkbenchSurface
                ref="surface"
                class="workbench-shell__surface"
                :doc="renderedDoc"
                :projection="layout.actions.renderedPresentation()"
                :lifted="liftedCard"
                :floats="layout.actions.floats()"
                :data-drag-feel="drag?.live.active.value === true ? 'live' : 'indicator'"
                :data-live-preview="drag?.live.previewKey.value ?? 'none'"
                :maximized="state.maximized"
                :disabled="!state.ready"
                :title-only-panels="titleOnlyPanelIds"
                :slot-panel="dragSlotPanel"
                context-key="workbench"
                @extent="onExtent"
                @card-gap="(gap) => layout.actions.acceptCardGap(gap)"
                @presented="(sizes) => layout.actions.acceptPresented(sizes)"
                @preview="(sizes) => layout.actions.acceptPreview(sizes)"
                @gesture-commit="(sizes, collapsed) => layout.actions.commitGesture(sizes, collapsed)"
                @focus-panel="(panel) => layout.actions.focusPanel(panel)"
                @raise-float="(panel) => layout.actions.raiseFloat(panel)"
                @content-parked="onContentParked"
            >
                <template #activitybar>
                    <WorkbenchToolStrip
                        :label="message('shell.activityBar')"
                        :more-label="message('common.more')"
                        :entries="toolEntries"
                        :placeholder="toolPlaceholder"
                        :highlighted="mergeEntry"
                        :items="stripItems"
                        :drag-hint="message('shell.drag.hint')"
                        @select="selectEntry"
                        @run-item="(id) => chrome?.runItem(id)"
                        @context-menu="openContainerMenu"
                    />
                </template>
                <template #statusbar>
                    <WorkbenchStatusBar
                        :project="project"
                        :panel-hidden="!panelVisible"
                        :panel-toggle-disabled="!state.ready"
                        :problems="statusProblems"
                        :items="chrome?.statusEntries(resolver) ?? []"
                        @run-item="(id) => chrome?.runItem(id)"
                        @toggle-panel="run(SET_PART_HIDDEN_COMMAND, {part: 'panel', hidden: panelVisible})"
                        @retry="layout.actions.retry()"
                        @discard="layout.actions.discard()"
                    />
                </template>
                <template #head="{panelId, idPrefix}">
                    <template v-if="renderedDoc.panels[panelId]?.role === 'editor'">
                        <component :is="editorArea.head" v-if="editorArea !== null" :key="editorArea.id" :panel-id="panelId" :dragging-tab="dragPlaceholder" :frame-actions="editorFrameActions(panelId)" />
                    </template>
                    <WorkbenchPanelHead
                        v-else
                        :panel-id="panelId"
                        :label="text(panelTitle(renderedDoc, catalog, panelId))"
                        :tabs="headTabs(panelId)"
                        :active="renderedDoc.panels[panelId]?.active ?? null"
                        :more-label="message('common.more')"
                        :id-prefix="idPrefix"
                        :drag-hint="message('shell.drag.hint')"
                        :dragging-tab="dragPlaceholder"
                        :title-only="titleOnlyPanelIds.has(panelId)"
                        :frame-actions="frameActionsOf(panelId)"
                        @activate="(key) => layout.actions.activate(key)"
                        @reorder="(key, delta) => layout.actions.reorderTab(key, delta)"
                        @action="(action) => run(action, {panelId})"
                        @context-menu="openMoveMenu"
                    >
                        <template v-if="headActions.has(panelId)" #actions>
                            <TitleActions :model="headActions.get(panelId)!.model" :identity="viewIdentity(headActions.get(panelId)!.viewId)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(headActions.get(panelId)!.viewId, key)" />
                        </template>
                    </WorkbenchPanelHead>
                </template>
                <template #lifted-head="{contentKey}">
                    <div class="workbench-shell__card-head" data-drag-card-head>
                        <template v-if="cardTitle !== null">
                            <span v-if="cardTitle.icon !== undefined" class="workbench-shell__card-icon" :class="cardTitle.icon" aria-hidden="true"></span>
                            <FileIcon v-else-if="cardTitle.fileIcon != null" :icon="cardTitle.fileIcon" />
                            <span class="workbench-shell__card-title">{{ cardTitle.label }}</span>
                        </template>
                        <span class="workbench-shell__card-hint" data-drag-card-hint aria-hidden="true">{{ liveLabel }}</span>
                    </div>
                </template>
                <!-- 插槽始终传，条件写在里面：条件插槽编译成动态插槽，外壳每渲一次表面都要跟着更新。 -->
                <template #overlay>
                    <template v-if="drag?.live.active.value === true">
                        <div v-if="drag.live.slot.value !== null" class="workbench-shell__slot" data-live-slot :style="slotStyle"></div>
                        <!-- 按目标换元素：换目标时不从上一块滑过来，在新的这块淡入。 -->
                        <div v-if="mergeRect !== null" :key="mergeTarget ?? ''" class="workbench-shell__merge" data-live-merge :data-live-merge-panel="mergeTarget" :style="mergeStyle">
                            <span class="workbench-shell__merge-label">{{ message("shell.drop.addTab") }}</span>
                        </div>
                    </template>
                </template>
                <template #float-chrome="{id, rect}">
                    <FloatWindowHandles
                        :rect="rect"
                        :min="layout.actions.floatBounds(id).min"
                        :max="layout.actions.floatBounds(id).max"
                        move-icon-class="i-lucide-grip-horizontal"
                        @preview="(next) => layout.actions.previewFloat(next === null ? null : id, next)"
                        @commit="(next) => layout.actions.setFloatRect(id, next)"
                        @move="(position) => layout.actions.moveFloat(id, position)"
                    />
                </template>
                <template #content="{contentKey, panelId}">
                    <template v-if="viewIdOf(contentKey) === null">
                        <component :is="editorArea.group" v-if="editorArea !== null" :key="editorArea.id" :panel-id="panelId" :tab-id="editorTabIdOf(contentKey)" :context="editorContextOf(panelId)" data-workbench-editor-area />
                        <div v-else class="workbench-shell__welcome">
                            <h1>NeuroBook</h1>
                            <!-- 这块编辑组有标签时写的是原因（输出 34）：编辑器撤回了，标签还在，再次交付后恢复。 -->
                            <p>{{ (renderedDoc.panels[panelId]?.tabs.length ?? 0) > 0 ? message("shell.editorUnavailable") : welcome }}</p>
                        </div>
                    </template>
                    <div v-else-if="!catalog.has(viewIdOf(contentKey)!)" class="workbench-shell__missing" role="status" data-view-missing>
                        <span>{{ message("shell.missing.view", {viewId: viewIdOf(contentKey)!}) }}</span>
                        <button type="button" class="workbench-shell__missing-close nb-ui-focus-ring" @click="layout.actions.closeTab(contentKey)">{{ message("shell.missing.close") }}</button>
                    </div>
                    <WorkbenchViewFrame v-else-if="viewFrameOf(contentKey) !== null" v-bind="viewFrameOf(contentKey)!.props" v-on="viewFrameOf(contentKey)!.on" />
                </template>
            </WorkbenchSurface>
        </div>
        <component :is="editorArea.host" v-if="editorArea !== null" :key="editorArea.id" :attach-tab-drag="attachEditorDrag" />
        <ContextMenu :open="moveMenu !== null" :x="moveMenu?.x ?? 0" :y="moveMenu?.y ?? 0" :items="moveMenuItems" @request-close="closeMoveMenu" />
        <ContextMenu :open="containerMenu !== null" :x="containerMenu?.x ?? 0" :y="containerMenu?.y ?? 0" :items="containerMenuItems" @request-close="closeContainerMenu" />
        <WorkbenchDragFeedback ref="feedback" :ghost="dragGhost" :preview="feedbackPreview" :label="feedbackLabel" :kind="feedbackKind" :sectors="feedbackSectors" :sector-labels="sectorLabels" :live-status="liveLabel" />
    </div>
</template>

<style scoped>
/* 卡片的头：跟手的内容上面那一条。 */
.workbench-shell__card-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding-inline: 10px;
    border-bottom: 1px solid var(--divider);
    background: var(--panel-surface);
    color: var(--text-main);
    font-size: var(--text-sm);
}

.workbench-shell__card-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-shell__card-hint {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
}

/* 空位：缺省什么都不画，放下才有卡片（输出 38）；边框和底是主题能给的令牌。 */
.workbench-shell__slot {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border: 1px solid var(--layout-slot-border);
    border-radius: var(--layout-card-radius);
    background: var(--layout-slot-fill);
    pointer-events: none;
}

/* 并入：目标变暗加内描边。来源收起时目标会动，过渡和外框同一条曲线；样式走令牌，主题能换。 */
.workbench-shell__merge {
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    box-sizing: border-box;
    border-radius: var(--layout-card-radius);
    background: var(--layout-merge-fill);
    box-shadow: inset 0 0 0 var(--layout-merge-border-width) var(--layout-merge-border);
    pointer-events: none;
    transition:
        transform var(--motion-layout) var(--ease-layout),
        width var(--motion-layout) var(--ease-layout),
        height var(--motion-layout) var(--ease-layout);
    animation: workbench-shell-merge-in var(--motion-fast) var(--ease-layout);
}

.workbench-shell__merge-label {
    color: var(--text-main);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
}

@keyframes workbench-shell-merge-in {
    from {
        opacity: 0;
    }
}

.workbench-shell-host {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    outline: none;
}

/* 外壳根是卡片之间露出的窗体底：主题给 --shell-ground；平铺的主题不给，与部件同一块面板底色。 */
.workbench-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--shell-ground, var(--panel-surface));
    color: var(--text-main);
    font-family: var(--font-ui);
}

.workbench-shell__titlebar-slot {
    flex: none;
    min-width: 0;
    overflow: hidden;
}

.workbench-shell__surface {
    flex: 1 1 auto;
    min-height: 0;
}

.workbench-shell__titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 100%;
    padding-inline: var(--space-3);
    font-size: var(--text-xs);
}

.workbench-shell__app {
    font-weight: 600;
}

.workbench-shell__project {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-shell__missing {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.workbench-shell__missing-close {
    color: var(--accent-text);
}

.workbench-shell__welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-4);
    text-align: center;
}

.workbench-shell__welcome h1 {
    margin: 0;
    font-size: var(--text-lg);
}

.workbench-shell__welcome p {
    margin: 0;
    max-width: 40rem;
    color: var(--text-secondary);
}
</style>
