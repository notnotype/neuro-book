<script setup lang="ts">
/**
 * 产品的工作台外壳（同名 .md）：布局文档的 store 接到表面，标题栏、活动栏、面板头、状态栏与视图内容，按钮接到命令，拖放接到 `layout-drag`。
 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason, ContextMenuItem} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {findTab, findTreeNode, tabKey, treeLeaves} from "@notnotype/nb-layout";
import type {GridExtent, LayoutDoc} from "@notnotype/nb-layout";
import {DropSectorsOverlay} from "@notnotype/nb-layout/vue";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {TextParams} from "@notnotype/nb-ui/text";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";
import TitleActions from "nbook/ui/menus/TitleActions.vue";
import {buttonBudget, NO_TITLE_ACTIONS} from "nbook/ui/menus/title-actions";
import type {TitleActionsModel} from "nbook/ui/menus/title-actions";

import {editorTabIdOf} from "../../shared/editor-panels";
import {SET_PANEL_COLLAPSED_COMMAND, TOGGLE_PANEL_MAXIMIZED_COMMAND} from "../commands/panel-commands";
import {MOVE_VIEW_COMMAND} from "../commands/view-commands";
import {workbenchText} from "../../shared/text";
import type {WorkbenchTextKey} from "../../shared/text";
import type {ViewLocation} from "../../shared/views";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {canResetView, moveTargetsOf, panelTitle, sidebarColumnPanels, toolEntryIntent, viewIdOf, viewKey} from "../state/layout-present";
import {createLayoutPolicy} from "../state/layout-constraints";
import type {PaneFocusMover} from "../commands/pane-focus-commands";
import {createLayoutDrag} from "../layout-drag";
import type {LayoutDrag, LayoutDragDrop, LayoutTabSource} from "../layout-drag";
import type {ViewSource} from "../views/registry";
import {useViewInstances} from "../views/view-instances";
import type {EditorAreaContext, EditorTabDrag} from "../contracts";
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
import type {ToolStripItem} from "./WorkbenchToolStrip.vue";
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

/** 每块编辑组一份：别的面板最大化时盖住它，对提供者就是不可见。 */
const editorContexts = new Map<string, EditorAreaContext>();
function editorContextOf(panelId: string): EditorAreaContext {
    let context = editorContexts.get(panelId);
    if (context === undefined) {
        context = {visible: computed(() => state.value.maximized === null || state.value.maximized === panelId)};
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
        return panel === null ? null : ((doc.value.panels[panel]?.name as ViewLocation | undefined) ?? null);
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
/** 横向分支里收起就是零宽，和隐藏重复，无名面板还找不回来：只有上下排的面板有收起按钮（输出 20）。 */
const collapsibleHere = (panelId: string): boolean => findTreeNode(renderedDoc.value.tree.root, panelId)?.parent?.orientation === "vertical";
function headReserved(panelId: string): number {
    const panel = renderedDoc.value.panels[panelId];
    const frames = 1 + (collapsibleHere(panelId) ? 1 : 0) + (panel?.name === undefined ? 0 : 1);
    const others = titleOnlyPanels.value.has(panelId) ? 0 : Math.max(0, (panel?.tabs.length ?? 1) - 1);
    return TAB_TRUNCATED_PX + TAB_ICON_PX * others + FRAME_BUTTON_PX * frames + HEAD_PADDING_PX;
}

/** 视图的标题动作（docs/specs/workbench/views.md 输出 10、11）；Lab 里没有命令服务（没有 chrome）时没有。 */
function viewActionsOf(viewId: string, panelId: string): TitleActionsModel {
    const width = state.value.presented[panelId]?.width ?? null;
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

/** 头只写标题的面板（输出 20）：切视图靠活动栏，所以活动栏隐藏时它们也画标签带。 */
const titleOnlyIn = (source: LayoutDoc): ReadonlySet<string> => new Set(source.hiddenBars.includes("activitybar") ? [] : sidebarColumnPanels(source));
const titleOnlyPanels = computed(() => titleOnlyIn(renderedDoc.value));
const headTabs = (panelId: string): PanelHeadTab[] => tabsIn(renderedDoc.value, panelId);

/** 框架按钮（输出 20）：可用性问命令系统；先读布局状态，让按钮随它重新求值（命令系统的可用性变化不通知）。 */
function frameActionsOf(panelId: string): PanelFrameAction[] {
    const panel = renderedDoc.value.panels[panelId];
    void [state.value.ready, state.value.maximized];
    const describe = (id: string, icon: string, title: WorkbenchTextKey, pressed?: boolean): PanelFrameAction => {
        const enabled = props.commands.isEnabled(id);
        return {id, icon, label: message(title), disabled: !(enabled.ok && enabled.value), ...(enabled.ok ? {} : {reason: resolver.t(enabled.reason)}), ...(pressed === undefined ? {} : {pressed})};
    };
    return [
        ...(collapsibleHere(panelId) ? [describe(SET_PANEL_COLLAPSED_COMMAND, "i-lucide-chevrons-down", "commands.nbook.view.set-panel-collapsed.title", panel?.collapsed === true)] : []),
        describe(TOGGLE_PANEL_MAXIMIZED_COMMAND, "i-lucide-maximize-2", "commands.nbook.view.toggle-panel-maximized.title", state.value.maximized === panelId),
        // 无名面板没有隐藏按钮。
        ...(panel?.name === undefined ? [] : [describe(SET_PART_HIDDEN_COMMAND, "i-lucide-x", "shell.frame.hide")]),
    ];
}

function runFrameAction(panelId: string, action: string): void {
    if (action !== SET_PART_HIDDEN_COMMAND) {
        run(action, {panelId});
        return;
    }
    // 按钮随面板一起没了：焦点按内容停放的规则走，键盘用户不掉到 body。
    const active = doc.value.panels[panelId]?.active ?? null;
    run(action, {part: doc.value.panels[panelId]?.name, hidden: true});
    if (active !== null) onContentParked(active);
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

/** 键盘关掉或选完之后，焦点回到打开它的标签（选完时标签可能已经在别的面板）；点到外面时焦点归点到的地方。 */
function closeMoveMenu(reason: ContextMenuCloseReason): void {
    const opened = moveMenu.value;
    moveMenu.value = null;
    if (opened === null || reason === "outside") return;
    void nextTick(() => {
        const root = hostEl.value;
        (root?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(viewKey(opened.viewId))}"]`) ?? root?.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(opened.viewId)}"]`))?.focus({preventScroll: true});
    });
}

const moveMenuItems = computed((): ContextMenuItem[] => {
    const opened = moveMenu.value;
    if (opened === null) return [];
    const targets = moveTargetsOf(doc.value, opened.viewId) ?? [];
    const into = targets.flatMap((target): ContextMenuItem[] => (target.kind !== "panel" ? [] : [{label: text(panelTitle(doc.value, catalog.value, target.panel)), action: () => run(MOVE_VIEW_COMMAND, {viewId: opened.viewId, target: target.panel})}]));
    const beside = targets.flatMap((target): ContextMenuItem[] => (target.kind !== "new-panel" ? [] : [{label: message("viewCommands.newPanelNextTo", {panel: text(panelTitle(doc.value, catalog.value, target.nextTo))}), action: () => run(MOVE_VIEW_COMMAND, {viewId: opened.viewId, newPanelNextTo: target.nextTo})}]));
    const reset: ContextMenuItem[] = canResetView(doc.value, catalog.value, opened.viewId) ? [{label: message("views.resetLocation"), action: () => props.layout.actions.resetView(opened.viewId)}] : [];
    const sections = [into, beside, reset].filter((section) => section.length > 0);
    return sections.flatMap((section, index) => (index === 0 ? section : [{separator: true}, ...section]));
});

// ── 活动栏 ────────────────────────────────────────────────────────────────

/** 侧栏这一列的视图，按文档的顺序（输出 22）。标题与图标同面板头的标签：声明消失的视图也有条目，点了能看到占位。 */
const toolEntries = computed(() => sidebarColumnPanels(doc.value).flatMap((panelId) => tabsIn(doc.value, panelId)).flatMap((tab) => {
    const id = viewIdOf(tab.id);
    return id === null ? [] : [{id, label: tab.label, icon: tab.icon, pressed: visibleViews.value.has(id)}];
}));

const stripItems = computed<ToolStripItem[]>(() => (props.chrome?.activityEntries(resolver) ?? []).map((item) => ({id: item.id, title: item.title, icon: item.icon, interactive: item.command !== null, pressed: item.pressed, disabledReason: item.disabledReason})));

const hostEl = ref<HTMLElement | null>(null);

/** 焦点给视图：里面第一个能聚焦的；还没加载出来时给它的标签（输出 22）。 */
function focusView(viewId: string): void {
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const content = root.querySelector(`[data-content="${CSS.escape(viewKey(viewId))}"]`);
        const inner = content?.querySelector<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
        const tab = root.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(viewKey(viewId))}"]`);
        (inner ?? tab)?.focus({preventScroll: true});
    });
}

function selectEntry(viewId: string): void {
    const intent = toolEntryIntent(doc.value, viewId, {visible: state.value.visibleTabs as ReadonlySet<string>});
    switch (intent.kind) {
        case "reveal":
            props.layout.actions.revealView(viewId);
            focusView(viewId);
            return;
        case "hide":
            run(SET_PART_HIDDEN_COMMAND, {part: doc.value.panels[intent.panel]?.name, hidden: true});
            return;
        case "collapse":
            props.layout.actions.setCollapsed(intent.panel, true);
            return;
        case "none":
            return;
    }
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

/**
 * 焦点所在的内容或面板头不可见了（输出 16）：同一面板看得见的标签，面板看不见时活动栏里这个视图的条目，都没有时外壳根；编辑器的内容没有所属的活动栏条目，去活动编辑组的活动标签。焦点已经去了别处（菜单、对话框、别的面板）时不抢。
 * 判断焦点丢了要等渲染之后：面板头被移走时焦点回到 body，内容停放时焦点还在 `inert` 的元素上。
 */
function onContentParked(key: string): void {
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const active = root.ownerDocument.activeElement;
        if (active !== null && active !== root.ownerDocument.body && active.closest("[inert]") === null) return;
        const viewId = viewIdOf(key);
        const panel = viewId === null ? null : panelOfView(viewId);
        const head = viewId === null ? "[data-editor-group-head-active]" : panel === null ? null : `[data-panel-head="${CSS.escape(panel)}"]`;
        const tab = head === null ? null : root.querySelector<HTMLElement>(`${head} [data-panel-tab][tabindex="0"]`);
        const entry = viewId === null ? null : root.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(viewId)}"]`);
        (tab !== null && tab.offsetParent !== null && tab.closest("[inert]") === null ? tab : (entry ?? root)).focus({preventScroll: true});
    });
}

let detachPaneFocus: (() => void) | undefined;
onMounted(() => {
    detachPaneFocus = props.attachPaneFocus?.((direction) => {
        surface.value?.moveFocus(direction);
    });
});
onBeforeUnmount(() => detachPaneFocus?.());

// ── 拖放 ──────────────────────────────────────────────────────────────────

/** 预备区的图标：与标题栏的布局按钮同一套。 */
const REVEAL_ICONS: Readonly<Record<string, string>> = {sidebar: "i-lucide-panel-left", auxiliarybar: "i-lucide-panel-right", panel: "i-lucide-panel-bottom"};
const POLICY = createLayoutPolicy();

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
        titleOnly: (panel) => titleOnlyIn(doc.value).has(panel),
        sectors: () => props.dropSectors !== false,
        feel: () => props.dragFeel ?? "live",
        settleMotion: () => surface.value?.settleMotion(),
        showPreview: (next) => props.layout.actions.setLivePreview(next),
        commit: (source, action, part, keyboard) => {
            // 编辑器标签走编辑器区的动作：要先结算视图的输入、合并同一标签（`EditorTabDrag`）。
            const editorTab = editorTabIdOf(source.tab);
            if (editorTab !== null) editorTabs.value?.drop(editorTab, action, part, keyboard);
            else props.layout.actions.drop(source, action);
        },
    });
});
onBeforeUnmount(() => drag.value?.dispose());

const dragState = computed(() => drag.value?.session.state.value ?? null);

function ghostOf(source: LayoutTabSource): {readonly label: string; readonly icon?: string; readonly fileIcon?: CatppuccinIcon | null} | null {
    const editorTab = editorTabIdOf(source.tab);
    if (editorTab !== null) return editorTabs.value?.ghost(editorTab) ?? null;
    const viewId = viewIdOf(source.tab);
    const declaration = viewId === null ? undefined : catalog.value.get(viewId);
    return declaration === undefined ? null : {label: text(declaration.title), icon: declaration.icon};
}

/** 实时布局下还在标签条里的来源：只有标签跟手（拖影），它留着位置。 */
const stripDragging = computed(() => {
    const current = dragState.value;
    return current !== null && drag.value?.live.active.value === true && drag.value.live.card.value === null ? current.source.tab : null;
});

/** 跟手的卡片：内容项拿起来了，拖影就不画了。 */
const liftedCard = computed(() => {
    const card = drag.value?.live.card.value ?? null;
    return card === null ? null : {...card, home: findTab(doc.value, card.key)?.panel ?? null};
});
const cardTitle = computed(() => {
    const current = dragState.value;
    return current === null ? null : ghostOf(current.source);
});
/** 实时布局的分区：相对网格根，画在卡片后面。 */
const liveSectors = computed(() => {
    const sectors = dragState.value?.drop?.sectors ?? null;
    const live = drag.value?.live;
    if (sectors === null || live === undefined) return null;
    const origin = hostEl.value?.querySelector("[data-workbench-surface] > [data-grid-scope]")?.getBoundingClientRect();
    if (origin === undefined) return null;
    const {rect} = sectors;
    return {...sectors, rect: {left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top}};
});
const slotStyle = computed(() => {
    const slot = drag.value?.live.slot.value ?? null;
    return slot === null ? {} : {transform: `translate(${String(slot.x)}px, ${String(slot.y)}px)`, width: `${String(slot.width)}px`, height: `${String(slot.height)}px`};
});

const dragGhost = computed(() => {
    const current = dragState.value;
    if (current === null || drag.value?.live.card.value != null) return null;
    const ghost = ghostOf(current.source);
    return ghost === null ? null : {...ghost, x: current.point.x, y: current.point.y};
});

const revealZones = computed(() => {
    const current = dragState.value;
    if (current === null) return [];
    const active = current.drop?.action.kind === "reveal" ? current.drop.action.panel : null;
    // 实时布局已经把这块面板摆出来了：预备区让开。
    const shown = drag.value?.live.shownAction.value;
    const revealed = shown?.kind === "reveal" ? shown.panel : null;
    return (drag.value?.zones() ?? []).filter((zone) => zone.panel !== revealed).map((zone) => ({part: zone.panel, rect: zone.rect, label: text(panelTitle(doc.value, catalog.value, zone.panel)), icon: REVEAL_ICONS[zone.panel] ?? "i-lucide-panel-top", active: zone.panel === active}));
});

function dropLabel(drop: LayoutDragDrop): string {
    if (drop.inPlace) return message("shell.drop.inPlace");
    const {action} = drop;
    if (action.kind === "reveal") return message("shell.drop.reveal", {part: text(panelTitle(doc.value, catalog.value, action.panel))});
    if (action.kind === "strip") return message("shell.drop.insert");
    if (action.kind === "center") return message("shell.drop.addTab");
    return message(action.target.kind === "between" ? "shell.drop.between" : "shell.drop.split");
}

const dropFeedback = computed(() => {
    const drop = dragState.value?.drop ?? null;
    if (drop === null) return {preview: null, label: "", liveLabel: "", kind: ""};
    if (drag.value?.live.active.value === true) {
        // 实时布局的反馈就是布局本身；活动栏的落点不预览，照旧一条插入线。字写在卡片头，读屏靠常驻的状态节点。
        const preview = drop.noPreview === true ? {areaRect: null, entryRect: null, indicator: drop.preview.indicator, orientation: drop.preview.orientation} : null;
        return {preview, label: "", liveLabel: dropLabel(drop), kind: drop.inPlace ? "noop" : drop.action.kind};
    }
    return {liveLabel: "", preview: {areaRect: drop.preview.areaRect, entryRect: null, indicator: drop.preview.indicator, orientation: drop.preview.orientation}, label: dropLabel(drop), kind: drop.inPlace ? "noop" : drop.action.kind};
});

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
                :data-drag-feel="drag?.live.active.value === true ? 'live' : 'indicator'"
                :data-live-preview="drag?.live.previewKey.value ?? 'none'"
                :maximized="state.maximized"
                :disabled="!state.ready"
                :title-only-panels="titleOnlyPanels"
                context-key="workbench"
                @extent="onExtent"
                @card-gap="(gap) => layout.actions.acceptCardGap(gap)"
                @presented="(sizes) => layout.actions.acceptPresented(sizes)"
                @preview="(sizes) => layout.actions.acceptPreview(sizes)"
                @gesture-commit="(sizes, collapsed) => layout.actions.commitGesture(sizes, collapsed)"
                @focus-panel="(panel) => layout.actions.focusPanel(panel)"
                @content-parked="onContentParked"
            >
                <template #activitybar>
                    <WorkbenchToolStrip
                        :label="message('shell.activityBar')"
                        :more-label="message('common.more')"
                        :entries="toolEntries"
                        :items="stripItems"
                        :drag-hint="message('shell.drag.hint')"
                        @select="selectEntry"
                        @run-item="(id) => chrome?.runItem(id)"
                        @context-menu="(id, at) => openMoveMenu(viewKey(id), at)"
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
                        <component :is="editorArea.head" v-if="editorArea !== null" :key="editorArea.id" :panel-id="panelId" :dragging-tab="stripDragging" />
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
                        :dragging-tab="stripDragging"
                        :title-only="titleOnlyPanels.has(panelId)"
                        :frame-actions="frameActionsOf(panelId)"
                        @activate="(key) => layout.actions.activate(key)"
                        @reorder="(key, delta) => layout.actions.reorderTab(key, delta)"
                        @action="(action) => runFrameAction(panelId, action)"
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
                        <span class="workbench-shell__card-hint" data-drag-card-hint aria-hidden="true">{{ dropFeedback.liveLabel }}</span>
                    </div>
                </template>
                <template v-if="drag?.live.active.value === true" #overlay>
                    <DropSectorsOverlay v-if="liveSectors !== null" inline variant="live" :rect="liveSectors.rect" :sectors="liveSectors.items" :active="liveSectors.active" />
                    <div v-if="drag.live.slot.value !== null" class="workbench-shell__slot" data-live-slot :style="slotStyle"></div>
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
        <component :is="editorArea.host" v-if="editorArea !== null" :key="editorArea.id" :attach-tab-drag="(next: EditorTabDrag | null) => (editorTabs = next)" />
        <ContextMenu :open="moveMenu !== null" :x="moveMenu?.x ?? 0" :y="moveMenu?.y ?? 0" :items="moveMenuItems" @request-close="closeMoveMenu" />
        <WorkbenchDragFeedback :ghost="dragGhost" :zones="revealZones" :preview="dropFeedback.preview" :label="dropFeedback.label" :kind="dropFeedback.kind" :sectors="drag?.live.active.value === true ? null : dragState?.drop?.sectors ?? null" :sector-labels="sectorLabels" :live-status="dropFeedback.liveLabel" />
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

/* 空位：一块空面板加一圈边框，不铺遮罩（提案第 3 节）。过渡和外框同一条曲线，跟着布局走。 */
.workbench-shell__slot {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border: 1px solid var(--layout-slot-border);
    border-radius: var(--layout-card-radius);
    pointer-events: none;
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
