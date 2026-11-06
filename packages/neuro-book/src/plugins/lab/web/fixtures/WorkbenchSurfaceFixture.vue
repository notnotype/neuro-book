<script setup lang="ts">
/**
 * WorkbenchSurface 的场景（docs/specs/ui/workbench-layout.md，断言在 e2e/lab-workbench-surface.e2e.ts）。夹具自己扮演工作台：`侧栏(A | B) | (编辑组 g0 | g1) | 右栏(C | D)`，
 * 文档、呈现树、有效可见、活动栏条目都用产品的纯函数算（`state/`），只是不存盘、不接命令系统。按钮做拖放会提交的那些结构变化；真实的拖动手势在外壳切换时接上。
 */
import {
    activateTab,
    edgeTargetOf,
    moveTabToEdge,
    moveTabToStrip,
    openPanelAtEdge,
    presentationCollapse,
    projectLayoutDoc,
    rebaseIntents,
    setPanelCollapsed,
    setPanelHidden,
    tabKey,
} from "@notnotype/nb-layout";
import type {GridExtent, LayoutDoc, LayoutResult} from "@notnotype/nb-layout";
import {IconButton} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, shallowRef} from "vue";

import WorkbenchPanelHead from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import type {PanelFrameAction, PanelHeadTab} from "nbook/plugins/workbench/web/components/WorkbenchPanelHead.vue";
import WorkbenchSurface from "nbook/plugins/workbench/web/components/WorkbenchSurface.vue";
import WorkbenchToolStrip from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import type {ToolStripEntry, ToolStripItem} from "nbook/plugins/workbench/web/components/WorkbenchToolStrip.vue";
import {defaultLayoutDoc, INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import {COLLAPSE_ORDER, createLayoutPolicy, layoutProjectionOptions} from "nbook/plugins/workbench/web/state/layout-constraints";
import {effectiveVisibleTabs, sidebarColumnPanels, toolEntryIntent} from "nbook/plugins/workbench/web/state/layout-present";
import type {ViewCatalog} from "nbook/plugins/workbench/web/views/placement";

import type {LabFixtureProps} from "../lab-subject";
import GridStructureLeaf from "./nb-layout/GridStructureLeaf.vue";

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

const options = computed(() => layoutProjectionOptions({catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value}));
const collapse = computed(() => (extent.value === null ? {removed: new Set<string>(), squeezed: false} : presentationCollapse(doc.value, extent.value, {...options.value, order: COLLAPSE_ORDER, focused: focusedPanel.value})));
const projection = computed(() => projectLayoutDoc(doc.value, layoutProjectionOptions({catalog: CATALOG, viewportWidth: extent.value?.width ?? 0, cardGap: cardGap.value, removed: collapse.value.removed, squeezed: collapse.value.squeezed})));
const visible = computed(() => effectiveVisibleTabs(doc.value, {sizes: presented.value, preview: preview.value, removed: collapse.value.removed, maximized: maximized.value}));

/** 结构操作之前把呈现尺寸写回意图（workbench-layout 输出 8），和产品的 store 同一个次序。 */
function commit(operation: (current: LayoutDoc) => LayoutResult): void {
    const base = rebaseIntents(doc.value, presented.value, projection.value.collapsedTo);
    doc.value = unwrap(operation(base), doc.value);
}

function onGestureCommit(sizes: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void {
    // 先改收起状态再写回意图，和产品的 store 同一个次序：收起的面板呈现尺寸不是意图。
    let next = doc.value;
    for (const [id, value] of Object.entries(collapsed)) next = unwrap(setPanelCollapsed(next, id, value), next);
    doc.value = rebaseIntents(next, sizes, projection.value.collapsedTo);
}

const moveTo = (tab: string, panel: string, edge: "left" | "right" | "top" | "bottom") => (current: LayoutDoc): LayoutResult => {
    const target = edgeTargetOf(current, panel, edge);
    return target === null ? {ok: false, code: "not-found", detail: panel} : moveTabToEdge(current, {tab, target}, POLICY);
};

const ACTIONS: Readonly<Record<string, () => void>> = {
    "a-to-right": () => commit((current) => moveTabToStrip(current, {tab: "view:a", panel: "auxiliarybar", index: 1}, POLICY)),
    "a-back": () => commit((current) => moveTabToStrip(current, {tab: "view:a", panel: "sidebar", index: 0}, POLICY)),
    "c-to-new-panel": () => commit(moveTo("view:c", "g1", "right")),
    "d-below-b": () => commit(moveTo("view:d", "sidebar", "bottom")),
};

function headTabs(panelId: string): PanelHeadTab[] {
    return (doc.value.panels[panelId]?.tabs ?? []).map((tab) => {
        const declared = tab.kind === "view" ? VIEWS.find((item) => item.id === tab.viewId) : undefined;
        return {id: tabKey(tab), label: declared?.label ?? tabKey(tab), icon: declared?.icon ?? "i-lucide-square"};
    });
}

function frameActions(panelId: string): PanelFrameAction[] {
    const panel = doc.value.panels[panelId];
    return [
        {id: "collapse", label: "收起", icon: "i-lucide-chevrons-down", disabled: false, pressed: panel?.collapsed === true},
        {id: "maximize", label: "最大化", icon: "i-lucide-maximize-2", disabled: false, pressed: maximized.value === panelId},
        ...(panel?.name === undefined ? [] : [{id: "hide", label: "隐藏", icon: "i-lucide-x", disabled: false}]),
    ];
}

function runFrame(panelId: string, action: string): void {
    if (action === "maximize") {
        maximized.value = maximized.value === panelId ? null : panelId;
        return;
    }
    if (maximized.value === panelId) maximized.value = null;
    if (action === "hide") commit((current) => setPanelHidden(current, panelId, true));
    if (action === "collapse") commit((current) => setPanelCollapsed(current, panelId, current.panels[panelId]?.collapsed !== true));
}

const entries = computed<ToolStripEntry[]>(() => {
    const inColumn = new Set(sidebarColumnPanels(doc.value).flatMap((panel) => doc.value.panels[panel]?.tabs.map((tab) => tabKey(tab)) ?? []));
    return VIEWS.filter(({id}) => inColumn.has(`view:${id}`)).map(({id, label, icon}) => ({id, label, icon, pressed: visible.value.has(`view:${id}`)}));
});

const STRIP_ITEMS: ReadonlyArray<ToolStripItem> = [
    {id: "profile", title: "个人资料尚未开放", icon: "i-lucide-user", interactive: false, pressed: null, disabledReason: null},
    {id: "settings", title: "设置", icon: "i-lucide-settings", interactive: true, pressed: false, disabledReason: null},
];

function focusView(viewId: string): void {
    void nextTick(() => document.querySelector<HTMLElement>(`[data-content="view:${viewId}"] [data-structure-first]`)?.focus());
}

function selectEntry(viewId: string): void {
    const intent = toolEntryIntent(doc.value, viewId, {visible: visible.value});
    if (intent.kind === "none") return;
    const {panel} = intent;
    if (intent.kind === "reveal") {
        maximized.value = null;
        commit((current) => {
            const shown = setPanelHidden(current, panel, false);
            return shown.ok ? activateTab(shown.doc, `view:${viewId}`) : shown;
        });
        focusView(viewId);
    } else if (intent.kind === "hide") commit((current) => setPanelHidden(current, panel, true));
    else commit((current) => setPanelCollapsed(current, panel, true));
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
                context-key="lab:surface"
                @extent="(next) => (extent = next)"
                @card-gap="(gap) => (cardGap = gap)"
                @presented="(sizes) => (presented = sizes)"
                @preview="(sizes) => (preview = sizes)"
                @gesture-commit="onGestureCommit"
                @focus-panel="(panel) => (focusedPanel = panel)"
            >
                <template #activitybar>
                    <WorkbenchToolStrip label="活动栏" more-label="更多" :entries="entries" :items="STRIP_ITEMS" @select="selectEntry" />
                </template>
                <template #statusbar>
                    <div class="workbench-surface-fixture__status">状态栏</div>
                </template>
                <template #head="{panelId, idPrefix}">
                    <WorkbenchPanelHead
                        :panel-id="panelId"
                        :label="doc.panels[panelId]?.name ?? panelId"
                        :tabs="headTabs(panelId)"
                        :active="doc.panels[panelId]?.active ?? null"
                        more-label="更多"
                        :id-prefix="idPrefix"
                        :frame-actions="frameActions(panelId)"
                        @activate="(key) => commit((current) => activateTab(current, key))"
                        @action="(action) => runFrame(panelId, action)"
                        @context-menu="(key) => (lastMenu = key)"
                    >
                        <template #actions>
                            <IconButton size="xs" icon-class="i-lucide-refresh-cw" aria-label="刷新" :data-view-action="panelId" />
                        </template>
                    </WorkbenchPanelHead>
                </template>
                <template #content="{contentKey}">
                    <GridStructureLeaf :id="labelOf(contentKey)" :create-instance="createInstance" />
                </template>
            </WorkbenchSurface>
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
    --shell-gap: 8px;
    --shell-card-radius: 10px;
    --shell-card-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
    --shell-seam: transparent;
    --shell-join-divider: var(--divider);
    background: var(--bg-subtle);
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
</style>
