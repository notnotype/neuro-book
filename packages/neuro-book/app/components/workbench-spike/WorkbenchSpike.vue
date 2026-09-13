<script setup lang="ts">
/**
 * 迷你工作台：用可序列化拆分树渲染 Part 骨架，用 descriptor 表渲染容器与 View。
 * 这不是产品实现，只用于验证提案的公共契约（见 docs/proposals/workbench-view-host.md）。
 */
import {computed, ref, watch} from "vue";
import {createGrid, GRID_SNAPSHOT_VERSION, type GridBranch, type GridLeaf, type GridNode} from "@notnotype/nb-ui/components";
import SpikeBranch from "./SpikeBranch.vue";
import DiagnosticsRail from "./DiagnosticsRail.vue";
import {labelOf, SPIKE_CONTAINERS, SPIKE_VIEWS, type SpikeViewDescriptor} from "./descriptors";
import {createSpikeContext, evaluateAuthority, evaluateWhen} from "./context";
import {resolveFactory} from "./factories";

function leaf(id: string, size: number, minimumSize = 80, maximumSize = 900): GridLeaf<string> {
    return {kind: "leaf", id, ref: id, minimumSize, maximumSize, size};
}

/** 初始拓扑：面板在编辑器中列（嵌套），可被移到整行（跨全宽）。 */
function initialTree(): GridNode<string> {
    return {
        kind: "branch",
        id: "root",
        orientation: "vertical",
        children: [
            {
                kind: "branch",
                id: "main",
                orientation: "horizontal",
                children: [
                    leaf("activity", 64, 48, 96),
                    leaf("sidebar-left", 280, 180, 520),
                    {kind: "branch", id: "center", orientation: "vertical", children: [leaf("editor", 520, 240, 1200), leaf("panel", 200, 120, 600)]},
                    leaf("sidebar-right", 300, 180, 520),
                ],
            },
            leaf("statusbar", 28, 24, 48),
        ],
    };
}

const grid = ref(createGrid(initialTree()));
const sizes = ref<Record<string, number>>({...grid.value.layout().sizes});
const issues = ref<string[]>([]);
const notices = ref<string[]>([]);
const context = createSpikeContext();

const hidden = ref<string[]>([]);
const instantiated = ref<string[]>([]);
const factoryErrors = ref<Record<string, string>>({});
const factoryRun = ref(0);

/** 懒实例化：可见且未被隐藏的 View 首次渲染时才解析 factory。 */
function visibleViewsOf(containerId: string): SpikeViewDescriptor[] {
    return SPIKE_VIEWS
        .filter((view) => view.container === containerId)
        .filter((view) => !hidden.value.includes(view.id))
        .filter((view) => evaluateWhen(view.when, context).visible)
        .sort((a, b) => a.order - b.order);
}

function unavailableOf(containerId: string): {id: string; reason?: string}[] {
    return SPIKE_VIEWS
        .filter((view) => view.container === containerId)
        .filter((view) => !hidden.value.includes(view.id))
        .map((view) => ({id: view.id, reason: evaluateWhen(view.when, context).reason}))
        .filter((item): item is {id: string; reason: string} => Boolean(item.reason));
}

/**
 * 懒实例化：只在 View 首次可见时解析 factory（渲染期不做任何副作用）。
 * 失败只落在该 View 上，其他 View 继续工作。
 */
type FactoryState = {kind: "ok"; ref: string} | {kind: "error"; reason: string};
const factoryStates = ref<Record<string, FactoryState>>({});

function resolveVisibleFactories() {
    const next = {...factoryStates.value};
    for (const view of SPIKE_VIEWS) {
        const container = SPIKE_CONTAINERS.find((item) => item.id === view.container);
        const visible = !hidden.value.includes(view.id) && evaluateWhen(view.when, context).visible;
        if (!container || !visible || next[view.id]) {
            continue;
        }
        if (!instantiated.value.includes(view.id)) {
            instantiated.value = [...instantiated.value, view.id];
        }
        const resolution = resolveFactory(view.factoryKey);
        next[view.id] = resolution.kind === "error" ? {kind: "error", reason: resolution.reason} : {kind: "ok", ref: resolution.ref};
    }
    factoryStates.value = next;
    factoryErrors.value = Object.fromEntries(Object.entries(next).filter(([, state]) => state.kind === "error").map(([id, state]) => [id, (state as {reason: string}).reason]));
}

watch([instantiated, hidden, context.project, context.selection, context.job], resolveVisibleFactories, {immediate: true});

function syncSizes() {
    const layout = grid.value.layout();
    sizes.value = {...layout.sizes};
    issues.value = layout.issues;
}

function onResize(id: string, deltaPx: number) {
    const result = grid.value.resize(id, deltaPx);
    if (!result.ok) {
        issues.value = [...issues.value, result.reason];
        return;
    }
    syncSizes();
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
        const result = grid.value.restore({version: 99, root: grid.value.serialize().root}, (ref) => ref);
        notices.value = ["版本不符：" + String(result.reason ?? "")];
        return;
    }
    if (kind === "empty-branch") {
        grid.value.removeLeaf("panel");
        grid.value.removeLeaf("editor");
        syncSizes();
        notices.value = ["已删空 center 分支：空分支塌陷，根收敛为单叶。"];
        return;
    }
    const snapshot = JSON.parse(JSON.stringify(grid.value.serialize())) as {version: number; root: GridNode<string>};
    if (kind === "unknown-ref") {
        (snapshot.root as GridBranch<string>).children.push({kind: "leaf", id: "ghost", ref: "ghost-ref", minimumSize: 10, maximumSize: 100, size: 50} as GridLeaf<string>);
        const result = grid.value.restore(snapshot, (ref) => (ref === "ghost-ref" ? null : ref));
        notices.value = ["未知 ref：丢弃 " + String(result.dropped.length) + " 个叶子（" + result.dropped.map((item) => item.ref).join("、") + "）。"];
    } else {
        (snapshot.root as GridBranch<string>).children.push({kind: "leaf", id: "dup", ref: "activity", minimumSize: 10, maximumSize: 100, size: 50} as GridLeaf<string>);
        const result = grid.value.restore(snapshot, (ref) => ref);
        notices.value = ["重复 ref：" + String(result.reason ?? "已拒绝")];
    }
    syncSizes();
}

function rerunFactories() {
    factoryRun.value += 1;
    instantiated.value = [];
    factoryStates.value = {};
    factoryErrors.value = {};
    resolveVisibleFactories();
    notices.value = ["已重跑 factory 解析。"];
}

const staleNotice = ref("");
function simulateStaleAsync() {
    const target = "spike.jobs";
    const token = grid.value.serialize().version;
    staleNotice.value = "请求已发出（目标 " + target + "）…";
    window.setTimeout(() => {
        staleNotice.value = "迟到结果被标记为 superseded（token " + String(token) + "），未写入当前视图。";
    }, 600);
}

function reset() {
    grid.value = createGrid(initialTree());
    syncSizes();
    notices.value = ["布局已重置。"];
}

syncSizes();
</script>

<template>
    <div class="flex h-dvh min-h-0 w-screen max-w-full" data-lab-subject>
        <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <SpikeBranch :node="grid.root() as GridBranch<unknown>" :sizes="sizes" :on-resize="onResize">
                <template #leaf="{leafId}">
                    <div v-if="leafId === 'activity'" class="flex h-full flex-col items-center gap-[var(--space-2)] bg-[var(--bg-subtle)] py-[var(--space-3)]">
                        <span v-for="container in SPIKE_CONTAINERS" :key="container.id" class="flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] bg-[var(--bg-subtle)] text-[var(--text-2xs)] text-[var(--text-muted)]" :title="labelOf(container.titleKey)"><span :class="container.icon" class="h-4 w-4" aria-hidden="true"></span></span>
                    </div>
                    <div v-else-if="leafId === 'editor'" class="flex h-full min-h-0 flex-col overflow-hidden p-[var(--space-6)]">
                        <h1 class="text-[var(--text-sm)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">编辑器区（Editor Part，第一版单组）</h1>
                        <p class="mt-[var(--space-2)] text-[var(--text-xs)] text-[var(--text-secondary)]">Tab 与分屏不在本探针范围；这里只占位说明拆分树不装组件、也不接管编辑器状态。</p>
                    </div>
                    <div v-else-if="leafId === 'statusbar'" class="flex h-full items-center gap-[var(--space-2)] bg-[var(--bg-subtle)] px-[var(--space-3)] text-[var(--text-2xs)] text-[var(--text-muted)]">
                        <span>状态栏（第一版固定底部）</span>
                        <span v-if="staleNotice">{{ staleNotice }}</span>
                    </div>
                    <div v-else class="flex h-full min-h-0 flex-col">
                        <div class="shrink-0 border-b border-[var(--divider)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--text-xs)] [font-weight:var(--weight-medium)] text-[var(--text-main)]">
                            {{ labelOf(SPIKE_CONTAINERS.find((item) => item.location === leafId || item.id.endsWith(leafId))?.titleKey ?? leafId) }}
                        </div>
                        <ul class="flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto p-[var(--space-2)]">
                            <li
                                v-for="view in visibleViewsOf(SPIKE_CONTAINERS.find((item) => item.location === leafId || item.id.endsWith(leafId))?.id ?? '')"
                                :key="view.id"
                                class="rounded-[var(--radius-control)] border border-[var(--divider)] p-[var(--space-2)]"
                            >
                                <div class="flex items-center justify-between gap-[var(--space-2)]">
                                    <span class="flex min-w-0 items-center gap-[var(--space-2)]">
                                        <span :class="view.icon" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                                        <span class="truncate text-[var(--text-xs)] text-[var(--text-main)]">{{ labelOf(view.titleKey) }}</span>
                                        <span class="shrink-0 text-[var(--text-2xs)] text-[var(--text-muted)]">{{ view.layout }}</span>
                                    </span>
                                    <span class="shrink-0 text-[var(--text-2xs)] text-[var(--text-muted)]">
                                        {{ view.canMoveView ? "可移动" : "不可移动" }}
                                    </span>
                                </div>
                                <p v-if="factoryStates[view.id]?.kind === 'error'" class="mt-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-main)]">{{ (factoryStates[view.id] as {reason: string}).reason }}</p>
                                <p v-else-if="!evaluateAuthority(view.requiredAuthority, context).actionable" class="mt-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-secondary)]">
                                    动作不可用：{{ evaluateAuthority(view.requiredAuthority, context).reason }}
                                </p>
                                <p v-else class="mt-[var(--space-1)] text-[var(--text-2xs)] text-[var(--text-secondary)]">
                                    {{ factoryStates[view.id]?.kind === "ok" ? "已实例化：" + (factoryStates[view.id] as {ref: string}).ref : "等待首次可见" }}
                                </p>
                            </li>
                            <li v-for="item in unavailableOf(SPIKE_CONTAINERS.find((entry) => entry.location === leafId || entry.id.endsWith(leafId))?.id ?? '')" :key="item.id" class="px-[var(--space-2)] text-[var(--text-2xs)] text-[var(--text-muted)]">
                                不可见：{{ labelOf(SPIKE_VIEWS.find((view) => view.id === item.id)?.titleKey ?? item.id) }}（{{ item.reason }}）
                            </li>
                        </ul>
                    </div>
                </template>
            </SpikeBranch>
        </div>
        <DiagnosticsRail
            :snapshot-json="JSON.stringify(grid.serialize(), null, 1)"
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
        />
    </div>
</template>
