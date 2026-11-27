<script setup lang="ts">
/**
 * WorkbenchSurface 的场景（docs/specs/ui/workbench-layout.md，断言在 e2e/lab-workbench-surface.e2e.ts）。夹具自己扮演工作台：`侧栏 | (编辑组 g0 | g1) | 右栏`，下面是底部面板。
 * 五个视图都没写容器，各是自己的隐式容器（`view:a` 到 `view:e`）：侧栏有 A（当前）、B 两个容器，右栏有 C（当前）、D，底部面板有 E。一个区域只显示当前容器的分节，活动栏一个容器一个入口。
 * 文档、呈现树、有效可见、活动栏的入口与点了做什么都用产品的纯函数算（`state/`），只是不存盘、不接命令系统。按钮做拖放与菜单会提交的那些结构变化；真实的拖动手势在外壳切换时接上。
 * “标题区”场景里右栏的视图 C 接管标题区（docs/specs/workbench/views.md 输出 19），用一段示例内容（新建、Profile 图标与会话标题、更多）演示三列。
 * 右栏的入口在右栏外侧的右轨上（docs/specs/ui/workbench-layout.md 输出 50），和活动栏同一个组件；“卡片”场景看右栏与右轨相连、隐藏与显示时角接过去。
 */
import {
    activateTab,
    applyGestureCommit,
    edgeTargetOf,
    findTreeNode,
    isSectionCollapsed,
    moveTabToEdge,
    openPanelAtEdge,
    presentationCollapse,
    projectLayoutDoc,
    rebaseForOperation,
    sectionCollapseBlock,
    setActiveContainer,
    setPanelCollapsed,
    setPanelHidden,
    tabKey,
} from "@notnotype/nb-workbench-layout";
import type {GridExtent} from "@notnotype/nb-layout";
import type {LayoutDoc, LayoutResult, PanelName} from "@notnotype/nb-workbench-layout";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed, ref, shallowRef, Teleport} from "vue";

import WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type {PanelFrameAction, PanelHeadTab, PanelViewHead} from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type {PanelHeadSlots} from "nbook/plugins/workbench/web/views/view-head";
import WorkbenchRegionStrip from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import type {RegionStripEntry} from "nbook/plugins/workbench/web/components/WorkbenchRegionStrip.vue";
import WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import {defaultLayoutDoc, INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import {collapseOrder, createLayoutPolicy, layoutProjectionOptions} from "nbook/plugins/workbench/web/state/layout-constraints";
import {implicitContainerOf, moveContainerTo, sectionLanding, settleContainers} from "nbook/plugins/workbench/web/state/containers";
import {effectiveVisibleTabs, regionEntries, regionEntryIntent, regionVisible, titleOnlyPanels} from "nbook/plugins/workbench/web/state/layout-present";
import type {ViewCatalog} from "nbook/plugins/workbench/web/views/registry";
import {applyEntryDrop} from "nbook/plugins/workbench/web/entry-drop";
import {CUSTOM_CONTAINER_PREFIX} from "nbook/plugins/workbench/shared/views";

import {type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";
import GridStructureLeaf from "./GridStructureLeaf.vue";

const props = defineProps<LabFixtureProps>();

const VIEWS = [
    {id: "a", label: "视图 A", icon: "i-lucide-files", location: "sidebar"},
    {id: "b", label: "视图 B", icon: "i-lucide-search", location: "sidebar"},
    {id: "c", label: "视图 C", icon: "i-lucide-message-square", location: "auxiliarybar"},
    {id: "d", label: "视图 D", icon: "i-lucide-list-tree", location: "auxiliarybar"},
    {id: "e", label: "视图 E", icon: "i-lucide-terminal", location: "panel"},
] as const;
const CATALOG: ViewCatalog = new Map(VIEWS.map(({id, label, icon, location}) => [id, {title: label, icon, location, layout: "scroll" as const}]));
const POLICY = createLayoutPolicy();

function unwrap(result: LayoutResult, base: LayoutDoc): LayoutDoc {
    return result.ok ? result.doc : base;
}

function initialDoc(): LayoutDoc {
    const base = defaultLayoutDoc(CATALOG);
    const target = edgeTargetOf(base, INITIAL_EDITOR_PANEL, "right");
    if (target === null) return base;
    return unwrap(openPanelAtEdge(base, {id: "g1", panel: {role: "editor", tabs: [], active: null}, target}, POLICY), base);
}

const doc = shallowRef<LayoutDoc>(initialDoc());
const extent = shallowRef<GridExtent | null>(null);
const cardGap = ref(0);
const presented = shallowRef<Readonly<Record<string, GridExtent>>>({});
const preview = shallowRef<Readonly<Record<string, GridExtent>> | null>(null);
const maximized = ref<string | null>(null);
const focusedPanel = ref<string | null>(null);
const lastMenu = ref("");
const surface = ref<InstanceType<typeof WorkbenchSurface> | null>(null);

const options = computed(() => layoutProjectionOptions({doc: doc.value, catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value}));
const collapse = computed(() => (extent.value === null ? {removed: new Set<string>(), squeezed: false} : presentationCollapse(doc.value, extent.value, {...options.value, order: collapseOrder(doc.value), focused: focusedPanel.value})));
const projection = computed(() => projectLayoutDoc(doc.value, layoutProjectionOptions({doc: doc.value, catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value, removed: collapse.value.removed, squeezed: collapse.value.squeezed})));
/** 分节的头只写标题（输出 20），内容是以标题命名的 region：和外壳用同一个判定。 */
const titleOnly = computed(() => titleOnlyPanels(doc.value));
const visible = computed(() => effectiveVisibleTabs(doc.value, {sizes: presented.value, preview: preview.value, removed: collapse.value.removed, maximized: maximized.value, fillers: projection.value.fillers}));

/** 结构操作之前把呈现尺寸写回意图（workbench-layout 输出 8、49），之后把锚归整到和分节一致（输出 41、43），和产品的 store 同一个次序。库拒绝时文档不变。 */
function commit(operation: (current: LayoutDoc) => LayoutResult): void {
    const base = rebaseForOperation(doc.value, projection.value, presented.value);
    const result = operation(base);
    if (result.ok) doc.value = settleContainers(result.doc);
}

/** 区域显示并切到这个容器（输出 42）。 */
function showContainer(current: LayoutDoc, region: PanelName, container: string): LayoutResult {
    const shown = setPanelHidden(settleContainers(current), region, false);
    return shown.ok ? setActiveContainer(shown.doc, region, container) : shown;
}

/** 手势落账：和产品的 store 一样经库的入口写回（收起记在锚上、拉开隐藏的区域清掉隐藏、没动的保留像素节点不写，输出 11、49）。 */
function onGestureCommit(before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void {
    doc.value = applyGestureCommit(doc.value, projection.value, {before, after, collapsed}).doc;
}

/** 把视图放成 `region` 里 `container` 的最后一个分节，区域显示并切到这个容器（输出 23 的“移进一个容器”）。 */
const intoContainer = (viewId: string, region: PanelName, container: string) => (current: LayoutDoc): LayoutResult => {
    const target = sectionLanding(current, region, container);
    if (target === null) return {ok: false, code: "not-found", message: `No section landing in region ${region}`};
    const moved = moveTabToEdge(current, {tab: `view:${viewId}`, target, container}, POLICY);
    return moved.ok ? showContainer(moved.doc, region, container) : moved;
};

const ACTIONS: Readonly<Record<string, () => void>> = {
    // 整个容器搬到另一个区域（输出 44）：入口从活动栏消失，搬回来排在入口顺序最后。
    "a-to-right": () => commit((current) => moveContainerTo(current, implicitContainerOf("a"), "auxiliarybar", POLICY)),
    "a-back": () => commit((current) => moveContainerTo(current, implicitContainerOf("a"), "sidebar", POLICY)),
    // 视图换容器：C 成为底部面板里 E 那个容器的又一个分节；D 成为侧栏里 B 那个容器的又一个分节。
    "c-to-new-panel": () => commit(intoContainer("c", "panel", implicitContainerOf("e"))),
    "d-below-b": () => commit(intoContainer("d", "sidebar", implicitContainerOf("b"))),
    // 活动栏上段的落点（输出 45），和拖到那里放下是同一个函数：D 放到入口最后，新建一个只含它的用户容器；D 放到 A 的入口上，成为 A 的最后一个分节。都切过去。
    "d-new-entry": () => commit((current) => applyEntryDrop(current, {kind: "tab", tab: "view:d"}, {kind: "new-container", region: "sidebar", container: `${CUSTOM_CONTAINER_PREFIX}lab`, before: null}, POLICY, {commit: true})),
    "d-into-a": () => commit((current) => applyEntryDrop(current, {kind: "tab", tab: "view:d"}, {kind: "join-container", region: "sidebar", container: implicitContainerOf("a")}, POLICY, {commit: true})),
};

function headTabs(panelId: string): PanelHeadTab[] {
    return (doc.value.panels[panelId]?.tabs ?? []).map((tab) => {
        const declared = tab.kind === "view" ? VIEWS.find((item) => item.id === tab.viewId) : undefined;
        return {id: tabKey(tab), label: declared?.label ?? tabKey(tab), icon: declared?.icon ?? "i-lucide-square"};
    });
}

/** 头都是分节的：隐藏的是整个区域，记在锚上，锚没有头，所以没有“隐藏”按钮。收起不是按钮，是标题行（输出 20）。 */
function frameActions(panelId: string): PanelFrameAction[] {
    return [{id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false, pressed: maximized.value === panelId}];
}

/** 展开标记，同外壳的 `foldOf`：只写标题、上下排、库说能收成标题行、没有被最大化。 */
function foldOf(panelId: string): {readonly collapsed: boolean} | null {
    const vertical = findTreeNode(doc.value.tree.root, panelId)?.parent?.orientation === "vertical";
    if (!titleOnly.value.has(panelId) || !vertical || sectionCollapseBlock(doc.value, panelId) !== null || maximized.value === panelId) return null;
    return {collapsed: isSectionCollapsed(doc.value, panelId)};
}

/** 点标题，同外壳的 `activateTab` 与 store 的 `activate`：能收起、展开着、视图没接管标题区、点的是当前标签时收起，否则激活，收着的同时展开。 */
function activateFromHead(panelId: string, key: string): void {
    const fold = foldOf(panelId);
    if (fold !== null && !fold.collapsed && viewHeadOf(panelId) === null && doc.value.panels[panelId]?.active === key) {
        commit((current) => setPanelCollapsed(current, panelId, true));
        return;
    }
    commit((current) => {
        const activated = activateTab(current, key);
        return activated.ok && isSectionCollapsed(current, panelId) ? setPanelCollapsed(activated.doc, panelId, false) : activated;
    });
}

function toggleFold(panelId: string): void {
    const fold = foldOf(panelId);
    if (fold !== null) commit((current) => setPanelCollapsed(current, panelId, !fold.collapsed));
}

/** 分节的头：画在它自己的叶里，或并成一行时画在入口条里，两处同一组属性与事件。 */
function headProps(panelId: string, idPrefix: string): InstanceType<typeof WorkbenchPanelHead>["$props"] {
    const fold = foldOf(panelId);
    return {
        panelId,
        label: doc.value.panels[panelId]?.name ?? panelId,
        tabs: headTabs(panelId),
        active: doc.value.panels[panelId]?.active ?? null,
        moreLabel: "更多",
        idPrefix,
        titleOnly: titleOnly.value.has(panelId),
        frameActions: frameActions(panelId),
        viewHead: viewHeadOf(panelId),
        fold,
        foldLabel: fold?.collapsed === true ? "展开" : "收起",
    };
}
function headEvents(panelId: string): Record<string, (...args: never[]) => void> {
    return {
        activate: (key: string) => activateFromHead(panelId, key),
        "toggle-fold": () => toggleFold(panelId),
        "head-slots": (slots: PanelHeadSlots | null) => (headSlots.value = slots),
        action: (action: string) => runFrame(panelId, action),
        "context-menu": (key: string) => (lastMenu.value = key),
    };
}

function runFrame(panelId: string, action: string): void {
    if (action === "maximize") maximized.value = maximized.value === panelId ? null : panelId;
}

const sidebarShowing = computed(() => regionVisible(doc.value, "sidebar", {removed: collapse.value.removed, maximized: maximized.value}, visible.value));

/** 一个容器一个入口（输出 22、41）；这里的容器都只含一个视图时入口就是那个视图的，D 并进 B 的容器后那个入口含两个视图。 */
const entries = computed<ToolStripEntry[]>(() => regionEntries(doc.value, "sidebar", CATALOG).map((entry) => {
    const titles = entry.views.map((viewId) => VIEWS.find((item) => item.id === viewId)?.label ?? viewId);
    const label = typeof entry.label.title === "string" ? entry.label.title : entry.id;
    return {id: entry.id, label, icon: entry.label.icon, tooltip: titles.length === 1 ? label : `${label}：${titles.join("、")}`, viewId: entry.views.length === 1 ? (entry.views[0] ?? null) : null, current: entry.current, pressed: entry.current && sidebarShowing.value};
}));

const STRIP_ITEMS: ReadonlyArray<ToolStripItem> = [
    {id: "profile", title: "个人资料尚未开放", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
    {id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: false, disabledReason: null},
];

/** 点入口（输出 22）：和产品的外壳用同一个判定。焦点的去向是外壳的事，夹具不管。 */
/** 右轨、底部面板入口条的入口，同活动栏（输出 47、50）。 */
function stripEntries(region: PanelName): RegionStripEntry[] {
    const showing = regionVisible(doc.value, region, {removed: collapse.value.removed, maximized: maximized.value}, visible.value);
    return regionEntries(doc.value, region, CATALOG).map((entry) => {
        const label = typeof entry.label.title === "string" ? entry.label.title : entry.id;
        return {id: entry.id, label, icon: entry.label.icon, tooltip: label, viewId: entry.views.length === 1 ? (entry.views[0] ?? null) : null, current: entry.current, pressed: entry.current && showing};
    });
}

function selectRegionEntry(region: PanelName, container: string): void {
    const showing = regionVisible(doc.value, region, {removed: collapse.value.removed, maximized: maximized.value}, visible.value);
    const intent = regionEntryIntent(doc.value, region, container, {regionVisible: showing});
    if (intent.kind === "show") {
        maximized.value = null;
        commit((current) => showContainer(current, region, intent.container));
    }
    if (intent.kind === "hide") commit((current) => setPanelHidden(current, region, true));
}

function selectEntry(container: string): void {
    const intent = regionEntryIntent(doc.value, "sidebar", container, {regionVisible: sidebarShowing.value});
    if (intent.kind === "show") {
        maximized.value = null;
        commit((current) => showContainer(current, "sidebar", intent.container));
    }
    if (intent.kind === "hide") commit((current) => setPanelHidden(current, "sidebar", true));
}

const labelOf = (key: string): string => key.slice(key.indexOf(":") + 1);
let created = 0;
const createInstance = (): number => {
    created += 1;
    return created;
};

function onKeydown(event: KeyboardEvent): void {
    if (event.key === "F6" && surface.value?.moveFocus(event.shiftKey ? "previous" : "next") === true) event.preventDefault();
}

const visibleText = computed(() => [...visible.value].sort().join(" "));

/** “标题区”场景：视图 C 所在的只写标题的面板交给它标题区。 */
const HEAD_VIEW = tabKey({kind: "view", viewId: "c"});
const headSlots = shallowRef<PanelHeadSlots | null>(null);
function viewHeadOf(panelId: string): PanelViewHead | null {
    return props.scene === "view-head" && titleOnly.value.has(panelId) && doc.value.panels[panelId]?.active === HEAD_VIEW ? {key: "c:1", popup: {expanded: false}} : null;
}
</script>

<template>
    <div class="workbench-surface-fixture" :class="{'workbench-surface-fixture--cards': props.scene === 'cards'}" :data-visible-tabs="visibleText" :data-focused-panel="focusedPanel ?? ''" :data-last-menu="lastMenu" @keydown="onKeydown">
        <div class="workbench-surface-fixture__actions">
            <button v-for="(_, name) in ACTIONS" :key="name" type="button" :data-surface-action="name" @click="ACTIONS[name]?.()">{{ name }}</button>
        </div>
        <div class="workbench-surface-fixture__stage">
            <WorkbenchSurface
                ref="surface"
                data-lab-subject
                :doc="doc"
                :projection="projection"
                :maximized="maximized"
                :title-only-panels="titleOnly"
                context-key="lab:surface"
                @extent="(next) => (extent = next)"
                @card-gap="(gap) => (cardGap = gap)"
                @presented="(sizes) => (presented = sizes)"
                @preview="(sizes) => (preview = sizes)"
                @gesture-commit="onGestureCommit"
                @focus-panel="(panel) => (focusedPanel = panel)"
            >
                <template #activitybar="{joined}">
                    <WorkbenchToolStrip label="活动栏" more-label="更多" :joined="joined" :entries="entries" :items="STRIP_ITEMS" @select="selectEntry" />
                </template>
                <template #rail="{joined}">
                    <WorkbenchToolStrip label="右栏的侧轨" more-label="更多" region="auxiliarybar" :joined="joined" :entries="stripEntries('auxiliarybar')" @select="(id) => selectRegionEntry('auxiliarybar', id)" />
                </template>
                <template #statusbar>
                    <div class="workbench-surface-fixture__status">状态栏</div>
                </template>
                <template #empty-region>
                    <div class="workbench-surface-fixture__empty" data-empty-region>把视图拖到这里</div>
                </template>
                <template #head="{panelId, idPrefix}">
                    <WorkbenchPanelHead v-bind="headProps(panelId, idPrefix)" v-on="headEvents(panelId)">
                        <template #actions>
                            <IconButton size="xs" icon-class="i-lucide-refresh-cw" aria-label="刷新" :data-view-action="panelId" />
                        </template>
                    </WorkbenchPanelHead>
                </template>
                <!-- 底部面板的入口条（输出 47）：当前容器只有一节时那一节的头并在这一行里，同分节的头。 -->
                <template #strip="{region, merged, idPrefix}">
                    <WorkbenchRegionStrip
                        :region="region"
                        :label="`${region} 的视图容器`"
                        more-label="更多"
                        :entries="stripEntries(region)"
                        :head-min-width="merged === null ? 0 : 160"
                        @select="(id) => selectRegionEntry(region, id)"
                    >
                        <!-- 底部面板的入口写着标题，并进来的头不再写一遍（同产品的外壳，输出 47）。 -->
                        <WorkbenchPanelHead v-if="merged !== null" :key="merged" v-bind="headProps(merged, idPrefix)" :title-in-entry="region === 'panel'" v-on="headEvents(merged)">
                            <template #actions>
                                <IconButton size="xs" icon-class="i-lucide-refresh-cw" aria-label="刷新" :data-view-action="merged" />
                            </template>
                        </WorkbenchPanelHead>
                    </WorkbenchRegionStrip>
                </template>
                <template #content="{contentKey}">
                    <GridStructureLeaf :id="labelOf(contentKey)" :create-instance="createInstance" />
                </template>
            </WorkbenchSurface>
            <template v-if="headSlots !== null">
                <Teleport :to="headSlots.start">
                    <IconButton size="xs" icon-class="i-lucide-plus" aria-label="新建对话" />
                </Teleport>
                <Teleport :to="headSlots.title">
                    <span class="i-lucide-feather workbench-surface-fixture__head-icon" aria-hidden="true"></span>
                    <span class="workbench-surface-fixture__head-title">第三章节奏调整</span>
                    <span class="i-lucide-chevron-down workbench-surface-fixture__head-icon" aria-hidden="true"></span>
                </Teleport>
                <Teleport :to="headSlots.end">
                    <IconButton size="xs" icon-class="i-lucide-ellipsis" aria-label="更多" />
                </Teleport>
            </template>
        </div>
    </div>
</template>

<style scoped>
.workbench-surface-fixture {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.workbench-surface-fixture__actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    gap: 4px;
    font-size: var(--text-xs);
}

.workbench-surface-fixture__stage {
    flex: 1 1 auto;
    /* Lab 的舞台按内容定高：给够放下两侧、编辑组和面板。 */
    min-height: 620px;
    border: var(--border-w) solid var(--divider);
}

/* 卡片主题的几个变量写在这里：看缝、圆角、相连，不依赖某个具体主题。 */
.workbench-surface-fixture--cards .workbench-surface-fixture__stage {
    --shell-gap: 4px;
    --shell-card-radius: 10px;
    --shell-card-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
    --shell-seam: transparent;
    --shell-join-divider: var(--divider);
    background: var(--bg-subtle);
}

/* 打开着的空区域（ADR 0050）：同产品外壳，正中一句提示。 */
.workbench-surface-fixture__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    pointer-events: none;
}

.workbench-surface-fixture__status {
    display: flex;
    align-items: center;
    height: 100%;
    padding-inline: var(--space-2);
    background: var(--panel-surface);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

/* “标题区”场景的示例内容：送进面板头的标题按钮里，只放文字与图标。 */
.workbench-surface-fixture__head-icon {
    flex-shrink: 0;
    width: 1.1em;
    height: 1.1em;
    color: var(--accent-text);
}

.workbench-surface-fixture__head-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
