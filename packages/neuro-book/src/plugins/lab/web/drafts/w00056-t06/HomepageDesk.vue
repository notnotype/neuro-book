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
import {FloatWindowHandles} from "@notnotype/nb-layout/vue";
import type {TextParams} from "@notnotype/nb-ui/text";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {activateTab, applyGestureCommit, applyLayoutDrop, edgeTargetOf, presentationCollapse, projectLayoutDoc, rebaseForOperation, sameTreeShape, setActiveContainer, setFloatRect, setPanelHidden, tabKey} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, LayoutFloatRect, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";
import {computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch} from "vue";
import type {Component} from "vue";

import {agentCatalogs} from "nbook/plugins/agent/web/text";
import {CODE_EDITOR, EDITING_ACTIONS, editorMenusKey, MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
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
import {workbenchText} from "nbook/plugins/workbench/shared/text";
import type {WorkbenchTextKey} from "nbook/plugins/workbench/shared/text";
import WorkbenchDragFeedback from "nbook/plugins/workbench/web/components/WorkbenchDragFeedback.vue";
import WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type {PanelHeadTab} from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import WorkbenchRegionStrip from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {EditorTabDrag} from "nbook/plugins/workbench/web/contracts";
import {presentDrag} from "nbook/plugins/workbench/web/drag-presentation";
import {applyEntryDrop, isEntryAction} from "nbook/plugins/workbench/web/entry-drop";
import type {WorkbenchDragSource} from "nbook/plugins/workbench/web/entry-drop";
import {createLayoutDrag} from "nbook/plugins/workbench/web/layout-drag";
import type {LayoutDrag, LayoutDragDrop} from "nbook/plugins/workbench/web/layout-drag";
import {implicitContainerOf, moveContainerTo, settleContainers} from "nbook/plugins/workbench/web/state/containers";
import {defaultLayoutDoc, fitsSkeleton, INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import {collapseOrder, createLayoutPolicy, EDITOR_GROUP_MINIMUM, keepVisible, layoutProjectionOptions} from "nbook/plugins/workbench/web/state/layout-constraints";
import {effectiveVisibleTabs, regionEntries, regionEntryIntent, regionVisible, titleOnlyPanels} from "nbook/plugins/workbench/web/state/layout-present";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {useLabEventSink} from "../../lab-event-sink";
import {createLabEditorMenus} from "../../fixtures/editor-scene/lab-editor-menus";
import {createMemoryFiles} from "../../fixtures/explorer-scene/memory-files";
import {labStickers} from "../../fixtures/lab-stickers";
import {labAgentRegistry, labAgentRenderers, labAgentServices, provideLabMarkdown} from "../../fixtures/nb-agent-ui/host";
// 星璃的头像是 bots 插件的内置素材；插件之间不直接引对方 web、shared 以外的文件（architecture.test.ts 的依赖方向），这里用一份副本。
import LYRA_AVATAR from "./assets/lyra-avatar.webp";
import {createDemoPointer} from "./demo-pointer";
import type {DemoPointer} from "./demo-pointer";
import type {DeskPlate, DeskSetup, DeskSnapshot, DeskTarget} from "./desk";
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
/** 约束按面板所在的区域取，区域要从被投影的那份文档里问：实时布局的预览另算一份（同产品的布局 store）。 */
const optionsFor = (of: LayoutDoc) => layoutProjectionOptions({doc: of, catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value, removed: collapse.value.removed, squeezed: collapse.value.squeezed});
const projectionOptions = computed(() => optionsFor(doc.value));
const projection = computed(() => projectLayoutDoc(doc.value, projectionOptions.value));
/**
 * 实时布局的预览（docs/specs/ui/workbench-layout.md 的“实时布局”）：拖动中只给渲染用的一份文档，判定、提交与可见性都还看已提交的 `doc`。
 * 同产品的布局 store：预览期间不收表面发来的呈现尺寸，预览才有的节点不能混进下一次提交的意图。
 */
const livePreview = shallowRef<LayoutDoc | null>(null);
const renderedDoc = computed(() => livePreview.value ?? doc.value);
const renderedProjection = computed(() => (livePreview.value === null ? projection.value : projectLayoutDoc(livePreview.value, optionsFor(livePreview.value))));
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

function acceptPresented(sizes: Readonly<Record<string, GridExtent>>): void {
    if (livePreview.value !== null) return;
    presented.value = sizes;
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
    return (renderedDoc.value.panels[panelId]?.tabs ?? []).map((tab) => {
        const view = viewOf(tabKey(tab));
        return {id: tabKey(tab), label: view?.label ?? tabKey(tab), icon: view?.icon ?? "i-lucide-square"};
    });
}

function headProps(panelId: string, idPrefix: string): InstanceType<typeof WorkbenchPanelHead>["$props"] {
    return {panelId, label: renderedDoc.value.panels[panelId]?.name ?? panelId, tabs: headTabs(panelId), active: renderedDoc.value.panels[panelId]?.active ?? null, moreLabel: "更多", idPrefix, titleOnly: titleOnly.value.has(panelId), frameActions: [], viewHead: null, fold: null};
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
const floatPreview = shallowRef<{readonly panel: string; readonly rect: LayoutFloatRect; readonly gesture: "move" | "resize"} | null>(null);
/** 画出来的浮动窗（相对树区域）：拖着、缩放中的那扇按预览画并标上手势（表面据此不给它过渡）；同产品 store 的 `renderedFloats`。 */
const floats = computed(() => renderedDoc.value.floats.map(({panel, rect}) => {
    const shown = floatPreview.value?.panel === panel ? floatPreview.value : null;
    return {id: panel, rect: keepVisible(shown?.rect ?? rect, extent.value), ...(shown === null ? {} : {gesture: shown.gesture})};
}));
const floatMaximum = computed(() => ({width: extent.value?.width ?? 0, height: extent.value?.height ?? 0}));
/** 窗角缩放中（`FloatWindowHandles` 的 `preview`）；null 是撤下。 */
function previewFloat(panel: string | null, rect: LayoutFloatRect | null): void {
    floatPreview.value = panel === null || rect === null ? null : {panel, rect, gesture: "resize"};
}
function commitFloat(panel: string, rect: LayoutFloatRect): void {
    apply((current) => setFloatRect(current, {panel, rect}));
}
function moveFloatTo(panel: string, position: {readonly x: number; readonly y: number}): void {
    apply((current) => {
        const rect = current.floats.find((float) => float.panel === panel)?.rect;
        return rect === undefined ? {ok: false, code: "not-found", message: `No float ${panel}`} : setFloatRect(current, {panel, rect: {...rect, ...position}});
    });
}
const tabDrag = shallowRef<EditorTabDrag | null>(null);
const drag = shallowRef<LayoutDrag | null>(null);
const feedback = useTemplateRef<InstanceType<typeof WorkbenchDragFeedback>>("feedback");
const surface = useTemplateRef<InstanceType<typeof WorkbenchSurface>>("surface");
/** 第一幕的演示指针（`demo-pointer.ts`）：挂上以后才有根元素。 */
const demoPointer = shallowRef<DemoPointer | null>(null);

onMounted(() => {
    demoPointer.value = createDemoPointer(host.value!);
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
        titleOnly: (panel) => titleOnly.value.has(panel),
        ownHead: () => false,
        // 不画落点分区（上下左右中那一盘，第 7 轮开发者不要）：实时布局本来就不画；拖入口这类走落点指示的，也只留落点的框。
        sectors: () => false,
        // 实时布局（产品的缺省手感）：拖着走时布局一路跟着排，松手时卡片落进空位。
        feel: () => "live",
        cardShrink: () => "strip",
        cardRefresh: () => "display",
        grid: () => surface.value,
        showPreview: (next) => {
            livePreview.value = next !== null && fitsSkeleton(next) ? next : null;
        },
        moveGhost: (point) => feedback.value?.moveGhost(point),
        floats: () => floats.value,
        markFloatMove: (panel, rect) => {
            floatPreview.value = panel === null || rect === undefined ? null : {panel, rect, gesture: "move"};
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
// ── 拖动中画什么：同产品的外壳（`WorkbenchShell.vue` 的 `dragView`），只在这里取，模板读拆开的几样 ──

const dragSource = computed(() => drag.value?.session.state.value?.source ?? null);
const dragDrop = computed(() => drag.value?.session.state.value?.drop ?? null);
const dragView = computed(() => presentDrag({
    live: drag.value?.live.active.value === true,
    source: dragSource.value,
    drop: dragDrop.value,
    lifted: drag.value?.live.card.value != null,
    shownAction: drag.value?.live.shownAction.value ?? null,
    rendered: renderedDoc.value,
    rejected: drag.value?.rejected.value === true,
}));
const liftedCard = computed(() => drag.value?.live.card.value ?? null);
const dragSlotPanel = computed(() => dragView.value.slotPanel);
const mergeTarget = computed(() => dragView.value.mergeTarget);

const message = (key: WorkbenchTextKey, params?: TextParams): string => text.t(workbenchText(key, params));

/** 落点的文字，同外壳的 `dropLabel`。 */
function dropLabel(drop: LayoutDragDrop): string {
    if (drop.inPlace) return message("shell.drop.inPlace");
    const {action} = drop;
    if (action.kind === "new-container") return message("shell.drop.newContainer");
    if (action.kind === "move-entry" || action.kind === "move-container" || action.kind === "strip") return message("shell.drop.insert");
    if (action.kind === "join-container") {
        const entry = [...activityEntries.value, ...stripEntries("auxiliarybar"), ...stripEntries("panel")].find((item) => item.id === action.container);
        return message("shell.drop.joinContainer", {part: entry?.label ?? action.container});
    }
    if (action.kind === "center") return message("shell.drop.addTab");
    if (action.kind === "float") return message("shell.drop.float");
    if (action.container !== undefined) return message("shell.drop.insert");
    return message(action.target.kind === "between" ? "shell.drop.between" : "shell.drop.split");
}
const feedbackLabel = computed(() => {
    const {label} = dragView.value.feedback;
    return label === null ? "" : dropLabel(label);
});
/** 读屏与卡片头的落点文字。 */
const liveLabel = computed(() => {
    const {announce} = dragView.value.feedback;
    return announce === null ? "" : announce === "rejected" ? message("shell.drop.rejected") : dropLabel(announce);
});
const sectorLabels = computed(() => ({
    left: message("shell.drop.sector.left"),
    right: message("shell.drop.sector.right"),
    top: message("shell.drop.sector.top"),
    bottom: message("shell.drop.sector.bottom"),
    whole: message("shell.drop.insert"),
    center: message("shell.drop.addTab"),
}));

/** 拿起的是什么（拖影与卡片头）：整窗在跟手，没有拖影。 */
function ghostOf(source: WorkbenchDragSource): {readonly label: string; readonly icon?: string} | null {
    if (source.kind === "panel") return null;
    if (source.kind === "container") {
        const entry = [...activityEntries.value, ...stripEntries("auxiliarybar"), ...stripEntries("panel")].find((item) => item.id === source.container);
        return entry === undefined ? null : {label: entry.label, ...(typeof entry.icon === "string" ? {icon: entry.icon} : {})};
    }
    const editorTab = editorTabIdOf(source.tab);
    if (editorTab !== null) return tabDrag.value?.ghost(editorTab) ?? null;
    const view = viewOf(source.tab);
    return view === undefined ? null : {label: view.label, icon: view.icon};
}
const cardTitle = computed(() => (dragSource.value === null ? null : ghostOf(dragSource.value)));
const dragGhost = computed(() => (dragView.value.ghost ? cardTitle.value : null));
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
        case "first-editor-head":
            // 第一组的标签条（专心写那一拍双击它之前，聚光照亮这一条）。
            return rectOf(`[data-surface-head="${INITIAL_EDITOR_PANEL}"]`);
        case "alice-float": {
            const group = aliceFloat();
            return group === null ? null : rectOf(`[data-shell-card="${CSS.escape(group)}"]`);
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
        case "statusbar":
            return rectOf("[data-hp-status]");
        case "auxiliary-rail": {
            // 右轨上入口那一段（入口带以外是拒收区，w00043 t19）：落点取最后一个入口的下面，作品排在星璃后面。
            // 只认右栏的右轨：退到别的条（底部面板的入口条）上，演示会把作品树拖进底部面板。
            const band = rectOf('[data-rail="auxiliarybar"] [data-tool-band]');
            const frames = [...root.querySelectorAll<HTMLElement>('[data-rail="auxiliarybar"] [data-entry-frame]')];
            const last = frames.at(-1)?.getBoundingClientRect() ?? null;
            if (band === null) return null;
            const top = last === null ? band.top : Math.min(band.bottom - 8, last.bottom + 2);
            return new DOMRectReadOnly(band.left, top, band.width, Math.max(12, Math.min(last?.height ?? 28, band.bottom - top)));
        }
        case "alice-float-corner": {
            const group = aliceFloat();
            if (group === null) return null;
            const corner = rectOf(`[data-shell-card="${CSS.escape(group)}"] [data-float-handle="top-right"]`);
            if (corner !== null) return corner;
            // 手柄在窗口零件层里，不一定在卡片的子树下：按窗的矩形取右上角。
            const card = rectOf(`[data-shell-card="${CSS.escape(group)}"]`);
            return card === null ? null : new DOMRectReadOnly(card.right - 5, card.top, 4, 4);
        }
    }
}

/** 艾莉丝那扇浮动窗的面板 id；还没浮出来时为 null。 */
function aliceFloat(): string | null {
    const tabId = tabIdOf(OPEN_FILES.alice);
    const group = tabId === null ? undefined : area.groups.find(tabId)?.group.id;
    return group !== undefined && doc.value.floats.some((float) => float.panel === group) ? group : null;
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

/** 第二幕开场：收起或放回右栏（星璃那一栏），正文跟着展宽或收回；走产品的布局动画（workbench-layout 输出 42）。 */
function setAuxiliaryHidden(hidden: boolean): boolean {
    return apply((current) => setPanelHidden(settleContainers(current), "auxiliarybar", hidden)).ok;
}

/** 第三步：最大化某一块，null 还原。 */
function setMaximized(panel: string | null): void {
    maximized.value = panel;
}

function isMaximized(): boolean {
    return maximized.value !== null;
}

/** 第四步：艾莉丝的设定拖成浮窗。 */
function floatAlice(): boolean {
    const tabId = tabIdOf(OPEN_FILES.alice);
    if (tabId === null) return false;
    const group = area.groups.find(tabId)?.group.id;
    if (doc.value.floats.some((float) => float.panel === group)) return true;
    return area.groups.moveToFloat(tabId, floatLanding()) !== null;
}

/**
 * 让某一份文件到前面，并把光标放到它的末尾、聚焦（编辑器的“继续写作”，editor 输出 29）。控件是异步挂上的，刚换组时可能还没有句柄，
 * 这时返回 false，调用方过一会儿再试。
 */
/**
 * 让这份文件到前面：已经开着就在它所在的组里切过去，没开着才在活动组里开一份。
 * 不能直接 `area.open`：它开在活动组里，文件在别的组时会在活动组再开一份（第 7 轮跳着摆两拍时，两组都成了第五章）。
 */
function bring(file: OpenFile): void {
    const tabId = tabIdOf(OPEN_FILES[file]);
    if (tabId === null || !area.activate(tabId).ok) area.open(OPEN_FILES[file], {mode: "permanent"});
}

function revealEnd(file: OpenFile): boolean {
    bring(file);
    const handle = area.activeHandle.value;
    if (handle?.revealEnd === undefined) return false;
    handle.revealEnd();
    return true;
}

/**
 * 在光标处打几个字。走浏览器的输入路径（`insertText`，和访客打字、输入法上屏一样），编辑器照常收到输入、记脏、能撤销；
 * 不绕过编辑器去改文件。焦点不在这台工作台的编辑器里时不打，返回 false。`field` 时打进焦点所在的批注输入框（它传送在 body 下）。
 */
function type(text: string, where: "editor" | "field" = "editor"): boolean {
    const ready = where === "editor" ? typing() : document.activeElement?.closest("[data-markdown-comment-card]") != null;
    return ready && document.execCommand("insertText", false, text);
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

// ── 编辑器的高亮与批注：第一幕“划出来，记一笔” ──

/** 正文里这句话的位置（整句落在一个文本节点里的第一处）与它所在的编辑器。 */
function findText(text: string): {readonly editor: HTMLElement; readonly node: Text; readonly at: number} | null {
    const root = host.value;
    if (root === null) return null;
    for (const editor of root.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            const at = node.textContent?.indexOf(text) ?? -1;
            if (at >= 0 && node instanceof Text) return {editor, node, at};
        }
    }
    return null;
}

/**
 * 选中这句的前 `share`（0 到 1）：先让它所在的编辑器拿到焦点，再用 DOM 选区框住，ProseMirror 跟着 `selectionchange` 改自己的选区。
 * 演示的指针扫过去时一帧一帧加长，和访客拖选一样。返回选区末端那一行的矩形（指针停在那里）；这句不在桌上时返回 null。
 */
function selectText(text: string, share = 1): DOMRect | null {
    const found = findText(text);
    if (found === null) return null;
    if (document.activeElement !== found.editor) found.editor.focus({preventScroll: true});
    const end = found.at + Math.max(1, Math.round(text.length * Math.min(1, Math.max(0, share))));
    document.getSelection()?.setBaseAndExtent(found.node, found.at, found.node, end);
    // 浏览器的 selectionchange 要等下一个任务才派发，ProseMirror 靠它把 DOM 选区读进自己的状态；这里补发一个，
    // 让紧接着执行的编辑动作拿到的就是这段选区（不补的话高亮落在旧的空选区上，什么都没涂）。
    document.dispatchEvent(new Event("selectionchange"));
    const range = document.createRange();
    range.setStart(found.node, Math.max(found.at, end - 1));
    range.setEnd(found.node, end);
    return [...range.getClientRects()].at(-1) ?? null;
}

/** 选完了：选区菜单按指针松开判断“选完了”（拖选中不出），演示在扫完以后补一个松开。 */
function finishSelection(): void {
    window.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerId: 7077, pointerType: "mouse", isPrimary: true, button: 0, buttons: 0}));
}

/** 选区菜单上的按钮（菜单传送在 body 下，不在这台工作台里）：高亮是颜色拆分按钮的主按钮。菜单没出时返回 null。 */
function menuButton(kind: "highlight" | "comment"): DOMRectReadOnly | null {
    const menu = document.querySelector<HTMLElement>("[data-markdown-selection-menu]");
    if (menu === null) return null;
    const button = kind === "highlight"
        ? menu.querySelector<HTMLElement>(".markdown-color-button:has(.markdown-color-button__bar--light) .markdown-color-button__main button")
        : (menu.querySelector<HTMLElement>(`.${CSS.escape(EDITING_ACTIONS.comment.icon)}`)?.closest("button") ?? null);
    const rect = button?.getBoundingClientRect() ?? null;
    return rect === null || rect.width < 2 ? null : rect;
}

/** 写着的批注卡片里的保存按钮；卡片没开时返回 null。 */
function commentSave(): DOMRectReadOnly | null {
    const card = document.querySelector<HTMLElement>('[data-markdown-comment-card][data-mode="write"]');
    const icon = card?.querySelector<HTMLElement>(".i-lucide-check");
    const rect = icon?.closest("button")?.getBoundingClientRect() ?? null;
    return rect === null || rect.width < 2 ? null : rect;
}

/**
 * 收起选区（光标留在末尾）：涂完高亮让人看见涂上的颜色，选区菜单跟着收起。和 `selectText` 一样补发 selectionchange，
 * 让编辑器此刻就把自己的选区也收起来：不补的话，换到另一份正文以后这一份的选区还是一段，下一次指针松开（演示的拖动）
 * 选区菜单又在它上面出来（第 7 轮跳着摆两拍时看到的）。
 */
function collapseSelection(): void {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0 || host.value?.contains(selection.anchorNode) !== true) return;
    selection.collapseToEnd();
    document.dispatchEvent(new Event("selectionchange"));
}

/** 写着的批注卡片里的输入框拿到焦点（卡片打开时自己会聚焦；演示打字前再确认一次）。 */
function focusCommentField(): boolean {
    const field = document.querySelector<HTMLTextAreaElement>('[data-markdown-comment-card][data-mode="write"] textarea');
    if (field === null) return false;
    if (document.activeElement !== field) field.focus({preventScroll: true});
    return document.activeElement === field;
}

/** 批注末尾的小符号（页边没画时才有）：点它打开这条批注的卡片。 */
function commentMarker(): DOMRectReadOnly | null {
    const rect = host.value?.querySelector<HTMLElement>("[data-comment-marker]")?.getBoundingClientRect() ?? null;
    return rect === null || rect.width < 1 ? null : rect;
}

/** 这句（开头几个字）在不在高亮或批注里：演示点完菜单后核对一下，没点上就直接执行同一个编辑动作。 */
function marked(text: string, kind: "highlight" | "comment"): boolean {
    const head = text.slice(0, 4);
    // 高亮画成 `<mark>`，批注画成 `<comment>`（nb-markdown 的两个标记各自的 `renderHTML`）。
    const selector = kind === "highlight" ? "mark" : "comment";
    return [...(host.value?.querySelectorAll<HTMLElement>(selector) ?? [])].some((element) => element.textContent?.includes(head) === true);
}

/**
 * 不演、直接给这句涂高亮或加批注（快进与少动效时）：同一个编辑动作，只是不经菜单。先让这份文件到前面（编辑动作作用在活动的那一份上），
 * 再选中这句。返回这句此刻是不是真的涂上了（或加上了批注）：控件刚挂上、这句还没画出来时是 false，调用方过一会儿再试。
 */
function markNow(file: OpenFile, text: string, mark: {readonly kind: "highlight"; readonly color: string} | {readonly kind: "comment"; readonly body: string}): boolean {
    if (marked(text, mark.kind)) return true;
    bring(file);
    if (selectText(text) === null) return false;
    const editing = area.activeHandle.value?.editing;
    if (editing === undefined) return false;
    if (mark.kind === "highlight") editing.run("highlight", {color: mark.color});
    else editing.run("comment", {text: mark.body});
    collapseSelection();
    return marked(text, mark.kind);
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

/** 换回记下的某一份布局：标签一个没关，只是换了位置，编辑器的记录照旧对得上。布局的变化走产品的布局动画。 */
function applyDoc(next: DeskSnapshot): void {
    drag.value?.session.abort();
    livePreview.value = null;
    floatPreview.value = null;
    maximized.value = next.maximized;
    doc.value = next.doc;
    explorer.location.value = explorerRegion(next.doc);
    if (next.lyra !== undefined) lyra.value = {...lyra.value, messages: next.lyra};
}

/**
 * 摆回记下的样子，能就地摆就就地摆（布局动画从此刻的样子走回去），返回是否摆成了。就地摆的条件：打开的标签还是那几个
 * （编辑器的组与标签在布局文档里，换文档就换回来了），各文件存盘后的正文与记下的一样（访客打过字、演示打到一半时不一样，
 * 那要重新挂一台）。先存盘再比：没存的输入也算正文。
 */
async function restoreTo(next: DeskSnapshot): Promise<boolean> {
    await area.saveAll();
    const open = new Set(area.groups.attributes.value.keys());
    const wanted = new Set(Object.keys(next.tabs.tabs));
    if (open.size !== wanted.size || [...open].some((id) => !wanted.has(id))) return false;
    for (const [path, wantedText] of next.files ?? PROJECT_FILES) {
        const read = await memory.files.read(`project://${path}`);
        if (!read.ok || read.value.text !== wantedText) return false;
    }
    applyDoc(next);
    return true;
}

defineExpose({plates, ground, target, pointer: () => demoPointer.value, splitRight, moveExplorer, setAuxiliaryHidden, setMaximized, isMaximized, floatAlice, revealEnd, type, typing, shows, textRects, selectText, finishSelection, collapseSelection, menuButton, commentSave, focusCommentField, commentMarker, marked, markNow, lyraPost, lyraHas, snapshot, snapshotSaved, applyDoc, restoreTo});

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
    <!-- data-hp-preview：实时布局此刻按哪个候选预览（探针读：演示拖动的路上不该先排成别的样子）。 -->
    <div ref="host" class="hp-desk" :class="{'hp-desk--night': night}" :data-hp-preview="drag?.live.previewKey.value ?? 'none'" @pointerdown.capture="onVisitor" @keydown.capture="onVisitor">
        <WorkbenchSurface
            ref="surface"
            class="hp-desk__surface"
            :doc="renderedDoc"
            :projection="renderedProjection"
            :lifted="liftedCard"
            :dragging="dragSource !== null"
            :slot-panel="dragSlotPanel"
            :floats="floats"
            :maximized="maximized"
            :title-only-panels="titleOnly"
            :data-drag-feel="drag?.live.active.value === true ? 'live' : 'indicator'"
            context-key="homepage"
            @extent="(next) => (extent = next)"
            @card-gap="(gap) => (cardGap = gap)"
            @presented="acceptPresented"
            @preview="(sizes) => (preview = sizes)"
            @gesture-commit="commitGesture"
            @focus-panel="(panel) => (focusedPanel = panel)"
        >
            <template #activitybar="{joined}">
                <WorkbenchToolStrip label="活动栏" more-label="更多" :joined="joined" :entries="activityEntries" :items="STRIP_ITEMS" @select="(id: string) => selectRegionEntry('sidebar', id)" />
            </template>
            <!-- 右轨（workbench-layout 输出 50，w00043 t19）：右栏的容器入口，和活动栏同一个组件。第一幕“视图换位”把作品的入口拖到这里。 -->
            <template #rail="{joined}">
                <WorkbenchToolStrip label="右栏的侧轨" more-label="更多" region="auxiliarybar" :joined="joined" :entries="stripEntries('auxiliarybar')" @select="(id: string) => selectRegionEntry('auxiliarybar', id)" />
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
                <div v-if="renderedDoc.panels[panelId]?.role === 'editor'" class="hp-desk__editor-head" @dblclick="onHeadDoubleClick(panelId, $event)">
                    <EditorGroupHead :area="area" :group-id="panelId" :wrap-tabs="false" :dragging-tab="dragView.placeholder" @intent="onIntent" />
                </div>
                <WorkbenchPanelHead v-else v-bind="headProps(panelId, idPrefix)" v-on="HEAD_EVENTS" />
            </template>
            <template #strip="{region, merged, idPrefix}">
                <WorkbenchRegionStrip
                    :region="region"
                    :label="region === 'panel' ? '底部面板' : '右栏'"
                    more-label="更多"
                    :entries="stripEntries(region)"
                    :head-min-width="merged === null ? 0 : 160"
                    @select="(id: string) => selectRegionEntry(region, id)"
                >
                    <WorkbenchPanelHead v-if="merged !== null" :key="merged" v-bind="headProps(merged, idPrefix)" :title-in-entry="region === 'panel'" v-on="HEAD_EVENTS" />
                </WorkbenchRegionStrip>
            </template>
            <template #content="{contentKey, panelId}">
                <EditorGroup v-if="renderedDoc.panels[panelId]?.role === 'editor'" :area="area" :group-id="panelId" :tab-id="editorTabIdOf(contentKey)" :control="control" :empty-tips="[]" @intent="onIntent" />
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
            <!-- 跟手的卡片的头，同产品外壳：拿起的是什么，右边是落点的文字。 -->
            <template #lifted-head>
                <div class="hp-desk__card-head" data-drag-card-head>
                    <template v-if="cardTitle !== null">
                        <span v-if="cardTitle.icon !== undefined" class="hp-desk__card-icon" :class="cardTitle.icon" aria-hidden="true"></span>
                        <span class="hp-desk__card-title">{{ cardTitle.label }}</span>
                    </template>
                    <span class="hp-desk__card-hint" data-drag-card-hint aria-hidden="true">{{ liveLabel }}</span>
                </div>
            </template>
            <!-- 插槽始终传，条件写在里面（同外壳：条件插槽编译成动态插槽，每渲一次表面都要跟着更新）。 -->
            <template #overlay>
                <template v-if="drag?.live.active.value === true">
                    <div v-if="drag.live.slot.value !== null" class="hp-desk__slot" data-live-slot :style="slotStyle"></div>
                    <div v-if="mergeRect !== null" :key="mergeTarget ?? ''" class="hp-desk__merge" data-live-merge :style="mergeStyle"></div>
                </template>
            </template>
            <template #float-chrome="{id, rect}">
                <FloatWindowHandles
                    :rect="rect"
                    :min="EDITOR_GROUP_MINIMUM"
                    :max="floatMaximum"
                    move-icon-class="i-lucide-grip-horizontal"
                    @preview="(next) => previewFloat(next === null ? null : id, next)"
                    @commit="(next) => commitFloat(id, next)"
                    @move="(position) => moveFloatTo(id, position)"
                />
            </template>
        </WorkbenchSurface>
        <EditorHost :area="area" :wrap-tabs="false" :attach-tab-drag="(next: EditorTabDrag | null) => (tabDrag = next)" />
        <WorkbenchDragFeedback ref="feedback" :ghost="dragGhost" :preview="dragView.feedback.preview" :label="feedbackLabel" :kind="dragView.feedback.kind" :sectors="dragView.feedbackSectors" :sector-labels="sectorLabels" :live-status="liveLabel" />
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

/*
 * 夜间配色下的高亮：色板是写进 Markdown 的浅色字面量（`markdown/web/components/menus/palette.ts`），字却跟着正文用浅色，
 * 涂上就看不清（产品本身的问题，第 6 轮发现，已报给开发者）。首页先在这里把高亮里的字压成深墨。
 */
.hp-desk--night :deep(mark[style*="background-color"]) {
    color: #2a2118;
}

/* 跟手的卡片的头、空位与并入的盖层：照产品外壳（`WorkbenchShell.vue`），样式走同一组令牌。 */
.hp-desk__card-head {
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

.hp-desk__card-icon {
    width: 1.05em;
    height: 1.05em;
    color: var(--text-secondary);
}

.hp-desk__card-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.hp-desk__card-hint {
    margin-inline-start: auto;
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
}

.hp-desk__slot {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border: 1px solid var(--layout-slot-border);
    border-radius: var(--layout-card-radius);
    background: var(--layout-slot-fill);
    pointer-events: none;
}

.hp-desk__merge {
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
    animation: hp-desk-merge-in var(--motion-fast) var(--ease-layout);
}

@keyframes hp-desk-merge-in {
    from {
        opacity: 0;
    }
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
