<script setup lang="ts">
import {computed, nextTick, onMounted, ref, shallowRef, watch} from "vue";
import {
    createGrid,
    type Grid,
    type GridAxis,
    type GridBranchInput,
    type GridLayoutResult,
    type GridSnapshot,
} from "../../../../src/components/layout/grid";
import {useGridLayout} from "../../../../src/composables/useGridLayout";
import {useLayoutExtent} from "../../../../src/composables/useLayoutExtent";
import GridRenderer from "../../../../src/components/layout/GridRenderer.vue";
import type {GridBranchChange} from "../../../../src/components/layout/grid-gesture";
import type {GridSashRef} from "../../../../src/components/layout/sash-gesture";
import type {SplitterGestureCancelReason, SplitterGestureSource} from "../../../../src/components/layout/splitter-gesture";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const controls = ref<Record<string, string | boolean>>({});
const disabled = computed(() => controls.value.disabled === true);
const forceOverConstrained = computed(() => controls.value.forceOverConstrained === true);
const zeroInnerSash = computed(() => controls.value.zeroInnerSash === true);

const outerSashPx = ref(7);
const innerSashPx = computed(() => (zeroInnerSash.value ? 0 : 7));
const outerSashSizes = computed(() => [outerSashPx.value] as const);
const innerSashSizes = computed(() => [innerSashPx.value] as const);

const containerRef = ref<HTMLElement | null>(null);
/** 承载盒与 Renderer 用同一份布局盒测量：变换后的 rect 会把 Lab 舞台淡入的缩放算进来。 */
const containerExtent = useLayoutExtent(containerRef);
const containerSize = computed(() => containerExtent.value ?? {width: 0, height: 0});
const layoutEpoch = ref(0);

// 手势提交记录：只有实际产生尺寸改变的 gesture-end 才递增；挂载、视口变化、测量与程序布局均为 0
const commitCount = ref(0);
const lastGestureState = ref<"none" | "commit" | "cancel">("none");
const lastGestureSource = ref<"none" | "pointer" | "keyboard">("none");
const lastGestureSash = ref("");
const lastActive = ref<string[]>([]);
const lastCompensated = ref<string[]>([]);
const lastGesturePayload = ref("");
const lastGestureText = ref("尚无用户调整提交");
/** Renderer 的手势诊断（容量不足、提交被拒绝）：与布局诊断一起显示，不冒充布局降级。 */
const gestureIssues = ref<readonly string[]>([]);
const visibleIssues = computed(() => {
    const merged = [...layout.value.issues];
    for (const issue of gestureIssues.value) {
        if (!merged.includes(issue)) {
            merged.push(issue);
        }
    }
    return merged;
});

// 恢复场景事实：原件记录在内存、过滤情况与拒绝原因
const restoreStatus = ref<"success" | "dropped-unknown" | "rejected">("success");
const restoreReason = ref("");
const droppedRefs = ref<{ref: string; reason: string}[]>([]);
const rawRecordRef = ref<unknown>(null);

/** 进行中的手势：只用于把取消回执翻成可读标识；尺寸与收起事实一律来自提交载荷。 */
let activeSashes: readonly GridSashRef[] = [];

/** 当前网格实例：换场景会整棵替换，宿主据此重新发布几何。 */
const gridRef = shallowRef<Grid<string> | null>(null);

/** 网格宿主：布局、失效版本与一次手势的原子落账都由它提供，本夹具只接通知。 */
const host = useGridLayout<string>({
    grid: gridRef,
    extent: containerExtent,
    contextKey: () => gestureContextKey(),
    onApplied: (commit) => {
        for (const change of commit.changes) {
            syncRawRecordIntent(change.branchId, change.axis);
        }
        const active = commit.changes.flatMap((change) => [...change.active]);
        const compensated = commit.changes.flatMap((change) => [...change.compensated]);
        commitCount.value++;
        lastGestureState.value = "commit";
        lastGestureSource.value = commit.source;
        lastGestureSash.value = activeSashes.map(sashLabelOf).join(" + ");
        lastActive.value = active;
        lastCompensated.value = compensated;
        lastGesturePayload.value = JSON.stringify(commit);
        lastGestureText.value = `提交 · ${commit.source} · ${lastGestureSash.value} · 主动 [${active.join(", ")}] · 补偿 [${compensated.join(", ")}]`;
    },
    onIssues: pushIssues,
});

/** 呈现树与几何：宿主按当前树与承载盒发布，夹具不再自己测量或重算。 */
const layoutTree = host.node;
const layout = host.layout;

/** 诊断去重：布局降级与手势诊断来自两处，展示成一份列表。 */
function pushIssues(issues: readonly string[]): void {
    const merged = [...gestureIssues.value];
    for (const issue of issues) {
        if (!merged.includes(issue)) {
            merged.push(issue);
        }
    }
    gestureIssues.value = merged;
}

/** 手势的副作用上下文：场景与布局代次都变了就不再接受旧基线的提交。 */
function gestureContextKey(): string {
    return `${props.definition.id}:${props.sceneId}:${layoutEpoch.value}`;
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

function onGestureStart(info: {source: SplitterGestureSource; sashes: readonly GridSashRef[]}): void {
    activeSashes = info.sashes;
    lastGestureSource.value = info.source;
    emit("lab-event", "gesture-start", info);
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
        restoreStatus.value = "success";
        restoreReason.value = "";
        droppedRefs.value = [];
        rawRecordRef.value = gridRef.value.serialize();
    } else if (sceneId === "unknown-ref") {
        // (a) 未知引用：在右侧上下分栏中混入未知插件节点 ghost-plugin
        const snapshotWithUnknown: GridSnapshot = {
            version: 2,
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
        rawRecordRef.value = JSON.parse(JSON.stringify(snapshotWithUnknown));
        const res = gridRef.value.restore(snapshotWithUnknown, (ref) =>
            ref === "unknown-plugin-view" ? null : {ref},
        );
        restoreStatus.value = "dropped-unknown";
        restoreReason.value = "过滤未解析引用：unknown-plugin-view（原件在内存完整保留）";
        droppedRefs.value = res.dropped;
        emit("lab-event", "restore", res);
    } else if (sceneId === "malformed") {
        // (b) 畸形快照：存在重复节点身份 id: "left"，应被整体拒绝且不半更新
        const malformedSnapshot = {
            version: 2,
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
        rawRecordRef.value = JSON.parse(JSON.stringify(malformedSnapshot));
        const res = gridRef.value.restore(malformedSnapshot, (ref) => ({ref}));
        restoreStatus.value = "rejected";
        restoreReason.value = res.reason ?? "布局快照存在重复节点 id：left";
        droppedRefs.value = [];
        emit("lab-event", "restore", res);
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
        rawRecordRef.value = JSON.parse(JSON.stringify(highVersionSnapshot));
        const res = gridRef.value.restore(highVersionSnapshot, (ref) => ({ref}));
        restoreStatus.value = "rejected";
        restoreReason.value = res.reason ?? "布局快照版本 99 不受支持";
        droppedRefs.value = [];
        emit("lab-event", "restore", res);
    }

    host.invalidate();
}

/** 调整已知节点后同步更新原件内存记录，确保未识别节点不被抹除 */
function syncRawRecordIntent(branchId: string, axis: GridAxis): void {
    if (!rawRecordRef.value || typeof rawRecordRef.value !== "object") return;
    const envelope = rawRecordRef.value as {root?: any};
    if (!envelope.root || envelope.root.kind !== "branch") return;

    if (branchId === "root" && axis === "width") {
        const rootTree = gridRef.value?.root();
        if (rootTree && rootTree.kind === "branch") {
            const leftChild = rootTree.children.find((c) => c.id === "left");
            const rightChild = rootTree.children.find((c) => c.id === "right");
            const rawLeft = envelope.root.children.find((c: any) => c.id === "left");
            const rawRight = envelope.root.children.find((c: any) => c.id === "right");
            if (rawLeft && leftChild) rawLeft.size.width = leftChild.size.width;
            if (rawRight && rightChild) rawRight.size.width = rightChild.size.width;
        }
    } else if (branchId === "right" && axis === "height") {
        const rootTree = gridRef.value?.root();
        if (rootTree && rootTree.kind === "branch") {
            const rightBranch = rootTree.children.find((c) => c.id === "right");
            if (rightBranch && rightBranch.kind === "branch") {
                const topChild = rightBranch.children.find((c) => c.id === "top");
                const bottomChild = rightBranch.children.find((c) => c.id === "bottom");
                const rawRight = envelope.root.children.find((c: any) => c.id === "right");
                if (rawRight && rawRight.kind === "branch") {
                    const rawTop = rawRight.children.find((c: any) => c.id === "top");
                    const rawBottom = rawRight.children.find((c: any) => c.id === "bottom");
                    if (rawTop && topChild) rawTop.size.height = topChild.size.height;
                    if (rawBottom && bottomChild) rawBottom.size.height = bottomChild.size.height;
                }
            }
        }
    }
}

// 手势处理：提交由宿主接纳；preview 与取消只做观测与回执展示
function onGestureUpdate(preview: {layout: GridLayoutResult; changes: readonly GridBranchChange[]}): void {
    emit("lab-event", "gesture-update", preview);
}

function onGestureCancel(info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void {
    const label = info.sashes.map(sashLabelOf).join(" + ");
    emit("lab-event", "gesture-cancel", info);
    lastGestureState.value = "cancel";
    lastGestureSash.value = label;
    lastGesturePayload.value = JSON.stringify(info);
    lastGestureText.value = `未提交 · ${info.reason} · ${label}`;
}

/** Renderer 的手势诊断出口：容量不足、提交被拒绝都会在这里出现。 */
function onIssues(issues: readonly string[]): void {
    pushIssues(issues);
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

/** 重置状态 */
function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) {
        defaults[control.id] = controlDefaultValue(control);
    }
    controls.value = defaults;
    commitCount.value = 0;
    lastGestureState.value = "none";
    lastGestureSource.value = "none";
    lastGestureSash.value = "";
    lastActive.value = [];
    lastCompensated.value = [];
    lastGesturePayload.value = "";
    lastGestureText.value = "尚无用户调整提交";
    gestureIssues.value = [];
    activeSashes = [];
    initScene(props.sceneId);
    layoutEpoch.value++;
}

/** 布局发布即上报：Lab 事件日志与状态栏都消费同一份事实。 */
watch(layout, (next) => {
    emit("lab-event", "layout", next);
});

watch(
    () => [props.definition.id, props.sceneId],
    () => {
        resetState();
        void nextTick(() => emit("rendered"));
    },
    {immediate: true},
);

watch(
    () => [forceOverConstrained.value, zeroInnerSash.value],
    () => {
        initScene(props.sceneId);
        layoutEpoch.value++;
    },
);

onMounted(() => {
    void nextTick(() => emit("rendered"));
});

function formatPx(val?: number): string {
    return val !== undefined ? `${Math.round(val * 10) / 10}px` : "--";
}
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 主工作区卡片容器 -->
        <div class="nested-grid-card min-w-0 p-0 overflow-hidden flex flex-col w-full max-w-[880px] h-[520px]">
            <!-- 顶栏标题与操作区 -->
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[color-mix(in_srgb,var(--text-main)_4%,transparent)] border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)]">
                <div class="flex min-w-0 items-center gap-2">
                    <span class="i-lucide-grid-2x2 text-[var(--accent-main)] h-4 w-4 shrink-0" aria-hidden="true" />
                    <span class="min-w-0 truncate text-xs font-bold text-[var(--text-main)]">嵌套 Grid 工作区 (外层左右 + 内层上下)</span>
                    <span
                        class="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                        :class="sceneId === 'default' ? 'bg-[color-mix(in_srgb,var(--accent-main)_15%,transparent)] text-[var(--accent-main)]' : 'bg-[color-mix(in_srgb,var(--status-warning,#eab308)_15%,transparent)] text-[var(--status-warning,#eab308)]'"
                    >
                        {{ sceneId }}
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
            <div id="nb-lab-target" ref="containerRef" class="flex-1 min-h-0 w-full relative overflow-hidden">
                <GridRenderer
                    :node="layoutTree"
                    :layout="layout"
                    :disabled="disabled"
                    :context-key="gestureContextKey()"
                    :revision="host.revision.value"
                    :on-gesture-commit="host.onGestureCommit"
                    @gesture-start="onGestureStart"
                    @gesture-update="onGestureUpdate"
                    @gesture-end="emit('lab-event', 'gesture-end', $event)"
                    @gesture-cancel="onGestureCancel"
                    @issues="onIssues"
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
                </GridRenderer>
            </div>

            <!-- 底部状态栏与事实汇报区 -->
            <div class="flex min-w-0 flex-col gap-1.5 px-4 py-2 border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] text-[11px]">
                <!-- 手势可观察事实：提交次数、主动与被动补偿字段、Sash 标识 -->
                <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span
                        class="min-w-0 flex-1 truncate font-mono text-[var(--text-main)]"
                        data-lab-gesture
                        :data-lab-commit-count="commitCount"
                        :data-lab-gesture-state="lastGestureState"
                        :data-lab-gesture-source="lastGestureSource"
                        :data-lab-last-sash="lastGestureSash"
                        :data-lab-last-active="JSON.stringify(lastActive)"
                        :data-lab-last-compensated="JSON.stringify(lastCompensated)"
                        :data-lab-gesture-payload="lastGesturePayload"
                        :title="lastGestureText"
                    >
                        用户调整: 提交次数 {{ commitCount }} · {{ lastGestureText }}
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
                    :data-lab-restore-status="restoreStatus"
                    :data-lab-restore-reason="restoreReason"
                    :data-lab-dropped-count="droppedRefs.length"
                    :data-lab-raw-record="JSON.stringify(rawRecordRef)"
                    class="flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-muted)] font-mono border-t border-[color-mix(in_srgb,var(--border-color)_20%,transparent)] pt-1"
                >
                    <span class="uppercase tracking-wider">恢复记录:</span>
                    <span :class="restoreStatus === 'success' ? 'text-[var(--text-secondary)]' : restoreStatus === 'dropped-unknown' ? 'text-[var(--status-info,#3b82f6)]' : 'text-[var(--status-warning,#eab308)]'">
                        {{ restoreStatus }} {{ restoreReason ? `(${restoreReason})` : '' }}
                    </span>
                    <span v-if="droppedRefs.length > 0" class="text-[var(--text-secondary)]">
                        · 未解析: {{ droppedRefs.map((d) => d.ref).join(", ") }}
                    </span>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.nested-grid-card {
    margin: var(--space-3) auto 0;
    border-radius: var(--radius-panel, 12px);
    background: color-mix(in srgb, var(--panel-surface, var(--bg-panel)) 80%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--panel-outline, var(--border-color)) 70%, transparent);
    box-shadow: 0 16px 36px -10px color-mix(in srgb, var(--shadow-color, #000) 24%, transparent),
                0 2px 6px color-mix(in srgb, var(--shadow-color, #000) 6%, transparent);
}
</style>
