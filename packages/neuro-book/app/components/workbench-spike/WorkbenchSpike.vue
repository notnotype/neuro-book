<script setup lang="ts">
/**
 * 迷你工作台：Splitter 树渲染 Part 骨架，descriptor 表渲染容器与视图，
 * 界面态（收起 / 活动容器 / 视图位置覆盖）由 layout.ts 持有。
 * 本组件是**组装根**：注册表（视图 / 容器）在这里注入状态层与界面层，layout.ts 自己不认识它。
 * 这不是产品实现，只用于验证提案的公共契约（见 docs/proposals/workbench-view-host.md）。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {createGrid, GRID_SNAPSHOT_VERSION, type GridAxis, type GridBranch, type GridExtent, type GridLayoutResult, type GridSnapshotNode, type GridSnapshotBranch} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import WorkbenchSurface from "./WorkbenchSurface.vue";
import DiagnosticsRail from "./DiagnosticsRail.vue";
import {canMoveView, labelOf, SPIKE_CONTAINERS, SPIKE_VIEWS} from "./descriptors";
import {createSpikeContext, evaluateAuthority, evaluateWhen, type SpikeContextValues} from "./context";
import {resolveFactory, type FactoryResolution} from "./factories";
import {
    createDefaultLayout,
    createSpikeGrid,
    liveLeafIds,
    placeView,
    placementOf,
    restoreLayout,
    resizeSpikeBranch,
    serializeLayout,
    visibleGridTree,
    viewsOfContainer,
    type SpikeCatalog,
    type SpikeLayoutState,
    type SpikeLocation,
} from "./layout";

/** layout.ts 不认识注册表：组装根在这里注入。 */
const catalog: SpikeCatalog = {views: SPIKE_VIEWS, containers: SPIKE_CONTAINERS};

const state = ref<SpikeLayoutState>(createDefaultLayout(catalog));
/** 持有完整意图；当前约束由宿主恢复，可见树单独用于呈现。 */
const grid = ref(createSpikeGrid(state.value.grid));
const visibleRoot = ref<GridBranch<string> | null>(null);
/** 整棵树被换掉的次数（重置 / 恢复快照）：WorkbenchBranch 用它决定何时重挂 splitter。 */
const epoch = ref(0);
/** 渲染区实测尺寸：原语的呈现与诊断要当前容器，挂载后由 ResizeObserver 更新。 */
const container = ref<GridExtent>({width: 0, height: 0});
const stageEl = ref<HTMLElement | null>(null);
let stageObserver: ResizeObserver | null = null;
const issues = ref<string[]>([]);
const layout = ref<GridLayoutResult>(grid.value.layout(container.value));
const notices = ref<string[]>([]);

const context = createSpikeContext();

const factoryStates = ref<Record<string, FactoryResolution>>({});

/** 懒实例化：视图首次可见时才解析 factory；不可见的视图离开时释放（不留解析结果）。 */
function resolveVisibleFactories() {
    const next: Record<string, FactoryResolution> = {};
    for (const view of catalog.views) {
        if (evaluateWhen(view.when, context).visible) {
            next[view.id] = factoryStates.value[view.id] ?? resolveFactory(view.factoryKey);
        }
    }
    factoryStates.value = next;
}

watch([context.project, context.selection, context.job], resolveVisibleFactories, {immediate: true});

/** 可见性（when）与可执行性（requiredAuthority）分开求值：前者决定视图是否出现，后者决定其动作是否可用。 */
const visibility = computed(() => Object.fromEntries(catalog.views.map((view) => [view.id, evaluateWhen(view.when, context)])));
const authority = computed(() => Object.fromEntries(catalog.views.map((view) => [view.id, evaluateAuthority(view.requiredAuthority, context)])));
const contextValues = computed<SpikeContextValues>(() => ({
    project: context.project.value,
    selection: context.selection.value,
    session: context.session.value,
    files: context.files.value,
    job: context.job.value,
}));

/** 改动后重新发布快照并刷新诊断：渲染读快照的意图，呈现尺寸只在拿到实测容器后算。 */
function syncLayout() {
    const visibleTree = visibleGridTree(grid.value.root(), state.value.collapsed);
    visibleRoot.value = visibleTree?.kind === "branch" ? visibleTree : null;
    layout.value = createGrid(visibleTree, {sashSize: 1}).layout(container.value);
    issues.value = container.value.width > 0 ? layout.value.issues : [];
    const snapshot = grid.value.serialize();
    const live = liveLeafIds(snapshot.root);
    const stale = state.value.collapsed.filter((id) => !live.includes(id));
    if (stale.length > 0) {
        issues.value = [...issues.value, `收起列表里的叶子已不在树上，已移除：${stale.join("、")}`];
    }
    state.value = {...state.value, grid: snapshot, collapsed: state.value.collapsed.filter((id) => live.includes(id))};
}

function onResizeBranch(branchId: string, axis: GridAxis, baseline: Readonly<Record<string, number>>, target: Readonly<Record<string, number>>) {
    const result = resizeSpikeBranch(grid.value, state.value.collapsed, branchId, axis, baseline, target);
    if (!result.ok) {
        issues.value = [...issues.value, result.reason];
        return;
    }
    syncLayout();
}

function applyState(next: SpikeLayoutState) {
    state.value = next;
    grid.value = createSpikeGrid(next.grid);
    epoch.value += 1;
    syncLayout();
}

function setCollapsed(leafId: string, collapsed: boolean) {
    const next = collapsed
        ? (state.value.collapsed.includes(leafId) ? state.value.collapsed : [...state.value.collapsed, leafId])
        : state.value.collapsed.filter((id) => id !== leafId);
    state.value = {...state.value, collapsed: next};
    syncLayout();
    const container = catalog.containers.find((item) => item.id === state.value.activeContainer[leafId as SpikeLocation]);
    notices.value = [`${collapsed ? "已收起" : "已展开"}「${container ? labelOf(container.titleKey) : leafId}」。`];
}

function toggleCollapse(leafId: string) {
    setCollapsed(leafId, !state.value.collapsed.includes(leafId));
}

function setActiveContainer(location: SpikeLocation, containerId: string) {
    state.value = {
        ...state.value,
        activeContainer: {...state.value.activeContainer, [location]: containerId},
        collapsed: state.value.collapsed.filter((id) => id !== location),
    };
    syncLayout();
    const container = catalog.containers.find((item) => item.id === containerId);
    notices.value = [`已切换到容器「${container ? labelOf(container.titleKey) : containerId}」。`];
}

/**
 * 拖拽落账：视图不存在（含不可移动）→ 无操作，其中不可移动会在诊断栏留一条 notice；
 * 目标容器不存在 → 无操作；落到自身当前位置 → 无操作且不报错。
 */
function onDragView(viewId: string, containerId: string, index: number) {
    const view = catalog.views.find((item) => item.id === viewId);
    const container = catalog.containers.find((item) => item.id === containerId);
    if (!view || !container) {
        return;
    }
    if (!canMoveView(view)) {
        notices.value = [`视图「${labelOf(view.titleKey)}」不可移动，已忽略。`];
        return;
    }
    const current = viewsOfContainer(containerId, state.value, catalog);
    const from = current.findIndex((item) => item.id === viewId);
    const rest = current.filter((item) => item.id !== viewId);
    const at = Math.min(Math.max(0, from >= 0 && index > from ? index - 1 : index), rest.length);
    if (from === at) {
        return;
    }
    const before = at > 0 ? placementOf(rest[at - 1]!.id, state.value, catalog).order : null;
    const after = at < rest.length ? placementOf(rest[at]!.id, state.value, catalog).order : null;
    const order = before === null && after === null ? 10
        : before === null ? after! - 10
        : after === null ? before + 10
        : (before + after) / 2;
    state.value = placeView(viewId, containerId, order, state.value, catalog);
    notices.value = [`视图「${labelOf(view.titleKey)}」已移到「${labelOf(container.titleKey)}」第 ${at + 1} 位。`];
}

function resetViewPlacements() {
    state.value = {...state.value, viewPlacements: {}};
    notices.value = ["视图位置覆盖已清空，全部回到 descriptor 的默认位置。"];
}

/** 派生值只读响应式快照 state.grid：原语内部树是原地变化的，读 `grid.root()` 等于读一个永不失效的缓存。 */
const panelInFullRow = computed(() => {
    const root = state.value.grid.root;
    return root.kind === "branch" && root.children.some((child) => child.id === "panel");
});

/** 原语会把「只剩一个子节点」的分支收掉：面板搬走后 center 不复存在，移回时要重新找编辑器所在的分支。 */
function editorSlot(): {parentId: string; index: number} {
    const walk = (node: GridSnapshotNode): {parentId: string; index: number} | null => {
        if (node.kind === "leaf") {
            return null;
        }
        const at = node.children.findIndex((child) => child.id === "editor");
        if (at >= 0) {
            return {parentId: node.id, index: at + 1};
        }
        for (const child of node.children) {
            const hit = walk(child);
            if (hit) {
                return hit;
            }
        }
        return null;
    };
    return walk(state.value.grid.root) ?? {parentId: "main", index: 1};
}

function movePanel() {
    const toFullRow = panelInFullRow.value === false;
    const target = toFullRow ? {parentId: "root", index: 1} : editorSlot();
    const result = grid.value.moveLeaf("panel", target.parentId, target.index);
    syncLayout();
    notices.value = result.ok
        ? [toFullRow ? "面板已移到整行（跨全宽）。" : "面板已移回编辑器所在列。"]
        : ["移动失败：" + result.reason];
}

/** 注入场景全部走 restoreLayout：它负责拒绝非法快照、把原语的结果翻成 issue 并回退默认布局。 */
function inject(kind: "unknown-ref" | "invalid-root" | "single-leaf-root" | "version-mismatch" | "duplicate-ref" | "empty-branch") {
    if (kind === "version-mismatch") {
        const result = restoreLayout({...state.value, layoutVersion: 99}, catalog);
        applyState(result.state);
        issues.value = [...issues.value, ...result.issues];
        notices.value = ["布局快照被拒绝，已回默认布局：" + result.issues.join("；")];
        return;
    }
    if (kind === "single-leaf-root") {
        // 单叶根能通过原语恢复，但渲染侧没有 children：必须在恢复层拒绝，否则工作台白屏。
        const result = restoreLayout({...state.value, grid: {version: GRID_SNAPSHOT_VERSION, root: {kind: "leaf", id: "statusbar", ref: "statusbar", size: {width: 0, height: 40}, minimumSize: {width: 0, height: 32}, maximumSize: {width: 0, height: 64}}}}, catalog);
        applyState(result.state);
        issues.value = [...issues.value, ...result.issues];
        notices.value = ["已注入单叶根快照：回退默认布局并记录 issue。"];
        return;
    }
    if (kind === "invalid-root") {
        // 根节点 kind 既非 leaf 也非 branch：原语整体拒绝，恢复层再回退默认布局。
        const result = restoreLayout({...state.value, grid: {version: GRID_SNAPSHOT_VERSION, root: {kind: "bogus"}}}, catalog);
        applyState(result.state);
        issues.value = [...issues.value, ...result.issues];
        notices.value = ["已注入非法根节点快照：回退默认布局并记录 issue。"];
        return;
    }
    if (kind === "empty-branch") {
        grid.value.removeLeaf("panel");
        grid.value.removeLeaf("editor");
        syncLayout();
        notices.value = ["已删空 center 分支：空分支塌陷，根收敛为单叶。"];
        return;
    }
    const snapshot = JSON.parse(JSON.stringify(grid.value.serialize())) as {version: number; root: GridSnapshotBranch};
    if (kind === "unknown-ref") {
        snapshot.root.children.push({kind: "leaf", id: "ghost", ref: "ghost-ref", size: {width: 50, height: 0}});
        const result = restoreLayout({...state.value, grid: snapshot}, catalog);
        applyState(result.state);
        issues.value = [...issues.value, ...result.issues];
        notices.value = ["已注入未知引用：恢复时丢弃该叶并记录 issue。"];
        return;
    }
    snapshot.root.children.push({kind: "leaf", id: "dup", ref: "activity", size: {width: 50, height: 0}});
    const result = restoreLayout({...state.value, grid: snapshot}, catalog);
    applyState(result.state);
    issues.value = [...issues.value, ...result.issues];
    notices.value = ["已注入重复 ref：快照被拒绝，回退默认布局并记录 issue。"];
}

function rerunFactories() {
    factoryStates.value = {};
    resolveVisibleFactories();
    notices.value = ["已重跑 factory 解析。"];
}

function simulateStaleAsync() {
    const token = state.value.grid.version;
    notices.value = ["请求已发出（目标 spike.jobs）…"];
    window.setTimeout(() => {
        notices.value = ["迟到结果被标记为 superseded（token " + String(token) + "），未写入当前视图。"];
    }, 600);
}

function reset() {
    applyState(createDefaultLayout(catalog));
    notices.value = ["布局已重置。"];
}

/** 渲染区尺寸变化即容器的真相：原语的呈现与诊断按它重算，快照里的意图不动。 */
function measureStage(): void {
    const element = stageEl.value;
    if (!element) {
        return;
    }
    container.value = {width: element.clientWidth, height: element.clientHeight};
    syncLayout();
}

onMounted(() => {
    measureStage();
    if (!stageEl.value) {
        return;
    }
    stageObserver = new ResizeObserver(measureStage);
    stageObserver.observe(stageEl.value);
});

onBeforeUnmount(() => {
    stageObserver?.disconnect();
    stageObserver = null;
});

syncLayout();
</script>

<template>
    <div class="flex h-dvh min-h-0 w-screen max-w-full" data-lab-subject>
        <div ref="stageEl" class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <WorkbenchBranch v-if="visibleRoot" :node="visibleRoot" :layout="layout" :on-resize-branch="onResizeBranch" :epoch="epoch">
                <template #leaf="{leafId}">
                    <WorkbenchSurface
                        :leaf-id="leafId"
                        :state="state"
                        :catalog="catalog"
                        :factory-states="factoryStates"
                        :authority="authority"
                        :visibility="visibility"
                        @toggle-collapse="toggleCollapse"
                        @set-active-container="setActiveContainer"
                        @drag-view="onDragView"
                    />
                </template>
            </WorkbenchBranch>
        </div>
        <DiagnosticsRail
            :snapshot-json="serializeLayout(state)"
            :issues="issues"
            :notices="notices"
            :context="contextValues"
            :panel-in-full-row="panelInFullRow"
            @toggle-context="(key) => (context[key].value = !context[key].value)"
            @move-panel="movePanel"
            @inject="inject"
            @rerun-factories="rerunFactories"
            @stale-async="simulateStaleAsync"
            @reset="reset"
            @collapse-left-sidebar="setCollapsed('sidebar-left', true)"
            @expand-left-sidebar="setCollapsed('sidebar-left', false)"
            @reset-view-placements="resetViewPlacements"
        />
    </div>
</template>
