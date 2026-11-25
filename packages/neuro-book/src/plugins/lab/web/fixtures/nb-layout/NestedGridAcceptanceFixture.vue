<script setup lang="ts">
/**
 * NestedGrid 的手势与两轴几何验收场景（docs/specs/ui/nested-grid.md，断言在 e2e/lab-nested-grid.e2e.ts）。
 *
 * 夹具自己扮演宿主：建一棵 外层左右 + 内层上下 的树，用 `useGridHost` 求布局、接纳手势提交，并把提交次数、提交载荷、
 * 诊断与恢复结果写成 `data-lab-*` 属性，真实浏览器测试据此断言。所以树和布局不来自场景输入，场景 id 只决定用哪份快照恢复。
 * 事件日志（`.acc-events__*`）同样画在舞台里：e2e 按提交次数断言事件个数，不能依赖 Lab 的事件页签是否展开。
 */
import {computed, ref, shallowRef, watch} from "vue";

import {
    createGrid,
    GRID_SNAPSHOT_VERSION,
    type Grid,
    type GridAxis,
    type GridBranchChange,
    type GridBranchInput,
    type GridDroppedRef,
    type GridFailure,
    type GridGestureCancellation,
    type GridGestureStart,
    type GridIssue,
    type GridLayoutResult,
    type GridNode,
    type GridRestoreResult,
    type GridSashRef,
    type GridSnapshot,
} from "@notnotype/nb-layout";
import {NestedGrid, useGridHost} from "@notnotype/nb-layout/vue";
import {Checkbox} from "@notnotype/nb-ui/components";

import GridLeavingScene from "./GridLeavingScene.vue";
import GridPanelsScene from "./GridPanelsScene.vue";
import GridStructureScene from "./GridStructureScene.vue";
import GridSwapScene from "./GridSwapScene.vue";
import StarterScene from "./StarterScene.vue";
import LivePanelsScene from "./LivePanelsScene.vue";
import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabEventSink} from "../../lab-event-sink";
import type {LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();

const recordLabEvent = useLabEventSink();

/** 场景属性。标签文字是 e2e 与使用者认的名字，改动要同步。 */
const CONTROLS = [
    {id: "disabled", label: "禁用"},
    {id: "forceOverConstrained", label: "模拟过约束降级"},
    {id: "zeroInnerSash", label: "内层分隔条零高"},
] as const;

/** 事件日志只收录这几种事件。 */
const LOGGED_EVENTS: readonly string[] = ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel", "restore"];

type LoggedEvent = {id: number; name: string};
const events = ref<LoggedEvent[]>([]);
let eventCounter = 0;

/** 同时进事件日志（最新在上，最多 200 条）和 Lab 的事件页签。 */
function emitLabEvent(name: string, payload?: unknown): void {
    recordLabEvent(name, payload);
    if (!LOGGED_EVENTS.includes(name)) return;
    eventCounter += 1;
    events.value = [{id: eventCounter, name}, ...events.value].slice(0, 200);
}

const controls = ref<Record<string, boolean>>({});
const disabled = computed(() => controls.value.disabled === true);
const forceOverConstrained = computed(() => controls.value.forceOverConstrained === true);
const zeroInnerSash = computed(() => controls.value.zeroInnerSash === true);

const outerSashPx = ref(7);
const innerSashPx = computed(() => (zeroInnerSash.value ? 0 : 7));
const outerSashSizes = computed(() => [outerSashPx.value] as const);
const innerSashSizes = computed(() => [innerSashPx.value] as const);

const layoutEpoch = ref(0);

/** 手势提交记录：整份替换而不逐字段改，重置只需换回 `NO_GESTURE`。 */
type GestureRecord = {
    /** 只有实际产生尺寸改变的 gesture-end 才递增；挂载、视口变化、测量与程序布局均为 0。 */
    count: number;
    state: "none" | "commit" | "cancel";
    source: "none" | "pointer" | "keyboard";
    sash: string;
    active: readonly string[];
    compensated: readonly string[];
    payload: string;
    text: string;
};
const NO_GESTURE: GestureRecord = {
    count: 0,
    state: "none",
    source: "none",
    sash: "",
    active: [],
    compensated: [],
    payload: "",
    text: "尚无用户调整提交",
};
const gesture = shallowRef<GestureRecord>(NO_GESTURE);
/** Renderer 的手势诊断（容量不足、提交被拒绝）：与布局诊断一起显示，不冒充布局降级。 */
const gestureIssues = ref<readonly (GridIssue | GridFailure)[]>([]);
/** 夹具自己的去重键，同库里通知用的键：码、`cause`、轴与所在的节点。 */
function issueKeyOf(issue: GridIssue): string {
    const params = issue.params ?? {};
    return [issue.code, params.cause ?? "", params.axis ?? "", params.id ?? ""].join("\u0000");
}
const visibleIssues = computed(() => {
    const seen = new Set<string>();
    const messages: string[] = [];
    for (const issue of [...layout.value.issues, ...gestureIssues.value]) {
        const key = issueKeyOf(issue);
        if (!seen.has(key)) {
            seen.add(key);
            messages.push(issue.message);
        }
    }
    return messages;
});

// 恢复场景事实：原件记录在内存、过滤情况与拒绝原因
type RestoreRecord = {
    status: "success" | "dropped-unknown" | "rejected";
    reason: string;
    /** 恢复失败的码与版本：e2e 按码判，不按文字。 */
    code: string;
    version: string;
    dropped: readonly GridDroppedRef[];
};
const RESTORE_OK: RestoreRecord = {status: "success", reason: "", code: "", version: "", dropped: []};
const restore = shallowRef<RestoreRecord>(RESTORE_OK);
const rawRecordRef = ref<unknown>(null);

/** 进行中的手势：只用于把取消回执翻成可读标识；尺寸与收起事实一律来自提交载荷。 */
let activeSashes: readonly GridSashRef[] = [];

/** 当前网格实例：换场景会整棵替换，宿主据此重新发布几何。 */
const gridRef = shallowRef<Grid<string> | null>(null);

/** 网格宿主：尺寸取自 `NestedGrid` 量的根盒，布局、失效版本与一次手势的原子落账都由它提供，本夹具只接通知。 */
const host = useGridHost<string>({
    grid: gridRef,
    contextKey: gestureContextKey,
    disabled,
    // 只数手势提交：夹具改树都经 `grid.*` 再 `invalidate()`，那不通知。
    onApplied: (applied) => {
        if (applied.kind !== "gesture") return;
        const commit = applied.commit;
        for (const change of commit.changes) {
            syncRawRecordIntent(change.branchId, change.axis);
        }
        const active = commit.changes.flatMap((change) => [...change.active]);
        const compensated = commit.changes.flatMap((change) => [...change.compensated]);
        const sash = activeSashes.map(sashLabelOf).join(" + ");
        gesture.value = {
            count: gesture.value.count + 1,
            state: "commit",
            source: commit.source,
            sash,
            active,
            compensated,
            payload: JSON.stringify(commit),
            text: `提交 · ${commit.source} · ${sash} · 主动 [${active.join(", ")}] · 补偿 [${compensated.join(", ")}]`,
        };
    },
    onIssues: pushIssues,
});

/** 呈现的几何：宿主按当前树与承载盒发布，夹具不再自己测量或重算。 */
const layout = host.layout;
/** 承载盒的读数：`NestedGrid` 量到的根盒（布局盒，不受 Lab 舞台淡入时的缩放影响）。 */
const containerSize = computed(() => host.extent.value ?? {width: 0, height: 0});

/** 诊断去重：布局降级与手势诊断来自两处，展示成一份列表。 */
function pushIssues(issues: readonly (GridIssue | GridFailure)[]): void {
    const keys = new Set(gestureIssues.value.map(issueKeyOf));
    const fresh = issues.filter((issue) => {
        const key = issueKeyOf(issue);
        if (keys.has(key)) return false;
        keys.add(key);
        return true;
    });
    if (fresh.length > 0) gestureIssues.value = [...gestureIssues.value, ...fresh];
}

/** 手势的副作用上下文：场景与布局代次都变了就不再接受旧基线的提交。 */
function gestureContextKey(): string {
    return `nested-grid:${props.scene}:${layoutEpoch.value}`;
}

/** 分隔线的可读标识：所属分支的第 index 条边界 → 两侧直接子节点 id（`left~right`）。 */
function sashLabelOf(sash: {branchId: string; index: number}): string {
    const branch = gridRef.value?.find(sash.branchId);
    if (!branch || branch.kind !== "branch") {
        return `${sash.branchId}:${sash.index}`;
    }
    const before = branch.children[sash.index]?.id;
    const after = branch.children[sash.index + 1]?.id;
    return before !== undefined && after !== undefined ? `${before}~${after}` : `${sash.branchId}:${sash.index}`;
}

function onGestureStart(info: GridGestureStart): void {
    activeSashes = info.sashes;
    gesture.value = {...gesture.value, source: info.source};
    emitLabEvent("gesture-start", info);
}

function defaultTreeInput(): GridBranchInput<string> {
    const leftMinW = forceOverConstrained.value ? 600 : 80;
    const rightMinW = forceOverConstrained.value ? 600 : 120;
    return {
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        size: {width: 800, height: 450},
        children: [
            {
                kind: "leaf",
                id: "left",
                ref: "outline",
                size: {width: 240, height: 450},
                minimumSize: {width: leftMinW, height: 0},
                maximumSize: {width: 420, height: 10000},
            },
            {
                kind: "branch",
                id: "right",
                orientation: "vertical",
                size: {width: 560, height: 450},
                minimumSize: {width: rightMinW, height: 0},
                children: [
                    {
                        kind: "leaf",
                        id: "top",
                        ref: "editor",
                        size: {width: 560, height: 270},
                        minimumSize: {width: 0, height: 80},
                        maximumSize: {width: 10000, height: 600},
                    },
                    {
                        kind: "leaf",
                        id: "bottom",
                        ref: "terminal",
                        size: {width: 560, height: 180},
                        minimumSize: {width: 0, height: 60},
                        maximumSize: {width: 10000, height: 400},
                    },
                ],
            },
        ],
    };
}

function initScene(sceneId: string): void {
    const tree = defaultTreeInput();
    gridRef.value = createGrid(tree, {
        sashSize: (branchId) => (branchId === "root" ? outerSashPx.value : innerSashPx.value),
    });

    if (sceneId === "default") {
        restore.value = RESTORE_OK;
        rawRecordRef.value = gridRef.value.serialize();
    } else if (sceneId === "unknown-ref") {
        // (a) 未知引用：在右侧上下分栏中混入未知插件节点 ghost-plugin
        const snapshotWithUnknown: GridSnapshot = {
            version: GRID_SNAPSHOT_VERSION,
            root: {
                kind: "branch",
                id: "root",
                orientation: "horizontal",
                size: {width: 800, height: 450},
                children: [
                    {kind: "leaf", id: "left", ref: "outline", size: {width: 240, height: 450}},
                    {
                        kind: "branch",
                        id: "right",
                        orientation: "vertical",
                        size: {width: 560, height: 450},
                        children: [
                            {kind: "leaf", id: "top", ref: "editor", size: {width: 560, height: 260}},
                            {kind: "leaf", id: "bottom", ref: "terminal", size: {width: 560, height: 190}},
                            {kind: "leaf", id: "ghost-plugin", ref: "unknown-plugin-view", size: {width: 560, height: 100}},
                        ],
                    },
                ],
            },
        };
        rawRecordRef.value = structuredClone(snapshotWithUnknown);
        const res = gridRef.value.restore(snapshotWithUnknown, (ref) =>
            ref === "unknown-plugin-view" ? null : {ref},
        );
        restore.value = {
            status: "dropped-unknown",
            reason: "过滤未解析引用：unknown-plugin-view（原件在内存完整保留）",
            code: "",
            version: "",
            dropped: res.dropped,
        };
        emitLabEvent("restore", res);
    } else if (sceneId === "malformed") {
        // (b) 畸形快照：存在重复节点身份 id: "left"，应被整体拒绝且不半更新
        const malformedSnapshot = {
            version: GRID_SNAPSHOT_VERSION,
            root: {
                kind: "branch",
                id: "root",
                orientation: "horizontal",
                size: {width: 800, height: 450},
                children: [
                    {kind: "leaf", id: "left", ref: "outline", size: {width: 300, height: 450}},
                    {kind: "leaf", id: "left", ref: "duplicate-ref", size: {width: 500, height: 450}},
                ],
            },
        };
        rawRecordRef.value = structuredClone(malformedSnapshot);
        const res = gridRef.value.restore(malformedSnapshot, (ref) => ({ref}));
        showRestoreFailure(res);
        emitLabEvent("restore", res);
    } else if (sceneId === "high-version") {
        // (c) 不兼容版本：version 99（更高版本）拒绝恢复并保留原件
        const highVersionSnapshot = {
            version: 99,
            root: {
                kind: "branch",
                id: "root",
                orientation: "horizontal",
                size: {width: 800, height: 450},
                children: [
                    {kind: "leaf", id: "left", ref: "outline", size: {width: 300, height: 450}},
                    {kind: "leaf", id: "right", ref: "editor", size: {width: 500, height: 450}},
                ],
            },
        };
        rawRecordRef.value = structuredClone(highVersionSnapshot);
        const res = gridRef.value.restore(highVersionSnapshot, (ref) => ({ref}));
        showRestoreFailure(res);
        emitLabEvent("restore", res);
    }

    host.invalidate();
}

/** 原件里的节点记录；`unknown-ref` 场景里混入的未知节点在运行时的树中不存在，不会被动到。 */
type RawNode = {id: string; kind: string; size: {width: number; height: number}; children?: RawNode[]};

/** 把运行时树里 `parent` 各孩子在 `axis` 上的尺寸抄回原件里同 id 的孩子。 */
function copySizes(rawParent: RawNode, parent: GridNode<string>, axis: GridAxis): void {
    if (parent.kind !== "branch") return;
    for (const child of parent.children) {
        const raw = rawParent.children?.find((c) => c.id === child.id);
        if (raw) raw.size[axis] = child.size[axis];
    }
}

/** 调整已知节点后同步更新原件内存记录，确保未识别节点不被抹除 */
function syncRawRecordIntent(branchId: string, axis: GridAxis): void {
    if (!rawRecordRef.value || typeof rawRecordRef.value !== "object") return;
    const rawRoot = (rawRecordRef.value as {root?: RawNode}).root;
    if (!rawRoot || rawRoot.kind !== "branch") return;
    const root = gridRef.value?.root();
    if (!root || root.kind !== "branch") return;

    if (branchId === "root" && axis === "width") {
        copySizes(rawRoot, root, "width");
    } else if (branchId === "right" && axis === "height") {
        const right = root.children.find((c) => c.id === "right");
        const rawRight = rawRoot.children?.find((c) => c.id === "right");
        if (right && rawRight && rawRight.kind === "branch") copySizes(rawRight, right, "height");
    }
}

// 手势处理：提交由宿主接纳；preview 与取消只做观测与回执展示
function onGestureUpdate(preview: {layout: GridLayoutResult; changes: readonly GridBranchChange[]}): void {
    emitLabEvent("gesture-update", preview);
}

function onGestureCancel(info: GridGestureCancellation): void {
    const label = info.sashes.map(sashLabelOf).join(" + ");
    emitLabEvent("gesture-cancel", info);
    gesture.value = {
        ...gesture.value,
        state: "cancel",
        sash: label,
        payload: JSON.stringify(info),
        text: `未提交 · ${info.reason} · ${label}`,
    };
}

/** 程序布局重排：直接改意图并重算呈现，不产生任何用户手势提交 */
function triggerProgrammaticLayout(): void {
    if (!gridRef.value) return;
    const currentLeft = layout.value.sizes.left?.width ?? 240;
    const currentRight = layout.value.sizes.right?.width ?? 560;
    const total = currentLeft + currentRight;
    // 左右调整 40px
    const newLeft = currentLeft > 280 ? currentLeft - 40 : currentLeft + 40;
    const baseline = {left: currentLeft, right: currentRight};
    const target = {left: newLeft, right: total - newLeft};
    const res = gridRef.value.resizeBranches([{branchId: "root", axis: "width", baseline, target}]);
    if (res.ok) {
        host.invalidate();
        layoutEpoch.value++;
    }
}

/** 恢复被拒：显示失败的英文 message，码与版本写进属性。 */
function showRestoreFailure(res: GridRestoreResult): void {
    const version = res.ok ? undefined : res.params?.version;
    restore.value = {
        status: "rejected",
        reason: res.ok ? "" : res.message,
        code: res.ok ? "" : res.code,
        version: version === undefined ? "" : String(version),
        dropped: [],
    };
}

/** 重置状态 */
function resetState(): void {
    controls.value = Object.fromEntries(CONTROLS.map((control) => [control.id, false]));
    events.value = [];
    gesture.value = NO_GESTURE;
    gestureIssues.value = [];
    activeSashes = [];
    initScene(props.scene);
    layoutEpoch.value++;
}

/** 布局发布即上报：Lab 事件日志与状态栏都消费同一份事实。 */
watch(layout, (next) => {
    emitLabEvent("layout", next);
});

watch(() => props.scene, resetState, {immediate: true});

watch(
    () => [forceOverConstrained.value, zeroInnerSash.value],
    () => {
        initScene(props.scene);
        layoutEpoch.value++;
    },
);

function formatPx(val?: number): string {
    return val !== undefined ? `${Math.round(val * 10) / 10}px` : "--";
}
</script>

<template>
    <GridStructureScene v-if="scene === 'structure'" />
    <GridPanelsScene v-else-if="scene === 'panels'" />
    <GridSwapScene v-else-if="scene === 'swap'" />
    <GridLeavingScene v-else-if="scene === 'leaving'" />
    <LivePanelsScene v-else-if="scene === 'live-panels'" />
    <!-- README 的起步例子原样搬来（nb-layout 的 readme.test.ts 核对两边一字不差），Lab 要的标记包在外面。 -->
    <div v-else-if="scene === 'starter'" data-lab-subject style="height: 100%; padding: 8px">
        <StarterScene />
    </div>
    <div v-else class="flex w-full min-w-0 flex-col gap-4">
        <!-- 主工作区卡片容器 -->
        <div class="nested-grid-card mx-auto flex h-[520px] w-full min-w-0 max-w-[880px] flex-col overflow-hidden p-0">
            <!-- 顶栏标题与操作区 -->
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)]">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-grid-2x2 text-[var(--accent-main)] h-4 w-4 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 truncate text-xs font-bold text-[var(--text-main)]">嵌套 Grid 工作区 (外层左右 + 内层上下)</span>
                    <span
                        class="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                        :class="scene === 'default' ? 'bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)]' : 'bg-[color-mix(in_srgb,var(--status-warning,#eab308)_15%,transparent)] text-[var(--status-warning,#eab308)]'"
                    >
                        {{ scene }}
                    </span>
                </div>

                <div class="flex items-center gap-2">
                    <button
                        type="button"
                        data-lab-action="programmatic-layout"
                        class="px-2.5 py-1 text-[11px] font-medium rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_80%,transparent)] hover:bg-[var(--bg-main)] text-[var(--text-main)] transition-colors cursor-pointer"
                        title="触发程序布局：直接调用原语计算呈现，零手势提交"
                        @click="triggerProgrammaticLayout"
                    >
                        程序重排 (零提交)
                    </button>
                    <button
                        type="button"
                        data-lab-action="reset"
                        class="px-2.5 py-1 text-[11px] font-medium rounded-[var(--radius-control)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_80%,transparent)] hover:bg-[var(--bg-main)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                        @click="resetState"
                    >
                        重置
                    </button>
                </div>
            </div>

            <!-- 两轴几何指标事实条 -->
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-1.5 bg-[color-mix(in_srgb,var(--bg-main)_50%,transparent)] border-b border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] text-[11px] font-mono">
                <!-- 外层主要求横向 -->
                <div class="flex items-center gap-2">
                    <span class="text-[var(--text-muted)] font-sans text-[10px]">外层主要求 (W):</span>
                    <span data-lab-size-left class="text-[var(--text-main)] font-semibold">左 {{ formatPx(layout.sizes.left?.width) }}</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-sash-root class="text-[var(--accent-main)] font-semibold">外sash {{ outerSashPx }}px</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-size-right class="text-[var(--text-main)] font-semibold">右 {{ formatPx(layout.sizes.right?.width) }}</span>
                    <span class="text-[var(--text-muted)]">=</span>
                    <span data-lab-total-width class="text-[var(--text-secondary)]">{{ formatPx(layout.sizes.root?.width) }}</span>
                </div>

                <!-- 内层主要求纵向 -->
                <div class="flex items-center gap-2">
                    <span class="text-[var(--text-muted)] font-sans text-[10px]">内层主要求 (H):</span>
                    <span data-lab-size-top class="text-[var(--text-main)] font-semibold">上 {{ formatPx(layout.sizes.top?.height) }}</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-sash-right class="text-[var(--accent-main)] font-semibold">内sash {{ innerSashPx }}px</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-size-bottom class="text-[var(--text-main)] font-semibold">下 {{ formatPx(layout.sizes.bottom?.height) }}</span>
                    <span class="text-[var(--text-muted)]">=</span>
                    <span data-lab-total-height class="text-[var(--text-secondary)]">{{ formatPx(layout.sizes.right?.height) }}</span>
                </div>
            </div>

            <!-- 分割工作区：#nb-lab-target 是测试注入与观测的容器 -->
            <div id="nb-lab-target" class="flex-1 min-h-0 w-full relative overflow-hidden">
                <NestedGrid
                    data-lab-subject
                    v-bind="host.bindings.value"
                    @gesture-start="onGestureStart"
                    @gesture-update="onGestureUpdate"
                    @gesture-end="emitLabEvent('gesture-end', $event)"
                    @gesture-cancel="onGestureCancel"
                >
                    <template #leaf="{node}">
                        <div v-if="node.id === 'left'" class="p-3.5 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--bg-sidebar,var(--bg-panel))_70%,transparent)] flex flex-col gap-2.5">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">大纲导航</span>
                                <span class="text-[10px] font-mono text-[var(--text-muted)]">W: {{ formatPx(layout.sizes.left?.width) }}</span>
                            </div>
                            <div class="space-y-1 text-xs">
                                <div class="p-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--accent-main)_10%,transparent)] text-[var(--text-main)] font-medium border border-[color-mix(in_srgb,var(--accent-main)_20%,transparent)] flex items-center justify-between">
                                    <span>01. 神经连接.md</span>
                                    <span class="text-[10px] text-[var(--accent-main)] font-mono">ACTIVE</span>
                                </div>
                                <div class="p-2 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] transition-colors">
                                    02. 赛博黑市.md
                                </div>
                                <div class="p-2 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] transition-colors">
                                    03. 幽灵协议.md
                                </div>
                                <div class="p-2 rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] transition-colors">
                                    04. 意识重构.md
                                </div>
                            </div>
                        </div>

                        <div v-else-if="node.id === 'top'" class="p-4 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col gap-2">
                            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] pb-2">
                                <h2 class="text-sm font-bold text-[var(--text-main)]">第一章：深渊苏醒</h2>
                                <span class="text-[10px] font-mono text-[var(--text-muted)]">H: {{ formatPx(layout.sizes.top?.height) }}</span>
                            </div>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息。
                            </p>
                            <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                墙上的时钟停在 03:42。他撑起沉重的右臂——那是上周在黑市调试的军规潜行臂，散热阀依然散发着刺鼻的机油味。
                            </p>
                        </div>

                        <div v-else class="p-3 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] flex flex-col gap-2 text-xs">
                            <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] pb-1.5">
                                <span class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">实时诊断与终端</span>
                                <span class="text-[10px] font-mono text-[var(--text-muted)]">H: {{ formatPx(layout.sizes.bottom?.height) }}</span>
                            </div>
                            <div class="font-mono text-[11px] space-y-1 text-[var(--text-secondary)]">
                                <div>> 两轴几何计算状态：正常守恒</div>
                                <div>> 容器几何：{{ Math.round(containerSize.width) }} × {{ Math.round(containerSize.height) }} px</div>
                                <div>> 降级诊断数：{{ visibleIssues.length }}</div>
                            </div>
                        </div>
                    </template>
                </NestedGrid>
            </div>

            <!-- 底部状态栏与事实汇报区 -->
            <div class="flex min-w-0 flex-col gap-1.5 px-4 py-2 border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] text-[11px]">
                <!-- 手势可观察事实：提交次数、主动与被动补偿字段、Sash 标识 -->
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span
                        class="min-w-0 flex-1 truncate font-mono text-[var(--text-main)]"
                        data-lab-gesture
                        :data-lab-commit-count="gesture.count"
                        :data-lab-gesture-state="gesture.state"
                        :data-lab-gesture-source="gesture.source"
                        :data-lab-last-sash="gesture.sash"
                        :data-lab-last-active="JSON.stringify(gesture.active)"
                        :data-lab-last-compensated="JSON.stringify(gesture.compensated)"
                        :data-lab-gesture-payload="gesture.payload"
                        :title="gesture.text"
                    >
                        用户调整: 提交次数 {{ gesture.count }} · {{ gesture.text }}
                    </span>

                    <!-- 降级诊断指示：布局降级与手势诊断分开来源、同一个出口 -->
                    <div
                        data-lab-issues-container
                        :data-lab-issues="JSON.stringify(visibleIssues)"
                        :data-lab-has-issues="visibleIssues.length > 0"
                        class="shrink-0 flex items-center gap-1.5"
                    >
                        <span
                            v-if="visibleIssues.length === 0"
                            class="px-2 py-0.5 rounded text-[10px] font-mono bg-[color-mix(in_srgb,var(--status-info,#3b82f6)_12%,transparent)] text-[var(--status-info,#3b82f6)] font-medium"
                        >
                            几何正常 · 0 降级
                        </span>
                        <span
                            v-else
                            class="px-2 py-0.5 rounded text-[10px] font-mono bg-[color-mix(in_srgb,var(--status-warning,#eab308)_15%,transparent)] text-[var(--status-warning,#eab308)] font-semibold"
                        >
                            降级诊断 ({{ visibleIssues.length }}): {{ visibleIssues.join("; ") }}
                        </span>
                    </div>
                </div>

                <!-- 快照恢复可观察事实 -->
                <div
                    data-lab-recovery
                    :data-lab-restore-status="restore.status"
                    :data-lab-restore-reason="restore.reason"
                    :data-lab-restore-code="restore.code"
                    :data-lab-restore-version="restore.version"
                    :data-lab-dropped-count="restore.dropped.length"
                    :data-lab-raw-record="JSON.stringify(rawRecordRef)"
                    class="flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-muted)] font-mono border-t border-[color-mix(in_srgb,var(--border-color)_20%,transparent)] pt-1"
                >
                    <span class="uppercase tracking-wider">恢复记录:</span>
                    <span :class="restore.status === 'success' ? 'text-[var(--text-secondary)]' : restore.status === 'dropped-unknown' ? 'text-[var(--status-info,#3b82f6)]' : 'text-[var(--status-warning,#eab308)]'">
                        {{ restore.status }} {{ restore.reason ? `(${restore.reason})` : '' }}
                    </span>
                    <span v-if="restore.dropped.length > 0" class="text-[var(--text-secondary)]">
                        · 未解析: {{ restore.dropped.map((d) => d.ref).join(", ") }}
                    </span>
                </div>
            </div>
        </div>

        <!-- 事件日志：只在舞台里画一份，e2e 按行数断言 -->
        <section class="acc-events" aria-label="事件日志">
            <p class="acc-events__header text-[length:var(--text-2xs)] text-[var(--text-muted)]">事件（最新在上）</p>
            <ol class="m-0 list-none p-0 font-mono text-[length:var(--text-xs)]">
                <li v-for="item in events" :key="item.id" class="acc-events__row">
                    <span class="acc-events__name">{{ item.name }}</span>
                </li>
            </ol>
        </section>

        <!-- 场景属性：切换后夹具按新属性重建网格 -->
        <LabFixtureControls>
            <div class="flex flex-wrap items-center gap-3">
                <span class="text-[length:var(--text-2xs)] font-medium tracking-wider text-[var(--text-muted)]">场景属性:</span>
                <div v-for="control in CONTROLS" :key="control.id" :data-control="control.id" class="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <Checkbox
                        :model-value="controls[control.id] === true"
                        :label="control.label"
                        @update:model-value="controls = {...controls, [control.id]: $event}"
                    />
                </div>
            </div>
        </LabFixtureControls>
    </div>
</template>


<style scoped>
.nested-grid-card {
    border-radius: var(--radius-panel, 12px);
    background: color-mix(in srgb, var(--panel-surface, var(--bg-panel)) 80%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--panel-outline, var(--border-color)) 70%, transparent);
    box-shadow: 0 16px 36px -10px color-mix(in srgb, var(--shadow-color, #000) 24%, transparent),
                0 2px 6px color-mix(in srgb, var(--shadow-color, #000) 6%, transparent);
}
</style>
