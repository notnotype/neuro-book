<script setup lang="ts">
/**
 * 首页原型里那台能上手的工作台（同名 .md，w00056 t06）。拼法：视图的头、活动栏与入口条照 `fixtures/WorkbenchSurfaceFixture.vue`，
 * 编辑组、拖动与拖动反馈照 `fixtures/editor-scene/EditorAreaFixture.vue`，资源管理器照 `fixtures/explorer-scene/ExplorerLiveScene.vue`。
 *
 * 布局文档只有一份，放在这里的 `doc`；编辑器区经 `createEditorPanels` 改它，视图的结构操作、拖缝的落账也都走 `apply`。
 * `apply` 照产品的布局 store（`workbench/web/state/layout-doc-store.ts`）做同样几步：先把呈现尺寸写回意图，守骨架，树变了就取消最大化，
 * 最后归整容器。这样编辑器拆组、视图搬家与拖动落点三条路改出来的文档，和产品里同一个动作改出来的一样。
 */
import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationServices, AgentViewMode, MessageView} from "@notnotype/nb-agent-ui";
import type {GridExtent} from "@notnotype/nb-layout";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {activateTab, applyGestureCommit, applyLayoutDrop, edgeTargetOf, presentationCollapse, projectLayoutDoc, rebaseForOperation, sameTreeShape, setActiveContainer, setPanelHidden, tabKey} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutFloatRect, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";
import {computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch} from "vue";
import type {Component} from "vue";

import {agentCatalogs} from "nbook/plugins/agent/web/text";
import LYRA_AVATAR from "nbook/plugins/bots/builtin/lyra/avatar.webp";
import {CODE_EDITOR, editorMenusKey, MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import {createEditorArea} from "nbook/plugins/editor/web/area";
import EditorGroup from "nbook/plugins/editor/web/components/EditorGroup.vue";
import EditorGroupHead from "nbook/plugins/editor/web/components/EditorGroupHead.vue";
import EditorHost from "nbook/plugins/editor/web/components/EditorHost.vue";
import type {EditorState} from "nbook/plugins/editor/web/editor-registry";
import {editorCatalogs} from "nbook/plugins/editor/web/text";
import {explorerCatalogs} from "nbook/plugins/explorer/web/text";
import {createAssetUrls, markdownAssetsKey} from "nbook/plugins/markdown/web/parts/asset-urls";
import {markdownStickersKey} from "nbook/plugins/markdown/web/parts/stickers";
import {SyntaxCatalog, syntaxCatalogKey} from "nbook/plugins/markdown/web/syntax-catalog";
import {markdownCatalogs} from "nbook/plugins/markdown/web/text";
import type {EditorPanelsService} from "nbook/plugins/workbench/shared/contracts";
import {createEditorPanels, editorTabIdOf} from "nbook/plugins/workbench/shared/editor-panels";
import WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type {PanelHeadTab} from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import WorkbenchRegionStrip from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {EditorTabDrag} from "nbook/plugins/workbench/web/contracts";
import {applyEntryDrop, isEntryAction} from "nbook/plugins/workbench/web/entry-drop";
import {createLayoutDrag} from "nbook/plugins/workbench/web/layout-drag";
import type {LayoutDrag} from "nbook/plugins/workbench/web/layout-drag";
import {implicitContainerOf, moveContainerTo, settleContainers} from "nbook/plugins/workbench/web/state/containers";
import {defaultLayoutDoc, fitsSkeleton, INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import {collapseOrder, createLayoutPolicy, EDITOR_GROUP_MINIMUM, layoutProjectionOptions} from "nbook/plugins/workbench/web/state/layout-constraints";
import {effectiveVisibleTabs, regionEntries, regionEntryIntent, regionVisible, titleOnlyPanels} from "nbook/plugins/workbench/web/state/layout-present";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {useLabEventSink} from "../../lab-event-sink";
import {createLabEditorMenus} from "../../fixtures/editor-scene/lab-editor-menus";
import {createMemoryFiles} from "../../fixtures/explorer-scene/memory-files";
import {labStickers} from "../../fixtures/lab-stickers";
import {labAgentRegistry, labAgentRenderers, labAgentServices, provideLabMarkdown} from "../../fixtures/nb-agent-ui/host";
import {dropRect} from "./desk";
import type {DeskPlate, DeskSetup, DeskSnapshot, DeskTarget, Point} from "./desk";
import {createDeskExplorer} from "./desk-explorer";
import {BOOK_TITLE, CANON_GROUPS, CATALOG, DESK_REGION_WIDTHS, KNOCK_MESSAGES, lyraContext, OPEN_FILES, PROJECT_FILES, TOUR_MESSAGES, VIEWS} from "./sample";
import type {OpenFile} from "./sample";

const props = withDefaults(defineProps<{
    /** 上一次关掉时记下的布局、标签与最大化；缺省是首屏的样子。 */
    restore?: DeskSnapshot | null;
    /** 首屏摆什么（见 `DeskSetup`）；只在没有 `restore` 时用。 */
    setup?: DeskSetup;
    /** 夜间配色时强调色换成金（配色本身由页面写在根上，见 `HomepageSanctum.vue`）。 */
    night?: boolean;
}>(), {restore: null, setup: "tour", night: false});

const emit = defineEmits<{
    /** 访客自己按下了指针或按了键（演示不发这些事件）：第一幕的自动演示据此让开。 */
    (event: "touch"): void;
    /** 第一次排好版：卡片量得到了。 */
    (event: "ready"): void;
}>();

const record = useLabEventSink();

// ── 文字：桌上的零件共用一个端口，登记各自插件的目录（Lab 窗口的端口里没有它们）──
const engine = createHostTextEngine({locale: "zh-CN"});
engine.register("nbook.editor", editorCatalogs.catalogs, editorCatalogs.source);
engine.register("nbook.markdown", markdownCatalogs.catalogs, markdownCatalogs.source);
engine.register("nbook.explorer", explorerCatalogs.catalogs, explorerCatalogs.source);
engine.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
engine.register("nbook.workbench", workbenchCatalogs.catalogs, workbenchCatalogs.source);
provideHostText(engine.port);
const text = engine.port;
provideLabMarkdown();

// ── 布局文档与呈现：产品的纯函数，文档在内存里 ──

const POLICY = createLayoutPolicy();
/**
 * 首屏的布局：产品的缺省文档，侧栏与右栏换成 `DESK_REGION_WIDTHS`。缺省文档的主干是“活动栏 | 侧栏 | 中间 | 右栏”一排，
 * 侧栏、中间、右栏各是一列（列里的叶同宽），所以改一列的宽就是把这一列连同里面的节点都改成同一个宽，中间那列拿剩下的。
 */
function firstDoc(): LayoutDoc {
    const doc = defaultLayoutDoc(CATALOG);
    type Node = LayoutDoc["tree"]["root"];
    const withWidth = (node: Node, width: number): Node => (node.kind === "leaf" ? {...node, size: {...node.size, width}} : {...node, size: {...node.size, width}, children: node.children.map((child) => withWidth(child, width))});
    const root = doc.tree.root;
    if (root.kind !== "branch") return doc;
    const children = root.children.map((child): Node => {
        if (child.id !== "body" || child.kind !== "branch") return child;
        const total = child.size.width;
        const [bar, sidebar, center, auxiliary] = child.children;
        if (bar === undefined || sidebar === undefined || center === undefined || auxiliary === undefined) return child;
        const middle = total - bar.size.width - DESK_REGION_WIDTHS.sidebar - DESK_REGION_WIDTHS.auxiliarybar;
        return {...child, children: [bar, withWidth(sidebar, DESK_REGION_WIDTHS.sidebar), withWidth(center, middle), withWidth(auxiliary, DESK_REGION_WIDTHS.auxiliarybar)]};
    });
    return {...doc, tree: {...doc.tree, root: {...root, children}}};
}

const doc = shallowRef<LayoutDoc>(props.restore?.doc ?? firstDoc());
const extent = shallowRef<GridExtent | null>(null);
const cardGap = ref(0);
const presented = shallowRef<Readonly<Record<string, GridExtent>>>({});
const preview = shallowRef<Readonly<Record<string, GridExtent>> | null>(null);
const maximized = ref<string | null>(props.restore?.maximized ?? null);
const focusedPanel = ref<string | null>(null);

const baseOptions = computed(() => layoutProjectionOptions({doc: doc.value, catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value}));
const collapse = computed(() => (extent.value === null ? {removed: new Set<string>(), squeezed: false} : presentationCollapse(doc.value, extent.value, {...baseOptions.value, order: collapseOrder(doc.value), focused: focusedPanel.value})));
const projectionOptions = computed(() => layoutProjectionOptions({doc: doc.value, catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value, removed: collapse.value.removed, squeezed: collapse.value.squeezed}));
const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
const titleOnly = computed(() => titleOnlyPanels(doc.value));
const visible = computed(() => effectiveVisibleTabs(doc.value, {sizes: presented.value, preview: preview.value, removed: collapse.value.removed, maximized: maximized.value, fillers: projection.value.fillers}));

/** 结构操作的唯一出口，步骤同产品的布局 store（见文件头）。库拒绝时文档不变。 */
function apply(operation: (current: LayoutDoc) => LayoutResult, options: {readonly rebase?: boolean} = {}): LayoutResult {
    const base = options.rebase === false ? doc.value : rebaseForOperation(doc.value, projection.value, presented.value);
    const result = operation(base);
    if (!result.ok) return result;
    if (result.doc === base) return {ok: true, doc: doc.value};
    if (!fitsSkeleton(result.doc)) return {ok: false, code: "rejected", message: "The result does not fit the skeleton"};
    if (!sameTreeShape(base, result.doc)) maximized.value = null;
    const settled = settleContainers(result.doc);
    doc.value = settled;
    return {ok: true, doc: settled};
}

/** 拖缝的落账：经库的入口写回（收起记在锚上、拉开隐藏的区域清掉隐藏）。 */
function commitGesture(before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void {
    doc.value = applyGestureCommit(doc.value, projection.value, {before, after, collapsed}).doc;
}

// ── 编辑器区：产品的控制器、组与标签、Markdown 编辑器，文件在内存里 ──

// 重新挂一台时带回存过盘的正文（“关掉再打开”那一拍）；没有就按样本。
const memory = createMemoryFiles({project: props.restore?.files ?? PROJECT_FILES, user: []});
const editorPanels: EditorPanelsService = {
    ...createEditorPanels({document: () => doc.value, apply: (operation) => apply(operation), policy: POLICY}),
    ready: shallowRef(true),
    acceptSaveGate: () => undefined,
    flush: () => undefined,
};
const area = createEditorArea({
    files: memory.files,
    clock: systemClock,
    panels: editorPanels,
    workspaceKey: "homepage",
    generation: 1,
    initial: props.restore?.tabs ?? null,
    report: (error) => record("error", error instanceof Error ? error.message : String(error)),
});
/** 首屏打开的标签，按标签条上的先后；第一份在前面。 */
const FIRST_TABS: Readonly<Record<DeskSetup, readonly OpenFile[]>> = {tour: ["chapterOne", "chapterTwo", "alice"], knock: ["chapterFive", "chapterOne", "alice"]};
if (props.restore === null) {
    // 插在活动标签之后：依次打开得到标签条上的先后；最后再点一下第一份，让它在前面。
    const tabs = FIRST_TABS[props.setup];
    for (const file of tabs) area.open(OPEN_FILES[file], {mode: "permanent"});
    if (tabs[0] !== undefined) area.open(OPEN_FILES[tabs[0]], {mode: "permanent"});
}

/** 地址对应的标签：拆组、浮窗以后标签换了组，id 不变。 */
function tabIdOf(address: string): string | null {
    for (const [id, tab] of area.groups.attributes.value) if (tab.kind === "file" && tab.address === address) return id;
    return null;
}

provide(syntaxCatalogKey, new SyntaxCatalog({get: () => null, list: () => []}, () => undefined));
provide(markdownStickersKey, labStickers());
provide(markdownAssetsKey, createAssetUrls({rawUrl: () => null, watch: () => () => undefined}));
provide(editorMenusKey, createLabEditorMenus(area, text));
const MonacoControl = defineAsyncComponent(() => import("nbook/plugins/editor/web/components/MonacoControl.vue"));
const MarkdownControl = defineAsyncComponent(() => import("nbook/plugins/markdown/web/components/MarkdownControl.vue"));
const controls: Readonly<Record<string, Component>> = {[CODE_EDITOR]: MonacoControl, [MARKDOWN_EDITOR]: MarkdownControl};
const control = (editor: string): EditorState => {
    const component = controls[editor];
    return component === undefined ? {kind: "gone"} : {kind: "ready", component};
};
const onIntent = (intent: string): void => {
    if (intent === "save") void area.save();
    if (intent === "split-right") area.split("right");
    if (intent === "close") {
        const tab = area.groups.activeTab();
        if (tab !== null) void area.close(tab.id);
    }
};

// ── 视图：资源管理器是真的；设定与剧情先放名字（第三幕再讲）；星璃是产品的对话视图 ──

const explorer = createDeskExplorer({
    files: memory.files,
    text,
    title: BOOK_TITLE,
    open: (address, mode) => area.open(address, {mode}).ok,
    report: (message) => record("explorer", message),
});
/** 作品这个容器在哪个区域：搬到右栏后视图按右栏的宽度排。 */
const explorerRegion = (current: LayoutDoc): PanelName => ((current.panels.auxiliarybar?.entries ?? []).includes(implicitContainerOf("explorer")) ? "auxiliarybar" : "sidebar");
explorer.location.value = explorerRegion(doc.value);
/** 星璃的对话：第一幕会往里加消息（作者问、她边打边答），所以整份换新对象让视图跟着变。 */
const lyra = shallowRef(lyraContext(LYRA_AVATAR, props.restore?.lyra ?? (props.setup === "knock" ? KNOCK_MESSAGES : TOUR_MESSAGES)));
const lyraServices: AgentConversationServices = labAgentServices();
const lyraRegistry = labAgentRegistry();
const lyraMode = ref<AgentViewMode>("turns");

const viewOf = (key: string) => VIEWS.find((view) => tabKey({kind: "view", viewId: view.id}) === key);

function headTabs(panelId: string): PanelHeadTab[] {
    return (doc.value.panels[panelId]?.tabs ?? []).map((tab) => {
        const view = viewOf(tabKey(tab));
        return {id: tabKey(tab), label: view?.label ?? tabKey(tab), icon: view?.icon ?? "i-lucide-square"};
    });
}

function headProps(panelId: string, idPrefix: string): InstanceType<typeof WorkbenchPanelHead>["$props"] {
    return {panelId, label: doc.value.panels[panelId]?.name ?? panelId, tabs: headTabs(panelId), active: doc.value.panels[panelId]?.active ?? null, moreLabel: "更多", idPrefix, titleOnly: titleOnly.value.has(panelId), frameActions: [], viewHead: null, fold: null};
}
const HEAD_EVENTS: Record<string, (...args: never[]) => void> = {
    activate: (key: string) => {
        apply((current) => activateTab(current, key));
    },
};

/** 区域显示并切到这个容器（workbench-layout 输出 42）。 */
function showContainer(current: LayoutDoc, region: PanelName, container: string): LayoutResult {
    const shown = setPanelHidden(settleContainers(current), region, false);
    return shown.ok ? setActiveContainer(shown.doc, region, container) : shown;
}

const regionShowing = (region: PanelName): boolean => regionVisible(doc.value, region, {removed: collapse.value.removed, maximized: maximized.value}, visible.value);

/** 点入口：和产品的外壳同一个判定（输出 22）。 */
function selectRegionEntry(region: PanelName, container: string): void {
    const intent = regionEntryIntent(doc.value, region, container, {regionVisible: regionShowing(region)});
    if (intent.kind === "show") {
        maximized.value = null;
        apply((current) => showContainer(current, region, intent.container));
    }
    if (intent.kind === "hide") apply((current) => setPanelHidden(current, region, true));
}

const activityEntries = computed<ToolStripEntry[]>(() => regionEntries(doc.value, "sidebar", CATALOG).map((entry) => {
    const label = typeof entry.label.title === "string" ? entry.label.title : entry.id;
    return {id: entry.id, label, icon: entry.label.icon, tooltip: label, viewId: entry.views.length === 1 ? (entry.views[0] ?? null) : null, current: entry.current, pressed: entry.current && regionShowing("sidebar")};
}));
const STRIP_ITEMS: ReadonlyArray<ToolStripItem> = [{id: "settings", title: "设置", icon: "i-lucide-settings", interactive: false, pressed: null, disabledReason: null}];

function stripEntries(region: PanelName): RegionStripEntry[] {
    const showing = regionShowing(region);
    return regionEntries(doc.value, region, CATALOG).map((entry) => {
        const label = typeof entry.label.title === "string" ? entry.label.title : entry.id;
        return {id: entry.id, label, icon: entry.label.icon, tooltip: label, viewId: entry.views.length === 1 ? (entry.views[0] ?? null) : null, current: entry.current, pressed: entry.current && showing};
    });
}

// ── 拖动：产品的手势与落点；落账同产品 store 的 `commitDrop` ──

const host = ref<HTMLElement | null>(null);
const floatPreview = shallowRef<{readonly panel: string; readonly rect: LayoutFloatRect} | null>(null);
const floats = computed(() => doc.value.floats.map(({panel, rect}) => ({id: panel, rect: floatPreview.value?.panel === panel ? floatPreview.value.rect : rect})));
const tabDrag = shallowRef<EditorTabDrag | null>(null);
const drag = shallowRef<LayoutDrag | null>(null);
const feedback = useTemplateRef<InstanceType<typeof WorkbenchDragFeedback>>("feedback");
const surface = useTemplateRef<InstanceType<typeof WorkbenchSurface>>("surface");

onMounted(() => {
    drag.value = createLayoutDrag({
        root: host.value!,
        doc: () => doc.value,
        catalog: () => CATALOG,
        policy: () => POLICY,
        projection: () => projectionOptions.value,
        extent: () => extent.value,
        maximized: () => maximized.value,
        enabled: () => true,
        editorTabs: () => tabDrag.value,
        titleOnly: () => titleOnly.value.size > 0,
        ownHead: () => false,
        sectors: () => true,
        feel: () => "indicator",
        cardShrink: () => "strip",
        cardRefresh: () => "display",
        grid: () => null,
        showPreview: () => undefined,
        moveGhost: (point) => feedback.value?.moveGhost(point),
        floats: () => floats.value,
        markFloatMove: (panel, rect) => {
            floatPreview.value = panel === null || rect === undefined ? null : {panel, rect};
        },
        placeFloat: (panel, offset) => surface.value?.placeFloat(panel, offset),
        floatMinimum: () => EDITOR_GROUP_MINIMUM,
        commit: (source, action, part, keyboard) => {
            if (isEntryAction(action)) {
                apply((current) => applyEntryDrop(current, source, action, POLICY, {commit: true}), {rebase: action.kind !== "move-entry"});
                return;
            }
            if (source.kind === "container") return;
            if (source.kind === "tab") {
                const editorTab = editorTabIdOf(source.tab);
                if (editorTab !== null) {
                    void tabDrag.value?.drop(editorTab, action, part, keyboard);
                    return;
                }
            } else if (doc.value.panels[source.panel]?.role === "editor" && action.kind !== "float") {
                void tabDrag.value?.dropPanel(source.panel, action, part, keyboard);
                return;
            }
            apply((current) => applyLayoutDrop(current, source, action, POLICY));
        },
    });
});
const dragState = computed(() => drag.value?.session.state.value ?? null);

/** 第一幕演示画的拖影与落点：走产品的拖动反馈组件，只是位置由演示给。 */
const demoDrag = shallowRef<{readonly ghost: {readonly label: string; readonly icon: string}; readonly at: Point; readonly area: DOMRectReadOnly | null} | null>(null);
const dragGhost = computed(() => {
    if (demoDrag.value !== null) return demoDrag.value.ghost;
    const current = dragState.value;
    const tabId = current === null || current.source.kind !== "tab" ? null : editorTabIdOf(current.source.tab);
    return tabId === null ? null : (tabDrag.value?.ghost(tabId) ?? null);
});
const dropPreview = computed(() => {
    if (demoDrag.value !== null) return demoDrag.value.area === null ? null : {areaRect: dropRect(demoDrag.value.area), entryRect: null, indicator: null, orientation: "horizontal" as const};
    const drop = dragState.value?.drop ?? null;
    return drop === null ? null : {areaRect: drop.preview.areaRect, entryRect: null, indicator: drop.preview.indicator, orientation: drop.preview.orientation};
});

// ── 访客动手：只认真实的输入（演示不发事件） ──

function onVisitor(event: Event): void {
    if (event.isTrusted) emit("touch");
}

/** 双击编辑组的标签条空白处：最大化或还原这一组（同产品的外壳）。 */
function onHeadDoubleClick(panelId: string, event: MouseEvent): void {
    if ((event.target as Element | null)?.closest("[data-editor-tab], button") !== null) return;
    maximized.value = maximized.value === panelId ? null : panelId;
}

// ── 对外：开场动画量卡片，第一幕驱动布局 ──

function cardsIn(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>("[data-shell-card]")];
}

function paintOf(card: HTMLElement): DeskPlate["paint"] {
    const style = getComputedStyle(card);
    return {background: style.backgroundColor, radius: style.borderRadius, shadow: style.boxShadow};
}

/** 桌面底色（卡片之间露出来的那层，主题的 `--shell-ground`）：开场的替身用同一色。自定义属性的计算值已经代入了 `var()`。 */
function ground(): string {
    const root = host.value;
    if (root === null) return "transparent";
    const style = getComputedStyle(root);
    return style.getPropertyValue("--shell-ground").trim() || style.getPropertyValue("--bg-main").trim() || "transparent";
}

function plates(): DeskPlate[] {
    const root = host.value;
    if (root === null) return [];
    const origin = root.getBoundingClientRect();
    const local = (rect: DOMRect): DeskPlate["rect"] => ({left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height});
    const result: DeskPlate[] = cardsIn(root).flatMap((card): DeskPlate[] => {
        const id = card.dataset.shellCard ?? "";
        const rect = card.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return [];
        const role = doc.value.panels[id]?.role;
        return [{id, kind: id === "activitybar" ? "bar" : role === "editor" ? "editor" : "tool", rect: local(rect), paint: paintOf(card)}];
    });
    const status = root.querySelector<HTMLElement>("[data-hp-status]");
    if (status !== null) result.push({id: "statusbar", kind: "status", rect: local(status.getBoundingClientRect()), paint: {background: "transparent", radius: "0px", shadow: "none"}});
    return result;
}

/** 区域里所有卡片的外接矩形（视口坐标）：锚、入口条与分节合起来是一块。 */
function regionRect(region: PanelName): DOMRectReadOnly | null {
    const root = host.value;
    if (root === null) return null;
    const entries = new Set(doc.value.panels[region]?.entries ?? []);
    const ids = new Set([region, ...Object.entries(doc.value.panels).flatMap(([id, panel]) => (panel.container !== undefined && entries.has(panel.container) ? [id] : []))]);
    const rects = cardsIn(root).filter((card) => ids.has(card.dataset.shellCard ?? "")).map((card) => card.getBoundingClientRect()).filter((rect) => rect.width > 8 && rect.height > 8);
    if (rects.length === 0) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    return new DOMRectReadOnly(left, top, Math.max(...rects.map((rect) => rect.right)) - left, Math.max(...rects.map((rect) => rect.bottom)) - top);
}

/**
 * 浮窗落在哪（树区域坐标）。`tour`：编辑区偏右下，盖住第一章的一角，第二章那一栏还看得见。
 * `knock`：侧栏作品树下面的空处，两栏正文都不盖；侧栏量不到（收着）时退到编辑区左下。
 */
function floatLanding(): LayoutFloatRect {
    const width = extent.value?.width ?? 1000;
    const height = extent.value?.height ?? 640;
    if (props.setup === "tour") return {x: Math.round(width * 0.34), y: Math.round(height * 0.3), width: 300, height: 260};
    const tree = host.value?.querySelector<HTMLElement>("[data-workbench-surface]")?.getBoundingClientRect();
    const sidebar = regionRect("sidebar");
    const floatHeight = Math.min(320, Math.round(height * 0.46));
    if (tree === undefined || sidebar === null) return {x: 56, y: height - floatHeight - 40, width: 280, height: floatHeight};
    // 宽只比侧栏多一点点：再宽就压到第五章的左边距上了（第 4 轮的截图里压了几个像素）。
    return {x: Math.round(sidebar.left - tree.left + 6), y: Math.round(height - floatHeight - 24), width: Math.max(250, Math.round(sidebar.width + 12)), height: floatHeight};
}

function target(name: DeskTarget): DOMRectReadOnly | null {
    const root = host.value;
    if (root === null) return null;
    const rectOf = (selector: string): DOMRectReadOnly | null => root.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    switch (name) {
        case "chapter-one-tab":
            return rectOf(`[data-editor-tab="${CSS.escape(tabIdOf(OPEN_FILES.chapterOne) ?? "")}"]`);
        case "chapter-two-tab":
            return rectOf(`[data-editor-tab="${CSS.escape(tabIdOf(OPEN_FILES.chapterTwo) ?? "")}"]`);
        case "alice-tab":
            return rectOf(`[data-editor-tab="${CSS.escape(tabIdOf(OPEN_FILES.alice) ?? "")}"]`);
        case "first-editor":
            return rectOf(`[data-shell-card="${INITIAL_EDITOR_PANEL}"]`);
        case "first-editor-body": {
            // 编辑组标签条以下的部分：分栏的落点只盖正文，不盖标签条与工具栏。
            const card = rectOf(`[data-shell-card="${INITIAL_EDITOR_PANEL}"]`);
            const head = rectOf(`[data-surface-head="${INITIAL_EDITOR_PANEL}"]`);
            if (card === null) return null;
            const top = head === null ? card.top : head.bottom;
            return new DOMRectReadOnly(card.left, top, card.width, card.bottom - top);
        }
        case "editor-head-blank": {
            const head = rectOf(`[data-surface-head="${INITIAL_EDITOR_PANEL}"]`);
            return head === null ? null : new DOMRectReadOnly(head.right - 96, head.top, 64, head.height);
        }
        case "explorer-entry":
            return rectOf(`[data-tool-entry="${CSS.escape(implicitContainerOf("explorer"))}"]`);
        case "auxiliarybar":
            return regionRect("auxiliarybar");
        case "lyra":
            // 两轮的演示都不搬星璃，她一直在右栏。
            return regionRect("auxiliarybar");
        case "float-landing": {
            const tree = root.querySelector<HTMLElement>("[data-workbench-surface]")?.getBoundingClientRect();
            const rect = floatLanding();
            return tree === undefined ? null : new DOMRectReadOnly(tree.left + rect.x, tree.top + rect.y, rect.width, rect.height);
        }
    }
}

/** 第一步：把一份（缺省第二章）移到第一组右边，成为新的一组（同把标签拖到编辑组右缘放下）。 */
function splitRight(file: OpenFile = "chapterTwo"): boolean {
    const tabId = tabIdOf(OPEN_FILES[file]);
    if (tabId === null) return false;
    // 已经不在第一组（拆过了）：这一步的终态已经在了。
    if (area.groups.find(tabId)?.group.id !== INITIAL_EDITOR_PANEL) return true;
    const edge = edgeTargetOf(doc.value, INITIAL_EDITOR_PANEL, "right");
    return edge !== null && area.groups.moveToNewGroup(tabId, edge) !== null;
}

/** 第二步：作品这个容器整个搬到右栏，或搬回侧栏（输出 44：外框滑过去，视图不重建）。 */
function moveExplorer(region: PanelName): boolean {
    if (explorerRegion(doc.value) === region) return true;
    const moved = apply((current) => moveContainerTo(current, implicitContainerOf("explorer"), region, POLICY)).ok;
    if (moved) explorer.location.value = region;
    return moved;
}

/** 第三步：最大化某一块，null 还原。 */
function setMaximized(panel: string | null): void {
    maximized.value = panel;
}

/** 第四步：艾莉丝的设定拖成浮窗。 */
function floatAlice(): boolean {
    const tabId = tabIdOf(OPEN_FILES.alice);
    if (tabId === null) return false;
    const group = area.groups.find(tabId)?.group.id;
    if (doc.value.floats.some((float) => float.panel === group)) return true;
    return area.groups.moveToFloat(tabId, floatLanding()) !== null;
}

function showDrag(next: {readonly ghost: {readonly label: string; readonly icon: string}; readonly at: Point; readonly area: DOMRectReadOnly | null} | null): void {
    demoDrag.value = next;
    if (next !== null) void nextTick(() => feedback.value?.moveGhost(next.at));
}

function moveGhost(point: Point): void {
    feedback.value?.moveGhost(point);
}

/** 演示拿起的那个标签或入口（拖动时它变淡，同产品拖动中的来源）。 */
function sourceElement(name: DeskTarget): HTMLElement | null {
    const root = host.value;
    if (root === null) return null;
    const tabFile: Partial<Record<DeskTarget, string>> = {"chapter-one-tab": OPEN_FILES.chapterOne, "chapter-two-tab": OPEN_FILES.chapterTwo, "alice-tab": OPEN_FILES.alice};
    const file = tabFile[name];
    if (file !== undefined) return root.querySelector<HTMLElement>(`[data-editor-tab="${CSS.escape(tabIdOf(file) ?? "")}"]`);
    if (name === "explorer-entry") return root.querySelector<HTMLElement>(`[data-tool-entry="${CSS.escape(implicitContainerOf("explorer"))}"]`);
    return null;
}

/**
 * 让某一份文件到前面，并把光标放到它的末尾、聚焦（编辑器的“继续写作”，editor 输出 29）。控件是异步挂上的，刚换组时可能还没有句柄，
 * 这时返回 false，调用方过一会儿再试。
 */
function revealEnd(file: OpenFile): boolean {
    area.open(OPEN_FILES[file], {mode: "permanent"});
    const handle = area.activeHandle.value;
    if (handle?.revealEnd === undefined) return false;
    handle.revealEnd();
    return true;
}

/**
 * 在光标处打几个字。走浏览器的输入路径（`insertText`，和访客打字、输入法上屏一样），编辑器照常收到输入、记脏、能撤销；
 * 不绕过编辑器去改文件。焦点不在这台工作台的编辑器里时不打，返回 false。
 */
function type(text: string): boolean {
    return typing() && document.execCommand("insertText", false, text);
}

/** 焦点在不在这台工作台的编辑器里（`revealEnd` 之后编辑器可能还没准备好，聚焦没有落下）。 */
function typing(): boolean {
    const active = document.activeElement;
    return active instanceof HTMLElement && host.value?.contains(active) === true && active.isContentEditable;
}

/** 桌上的正文里有没有这句（演示据此判断某一拍打过没有）。 */
function shows(text: string): boolean {
    return host.value?.textContent?.includes(text) ?? false;
}

/**
 * 这句话在编辑器里占的几块矩形（视口坐标，折行时是几块）：第一幕把两章里的敲门同时描金。
 * 只找编辑器正文（`contenteditable`）里的、整句落在一个文本节点里的；找不到返回空数组。
 */
function textRects(text: string): DOMRect[] {
    const root = host.value;
    if (root === null) return [];
    const rects: DOMRect[] = [];
    for (const editor of root.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const at = node.textContent?.indexOf(text) ?? -1;
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + text.length);
            rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 1));
        }
    }
    return rects;
}

/** 往星璃的对话里加一条消息；`id` 已经有了就换掉那一条（边打边出的回复每次给新的文字）。 */
function lyraPost(message: MessageView): void {
    const messages = lyra.value.messages;
    const at = messages.findIndex((item) => item.id === message.id);
    lyra.value = {...lyra.value, messages: at < 0 ? [...messages, message] : messages.map((item, index) => (index === at ? message : item))};
}

function lyraHas(id: string): boolean {
    return lyra.value.messages.some((item) => item.id === id);
}

function snapshot(): DeskSnapshot {
    return {doc: doc.value, tabs: area.groups.snapshot(), maximized: maximized.value};
}

/** 关掉之前的样子：先存盘（打到一半的那句进文件），再连同正文与星璃的对话一起记下。 */
async function snapshotSaved(): Promise<DeskSnapshot> {
    await area.saveAll();
    const files = await Promise.all(PROJECT_FILES.map(async ([path, fallback]): Promise<readonly [string, string]> => {
        const read = await memory.files.read(`project://${path}`);
        return [path, read.ok ? read.value.text : fallback];
    }));
    return {...snapshot(), files, lyra: lyra.value.messages};
}

/** 换回记下的某一份布局（第一幕往回滚时）：标签一个没关，只是换了位置，编辑器的记录照旧对得上。 */
function applyDoc(next: DeskSnapshot): void {
    maximized.value = next.maximized;
    doc.value = next.doc;
    explorer.location.value = explorerRegion(next.doc);
}

defineExpose({plates, ground, target, sourceElement, splitRight, moveExplorer, setMaximized, floatAlice, showDrag, moveGhost, revealEnd, type, typing, shows, textRects, lyraPost, lyraHas, snapshot, snapshotSaved, applyDoc});

// 第一次排好版（量到尺寸、卡片有了）再告诉页面，开场动画照它摆。
const stopReady = watch(presented, (sizes) => {
    if (Object.keys(sizes).length === 0) return;
    void nextTick(() => {
        emit("ready");
        stopReady();
    });
});

onBeforeUnmount(() => {
    drag.value?.dispose();
    explorer.dispose();
    area.dispose();
    memory.dispose();
});
</script>

<template>
    <!-- 只认按下与按键：滚轮不算动手，第一幕里鼠标停在工作台上滚页面是常事。 -->
    <div ref="host" class="hp-desk" :class="{'hp-desk--night': night}" @pointerdown.capture="onVisitor" @keydown.capture="onVisitor">
        <WorkbenchSurface
            ref="surface"
            class="hp-desk__surface"
            :doc="doc"
            :projection="projection"
            :floats="floats"
            :maximized="maximized"
            :title-only-panels="titleOnly"
            context-key="homepage"
            @extent="(next) => (extent = next)"
            @card-gap="(gap) => (cardGap = gap)"
            @presented="(sizes) => (presented = sizes)"
            @preview="(sizes) => (preview = sizes)"
            @gesture-commit="commitGesture"
            @focus-panel="(panel) => (focusedPanel = panel)"
        >
            <template #activitybar>
                <WorkbenchToolStrip label="活动栏" more-label="更多" :entries="activityEntries" :items="STRIP_ITEMS" @select="(id: string) => selectRegionEntry('sidebar', id)" />
            </template>
            <template #statusbar>
                <div class="hp-desk__status" data-hp-status>
                    <span class="i-lucide-book-open hp-desk__status-icon" aria-hidden="true"></span>
                    <span>{{ BOOK_TITLE }}</span>
                    <span class="hp-desk__status-end">
                        <span class="i-lucide-hard-drive hp-desk__status-icon" aria-hidden="true"></span>
                        存在本机
                    </span>
                </div>
            </template>
            <template #empty-region>
                <div class="hp-desk__empty">把视图拖到这里</div>
            </template>
            <template #head="{panelId, idPrefix}">
                <div v-if="doc.panels[panelId]?.role === 'editor'" class="hp-desk__editor-head" @dblclick="onHeadDoubleClick(panelId, $event)">
                    <EditorGroupHead :area="area" :group-id="panelId" :wrap-tabs="false" @intent="onIntent" />
                </div>
                <WorkbenchPanelHead v-else v-bind="headProps(panelId, idPrefix)" v-on="HEAD_EVENTS" />
            </template>
            <template #strip="{region, merged, idPrefix}">
                <WorkbenchRegionStrip
                    :region="region"
                    :label="region === 'panel' ? '底部面板' : '右栏'"
                    more-label="更多"
                    :entries="stripEntries(region)"
                    :variant="region === 'panel' ? 'titles' : 'icons'"
                    :head-min-width="merged === null ? 0 : 160"
                    @select="(id: string) => selectRegionEntry(region, id)"
                >
                    <WorkbenchPanelHead v-if="merged !== null" :key="merged" v-bind="headProps(merged, idPrefix)" :title-in-entry="region === 'panel'" v-on="HEAD_EVENTS" />
                </WorkbenchRegionStrip>
            </template>
            <template #content="{contentKey, panelId}">
                <EditorGroup v-if="doc.panels[panelId]?.role === 'editor'" :area="area" :group-id="panelId" :tab-id="editorTabIdOf(contentKey)" :control="control" :empty-tips="[]" @intent="onIntent" />
                <component :is="explorer.Host" v-else-if="contentKey === 'view:explorer'" :context="explorer.context" class="h-full w-full" />
                <AgentConversationView
                    v-else-if="contentKey === 'view:lyra'"
                    v-model:view-mode="lyraMode"
                    class="h-full w-full"
                    :ctx="lyra"
                    :services="lyraServices"
                    :registry="lyraRegistry"
                    :renderers="labAgentRenderers"
                    :teleport-target="false"
                    :status-bar="false"
                    locale="zh-CN"
                />
                <div v-else-if="contentKey === 'view:canon'" class="hp-desk__canon">
                    <section v-for="group in CANON_GROUPS" :key="group.kind" class="hp-desk__canon-group">
                        <h3 class="hp-desk__canon-kind">{{ group.kind }}</h3>
                        <ul>
                            <li v-for="name in group.names" :key="name" class="hp-desk__canon-item">
                                <span :class="group.icon" class="hp-desk__canon-icon" aria-hidden="true"></span>{{ name }}
                            </li>
                        </ul>
                    </section>
                </div>
                <div v-else class="hp-desk__empty">还没有内容</div>
            </template>
        </WorkbenchSurface>
        <EditorHost :area="area" :wrap-tabs="false" :attach-tab-drag="(next: EditorTabDrag | null) => (tabDrag = next)" />
        <WorkbenchDragFeedback ref="feedback" :ghost="dragGhost" :preview="dropPreview" label="" :kind="dragState?.drop?.action.kind ?? ''" :sectors="dragState?.drop?.sectors ?? null" />
    </div>
</template>

<style scoped>
/*
 * 产品的“昼”配色，强调色换成品牌的赤红。下面几项在根上由配色派生（自定义属性在声明处求值），只改强调色不会跟着变，所以连派生的一起写。
 * 落点高亮的覆盖层传送到 body，不在这里继承：它的金色由页面在根上写（`HomepageDraft.vue`）。
 */
.hp-desk {
    --accent-main: #871222;
    --accent-bg: rgb(135 18 34 / 0.08);
    --accent-text: #871222;
    --border-accent: color-mix(in srgb, #871222 40%, #ddd7cc);
    --selection-bg: rgb(168 118 47 / 0.24);
    --focus-ring: 0 0 0 1px rgb(135 18 34 / 0.35), 0 0 0 3.5px rgb(135 18 34 / 0.14);
    --focus-outline: rgb(135 18 34 / 0.7);
    position: relative;
    width: 100%;
    height: 100%;
}

/* 夜间：强调色换成品牌的金（暗底上赤红太闷），派生的几项一起写，理由同上。 */
.hp-desk--night {
    --accent-main: #e1b285;
    --accent-bg: rgb(225 178 133 / 0.14);
    --accent-text: #f0c987;
    --border-accent: color-mix(in srgb, #e1b285 45%, #3e3933);
    --selection-bg: rgb(225 178 133 / 0.28);
    --focus-ring: 0 0 0 1px rgb(225 178 133 / 0.45), 0 0 0 3.5px rgb(225 178 133 / 0.16);
    --focus-outline: rgb(240 201 135 / 0.8);
}

.hp-desk__surface {
    width: 100%;
    height: 100%;
}

.hp-desk__status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 100%;
    padding-inline: var(--space-5);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.hp-desk__status-end {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-start: auto;
}

.hp-desk__status-icon {
    width: 1.1em;
    height: 1.1em;
}

.hp-desk__editor-head {
    display: contents;
}

.hp-desk__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.hp-desk__canon {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-5) var(--space-6);
    overflow: auto;
    height: 100%;
}

.hp-desk__canon-kind {
    margin-block-end: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
}

.hp-desk__canon-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 30px;
    color: var(--text-main);
    font-size: var(--text-sm);
}

.hp-desk__canon-icon {
    width: 1.05em;
    height: 1.05em;
    color: var(--text-secondary);
}
</style>
