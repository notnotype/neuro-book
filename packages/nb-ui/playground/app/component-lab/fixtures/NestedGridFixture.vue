<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {
    createGrid,
    type Grid,
    type GridAxis,
    type GridBranchInput,
    type GridExtent,
    type GridLayoutResult,
    type GridNodeInput,
    type GridSnapshot,
    type GridSnapshotNode,
} from "../../../../src/components/layout/grid";
import Splitter, {type SplitterPanelConfig} from "../../../../src/components/layout/Splitter.vue";
import type {
    SplitterGestureCancellation,
    SplitterGestureState,
} from "../../../../src/components/layout/splitter-gesture";
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
const containerExtent = ref<GridExtent>({width: 800, height: 450});
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

// 恢复场景事实：原件记录在内存、过滤情况与拒绝原因
const restoreStatus = ref<"success" | "dropped-unknown" | "rejected">("success");
const restoreReason = ref("");
const droppedRefs = ref<{ref: string; reason: string}[]>([]);
const rawRecordRef = ref<unknown>(null);

let outerBaseline = {left: 240, right: 560};
let innerBaseline = {top: 270, bottom: 180};

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

let gridInstance: Grid<string> | null = null;
const layoutResult = ref<GridLayoutResult>({
    sizes: {
        root: {width: 800, height: 450},
        left: {width: 240, height: 450},
        right: {width: 560, height: 450},
        top: {width: 560, height: 270},
        bottom: {width: 560, height: 180},
    },
    constraints: {},
    sashSizes: {root: [7], right: [7]},
    issues: [],
});

function recalcLayout(): void {
    if (!gridInstance) return;
    const res = gridInstance.layout(containerExtent.value);
    layoutResult.value = res;
    emit("lab-event", "layout", res);
}

function initScene(sceneId: string): void {
    const tree = defaultTreeInput();
    gridInstance = createGrid(tree, {
        sashSize: (branchId) => (branchId === "root" ? outerSashPx.value : innerSashPx.value),
    });

    if (sceneId === "default") {
        restoreStatus.value = "success";
        restoreReason.value = "";
        droppedRefs.value = [];
        rawRecordRef.value = gridInstance.serialize();
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
        const res = gridInstance.restore(snapshotWithUnknown, (ref) =>
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
        const res = gridInstance.restore(malformedSnapshot, (ref) => ({ref}));
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
        const res = gridInstance.restore(highVersionSnapshot, (ref) => ({ref}));
        restoreStatus.value = "rejected";
        restoreReason.value = res.reason ?? "布局快照版本 99 不受支持";
        droppedRefs.value = [];
        emit("lab-event", "restore", res);
    }

    recalcLayout();
}

/** 调整已知节点后同步更新原件内存记录，确保未识别节点不被抹除 */
function syncRawRecordIntent(branchId: string, axis: GridAxis): void {
    if (!rawRecordRef.value || typeof rawRecordRef.value !== "object") return;
    const envelope = rawRecordRef.value as {root?: any};
    if (!envelope.root || envelope.root.kind !== "branch") return;

    if (branchId === "root" && axis === "width") {
        const rootTree = gridInstance?.root();
        if (rootTree && rootTree.kind === "branch") {
            const leftChild = rootTree.children.find((c) => c.id === "left");
            const rightChild = rootTree.children.find((c) => c.id === "right");
            const rawLeft = envelope.root.children.find((c: any) => c.id === "left");
            const rawRight = envelope.root.children.find((c: any) => c.id === "right");
            if (rawLeft && leftChild) rawLeft.size.width = leftChild.size.width;
            if (rawRight && rightChild) rawRight.size.width = rightChild.size.width;
        }
    } else if (branchId === "right" && axis === "height") {
        const rootTree = gridInstance?.root();
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

const outerPanels = computed<SplitterPanelConfig[]>(() => {
    const sizes = layoutResult.value.sizes;
    const constraints = layoutResult.value.constraints;
    const leftW = sizes.left?.width ?? 240;
    const rightW = sizes.right?.width ?? 560;
    const total = leftW + rightW;
    if (total <= 0) return [{id: "left", defaultSize: 30}, {id: "right", defaultSize: 70}];
    return [
        {
            id: "left",
            defaultSize: (leftW * 100) / total,
            minSize: ((constraints.left?.minimumSize.width ?? 0) * 100) / total,
            maxSize: Math.min(100, ((constraints.left?.maximumSize.width ?? total) * 100) / total),
        },
        {
            id: "right",
            defaultSize: (rightW * 100) / total,
            minSize: ((constraints.right?.minimumSize.width ?? 0) * 100) / total,
            maxSize: Math.min(100, ((constraints.right?.maximumSize.width ?? total) * 100) / total),
        },
    ];
});

const innerPanels = computed<SplitterPanelConfig[]>(() => {
    const sizes = layoutResult.value.sizes;
    const constraints = layoutResult.value.constraints;
    const topH = sizes.top?.height ?? 270;
    const bottomH = sizes.bottom?.height ?? 180;
    const total = topH + bottomH;
    if (total <= 0) return [{id: "top", defaultSize: 60}, {id: "bottom", defaultSize: 40}];
    return [
        {
            id: "top",
            defaultSize: (topH * 100) / total,
            minSize: ((constraints.top?.minimumSize.height ?? 0) * 100) / total,
            maxSize: Math.min(100, ((constraints.top?.maximumSize.height ?? total) * 100) / total),
        },
        {
            id: "bottom",
            defaultSize: (bottomH * 100) / total,
            minSize: ((constraints.bottom?.minimumSize.height ?? 0) * 100) / total,
            maxSize: Math.min(100, ((constraints.bottom?.maximumSize.height ?? total) * 100) / total),
        },
    ];
});

// 手势处理
function onOuterGestureStart(state: SplitterGestureState): void {
    outerBaseline = {
        left: layoutResult.value.sizes.left?.width ?? 240,
        right: layoutResult.value.sizes.right?.width ?? 560,
    };
    emit("lab-event", "gesture-start", state);
}

function onOuterGestureUpdate(state: SplitterGestureState): void {
    emit("lab-event", "gesture-update", state);
}

function onOuterGestureEnd(state: SplitterGestureState): void {
    emit("lab-event", "gesture-end", state);
    if (state.active.length === 0) return;

    const totalOuter = outerBaseline.left + outerBaseline.right;
    if (totalOuter > 0 && state.sizes.length === 2 && gridInstance) {
        const target = {
            left: (state.sizes[0]! * totalOuter) / 100,
            right: (state.sizes[1]! * totalOuter) / 100,
        };
        const res = gridInstance.resizeBranch("root", "width", outerBaseline, target);
        if (res.ok) {
            recalcLayout();
            syncRawRecordIntent("root", "width");
        }
    }

    commitCount.value++;
    lastGestureState.value = "commit";
    lastGestureSource.value = state.source;
    lastGestureSash.value = state.sash;
    lastActive.value = [...state.active];
    lastCompensated.value = [...state.compensated];
    lastGesturePayload.value = JSON.stringify(state);
    lastGestureText.value = `外层提交 · ${state.source} · ${state.sash} · 主动 [${state.active.join(", ")}] · 补偿 [${state.compensated.join(", ")}]`;
}

function onOuterGestureCancel(info: SplitterGestureCancellation): void {
    emit("lab-event", "gesture-cancel", info);
    lastGestureState.value = "cancel";
    lastGestureSource.value = info.source;
    lastGestureSash.value = info.sash;
    lastGesturePayload.value = JSON.stringify(info);
    lastGestureText.value = `未提交 · ${info.reason} · ${info.sash}`;
}

function onInnerGestureStart(state: SplitterGestureState): void {
    innerBaseline = {
        top: layoutResult.value.sizes.top?.height ?? 270,
        bottom: layoutResult.value.sizes.bottom?.height ?? 180,
    };
    emit("lab-event", "gesture-start", state);
}

function onInnerGestureUpdate(state: SplitterGestureState): void {
    emit("lab-event", "gesture-update", state);
}

function onInnerGestureEnd(state: SplitterGestureState): void {
    emit("lab-event", "gesture-end", state);
    if (state.active.length === 0) return;

    const totalInner = innerBaseline.top + innerBaseline.bottom;
    if (totalInner > 0 && state.sizes.length === 2 && gridInstance) {
        const target = {
            top: (state.sizes[0]! * totalInner) / 100,
            bottom: (state.sizes[1]! * totalInner) / 100,
        };
        const res = gridInstance.resizeBranch("right", "height", innerBaseline, target);
        if (res.ok) {
            recalcLayout();
            syncRawRecordIntent("right", "height");
        }
    }

    commitCount.value++;
    lastGestureState.value = "commit";
    lastGestureSource.value = state.source;
    lastGestureSash.value = state.sash;
    lastActive.value = [...state.active];
    lastCompensated.value = [...state.compensated];
    lastGesturePayload.value = JSON.stringify(state);
    lastGestureText.value = `内层提交 · ${state.source} · ${state.sash} · 主动 [${state.active.join(", ")}] · 补偿 [${state.compensated.join(", ")}]`;
}

function onInnerGestureCancel(info: SplitterGestureCancellation): void {
    emit("lab-event", "gesture-cancel", info);
    lastGestureState.value = "cancel";
    lastGestureSource.value = info.source;
    lastGestureSash.value = info.sash;
    lastGesturePayload.value = JSON.stringify(info);
    lastGestureText.value = `未提交 · ${info.reason} · ${info.sash}`;
}

/** 程序布局重排：不产生任何用户手势提交 */
function triggerProgrammaticLayout(): void {
    if (!gridInstance) return;
    const currentLeft = layoutResult.value.sizes.left?.width ?? 240;
    const currentRight = layoutResult.value.sizes.right?.width ?? 560;
    const total = currentLeft + currentRight;
    // 左右调整 40px
    const newLeft = currentLeft > 280 ? currentLeft - 40 : currentLeft + 40;
    const baseline = {left: currentLeft, right: currentRight};
    const target = {left: newLeft, right: total - newLeft};
    const res = gridInstance.resizeBranch("root", "width", baseline, target);
    if (res.ok) {
        recalcLayout();
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
    initScene(props.sceneId);
    layoutEpoch.value++;
}

let resizeObserver: ResizeObserver | null = null;

function updateContainerExtent(): void {
    if (!containerRef.value) return;
    const rect = containerRef.value.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        const next = {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        };
        if (next.width !== containerExtent.value.width || next.height !== containerExtent.value.height) {
            containerExtent.value = next;
            recalcLayout();
        }
    }
}

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
    void nextTick(() => {
        updateContainerExtent();
        if (containerRef.value) {
            resizeObserver = new ResizeObserver(() => {
                updateContainerExtent();
            });
            resizeObserver.observe(containerRef.value);
        }
        emit("rendered");
    });
});

onBeforeUnmount(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
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
                    <span data-lab-size-left class="text-[var(--text-main)] font-semibold">左 {{ formatPx(layoutResult.sizes.left?.width) }}</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-sash-root class="text-[var(--accent-main)] font-semibold">外sash {{ outerSashPx }}px</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-size-right class="text-[var(--text-main)] font-semibold">右 {{ formatPx(layoutResult.sizes.right?.width) }}</span>
                    <span class="text-[var(--text-muted)]">=</span>
                    <span data-lab-total-width class="text-[var(--text-secondary)]">{{ formatPx(layoutResult.sizes.root?.width) }}</span>
                </div>

                <!-- 内层主要求纵向 -->
                <div class="flex items-center gap-2">
                    <span class="text-[var(--text-muted)] font-sans text-[10px]">内层主要求 (H):</span>
                    <span data-lab-size-top class="text-[var(--text-main)] font-semibold">上 {{ formatPx(layoutResult.sizes.top?.height) }}</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-sash-right class="text-[var(--accent-main)] font-semibold">内sash {{ innerSashPx }}px</span>
                    <span class="text-[var(--text-muted)]">+</span>
                    <span data-lab-size-bottom class="text-[var(--text-main)] font-semibold">下 {{ formatPx(layoutResult.sizes.bottom?.height) }}</span>
                    <span class="text-[var(--text-muted)]">=</span>
                    <span data-lab-total-height class="text-[var(--text-secondary)]">{{ formatPx(layoutResult.sizes.right?.height) }}</span>
                </div>
            </div>

            <!-- 分割工作区：#nb-lab-target 是测试注入与观测的容器 -->
            <div id="nb-lab-target" ref="containerRef" class="flex-1 min-h-0 w-full relative overflow-hidden">
                <Splitter
                    id="outer-splitter"
                    :key="`outer-${layoutEpoch}`"
                    direction="horizontal"
                    :disabled="disabled"
                    :panels="outerPanels"
                    :sash-sizes="outerSashSizes"
                    @gesture-start="onOuterGestureStart"
                    @gesture-update="onOuterGestureUpdate"
                    @gesture-end="onOuterGestureEnd"
                    @gesture-cancel="onOuterGestureCancel"
                >
                    <!-- 左侧大纲栏 -->
                    <template #panel-left>
                        <div data-panel-leaf="left" class="p-3.5 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--bg-sidebar,var(--bg-panel))_70%,transparent)] flex flex-col gap-2.5">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">大纲导航</span>
                                <span class="text-[10px] font-mono text-[var(--text-muted)]">W: {{ formatPx(layoutResult.sizes.left?.width) }}</span>
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
                    </template>

                    <!-- 右侧垂直内层分支 -->
                    <template #panel-right>
                        <div data-branch="right" class="h-full w-full overflow-hidden flex flex-col">
                            <Splitter
                                id="inner-splitter"
                                :key="`inner-${layoutEpoch}`"
                                direction="vertical"
                                :disabled="disabled"
                                :panels="innerPanels"
                                :sash-sizes="innerSashSizes"
                                @gesture-start="onInnerGestureStart"
                                @gesture-update="onInnerGestureUpdate"
                                @gesture-end="onInnerGestureEnd"
                                @gesture-cancel="onInnerGestureCancel"
                            >
                                <!-- 上部正文编辑器 -->
                                <template #panel-top>
                                    <div data-panel-leaf="top" class="p-4 h-full overflow-y-auto bg-[var(--bg-main)] flex flex-col gap-2">
                                        <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] pb-2">
                                            <h2 class="text-sm font-bold text-[var(--text-main)]">第一章：深渊苏醒</h2>
                                            <span class="text-[10px] font-mono text-[var(--text-muted)]">H: {{ formatPx(layoutResult.sizes.top?.height) }}</span>
                                        </div>
                                        <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                            当意识的第一道脉冲穿过义体神经中枢时，窗外正下着新东京特有的霓虹酸雨。林澈睁开眼，视网膜HUD界面瞬间刷新出24条未读加密讯息。
                                        </p>
                                        <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
                                            墙上的时钟停在 03:42。他撑起沉重的右臂——那是上周在黑市调试的军规潜行臂，散热阀依然散发着刺鼻的机油味。
                                        </p>
                                    </div>
                                </template>

                                <!-- 下部实时诊断面板/终端 -->
                                <template #panel-bottom>
                                    <div data-panel-leaf="bottom" class="p-3 h-full overflow-y-auto bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] flex flex-col gap-2 text-xs">
                                        <div class="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_30%,transparent)] pb-1.5">
                                            <span class="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">实时诊断与终端</span>
                                            <span class="text-[10px] font-mono text-[var(--text-muted)]">H: {{ formatPx(layoutResult.sizes.bottom?.height) }}</span>
                                        </div>
                                        <div class="font-mono text-[11px] space-y-1 text-[var(--text-secondary)]">
                                            <div>> 两轴几何计算状态：正常守恒</div>
                                            <div>> 容器几何：{{ containerExtent.width }} × {{ containerExtent.height }} px</div>
                                            <div>> 降级诊断数：{{ layoutResult.issues.length }}</div>
                                        </div>
                                    </div>
                                </template>
                            </Splitter>
                        </div>
                    </template>
                </Splitter>
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

                    <!-- 降级诊断指示 -->
                    <div
                        data-lab-issues-container
                        :data-lab-issues="JSON.stringify(layoutResult.issues)"
                        :data-lab-has-issues="layoutResult.issues.length > 0"
                        class="shrink-0 flex items-center gap-1.5"
                    >
                        <span
                            v-if="layoutResult.issues.length === 0"
                            class="px-2 py-0.5 rounded text-[10px] font-mono bg-[color-mix(in_srgb,var(--status-info,#3b82f6)_12%,transparent)] text-[var(--status-info,#3b82f6)] font-medium"
                        >
                            几何正常 · 0 降级
                        </span>
                        <span
                            v-else
                            class="px-2 py-0.5 rounded text-[10px] font-mono bg-[color-mix(in_srgb,var(--status-warning,#eab308)_15%,transparent)] text-[var(--status-warning,#eab308)] font-semibold"
                        >
                            降级诊断 ({{ layoutResult.issues.length }}): {{ layoutResult.issues.join("; ") }}
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
