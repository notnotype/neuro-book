<script setup lang="ts">
/**
 * 产品的工作台外壳（同名 .md）：布局文档的 store 接到表面，标题栏、活动栏、面板头、状态栏与视图内容，按钮接到命令，拖放接到 `layout-drag`。
 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason, ContextMenuItem} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {findTab, findTreeNode, isFloating, isPanelShown, isSectionCollapsed, regionOf, regionStripLeafId, sectionCollapseBlock, tabKey, treeLeaves} from "@notnotype/nb-workbench-layout";
import type {GridExtent, GridSwap} from "@notnotype/nb-layout";
import type {LayoutDoc, PanelName} from "@notnotype/nb-workbench-layout";
import {FloatWindowHandles, useDropTarget} from "@notnotype/nb-layout/vue";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {TextParams} from "@notnotype/nb-ui/text";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, shallowRef, useTemplateRef, watch, watchEffect} from "vue";

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
import {MOVE_VIEW_COMMAND, moveTargetItem, moveTargetsFor} from "../commands/view-commands";
import {workbenchText} from "../../shared/text";
import type {WorkbenchTextKey} from "../../shared/text";
import {OPEN_VIEW_COMMAND} from "../../shared/views";
import {NOTIFICATIONS_VIEW} from "../notifications";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {canResetContainer, containerHomeRegion, containerMoveTargets, containerRegion, regionContainers, viewSection} from "../state/containers";
import {entriesOnRail, focusLandings, isSoleWindow, mergedSections, panelTitle, regionEntries, regionEntryIntent, regionVisible, titleOnlyPanels, viewIdOf, viewKey} from "../state/layout-present";
import type {ContainerEntry, FocusLanding} from "../state/layout-present";
import {createLayoutPolicy, panelConstraints} from "../state/layout-constraints";
import type {DropSplit} from "../state/layout-constraints";
import type {PaneFocusMover} from "../commands/pane-focus-commands";
import {presentDrag} from "../drag-presentation";
import {createLayoutDrag, windowDragRegion} from "../layout-drag";
import type {LayoutDrag, LayoutDragDrop, LiveCardRefresh} from "../layout-drag";
import {dropKeyOf} from "../entry-drop";
import type {WorkbenchDragSource} from "../entry-drop";
import type {ViewSource} from "../views/registry";
import {useViewInstances} from "../views/view-instances";
import type {EditorAreaContext, EditorTabDrag, PanelFrameControl} from "../contracts";
import type {PanelHeadSlots} from "../views/view-head";
import {mountEditorArea} from "../editor-area";
import type {EditorAreaSource} from "../editor-area";
import {SHELL_TITLEBAR_HEIGHT} from "../shell/sizes";
import WorkbenchDragFeedback from "./WorkbenchDragFeedback.vue";
import WorkbenchPanelHead from "./WorkbenchPanelHead.vue";
import type {PanelFrameAction, PanelHeadTab, PanelViewHead} from "./WorkbenchPanelHead.vue";
import WorkbenchRegionStrip from "./WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "./WorkbenchRegionStrip.vue";
import WorkbenchStatusBar from "./WorkbenchStatusBar.vue";
import WorkbenchSurface from "./WorkbenchSurface.vue";
import WorkbenchTitleBar from "./WorkbenchTitleBar.vue";
import WorkbenchToolStrip from "./WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "./WorkbenchToolStrip.vue";
import WorkbenchViewFrame from "./WorkbenchViewFrame.vue";
import type {ShellChrome, ViewInstanceRef} from "../titlebar/titlebar-source";
import {SET_PART_HIDDEN_COMMAND} from "../commands/part-commands";
import {OPEN_COMMANDS_ID} from "../commands/open-commands";
import type {WorkbenchGridIssue} from "../grid-diagnostics";

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
    /** 通知中心里没看过的条数（状态栏铃铛的点）；没有通知服务时不给。 */
    unreadNotifications?: number;
    /** 拖动时画不画落点分区（设置 `nbook.workbench/dropSectors`）；缺省画。 */
    dropSectors?: boolean;
    /** 拖动的手感（设置 `nbook.workbench/dragFeel`）；缺省实时布局。 */
    dragFeel?: "live" | "indicator";
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）；缺省离开标签条就缩。 */
    dragCardShrink?: "strip" | "panel";
    /** 卡片的尺寸多久写一次（设置 `nbook.workbench/dragCardRefresh`）；缺省跟随屏幕每帧写。 */
    dragCardRefresh?: LiveCardRefresh;
    /** 拖到四周时怎么分（设置 `nbook.workbench/dropSplit`）；缺省只分本窗口。 */
    dropSplit?: DropSplit;
    /**
     * 网格的诊断与被拒的提交（`grid-diagnostics.ts`）。必填：外壳只有插件入口一个挂载点，漏接时网格的诊断全部静默丢掉。
     * 入口交出的属性不经类型检查核对，漏传只有开发构建里 Vue 的警告，由 workbench-shell 的 e2e 守着。
     */
    reportGridIssues: (issues: readonly WorkbenchGridIssue[]) => void;
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
const titleOnlyPanelIds = computed(() => titleOnlyPanels(doc.value));
/**
 * 此刻画出来的投影里并进入口条的分节（输出 47）：它是区域唯一的分节，按已提交的文档也收不成标题行；实时布局拖动的预览里并进来的那一节
 * 在已提交的文档里可能还有兄弟，所以展开标记另外按这个排除，头上的几处（标记、点标题、留宽、可访问描述）都经 `foldOf`。
 */
const mergedNow = computed(() => mergedSections(props.layout.actions.renderedPresentation()));
/** 并进入口条的那一节在哪个区域。 */
const mergedRegionOf = (panelId: string): PanelName | null => props.layout.actions.renderedPresentation().strips.find((strip) => strip.merged === panelId)?.region ?? null;
/**
 * 横向分支里收起就是零宽，和隐藏重复，无名面板还找不回来：只有上下排的面板有收起按钮（输出 20）。
 * 带容器的区域里再问库：底部面板的分节、区域此刻唯一显示的分节收不成标题行（输出 11），也没有按钮。和 `setPanelCollapsed` 拒绝的是同一个判定。
 */
const collapsibleIn = (source: LayoutDoc, panelId: string): boolean => findTreeNode(source.tree.root, panelId)?.parent?.orientation === "vertical" && sectionCollapseBlock(source, panelId) === null;
/**
 * 面板头的展开标记（输出 20）：只写标题的头（标记画在标题按钮里）、能收成标题行、没有被最大化（最大化着点标题只激活，还原靠还原按钮）。
 * 按已提交的文档算，和 `titleOnlyPanels` 一样：拖动中预览里这一列只剩一节时标记不跟着消失，标题不横跳。
 * 每块头的模板与点击都要问好几次，`collapsibleIn` 要在树里找节点，所以一份文档只算一次。
 */
const folds = computed<ReadonlyMap<string, {readonly collapsed: boolean}>>(() => new Map([...titleOnlyPanelIds.value].flatMap((panelId) => (
    collapsibleIn(doc.value, panelId) && state.value.maximized !== panelId && !mergedNow.value.has(panelId) ? [[panelId, {collapsed: isSectionCollapsed(doc.value, panelId)}] as const] : []
))));
const foldOf = (panelId: string): {readonly collapsed: boolean} | null => folds.value.get(panelId) ?? null;
/** 展开标记占的宽度：标题按钮里标记前的 9px、标记 14px、标记与标题之间 5px（WorkbenchPanelHead 的样式）；接管标题区时单独的按钮是 24px 加间距，比这个窄。 */
const FOLD_MARK_PX = 28;
/** 头自己要留的宽：截断的标题、别的标签的图标、框架按钮、内边距与展开标记；入口条交给它的 `head-min-width` 就是这个数。 */
function headOwnReserve(panelId: string): number {
    const panel = renderedDoc.value.panels[panelId];
    // 浮动窗只有“回到停靠”；树里是浮动、最大化（收起不是按钮了，是标题前的标记）。
    const frames = isFloating(renderedDoc.value, panelId) ? 1 : 2;
    const others = titleOnlyPanelIds.value.has(panelId) ? 0 : Math.max(0, (panel?.tabs.length ?? 1) - 1);
    // 底部面板并成一行时头不写标题（标题在入口上，输出 47），不给截断的标题留宽。
    const title = mergedRegionOf(panelId) === "panel" ? 0 : TAB_TRUNCATED_PX;
    return title + TAB_ICON_PX * others + FRAME_BUTTON_PX * frames + HEAD_PADDING_PX + (foldOf(panelId) === null ? 0 : FOLD_MARK_PX);
}

/** 视图动作的预算要扣掉的宽（`buttonBudget`）：头自己留的，并进入口条时再加上入口占的。 */
function headReserved(panelId: string): number {
    const region = mergedRegionOf(panelId);
    return headOwnReserve(panelId) + (region === null ? 0 : stripEntriesReserve(region));
}

/**
 * 并进入口条时入口占的宽：每个入口一份，加“更多”。右栏是 24px 的图标；底部面板的标题入口宽度各不相同，按一个短标题估。
 * 按全部入口算，宁可多扣：少扣时视图动作按钮多画出来、被入口条裁掉，多扣时只是早一点收进“⋯”。
 */
const STRIP_ICON_ENTRY_PX = 26;
const STRIP_TITLE_ENTRY_PX = 72;
function stripEntriesReserve(region: PanelName): number {
    const count = regionEntries(renderedDoc.value, region, catalog.value, state.value.containers).length;
    return count * (region === "panel" ? STRIP_TITLE_ENTRY_PX : STRIP_ICON_ENTRY_PX) + STRIP_ICON_ENTRY_PX;
}

/**
 * 入口条叶最近一次不为零的布局宽：区域隐藏、拖到零的那段过渡里它的宽是 0，接管标题区与否照显示着的时候判，头不在收起过程中换画法。
 * 只是缓存，不是响应式状态：读它的地方同时读了 `presented`，宽一变照样重算。
 */
const stripWidths = new Map<PanelName, number>();
function stripWidthOf(region: PanelName): number | null {
    const width = state.value.presented[regionStripLeafId(region)]?.width ?? null;
    if (width !== null && width > 0) {
        stripWidths.set(region, width);
        return width;
    }
    return stripWidths.get(region) ?? width;
}

/** 视图的标题动作（docs/specs/workbench/views.md 输出 10、11）；Lab 里没有命令服务（没有 chrome）时没有。 */
function viewActionsOf(viewId: string, panelId: string): TitleActionsModel {
    // 和头接管标题区按同一个宽（`headWidthOf`）：区域收起的那段过渡里两边都按显示着的时候算，动作不先收进“⋯”。
    const width = headWidthOf(panelId);
    return props.chrome?.viewActions(viewId, catalog.value.get(viewId)?.actions ?? [], resolver, instanceOf(viewId), buttonBudget(width, headReserved(panelId), Number.POSITIVE_INFINITY)) ?? NO_TITLE_ACTIONS;
}

/**
 * 视图所在面板与容器、交付状态与实例代际任一变化，已打开的菜单就关闭（输出 23）。容器要单独记：只有一个标签的分节换容器时是同一块面板移动，面板 id 不变（输出 27）。
 */
const viewIdentity = (viewId: string): string => `${viewId}|${panelOfView(viewId) ?? ""}|${viewSection(doc.value, viewId)?.container ?? ""}|${props.views.delivery(viewId).kind}|${String(instances.generations.value.get(viewId) ?? 0)}`;

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

/** 面板头的标签在标题后接视图的计数（views 输出 17）；活动栏的入口不接，所以只在这里加。 */
const headTabs = (panelId: string): PanelHeadTab[] => tabsIn(renderedDoc.value, panelId).map((tab) => {
    const viewId = viewIdOf(tab.id);
    const count = viewId === null ? null : props.views.badge?.(viewId) ?? null;
    return count === null ? tab : {...tab, label: `${tab.label} ${String(count)}`};
});

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

// ── 视图的标题区（docs/specs/workbench/views.md 输出 19） ─────────────────────

/**
 * 只写标题、活动视图申请了标题区、已就绪且此刻要接管（`claim`）的面板：活动视图与它这一代的标题区。点标题、分发位置、面板头的画法都经这里，
 * 视图交还标题区时三处一起回到普通画法。
 */
function headOfPanel(panelId: string) {
    // 自绘头时没有面板头，也就没有标题区可接管（输出 19 的“自绘头”与接管标题区互斥），视图写的 `claim` 不起作用。
    if (!titleOnlyPanelIds.value.has(panelId) || ownHeadBands.value.has(panelId)) return null;
    const viewId = viewIdOf(renderedDoc.value.panels[panelId]?.active ?? "");
    const control = viewId === null ? null : instances.headOf(viewId);
    return viewId === null || control === null || !control.head.claim.value ? null : {viewId, control};
}

/**
 * 视图接管标题区的最小宽度（views.md 输出 19）：头里留给视图的那一段（头的宽减去框架按钮；并进入口条时再减去入口）窄于它时不接管，头回到普通画法、视图在自己的内容里画头。
 * 只看布局给的宽度，不看视图送进来的内容，所以不会自己来回翻。按对话视图两侧列的实际宽度定；有第二个接管标题区的视图时改成视图声明。
 */
const VIEW_HEAD_MIN_PX = 220;
/**
 * 面板最近一次不为零的布局宽：区域隐藏、拖到零的那段过渡里它的宽是 0，接管与否照显示着的时候判，头不在收起过程中换画法（同 `stripWidthOf`）。
 * 浮动窗不在呈现尺寸里，按记录的矩形：不读画出来的那份，缩放时它每帧变，所有面板头都要跟着重算。只是缓存，读它的地方同时读了 `presented`；
 * 文档里没有了的面板（编辑组每次拆分都是新 id）跟着删掉。
 */
const panelWidths = new Map<string, number>();
watch(() => doc.value.panels, (panels) => {
    for (const id of panelWidths.keys()) if (panels[id] === undefined) panelWidths.delete(id);
});
function headWidthOf(panelId: string): number | null {
    const float = doc.value.floats.find((candidate) => candidate.panel === panelId);
    if (float !== undefined) return float.rect.width;
    const width = state.value.presented[panelId]?.width ?? null;
    if (width !== null && width > 0) {
        panelWidths.set(panelId, width);
        return width;
    }
    return panelWidths.get(panelId) ?? width;
}
function panelViewHead(panelId: string): PanelViewHead | null {
    const found = headOfPanel(panelId);
    if (found === null) return null;
    const region = mergedRegionOf(panelId);
    const room = region === null ? headWidthOf(panelId) : stripWidthOf(region) === null ? null : (stripWidthOf(region) as number) - stripEntriesReserve(region);
    if (room !== null && room - FRAME_BUTTON_PX * 2 - HEAD_PADDING_PX < VIEW_HEAD_MIN_PX) return null;
    return {key: `${found.viewId}:${String(instances.generations.value.get(found.viewId) ?? 0)}`, popup: found.control.head.titlePopup.value};
}

// ── 视图自绘头（docs/specs/workbench/views.md 输出 19 的“自绘头”） ─────────────

/**
 * 视图自绘头的面板 → 视图声明的那一条有多高。按已提交的文档算（同只写标题，拖动中标签数变了不跟着变）：在浮动窗里、只写标题、
 * 活动视图声明了自绘头且这一代实例已就绪。加载中、渲染出错、交付撤回时照常画面板头（t18 决定 4），换的时候直接换。
 */
const ownHeadBands = computed<ReadonlyMap<string, number>>(() => new Map(doc.value.floats.flatMap(({panel}) => {
    if (!titleOnlyPanelIds.value.has(panel)) return [];
    const viewId = viewIdOf(doc.value.panels[panel]?.active ?? "");
    const own = viewId === null ? null : instances.ownHeadOf(viewId);
    return own === null ? [] : [[panel, own.band] as const];
})));
/** 盖在自绘头右端的按钮一组让出的宽度，面板头量了交来，按面板记。 */
const ownHeadInsets = shallowReactive(new Map<string, number>());
/** 交给表面：哪些面板自绘头、内容上写多宽的让位。 */
const ownHeads = computed<ReadonlyMap<string, number>>(() => new Map([...ownHeadBands.value.keys()].map((panel) => [panel, ownHeadInsets.get(panel) ?? 0])));

/**
 * 自绘头的可拖元素上右键（输出 19 的“自绘头”）：按在拖动区的空白处（中间没有可交互的元素，按下的元素自己不直接写字、不是图片）、视图没有处理的，
 * 开这个视图的“移动到”；文字与图片上留给浏览器（复制、存图），按钮上留给视图。监听在外壳根上，冒泡到这里时视图自己的处理已经跑过。
 */
function onOwnHeadContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (event.defaultPrevented || !(target instanceof HTMLElement) || windowDragRegion(target) === null) return;
    if (target.matches("img, svg, svg *") || [...target.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "")) return;
    const panel = target.closest("[data-content-leaf][data-float]")?.getAttribute("data-content-leaf") ?? null;
    const active = panel === null || !ownHeadBands.value.has(panel) ? null : doc.value.panels[panel]?.active ?? null;
    if (active === null) return;
    event.preventDefault();
    openMoveMenu(active, {x: event.clientX, y: event.clientY});
}

/** 面板头交来的位置，按面板记。 */
const panelHeadSlots = shallowReactive(new Map<string, PanelHeadSlots>());

function setPanelHeadSlots(panelId: string, slots: PanelHeadSlots | null): void {
    if (slots === null) panelHeadSlots.delete(panelId);
    else panelHeadSlots.set(panelId, slots);
}

/**
 * 把位置交给视图：每个有标题区的实例，按它此刻所在的面板取那块面板头交来的位置，不在只写标题的面板里就是 null。
 * 按面板汇总再分发，而不是面板头直接写给视图：视图换面板时旧面板头拆掉（交 null）与新面板头画出的先后不定，按面板记就与先后无关。
 */
watchEffect(() => {
    for (const viewId of instances.instances.keys()) {
        const control = instances.headOf(viewId);
        if (control === null) continue;
        const panelId = panelOfView(viewId);
        const owns = panelId !== null && headOfPanel(panelId)?.control === control;
        control.setSlots(owns ? panelHeadSlots.get(panelId) ?? null : null);
        control.setOwnHead(panelId !== null && ownHeadBands.value.has(panelId) && viewIdOf(doc.value.panels[panelId]?.active ?? "") === viewId);
    }
});

/**
 * 点标题（输出 20）：能收成标题行的分节，标题行是开关——展开着点它收起，收着点它展开（`activate` 会把它展开）；视图接管标题区时标题按钮是视图的，
 * 展开着点它照旧通知视图（它开自己的列表），收起走单独的标记（`toggleFold`）。别的面板照旧只激活。只在这里决定，头只发一个事件：两个事件有先后，
 * 先激活（它会展开）再切换就又收回去了。收没收要在 `activate` 之前记下。
 */
function activateTab(panelId: string, key: string): void {
    const control = headOfPanel(panelId)?.control ?? null;
    const fold = foldOf(panelId);
    if (fold !== null && !fold.collapsed && control === null && key === doc.value.panels[panelId]?.active) {
        run(SET_PANEL_COLLAPSED_COMMAND, {panelId, collapsed: true});
        return;
    }
    const collapsed = isSectionCollapsed(renderedDoc.value, panelId);
    props.layout.actions.activate(key);
    if (control !== null && !collapsed) control.press();
}

/** 视图接管标题区时单独的展开标记：在展开、收起之间切。 */
function toggleFold(panelId: string): void {
    const fold = foldOf(panelId);
    if (fold !== null) run(SET_PANEL_COLLAPSED_COMMAND, {panelId, collapsed: !fold.collapsed});
}

/**
 * 工具面板的头：画在分节自己的叶里，或并成一行时画在区域的入口条里（输出 47），两处同一组属性与事件。
 */
function toolHeadProps(panelId: string, idPrefix: string): InstanceType<typeof WorkbenchPanelHead>["$props"] {
    const fold = foldOf(panelId);
    const title = text(panelTitle(renderedDoc.value, catalog.value, panelId));
    const viewHead = panelViewHead(panelId);
    return {
        panelId,
        label: title,
        tabs: headTabs(panelId),
        active: renderedDoc.value.panels[panelId]?.active ?? null,
        moreLabel: message("common.more"),
        idPrefix,
        // 接管标题区时 Enter 是视图的（对话开会话列表），可访问描述不写“展开或收起”。
        dragHint: message(fold === null || viewHead !== null ? "shell.drag.hint" : "shell.drag.hintFold"),
        draggingTab: dragPlaceholder.value,
        titleOnly: titleOnlyPanelIds.value.has(panelId),
        frameActions: frameActionsOf(panelId),
        viewHead,
        fold,
        foldLabel: fold === null ? "" : message(fold.collapsed ? "shell.fold.expand" : "shell.fold.collapse", {title}),
    };
}
function toolHeadEvents(panelId: string): Record<string, (...args: never[]) => void> {
    return {
        activate: (key: string) => activateTab(panelId, key),
        "toggle-fold": () => toggleFold(panelId),
        "head-slots": (slots: PanelHeadSlots | null) => setPanelHeadSlots(panelId, slots),
        reorder: (key: string, delta: -1 | 1) => props.layout.actions.reorderTab(key, delta),
        action: (action: string) => run(action, {panelId}),
        "context-menu": (key: string, at: {readonly x: number; readonly y: number}) => openMoveMenu(key, at),
    };
}

// ── “移动到” ──────────────────────────────────────────────────────────────

/** `container`：从底部面板并成一行的入口打开时是那个容器，菜单末尾接上它的“移到”（`openStripMenu`）；从标题打开时是 null。 */
const moveMenu = shallowRef<{readonly viewId: string; readonly x: number; readonly y: number; readonly identity: string; readonly container: string | null} | null>(null);

const canMoveView = (key: string): boolean => {
    const viewId = viewIdOf(key);
    return viewId !== null && catalog.value.get(viewId)?.movable !== false;
};

function openMoveMenu(key: string, at: {readonly x: number; readonly y: number}, container: string | null = null): void {
    const viewId = viewIdOf(key);
    if (viewId === null || !canMoveView(key)) return;
    moveMenu.value = {viewId, ...at, identity: viewIdentity(viewId), container};
}

watch(() => (moveMenu.value === null ? null : viewIdentity(moveMenu.value.viewId)), (identity) => {
    if (moveMenu.value !== null && identity !== moveMenu.value.identity) moveMenu.value = null;
});

/** 视图的“移动到”里选的是容器的“移到”时记下那个容器：菜单先跑选中项的动作、再请求关闭，关闭时焦点按容器的规则走（`focusContainer`）。 */
let movedContainer: string | null = null;

/**
 * 键盘关掉或选完之后，焦点回到打开它的标签（选完时标签可能已经在别的面板）；标签不在界面上时回活动栏里它那个容器的入口。
 * 选的是容器的“移到”时去这个容器在新区域里的入口（输出 44）。点到外面时焦点归点到的地方。
 */
function closeMoveMenu(reason: ContextMenuCloseReason): void {
    const opened = moveMenu.value;
    const moved = movedContainer;
    moveMenu.value = null;
    movedContainer = null;
    if (opened === null || reason === "outside") return;
    if (moved !== null) {
        focusContainer(moved);
        return;
    }
    void nextTick(() => {
        const root = hostEl.value;
        (root?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(viewKey(opened.viewId))}"]`) ?? root?.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(viewSection(doc.value, opened.viewId)?.container ?? "")}"]`))?.focus({preventScroll: true});
    });
}

const moveMenuItems = computed((): ContextMenuItem[] => {
    const opened = moveMenu.value;
    if (opened === null) return [];
    // 和命令面板第二步同一份目标表与同一套名字（`moveTargetItem`），都经 `move-view` 执行。
    const targets = moveTargetsFor(props.layout, opened.viewId) ?? [];
    const itemsOf = (kind: (typeof targets)[number]["kind"]): ContextMenuItem[] => targets.filter((target) => target.kind === kind).map((target) => {
        const item = moveTargetItem(target);
        return {label: text(item.label), action: () => run(MOVE_VIEW_COMMAND, {viewId: opened.viewId, ...item.args})};
    });
    const [into, fresh, reset] = [itemsOf("container"), itemsOf("new-container"), itemsOf("reset")];
    // 已经独占一个窗的再浮动没有意义。
    const home = panelOfView(opened.viewId);
    const float: ContextMenuItem[] = catalog.value.get(opened.viewId)?.floatable === false || isSoleWindow(doc.value, home) ? [] : [{label: message("commands.nbook.view.float.title"), action: () => run(FLOAT_COMMAND, {tab: viewKey(opened.viewId)})}];
    // 入口代表的容器只有这一节（并成一行，输出 47）：它的“重置”就是视图的“重置位置”，只接“移到”。
    const {container: owner} = opened;
    const container = owner === null ? [] : containerMoveItemsOf(owner).map((item): ContextMenuItem => ({
        ...item,
        action: () => {
            movedContainer = owner;
            item.action?.();
        },
    }));
    const sections = [into, fresh, float, reset, container].filter((section) => section.length > 0);
    return sections.flatMap((section, index) => (index === 0 ? section : [{separator: true}, ...section]));
});

// ── 活动栏 ────────────────────────────────────────────────────────────────

/** 区域此刻可见（活动栏、入口条的按下态与点了做什么都问它，输出 22、47）。 */
const regionShowing = (region: PanelName): boolean => regionVisible(doc.value, region, {removed: state.value.collapse.removed, maximized: state.value.maximized}, state.value.visibleTabs as ReadonlySet<string>);

/** 活动栏说的“侧栏可见”（输出 22）：入口的按下态问它。 */
const sidebarShowing = computed(() => regionShowing("sidebar"));

/** 视图的标题；声明消失的视图写它的 id，和面板头的标签一样（输出 4）。 */
const viewTitle = (viewId: string): string => {
    const declaration = catalog.value.get(viewId);
    return declaration === undefined ? viewId : text(declaration.title);
};

/**
 * 图标入口的角标（views.md 输出 17）：容器里各视图 `badge()` 的合计，都没有时是 null。图标入口没有分节头，几个视图的数只能合在入口上；
 * 底部面板的标题入口不用它（见 `stripEntries`）。
 */
const containerCount = (views: readonly string[]): number | null => {
    const total = views.reduce((sum, viewId) => sum + (props.views.badge?.(viewId) ?? 0), 0);
    return total > 0 ? total : null;
};

/**
 * 活动栏与入口条上的一个入口：`pressed` 是按下态（当前容器且区域可见），由调用方按自己区域的可见求值；角标各区域取法不同，由 `countOf` 按入口唯一的那个视图（含几个视图时是 null）给。
 */
function entryOf(entry: ContainerEntry, pressed: boolean, countOf: (viewId: string | null) => number | null): ToolStripEntry & RegionStripEntry {
    const label = text(entry.label.title);
    const views = entry.views.map(viewTitle);
    // 容器的名称就是它唯一那个视图的标题时，悬停文字不把同一个词写两遍。
    const tooltip = views.length === 1 && views[0] === label ? label : message("viewContainers.entryTooltip", {name: label, views: views.join(message("viewContainers.viewSeparator"))});
    const viewId = entry.views.length === 1 ? (entry.views[0] ?? null) : null;
    return {id: entry.id, label, icon: entry.label.icon, tooltip, viewId, current: entry.current, pressed, count: countOf(viewId)};
}

/** 上段的入口：侧栏里的容器，按入口顺序（输出 22、41）。成员是声明消失的视图时照样有入口，点了能看到占位。 */
const toolEntries = computed((): ToolStripEntry[] => regionEntries(renderedDoc.value, "sidebar", catalog.value, state.value.containers).map((entry) => entryOf(entry, entry.current && sidebarShowing.value, () => containerCount(entry.views))));

const stripItems = computed<ToolStripItem[]>(() => (props.chrome?.activityEntries(resolver) ?? []).map((item) => ({id: item.id, title: item.title, icon: item.icon, interactive: item.command !== null, pressed: item.pressed, disabledReason: item.disabledReason})));

const hostEl = ref<HTMLElement | null>(null);

/**
 * 切换容器时卡片不动、里面的内容滚过去（输出 42）：方向跟着入口排的方向，侧栏、右栏的入口竖排在侧轨上，竖着滚；底部面板在入口条下面横着滚。网格同时只有一个交换，
 * `token` 在三个区域之间递增；`WorkbenchSurface` 补上缝宽与裁切窗交给网格。`slides` 记每个区域滚过几次：入口的选中标记只在自己的区域滚的那一次滑过去。
 */
const regionSwap = shallowRef<Omit<GridSwap, "gap" | "window"> | null>(null);
const slides = shallowRef<Readonly<Record<PanelName, number>>>({sidebar: 0, auxiliarybar: 0, panel: 0});

/**
 * 点入口切换容器之前（同一个同步段里接着提交）：区域显示着、里面没有最大化的分节时，给网格一次交换，离开的是当前容器的分节、换上来的是新容器的，
 * 方向按入口顺序。隐藏着、拖到零时按显示长出来（不滚）；有最大化的分节时切换会退出最大化，上一帧是整窗的矩形，照常过渡。列的是文档里的分节，
 * 没呈现出来的（放不下收走的）由网格忽略；入口条叶前后都在，不在交换里，所以它和卡片顶上那一行不动。
 */
function prepareRegionSwap(region: PanelName, next: string): void {
    // 读已提交的文档，不读入口（入口是拖动预览的）：交换比的是网格上一帧与这一次提交，两头都是已提交的。
    const entries = regionEntries(doc.value, region, catalog.value, state.value.containers);
    const current = entries.find((entry) => entry.current)?.id;
    const maximized = state.value.maximized;
    if (current === undefined || current === next || !regionShowing(region) || (maximized !== null && regionOf(doc.value, maximized) === region)) return;
    const containers = regionContainers(doc.value, region);
    const sectionsOf = (id: string): string[] => [...(containers.find((container) => container.id === id)?.sections ?? [])];
    const order = entries.map((entry) => entry.id);
    regionSwap.value = {
        token: (regionSwap.value?.token ?? 0) + 1,
        leaving: sectionsOf(current),
        entering: sectionsOf(next),
        axis: entriesOnRail(region) ? "height" : "width",
        direction: order.indexOf(next) > order.indexOf(current) ? 1 : -1,
    };
    slides.value = {...slides.value, [region]: slides.value[region] + 1};
}

/**
 * 点活动栏或入口条的入口（输出 22、47）：不是当前容器就切到它（隐藏、拖到零时同一次写入显示），是当前容器且区域可见就隐藏区域。
 * 焦点不在这里管：鼠标点不抢焦点，原处看不见了由下面“焦点”一节的规则接走（输出 42）。
 */
function selectRegionEntry(region: PanelName, container: string): void {
    const intent = regionEntryIntent(doc.value, region, container, {regionVisible: regionShowing(region)});
    if (intent.kind === "show") {
        prepareRegionSwap(region, intent.container);
        props.layout.actions.showContainer(intent.container);
    }
    if (intent.kind === "hide") run(SET_PART_HIDDEN_COMMAND, {part: region, hidden: true});
}

/**
 * 右栏、底部面板入口条的入口：区域里的容器，按入口顺序（输出 41、47），和活动栏同一个求值；按下态是当前容器且区域可见。
 * 收成一个计算属性：模板里每次现算的话，外壳每渲一次两条入口条都拿到新数组、跟着重渲。
 */
const stripEntries = computed((): Readonly<Record<"auxiliarybar" | "panel", RegionStripEntry[]>> => {
    const entriesOf = (region: "auxiliarybar" | "panel"): RegionStripEntry[] => {
        const showing = regionShowing(region);
        // 底部面板的入口是容器的标题，只含一个视图的写那个视图的计数（views.md 输出 17）：并成一行时头不写标题，计数只在这里；几个视图的容器各节头
        // 已经各写各的数，入口不再写合计。右栏的入口是右轨上的图标，没有节头，写容器的合计。
        return regionEntries(renderedDoc.value, region, catalog.value, state.value.containers).map((entry) => entryOf(entry, entry.current && showing, (viewId) => (region === "panel" ? (viewId !== null ? props.views.badge?.(viewId) ?? null : null) : containerCount(entry.views))));
    };
    return {auxiliarybar: entriesOf("auxiliarybar"), panel: entriesOf("panel")};
});
const stripEntriesOf = (region: PanelName): RegionStripEntry[] => (region === "sidebar" ? [] : stripEntries.value[region]);

// ── 入口的右键菜单 ────────────────────────────────────────────────────────

const containerMenu = shallowRef<{readonly container: string; readonly x: number; readonly y: number} | null>(null);

/** 容器的“移到”另外两个区域（输出 44）：整个容器搬过去（`moveContainer`）。 */
const containerMoveItemsOf = (container: string): ContextMenuItem[] => containerMoveTargets(doc.value, container).filter((region) => props.layout.actions.permitsMoveContainer(container, region)).map((region): ContextMenuItem => ({
    label: message(`viewContainers.moveTo.${region}`),
    action: () => props.layout.actions.moveContainer(container, region),
}));

/** 容器的菜单（输出 44）：“移到”另外两个区域，然后是“重置”（容器有声明的区域、此刻不在那里时才有）。 */
function containerMenuItemsOf(container: string): ContextMenuItem[] {
    const moves = containerMoveItemsOf(container);
    const home = containerHomeRegion(container, catalog.value, state.value.containers);
    if (home === null || !canResetContainer(doc.value, container, catalog.value, state.value.containers) || !props.layout.actions.permitsMoveContainer(container, home)) return moves;
    return [...moves, {label: message("viewContainers.reset"), action: () => props.layout.actions.resetContainer(container, home)}];
}

const containerMenuItems = computed(() => (containerMenu.value === null ? [] : containerMenuItemsOf(containerMenu.value.container)));

/**
 * 入口条上入口的右键与菜单键（输出 44、47）：容器的菜单。底部面板并成一行时那一节的头不写标题，按下的入口就是它的标题：
 * 这个入口开那个视图的“移动到”（输出 23），和别处点它的标题一样，末尾接上容器的“移到”；视图不让移动时只开容器的菜单。
 */
function openStripMenu(region: PanelName, merged: string | null, container: string, at: {readonly x: number; readonly y: number}): void {
    const section = merged === null ? undefined : renderedDoc.value.panels[merged];
    const key = section?.active ?? null;
    if (region === "panel" && section?.container === container && key !== null && canMoveView(key)) {
        openMoveMenu(key, at, container);
        return;
    }
    openContainerMenu(container, at);
}

/** 一项都没有时不开（容器没有成员了）：空菜单只会吃掉一次按键。 */
function openContainerMenu(container: string, at: {readonly x: number; readonly y: number}): void {
    if (containerMenuItemsOf(container).length > 0) containerMenu.value = {container, ...at};
}

// 开着的时候菜单项没了（成员走光了）：关掉，不留一个空菜单。
watch(() => containerMenu.value !== null && containerMenuItems.value.length === 0, (stale) => {
    if (stale) containerMenu.value = null;
});

/** 键盘关掉或选完之后，焦点回到这个容器的入口。点到外面时焦点归点到的地方。 */
function closeContainerMenu(reason: ContextMenuCloseReason): void {
    const opened = containerMenu.value;
    containerMenu.value = null;
    if (opened === null || reason === "outside") return;
    focusContainer(opened.container);
}

/** 焦点去这个容器的入口（搬走了就是新区域里的那一个）；入口够不着（例如活动栏隐藏）时去它第一个分节的标题。等这一轮渲染做完：搬走的入口这时才在新区域里。 */
function focusContainer(container: string): void {
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const region = containerRegion(doc.value, container);
        const first = region === null ? undefined : regionContainers(doc.value, region).find((item) => item.id === container)?.sections[0];
        const candidates = [landingElement(root, {kind: "entry", container}), first === undefined ? null : landingElement(root, {kind: "tab", panel: first})];
        candidates.find(reachable)?.focus({preventScroll: true});
    });
}

// ── 标题栏与状态栏 ────────────────────────────────────────────────────────

/** “打开项目”的命令 id：项目插件的公开合同，工作台不为它依赖项目插件的模块。 */
const OPEN_PROJECT_COMMAND = "nbook.project.open";
/** “回到书架”的命令 id（同上）：命令在目录里时标题栏才画回书架的入口。 */
const BACK_TO_SHELF_COMMAND = "nbook.project.back-to-shelf";
const shelfTitle = computed(() => props.chrome?.commandTitle(BACK_TO_SHELF_COMMAND, resolver) ?? null);

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

/** 面板头上的标题按钮；底部面板并成一行时头不写标题，按下的入口就是它的标题（输出 47）。 */
function titleIn(head: HTMLElement | null): HTMLElement | null {
    return head?.querySelector<HTMLElement>('[data-panel-tab][tabindex="0"]') ?? head?.closest("[data-region-strip]")?.querySelector<HTMLElement>('[data-region-entry][aria-pressed="true"]') ?? null;
}

/** 落点在界面上对应的元素；不保证看得见，调用方用 `reachable` 筛。 */
function landingElement(root: HTMLElement, landing: FocusLanding): HTMLElement | null {
    // 侧栏、右栏的入口在侧轨（`data-tool-entry`），底部面板的在入口条（`data-region-entry`）；容器 id 在三个区域里不重。
    if (landing.kind === "entry") return root.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(landing.container)}"], [data-region-entry="${CSS.escape(landing.container)}"]`);
    const tab = titleIn(root.querySelector<HTMLElement>(`[data-panel-head="${CSS.escape(landing.panel)}"]`));
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

/**
 * 头换了地方时焦点跟过去（输出 13、47）：同一块面板的头在入口条与它自己的叶之间搬家（并成一行、分开、最大化、还原、入口条里换了并进来的那一节），
 * 旧头卸掉时焦点在它上面就丢了。焦点进头时记下“哪块面板、哪个元素”（标题、框架按钮的命令、接管标题区时单独的展开标记）；同一块面板的新头挂上、
 * 而焦点已经丢了（在 body 上，或在停放的内容里）时，交给新头里同一个元素，没有就给新头的标题。焦点没丢就不动。
 */
let headFocus: {readonly panel: string; readonly selector: string} | null = null;
function onHostFocusIn(event: FocusEvent): void {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const head = target?.closest<HTMLElement>("[data-panel-head]") ?? null;
    if (target === null || head === null) {
        headFocus = null;
        return;
    }
    const action = target.closest<HTMLElement>("[data-panel-action]")?.dataset.panelAction;
    const selector = action !== undefined ? `[data-panel-action="${CSS.escape(action)}"]` : target.closest("[data-panel-fold]") !== null && target.tagName === "BUTTON" ? "button[data-panel-fold]" : "[data-panel-tab]";
    headFocus = {panel: head.dataset.panelHead ?? "", selector};
}
function onHeadMounted(panelId: string): void {
    const remembered = headFocus;
    if (remembered === null || remembered.panel !== panelId) return;
    void nextTick(() => {
        const root = hostEl.value;
        if (root === null) return;
        const active = root.ownerDocument.activeElement;
        if (active !== null && active !== root.ownerDocument.body && active.closest("[inert]") === null && active.isConnected) return;
        const heads = [...root.querySelectorAll<HTMLElement>(`[data-panel-head="${CSS.escape(panelId)}"]`)];
        const target = heads.map((head) => head.querySelector<HTMLElement>(remembered.selector) ?? titleIn(head)).find(reachable);
        target?.focus({preventScroll: true});
    });
}

/** 工具面板的落点按 `focusLandings`：同一面板看得见的标签，切走容器后新容器的第一个分节，侧轨（活动栏、右轨）或底部面板入口条里它那个容器的入口。 */
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
        ownHead: (panel) => ownHeadBands.value.has(panel),
        sectors: () => props.dropSectors !== false,
        feel: () => props.dragFeel ?? "live",
        cardShrink: () => props.dragCardShrink ?? "strip",
        cardRefresh: () => props.dragCardRefresh ?? "display",
        grid: () => surface.value,
        showPreview: (next) => props.layout.actions.setLivePreview(next),
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
        const file: WorkbenchFileDrop = {action: drop.action, ...(drop.part === undefined ? {} : {part: drop.part}), key: dropKeyOf(drop.action, drop.part), label: dropLabel(drop)};
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
const feedbackPreview = computed(() => dragView.value.feedback.preview);
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
const liftedCard = computed(() => drag.value?.live.card.value ?? null);
const cardTitle = computed(() => (dragSource.value === null ? null : ghostOf(dragSource.value)));
const wantsGhost = computed(() => dragView.value.ghost);
/** 拖影的身份；位置经 `moveGhost` 写。 */
const dragGhost = computed(() => (wantsGhost.value ? cardTitle.value : null));
/** 正被拖着、入口条上留着位置的入口：只含被拖视图的那个容器的。 */
function entryPlaceholderIn(entries: ReadonlyArray<{readonly id: string; readonly viewId: string | null}>): string | null {
    const viewId = dragPlaceholder.value === null ? null : viewIdOf(dragPlaceholder.value);
    return viewId === null ? null : (entries.find((entry) => entry.viewId === viewId)?.id ?? null);
}
const toolPlaceholder = computed(() => entryPlaceholderIn(toolEntries.value));
/** 并入的盖层：矩形按预览算，来源收起时目标会动，盖层跟着过渡。 */
const mergeRect = computed(() => {
    const panel = mergeTarget.value;
    return panel === null ? null : (drag.value?.panelRectIn(renderedDoc.value, panel) ?? null);
});
const mergeStyle = computed(() => {
    const rect = mergeRect.value;
    return rect === null ? {} : {left: `${String(rect.left)}px`, top: `${String(rect.top)}px`, width: `${String(rect.right - rect.left)}px`, height: `${String(rect.bottom - rect.top)}px`};
});
const slotStyle = computed(() => {
    const slot = drag.value?.live.slot.value ?? null;
    return slot === null ? {} : {left: `${String(slot.x)}px`, top: `${String(slot.y)}px`, width: `${String(slot.width)}px`, height: `${String(slot.height)}px`};
});

function dropLabel(drop: LayoutDragDrop): string {
    if (drop.inPlace) return message("shell.drop.inPlace");
    const {action} = drop;
    if (action.kind === "new-container") return message("shell.drop.newContainer");
    // 整个容器搬过来也是“放在这里”：入口落在这个空位，和换序一样。
    if (action.kind === "move-entry" || action.kind === "move-container") return message("shell.drop.insert");
    if (action.kind === "join-container") {
        const entries = [...toolEntries.value, ...stripEntries.value.auxiliarybar, ...stripEntries.value.panel];
        return message("shell.drop.joinContainer", {part: entries.find((entry) => entry.id === action.container)?.label ?? action.container});
    }
    if (action.kind === "strip") return message("shell.drop.insert");
    if (action.kind === "center") return message("shell.drop.addTab");
    if (action.kind === "float") return message("shell.drop.float");
    // 带容器的外缘落点只有放进空区域这一种（ADR 0050）：整块一个落点，不说拆到哪一边。
    if (action.container !== undefined) return message("shell.drop.insert");
    return message(action.target.kind === "between" ? "shell.drop.between" : "shell.drop.split");
}

const sectorLabels = computed(() => ({
    left: message("shell.drop.sector.left"),
    right: message("shell.drop.sector.right"),
    top: message("shell.drop.sector.top"),
    bottom: message("shell.drop.sector.bottom"),
    whole: message("shell.drop.insert"),
    center: message("shell.drop.addTab"),
}));

/** 呈现降级写在外壳根上（“失败与恢复”）：被收走的面板，压到编辑组时再加一条；记录不合骨架回落了也写一条。 */
const diagnostics = computed(() => {
    const {removed, squeezed} = state.value.collapse;
    return [...removed].map((panel) => `放不下，收走 ${panel}`).concat(squeezed ? ["放不下，压缩编辑组"] : [], state.value.outsideSkeleton ? ["布局记录不合骨架，已用默认布局"] : [], state.value.recordRepairs.length > 0 ? [`布局记录有不认的值，已按缺省读：${state.value.recordRepairs.join("; ")}`] : []).join(" | ");
});

/** 布局里的面板，给外壳根写个数：e2e 和排障用。 */
const panelCount = computed(() => treeLeaves(doc.value.tree.root).filter((leaf) => doc.value.panels[leaf.id] !== undefined).length);
</script>

<template>
    <div ref="hostEl" class="workbench-shell-host" tabindex="-1" @focusin="onHostFocusIn" @contextmenu="onOwnHeadContextMenu">
        <div class="workbench-shell" data-workbench-shell :data-layout-diagnostics="diagnostics" :data-panel-count="panelCount">
            <div class="workbench-shell__titlebar-slot" data-shell-titlebar :style="{height: titlebarHeight}">
                <WorkbenchTitleBar
                    v-if="chrome !== undefined"
                    :project="project"
                    :menus="titleMenus"
                    :search-shortcut="chrome.searchShortcut()"
                    :layout="layoutButtons"
                    :items="chrome.titleEntries(resolver)"
                    :shelf="shelfTitle"
                    @run="(command, args) => run(command, {...args})"
                    @search="run(OPEN_COMMANDS_ID)"
                    @toggle-part="(part) => run(SET_PART_HIDDEN_COMMAND, {part})"
                    @open-project="run(OPEN_PROJECT_COMMAND)"
                    @back-to-shelf="run(BACK_TO_SHELF_COMMAND)"
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
                :dragging="dragSource !== null"
                :floats="layout.actions.floats()"
                :data-drag-feel="drag?.live.active.value === true ? 'live' : 'indicator'"
                :data-live-preview="drag?.live.previewKey.value ?? 'none'"
                :maximized="state.maximized"
                :disabled="!state.ready"
                :title-only-panels="titleOnlyPanelIds"
                :own-heads="ownHeads"
                :slot-panel="dragSlotPanel"
                :swap="regionSwap"
                context-key="workbench"
                @extent="onExtent"
                @card-gap="(gap) => layout.actions.acceptCardGap(gap)"
                @presented="(sizes) => layout.actions.acceptPresented(sizes)"
                @preview="(sizes) => layout.actions.acceptPreview(sizes)"
                @gesture-commit="(before, after, collapsed) => layout.actions.commitGesture(before, after, collapsed)"
                @focus-panel="(panel) => layout.actions.focusPanel(panel)"
                @raise-float="(panel) => layout.actions.raiseFloat(panel)"
                @content-parked="onContentParked"
                @issues="(issues) => reportGridIssues(issues)"
            >
                <template #activitybar="{joined}">
                    <WorkbenchToolStrip
                        :joined="joined"
                        :label="message('shell.activityBar')"
                        :more-label="message('common.more')"
                        :entries="toolEntries"
                        :placeholder="toolPlaceholder"
                        :highlighted="mergeEntry"
                        :slide-token="slides.sidebar"
                        :items="stripItems"
                        :drag-hint="message('shell.drag.hint')"
                        @select="(id) => selectRegionEntry('sidebar', id)"
                        @run-item="(id) => chrome?.runItem(id)"
                        @context-menu="openContainerMenu"
                    />
                </template>
                <!-- 右轨（输出 50）：右栏的容器入口，和活动栏同一个组件；点、拖、右键同活动栏的上段。 -->
                <template #rail="{joined}">
                    <WorkbenchToolStrip
                        region="auxiliarybar"
                        :joined="joined"
                        :label="message('shell.auxiliaryRail')"
                        :more-label="message('common.more')"
                        :entries="stripEntries.auxiliarybar"
                        :placeholder="entryPlaceholderIn(stripEntries.auxiliarybar)"
                        :highlighted="mergeEntry"
                        :slide-token="slides.auxiliarybar"
                        :drag-hint="message('shell.drag.hint')"
                        @select="(id) => selectRegionEntry('auxiliarybar', id)"
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
                        :unread-notifications="unreadNotifications ?? 0"
                        @open-notifications="run(OPEN_VIEW_COMMAND, {viewId: NOTIFICATIONS_VIEW})"
                        @toggle-panel="run(SET_PART_HIDDEN_COMMAND, {part: 'panel', hidden: panelVisible})"
                        @retry="layout.actions.retry()"
                        @discard="layout.actions.discard()"
                    />
                </template>
                <template #empty-region>
                    <div class="workbench-shell__empty-region" data-empty-region>{{ message("shell.emptyRegion") }}</div>
                </template>
                <template #head="{panelId, idPrefix}">
                    <template v-if="renderedDoc.panels[panelId]?.role === 'editor'">
                        <component :is="editorArea.head" v-if="editorArea !== null" :key="editorArea.id" :panel-id="panelId" :dragging-tab="dragPlaceholder" :frame-actions="editorFrameActions(panelId)" />
                    </template>
                    <WorkbenchPanelHead v-else v-bind="toolHeadProps(panelId, idPrefix)" v-on="toolHeadEvents(panelId)" @vue:mounted="onHeadMounted(panelId)">
                        <template v-if="headActions.has(panelId)" #actions>
                            <TitleActions :model="headActions.get(panelId)!.model" :identity="viewIdentity(headActions.get(panelId)!.viewId)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(headActions.get(panelId)!.viewId, key)" />
                        </template>
                    </WorkbenchPanelHead>
                </template>
                <template #strip="{region, merged, idPrefix}">
                    <WorkbenchRegionStrip
                        :region="region"
                        :label="message('shell.regionStrip.panel')"
                        :more-label="message('common.more')"
                        :entries="stripEntriesOf(region)"
                        :head-min-width="merged === null ? 0 : headOwnReserve(merged)"
                        :slide-token="slides[region]"
                        :drag-hint="message('shell.drag.hint')"
                        :placeholder="entryPlaceholderIn(stripEntriesOf(region))"
                        :highlighted="mergeEntry"
                        @select="(id) => selectRegionEntry(region, id)"
                        @context-menu="(id, at) => openStripMenu(region, merged, id, at)"
                    >
                        <!-- 并进来的那一节的头：同分节的头，以面板为 key，换了并进来的那一节就是新的头（head-slots 先 null 再给新的、焦点交接）。 -->
                        <!-- 底部面板的入口写着容器的标题，并进来的头不再写一遍（输出 47）。 -->
                        <WorkbenchPanelHead v-if="merged !== null" :key="merged" v-bind="toolHeadProps(merged, idPrefix)" :title-in-entry="region === 'panel'" v-on="toolHeadEvents(merged)" @vue:mounted="onHeadMounted(merged)">
                            <template v-if="headActions.has(merged)" #actions>
                                <TitleActions :model="headActions.get(merged)!.model" :identity="viewIdentity(headActions.get(merged)!.viewId)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(headActions.get(merged)!.viewId, key)" />
                            </template>
                        </WorkbenchPanelHead>
                    </WorkbenchRegionStrip>
                </template>
                <template #lifted-head>
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
                        <!-- 不写字：落点的文字在卡片头上，盖层中间的字压在内容上，指针在中央时还被卡片挡住。 -->
                        <div v-if="mergeRect !== null" :key="mergeTarget ?? ''" class="workbench-shell__merge" data-live-merge :data-live-merge-panel="mergeTarget" :style="mergeStyle"></div>
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
                <template #own-head="{panelId: id, idPrefix, actionsShown}">
                    <!-- 视图自绘头（views.md 输出 19 的“自绘头”）：盖在视图之上的一条，在内容里，焦点与 F6 算这块面板；窗口零件层的缩放带仍在它上面。 -->
                    <WorkbenchPanelHead
                        v-bind="toolHeadProps(id, idPrefix)"
                        :own-head="{band: ownHeadBands.get(id) ?? 0}"
                        :actions-shown="actionsShown"
                        v-on="toolHeadEvents(id)"
                        @own-head-inset="(width: number) => ownHeadInsets.set(id, width)"
                        @vue:mounted="onHeadMounted(id)"
                    >
                        <template v-if="headActions.has(id)" #actions>
                            <TitleActions :model="headActions.get(id)!.model" :identity="viewIdentity(headActions.get(id)!.viewId)" :more-label="message('shell.moreActions')" @run="(key) => runViewAction(headActions.get(id)!.viewId, key)" />
                        </template>
                    </WorkbenchPanelHead>
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

/* 并入：目标变暗加内描边。来源收起时目标会动，过渡和外框同一条曲线、同样用 left/top（见 nb-layout 的 `gridRectStyle`）；样式走令牌，主题能换。 */
.workbench-shell__merge {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border-radius: var(--layout-card-radius);
    background: var(--layout-merge-fill);
    box-shadow: inset 0 0 0 var(--layout-merge-border-width) var(--layout-merge-border);
    pointer-events: none;
    transition:
        left var(--motion-layout) var(--ease-layout),
        top var(--motion-layout) var(--ease-layout),
        width var(--motion-layout) var(--ease-layout),
        height var(--motion-layout) var(--ease-layout);
    animation: workbench-shell-merge-in var(--motion-fast) var(--ease-layout);
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

/* 打开着的空区域（ADR 0050）：整块卡片里正中一句提示，没有头；整块是落点，提示不接指针。 */
.workbench-shell__empty-region {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: center;
    pointer-events: none;
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
