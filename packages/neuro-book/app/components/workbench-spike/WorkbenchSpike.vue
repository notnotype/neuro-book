<script setup lang="ts">
/**
 * 迷你工作台：Splitter 树渲染 Part 骨架，descriptor 表渲染容器与视图，
 * 界面态（收起 / 活动容器 / 视图位置覆盖）由 layout.ts 持有。
 * 这不是产品实现，只用于验证提案的公共契约（见 docs/proposals/workbench-view-host.md）。
 */
import {computed, ref, watch} from "vue";
import {createGrid, type GridBranch} from "@notnotype/nb-ui/components";
import SpikeBranch from "./SpikeBranch.vue";
import WorkbenchSurface from "./WorkbenchSurface.vue";
import DiagnosticsRail from "./DiagnosticsRail.vue";
import {labelOf, SPIKE_CONTAINERS, SPIKE_VIEWS} from "./descriptors";
import {createSpikeContext, evaluateAuthority, evaluateWhen} from "./context";
import {resolveFactory, type FactoryResolution} from "./factories";
import {
    createDefaultLayout,
    placementOf,
    placeView,
    restoreLayout,
    serializeLayout,
    viewsOfContainer,
    type SpikeLayoutState,
    type SpikeLocation,
} from "./layout";

const state = ref<SpikeLayoutState>(createDefaultLayout());
const grid = ref(createGrid(state.value.grid.root));
/** 整棵树被换掉的次数（重置 / 恢复快照）：SpikeBranch 用它决定何时重挂 splitter。 */
const epoch = ref(0);
const sizes = ref<Record<string, number>>({...grid.value.layout().sizes});
const issues = ref<string[]>([]);
const notices = ref<string[]>([]);
const context = createSpikeContext();

const factoryStates = ref<Record<string, FactoryResolution>>({});

/** 懒实例化：视图首次可见时才解析 factory；不可见的视图离开时释放（不留解析结果）。 */
function resolveVisibleFactories() {
    const next: Record<string, FactoryResolution> = {};
    for (const view of SPIKE_VIEWS) {
        if (evaluateWhen(view.when, context).visible) {
            next[view.id] = factoryStates.value[view.id] ?? resolveFactory(view.factoryKey);
        }
    }
    factoryStates.value = next;
}

watch([context.project, context.selection, context.job], resolveVisibleFactories, {immediate: true});

/** 可见性（when）与可执行性（requiredAuthority）分开求值：前者决定视图是否出现，后者决定其动作是否可用。 */
const visibility = computed(() => Object.fromEntries(SPIKE_VIEWS.map((view) => [view.id, evaluateWhen(view.when, context)])));
const authority = computed(() => Object.fromEntries(SPIKE_VIEWS.map((view) => [view.id, evaluateAuthority(view.requiredAuthority, context)])));

function syncSizes() {
    const layout = grid.value.layout();
    sizes.value = {...layout.sizes};
    issues.value = layout.issues;
    state.value = {...state.value, grid: grid.value.serialize()};
}

function onResize(id: string, deltaPx: number) {
    const result = grid.value.resize(id, deltaPx);
    if (!result.ok) {
        issues.value = [...issues.value, result.reason];
        return;
    }
    syncSizes();
}

function applyState(next: SpikeLayoutState) {
    state.value = next;
    grid.value = createGrid(next.grid.root);
    epoch.value += 1;
    syncSizes();
}

function setCollapsed(leafId: string, collapsed: boolean) {
    const next = collapsed
        ? (state.value.collapsed.includes(leafId) ? state.value.collapsed : [...state.value.collapsed, leafId])
        : state.value.collapsed.filter((id) => id !== leafId);
    state.value = {...state.value, collapsed: next};
    const container = SPIKE_CONTAINERS.find((item) => item.id === state.value.activeContainer[leafId as SpikeLocation]);
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
    const container = SPIKE_CONTAINERS.find((item) => item.id === containerId);
    notices.value = [`已切换到容器「${container ? labelOf(container.titleKey) : containerId}」。`];
}

/** 拖拽落账：目标容器不存在或落到自身当前位置 → 无操作；否则按插入点相邻两项的 order 取中值。 */
function onDragView(viewId: string, containerId: string, index: number) {
    if (!SPIKE_VIEWS.some((view) => view.id === viewId) || !SPIKE_CONTAINERS.some((item) => item.id === containerId)) {
        return;
    }
    const current = viewsOfContainer(containerId, state.value);
    const from = current.findIndex((view) => view.id === viewId);
    const rest = current.filter((view) => view.id !== viewId);
    const at = Math.min(Math.max(0, from >= 0 && index > from ? index - 1 : index), rest.length);
    if (from === at) {
        return;
    }
    const before = at > 0 ? placementOf(rest[at - 1]!.id, state.value).order : null;
    const after = at < rest.length ? placementOf(rest[at]!.id, state.value).order : null;
    const order = before === null && after === null ? 10
        : before === null ? after! - 10
        : after === null ? before + 10
        : (before + after) / 2;
    state.value = placeView(viewId, containerId, order, state.value);
    const view = SPIKE_VIEWS.find((item) => item.id === viewId);
    const container = SPIKE_CONTAINERS.find((item) => item.id === containerId);
    notices.value = [`视图「${labelOf(view?.titleKey ?? viewId)}」已移到「${labelOf(container?.titleKey ?? containerId)}」第 ${at + 1} 位。`];
}

function resetViewPlacements() {
    state.value = {...state.value, viewPlacements: {}};
    notices.value = ["视图位置覆盖已清空，全部回到 descriptor 的默认位置。"];
}

const panelInFullRow = computed(() => {
    const rootBranch = grid.value.root();
    return Boolean(rootBranch && rootBranch.kind === "branch" && rootBranch.children.some((child) => child.id === "panel"));
});

function movePanel() {
    const result = panelInFullRow.value
        ? grid.value.moveLeaf("panel", "center", 1)
        : grid.value.moveLeaf("panel", "root", 1);
    notices.value = result.ok
        ? [panelInFullRow.value ? "面板已移回编辑器中列。" : "面板已移到整行（跨全宽）。"]
        : ["移动失败：" + result.reason];
    syncSizes();
}

function inject(kind: "unknown-ref" | "version-mismatch" | "duplicate-ref" | "empty-branch") {
    if (kind === "version-mismatch") {
        const result = restoreLayout({...state.value, layoutVersion: 99});
        applyState(result.state);
        issues.value = [...issues.value, ...result.issues];
        notices.value = ["布局快照被拒绝，已回默认布局：" + result.issues.join("；")];
        return;
    }
    if (kind === "empty-branch") {
        grid.value.removeLeaf("panel");
        grid.value.removeLeaf("editor");
        syncSizes();
        notices.value = ["已删空 center 分支：空分支塌陷，根收敛为单叶。"];
        return;
    }
    const snapshot = JSON.parse(JSON.stringify(grid.value.serialize())) as {version: number; root: GridBranch<string>};
    if (kind === "unknown-ref") {
        snapshot.root.children.push({kind: "leaf", id: "ghost", ref: "ghost-ref", minimumSize: 10, maximumSize: 100, size: 50});
        const result = grid.value.restore(snapshot, (ref) => (ref === "ghost-ref" ? null : ref));
        notices.value = ["未知 ref：丢弃 " + String(result.dropped.length) + " 个叶子（" + result.dropped.map((item) => item.ref).join("、") + "）。"];
    } else {
        snapshot.root.children.push({kind: "leaf", id: "dup", ref: "activity", minimumSize: 10, maximumSize: 100, size: 50});
        const result = grid.value.restore(snapshot, (ref) => ref);
        notices.value = ["重复 ref：" + String(result.reason ?? "已拒绝")];
    }
    syncSizes();
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
    applyState(createDefaultLayout());
    notices.value = ["布局已重置。"];
}

syncSizes();
</script>

<template>
    <div class="flex h-dvh min-h-0 w-screen max-w-full" data-lab-subject>
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <SpikeBranch :node="grid.root() as GridBranch<unknown>" :sizes="sizes" :on-resize="onResize" :collapsed="state.collapsed" :epoch="epoch">
                <template #leaf="{leafId}">
                    <WorkbenchSurface
                        :leaf-id="leafId"
                        :state="state"
                        :factory-states="factoryStates"
                        :authority="authority"
                        :visibility="visibility"
                        @toggle-collapse="toggleCollapse"
                        @set-active-container="setActiveContainer"
                        @drag-view="onDragView"
                    />
                </template>
            </SpikeBranch>
        </div>
        <DiagnosticsRail
            :snapshot-json="serializeLayout(state)"
            :issues="issues"
            :notices="notices"
            :context="{project: context.project.value, selection: context.selection.value, job: context.job.value}"
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
