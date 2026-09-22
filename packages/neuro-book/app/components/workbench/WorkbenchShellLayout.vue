<script setup lang="ts">
/**
 * 工作台外壳的**纯布局**：测量、Grid 构建、渲染、gutter 与手势结算。
 *
 * 不读 Store / Storage / Nuxt 页面状态，也不创建业务会话——产品外壳（`WorkbenchShell`）与
 * Component Lab 的骨架 fixture 用同一个组件，几何、插槽生命周期与手势只有这一份实现。
 *
 * 槽位实例只创建一次：七个 Part 的内容由组件根下的稳定宿主渲染，再用 Teleport 搬进当前渲染树的
 * 叶落点；隐藏或最大化时落到同一壳内的 `hidden inert` 停放区。结构变化（换位置、对齐、显隐、
 * 紧凑切换）因此都不会卸载编辑区或工具 View，也不重新求值业务组件；只有整个组件卸载才统一释放。
 *
 * 保存由宿主负责：组件只在**有效用户手势结束**时发一次 `resize({contextKey, patch})`，
 * 补丁只含真正变化的轴；测量、恢复、短容器退化、切工作面都不产生保存。
 * 交汇处的两条分界线属于**同一场会话**（Grid 侧只有一份 scope），松手时一整批 changes 一起
 * 结算：几何与补丁都只发布一次。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import {
    GridRenderer,
    type Grid,
    type GridBranch,
    type GridGestureCommit,
    type GridLayoutResult,
} from "@notnotype/nb-ui/layout";
import {
    createShellGrid,
    projectShell,
    settleShellGesture,
    SHELL_ACTIVITY_GUTTER_PX,
    SHELL_CONTAINER_GUTTER_PX,
    SHELL_PANEL_ID,
    SHELL_PART_IDS,
    SHELL_STATUSBAR_HEIGHT,
    SHELL_STATUSBAR_ID,
    SHELL_TITLEBAR_HEIGHT,
    SHELL_TITLEBAR_ID,
    type ShellDragCollapseMap,
    type ShellEffectivePanel,
    type ShellLayoutFacts,
    type ShellLayoutMode,
    type ShellProjection,
    type ShellSizePatch,
    type ShellSizePreferences,
} from "nbook/app/utils/workbench/layout";
import type {WorkbenchPanelState} from "nbook/app/utils/workbench/panel-state";

defineOptions({name: "WorkbenchShellLayout"});

const props = withDefaults(defineProps<{
    /** 四个绝对尺寸偏好（左/右栏宽、Panel 高、Panel 宽）。 */
    sizes: ShellSizePreferences;
    /** 保存的 Panel 状态 + 宿主内存里的瞬时最大化。 */
    panel: WorkbenchPanelState;
    /** 工作面或 fixture 场景代际：手势跨代不结算，宿主也据此丢弃过期回执。 */
    contextKey: string;
    /** 只接受 titlebar / activity / left / right；Panel 显隐走 `panel.hidden`。 */
    hiddenParts?: readonly string[];
    /**
     * 用户拖到零的 Part（left / right / panel）：保留节点与展开尺寸意图，内容 0px、
     * 相邻 1px 可拖边界。与环境隐藏是两件事，不能互相代替。
     */
    dragCollapsedParts?: ShellDragCollapseMap;
    disabled?: boolean;
}>(), {hiddenParts: () => [], dragCollapsedParts: () => ({}), disabled: false});

const emit = defineEmits<{
    (e: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    (e: "layout", payload: ShellLayoutFacts): void;
    (e: "gesture-cancel", payload: {reason: string}): void;
}>();

defineSlots<{
    titlebar(props: ShellSlotProps): unknown;
    activity(props: ShellSlotProps): unknown;
    left(props: ShellSlotProps): unknown;
    editor(props: ShellSlotProps): unknown;
    right(props: ShellSlotProps): unknown;
    panel(props: ShellSlotProps): unknown;
    statusbar(props: ShellSlotProps): unknown;
}>();

type ShellSlotProps = {
    /** 只有 Panel 槽会拿到 true（32px 标题头）。 */
    collapsed: boolean;
    effectivePanel: ShellEffectivePanel;
    mode: ShellLayoutMode;
};

const rootEl = ref<HTMLElement | null>(null);
const parkingEl = ref<HTMLElement | null>(null);
const extent = ref<{width: number; height: number}>({width: 0, height: 0});
const projection = shallowRef<ShellProjection | null>(null);
const grid = shallowRef<Grid<string> | null>(null);
const layout = shallowRef<GridLayoutResult | null>(null);
/** 投影诊断（`projectShell` 每次重建时的诊断）与手势诊断分开累积：重建不覆盖用户看得见的手势结论。 */
const projectionIssues = ref<readonly string[]>([]);
const gestureIssues = ref<readonly string[]>([]);
const targets = shallowRef<Record<string, Element | null>>({});

const mode = computed<ShellLayoutMode>(() => projection.value?.mode ?? "split");
const effectivePanel = computed<ShellEffectivePanel>(() => projection.value?.effectivePanel ?? {
    position: "bottom",
    alignment: "center",
    collapsed: false,
    maximized: false,
});

/** 槽宿主四周留白：叶宽是树上的逻辑尺寸，卡片是叶的内接盒（组件自己不写宽度）。 */
const shellStyle = {
    "--workbench-activity-gutter": `${SHELL_ACTIVITY_GUTTER_PX}px`,
    "--workbench-container-gutter": `${SHELL_CONTAINER_GUTTER_PX}px`,
    "--workbench-titlebar-height": `${SHELL_TITLEBAR_HEIGHT}px`,
} as Record<string, string>;

const rootBranch = computed<GridBranch<unknown> | null>(() => {
    const node = grid.value?.root() ?? null;
    return node && node.kind === "branch" ? node : null;
});

/** 紧凑呈现直接按投影渲染叶落点（不跑 Splitter，也没有可拖边界）。 */
const compactBodyLeaves = computed<{id: string; style: Record<string, string>}[]>(() => {
    const sizes = projection.value?.sizes ?? {};
    const hidden = props.hiddenParts ?? [];
    return ["left", "editor", "right", SHELL_PANEL_ID]
        .filter((id) => id !== SHELL_PANEL_ID || !props.panel.hidden)
        .filter((id) => !hidden.includes(id))
        .map((id) => id === SHELL_PANEL_ID
            ? {id, style: {flex: `0 0 ${sizes[id] ?? 0}px`}}
            : {id, style: {flex: "1 1 0px"}});
});

const compactChrome = computed(() => {
    const sizes = projection.value?.sizes ?? {};
    return {
        titlebar: props.hiddenParts?.includes(SHELL_TITLEBAR_ID) ? 0 : (sizes[SHELL_TITLEBAR_ID] ?? SHELL_TITLEBAR_HEIGHT),
        statusbar: sizes[SHELL_STATUSBAR_ID] ?? SHELL_STATUSBAR_HEIGHT,
        activity: props.hiddenParts?.includes("activity") ? null : (sizes.activity ?? 0),
    };
});

const diagnostics = computed(() => [...projectionIssues.value, ...gestureIssues.value].slice(-3).join(" | "));

/** 树的稳定签名：结构变化（换位置/对齐/显隐）才让手势基线作废。 */
type TreeSignatureNode = {id: string; kind: string; children?: readonly TreeSignatureNode[]};

function treeSignature(node: TreeSignatureNode | null): string {
    if (node === null) {
        return "";
    }
    const children = node.kind === "branch" ? (node.children ?? []) : [];
    return `${node.id}(${children.map((child) => treeSignature(child)).join(",")})`;
}

function structureKey(): string {
    return `${mode.value}|${treeSignature(projection.value?.tree ?? null)}`;
}

function extentKey(): string {
    return `${Math.round(extent.value.width)}x${Math.round(extent.value.height)}`;
}

/**
 * 外部事实版本：结构（换位置/对齐/显隐）、容器尺寸、工作面代际变化都递增它。
 *
 * Grid 会话在 `revision` 变化时自行取消（不沿旧基线写新上下文），这里不再按分支记账——
 * 交汇处两根轴由同一份会话持有，取消即整场取消。
 */
const revision = ref(0);
let lastFactsKey = "";

function emitFacts(next: ShellProjection): void {
    const facts: ShellLayoutFacts = {
        extent: {width: extent.value.width, height: extent.value.height},
        mode: next.mode,
        effectivePanel: next.effectivePanel,
        issues: next.issues,
    };
    const key = `${facts.mode}|${facts.effectivePanel.position}|${facts.effectivePanel.alignment}|${facts.effectivePanel.collapsed}|${facts.effectivePanel.maximized}|${facts.extent.width}x${facts.extent.height}|${facts.issues.join("~")}`;
    if (key === lastFactsKey) {
        return;
    }
    lastFactsKey = key;
    emit("layout", facts);
}

function captureFocus(): {element: HTMLElement; scroller: HTMLElement | null; top: number; left: number} | null {
    if (typeof document === "undefined") {
        return null;
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !rootEl.value?.contains(active)) {
        return null;
    }
    let scroller: HTMLElement | null = active.parentElement;
    while (scroller && scroller !== rootEl.value) {
        if (scroller.scrollTop > 0 || scroller.scrollLeft > 0) {
            break;
        }
        scroller = scroller.parentElement;
    }
    return {element: active, scroller, top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0};
}

/**
 * 搬完 DOM 后恢复焦点与滚动：只在原 Part 仍可见、且用户没有把焦点移出外壳时进行，
 * 不抢菜单/对话框的焦点。
 */
function restoreFocus(memory: {element: HTMLElement; scroller: HTMLElement | null; top: number; left: number} | null): void {
    if (memory === null || !memory.element.isConnected) {
        return;
    }
    if (parkingEl.value?.contains(memory.element)) {
        return;
    }
    if (typeof document !== "undefined") {
        const current = document.activeElement;
        const inside = current !== null && (current === document.body || rootEl.value?.contains(current) === true);
        if (inside && current !== memory.element) {
            memory.element.focus({preventScroll: true});
        }
    }
    if (memory.scroller?.isConnected) {
        memory.scroller.scrollTop = memory.top;
        memory.scroller.scrollLeft = memory.left;
    }
}

function syncAnchors(): void {
    const root = rootEl.value;
    const next: Record<string, Element | null> = {};
    for (const part of SHELL_PART_IDS) {
        next[part] = root?.querySelector(`[data-leaf="${part}"]`) ?? null;
    }
    targets.value = next;
}

/** 宿主提供的焦点落点：状态栏「显示面板」与 Panel 标题；槽没给就用壳根兜底。 */
function focusShellTarget(target: "panel-toggle" | "panel-title"): void {
    const root = rootEl.value;
    if (!root) {
        return;
    }
    const active = document.activeElement;
    // 焦点在外壳之外（对话框、其它区域）时不抢：只有「焦点本来就属于外壳、而它的落点消失了」才搬。
    if (active instanceof HTMLElement && active !== document.body && !root.contains(active)) {
        return;
    }
    const element = root.querySelector<HTMLElement>(`[data-shell-focus-target="${target}"]`) ?? root;
    if (element === root) {
        root.setAttribute("tabindex", "-1");
    }
    element.focus({preventScroll: true});
}

let previousHidden = false;
let previousMaximized = false;

/**
 * 隐藏或最大化把焦点所在的内容移走了，焦点不能留在已停放的节点上：
 * 隐藏 → 状态栏「显示面板」；最大化 → Panel 标题；槽没提供落点就用壳根。
 * 还原、收起、换位置等只搬可见内容的情况不搬焦点（`restoreFocus` 已经处理了保留）。
 */
function applyPanelFocusPolicy(next: ShellProjection): void {
    const hidden = props.panel.hidden;
    const maximized = next.effectivePanel.maximized;
    const becameHidden = hidden && !previousHidden;
    const becameMaximized = maximized && !previousMaximized;
    previousHidden = hidden;
    previousMaximized = maximized;
    if (becameHidden) {
        focusShellTarget("panel-toggle");
        return;
    }
    if (becameMaximized) {
        focusShellTarget("panel-title");
    }
}

/** 重建投影、树与呈现：纯计算 + 一次 nextTick 后的落点同步，不产生保存。 */
function rebuild(): void {
    const memory = captureFocus();
    const next = projectShell({
        extent: {width: extent.value.width, height: extent.value.height},
        preferences: props.sizes,
        panel: props.panel,
        hiddenParts: props.hiddenParts,
        dragCollapsedParts: props.dragCollapsedParts,
    });
    // 结构/尺寸上下文变化：进行中的手势由 Grid 会话按 revision 自行取消并回滚。
    revision.value += 1;
    const nextGrid = createShellGrid(next);
    projection.value = next;
    grid.value = nextGrid;
    layout.value = nextGrid.layout({width: extent.value.width, height: extent.value.height});
    projectionIssues.value = [...next.issues];
    emitFacts(next);
    void nextTick(() => {
        syncAnchors();
        // 落点变化会让 Teleport 在下一帧搬 DOM；焦点与滚动必须等搬完再恢复，否则会被搬走。
        void nextTick(() => {
            restoreFocus(memory);
            applyPanelFocusPolicy(next);
        });
    });
}

function measure(): void {
    const el = rootEl.value;
    if (!el) {
        return;
    }
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (width === extent.value.width && height === extent.value.height) {
        return;
    }
    extent.value = {width, height};
    rebuild();
}

/**
 * 一次手势的同步接纳：整批 changes 一起落账，几何与补丁都只发布一次。
 *
 * 接纳成功时**不**在这里重建投影：宿主会把新偏好写回 props，投影由那次发布驱动，
 * 最后一帧预览因此能保持到匹配布局出现，不会闪回旧尺寸；没有可保存轴时按模型重建一次。
 */
function acceptGesture(commit: GridGestureCommit): {ok: true} | {ok: false; reason: string} {
    const current = grid.value;
    if (props.disabled) {
        return {ok: false, reason: "外壳当前不可调整"};
    }
    if (current === null) {
        return {ok: false, reason: "布局尚未就绪"};
    }
    const settled = settleShellGesture({grid: current, contextKey: props.contextKey, commit});
    if (!settled.ok) {
        gestureIssues.value = [...gestureIssues.value, `手势未落账：${settled.reason}`].slice(-4);
        rebuild();
        return {ok: false, reason: settled.reason};
    }
    if (Object.keys(settled.patch).length === 0) {
        rebuild();
        return {ok: true};
    }
    emit("resize", {contextKey: props.contextKey, patch: settled.patch});
    return {ok: true};
}

function onGestureCancel(info: {reason: string}): void {
    // 取消是宿主可见的事实：诊断只作补记，不参与几何；`no-change` 不算异常，不写诊断。
    if (info.reason !== "no-change") {
        gestureIssues.value = [...gestureIssues.value, `手势被取消：${info.reason}`].slice(-4);
    }
    emit("gesture-cancel", {reason: `手势被取消：${info.reason}`});
    rebuild();
}

let observer: ResizeObserver | null = null;

onMounted(() => {
    measure();
    if (!rootEl.value) {
        return;
    }
    observer = new ResizeObserver(() => measure());
    observer.observe(rootEl.value);
});

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
    revision.value += 1;
});

watch(
    () => [
        extent.value.width,
        extent.value.height,
        props.contextKey,
        props.sizes.leftPanelWidth,
        props.sizes.agentPanelWidth,
        props.sizes.panelHeight,
        props.sizes.panelWidth,
        props.panel.position,
        props.panel.alignment,
        props.panel.hidden,
        props.panel.collapsed,
        props.panel.maximized,
        (props.hiddenParts ?? []).join(","),
        JSON.stringify(props.dragCollapsedParts ?? {}),
    ],
    () => rebuild(),
    {immediate: true},
);

watch(() => props.disabled, (disabled) => {
    if (disabled) {
        // 禁用即外部事实变化：进行中的手势由 Grid 会话按 revision 取消，不结算。
        revision.value += 1;
    }
});
</script>

<template>
    <div
        ref="rootEl"
        class="workbench-shell-layout flex h-full w-full min-h-0 min-w-0 overflow-hidden"
        :style="shellStyle"
        data-workbench-shell
        tabindex="-1"
        :data-shell-layout="mode"
        :data-layout-diagnostics="diagnostics"
    >
        <GridRenderer
            v-if="mode === 'split' && rootBranch && layout"
            :node="rootBranch"
            :layout="layout"
            :disabled="disabled"
            :context-key="props.contextKey"
            :revision="revision"
            :on-gesture-commit="acceptGesture"
            @gesture-cancel="onGestureCancel"
        />

        <!-- 紧凑呈现：activity 仍是主体左侧通高列，其余 Part 在它右侧纵向排布（没有可拖边界）。 -->
        <div v-else-if="mode === 'compact'" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" data-shell-compact>
            <div
                v-if="compactChrome.titlebar > 0"
                class="flex min-h-0 w-full flex-none flex-col overflow-hidden"
                :style="{height: `${compactChrome.titlebar}px`}"
                data-leaf="titlebar"
            ></div>
            <div class="flex min-h-0 w-full flex-1 overflow-hidden">
                <div
                    v-if="compactChrome.activity !== null"
                    class="flex min-h-0 flex-none flex-col overflow-hidden"
                    :style="{width: `${compactChrome.activity}px`}"
                    data-leaf="activity"
                ></div>
                <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div
                        v-for="leaf in compactBodyLeaves"
                        :key="leaf.id"
                        class="flex min-h-0 w-full flex-col overflow-hidden"
                        :style="leaf.style"
                        :data-leaf="leaf.id"
                    ></div>
                </div>
            </div>
            <div class="flex min-h-0 w-full flex-none flex-col overflow-hidden" :style="{height: `${compactChrome.statusbar}px`}" data-leaf="statusbar"></div>
        </div>

        <!-- 停放区：隐藏或最大化的 Part 在这里保持挂载（不卸载、不重挂），也不参与焦点与读屏。 -->
        <div ref="parkingEl" class="hidden" aria-hidden="true" inert data-shell-parking>
            <Teleport v-for="part in SHELL_PART_IDS" :key="part" :to="targets[part] ?? undefined" :disabled="!targets[part]">
                <div :data-shell-slot="part" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
                    <slot
                        :name="part"
                        :collapsed="part === SHELL_PANEL_ID && effectivePanel.collapsed"
                        :effective-panel="effectivePanel"
                        :mode="mode"
                    ></slot>
                </div>
            </Teleport>
        </div>
    </div>
</template>

<style scoped>
/*
 * 活动栏卡片的四周留白归外壳：留白加在叶上，卡片（`WorkbenchActivityBar` 的根元素）就是叶的内接盒。
 * 叶宽 = 卡片 + 两侧留白由 `layout.ts` 一处给出（`SHELL_ACTIVITY_WIDTH`），组件里不再出现重复宽度。
 */
:deep([data-leaf="activity"]) {
    padding: var(--workbench-activity-gutter);
}

/* 左右叶的留白同活动栏卡片：容器卡片是叶的内接盒（面 / 描边 / 圆角都由组件画）。 */
:deep([data-leaf="left"]),
:deep([data-leaf="right"]) {
    padding: var(--workbench-container-gutter);
}
</style>
