<script setup lang="ts">
/**
 * 外壳的纯布局（同名 .md）：测量、网格、七个 Part 的落点、手势结算与呈现事实。测量与落账用 nb-ui 的共享宿主
 * （`useLayoutExtent`、`useGridLayout`，docs/specs/ui/nested-grid.md），这里只加外壳自己的事：位置与对齐决定的树、
 * 落账前的整批核对与落账后的补丁、Part 内容的稳定寿命与焦点策略。
 */
import {GridRenderer} from "@notnotype/nb-ui/layout";
import type {GridGestureCommit} from "@notnotype/nb-ui/layout";
import {useGridLayout, useLayoutExtent} from "@notnotype/nb-ui/composables";
import {computed, nextTick, ref, shallowRef, watch} from "vue";

import {createShellGrid, projectShell, shellGestureProblem, shellPatch} from "../shell/layout";
import type {PanelState} from "../shell/panel-state";
import {SHELL_DRAG_COLLAPSIBLE_IDS, SHELL_GUTTER_PX, SHELL_PART_IDS, SHELL_STATUSBAR_HEIGHT, SHELL_TITLEBAR_HEIGHT} from "../shell/sizes";
import type {ShellDragCollapseMap, ShellEffectivePanel, ShellHideablePart, ShellLayoutFacts, ShellLayoutMode, ShellPartId, ShellSizePatch, ShellSizePreferences} from "../shell/sizes";

defineOptions({name: "WorkbenchShellLayout"});

const props = withDefaults(defineProps<{
    sizes: ShellSizePreferences;
    panel: PanelState;
    contextKey: string;
    hiddenParts?: ReadonlyArray<ShellHideablePart>;
    dragCollapsedParts?: ShellDragCollapseMap;
    disabled?: boolean;
}>(), {hiddenParts: () => [], dragCollapsedParts: () => ({}), disabled: false});

const emit = defineEmits<{
    (event: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    (event: "layout", facts: ShellLayoutFacts): void;
}>();

interface PartSlotProps {
    collapsed: boolean;
    effectivePanel: ShellEffectivePanel;
    mode: ShellLayoutMode;
}

defineSlots<{
    titlebar(props: PartSlotProps): unknown;
    activitybar(props: PartSlotProps): unknown;
    sidebar(props: PartSlotProps): unknown;
    editor(props: PartSlotProps): unknown;
    auxiliarybar(props: PartSlotProps): unknown;
    panel(props: PartSlotProps): unknown;
    statusbar(props: PartSlotProps): unknown;
}>();

const rootEl = ref<HTMLElement | null>(null);
const parkingEl = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(rootEl);

const projection = computed(() => projectShell({
    extent: extent.value ?? {width: 0, height: 0},
    preferences: props.sizes,
    panel: props.panel,
    hiddenParts: props.hiddenParts,
    dragCollapsedParts: props.dragCollapsedParts,
}));
const grid = computed(() => createShellGrid(projection.value));
const gestureIssues = ref<readonly string[]>([]);
const noteIssues = (issues: readonly string[]): void => {
    gestureIssues.value = [...gestureIssues.value, ...issues].slice(-4);
};

const host = useGridLayout({
    grid,
    extent,
    contextKey: () => props.contextKey,
    onApplied: (commit) => {
        const patch = shellPatch(commit);
        if (Object.keys(patch).length > 0) emit("resize", {contextKey: commit.contextKey, patch});
    },
    onIssues: noteIssues,
});

/** 落账前的整批核对：不产生保存的分支整场拒绝，不留半状态；之后只经共享宿主一次落账。 */
function acceptGesture(commit: GridGestureCommit): {ok: true} | {ok: false; reason: string} {
    if (props.disabled) return {ok: false, reason: "外壳当前不可调整"};
    const problem = shellGestureProblem(grid.value, commit);
    if (problem !== null) {
        noteIssues([`手势未落账：${problem}`]);
        return {ok: false, reason: problem};
    }
    return host.onGestureCommit(commit);
}

const mode = computed<ShellLayoutMode>(() => projection.value.mode);
const effectivePanel = computed<ShellEffectivePanel>(() => projection.value.effectivePanel);
const diagnostics = computed(() => [...projection.value.issues, ...gestureIssues.value].slice(-3).join(" | "));

/** 紧凑呈现不跑网格：按投影直接排出叶落点（没有可拖边界）。 */
const compactLeaves = computed(() => {
    const sizes = projection.value.sizes;
    return (["sidebar", "editor", "auxiliarybar", "panel"] as const)
        .filter((id) => (id === "panel" ? !props.panel.hidden && props.dragCollapsedParts.panel !== true : !props.hiddenParts.includes(id as ShellHideablePart) && props.dragCollapsedParts[id as "sidebar" | "auxiliarybar"] !== true))
        .map((id) => ({id, style: id === "panel" ? {flex: `0 0 ${String(sizes[id] ?? 0)}px`} : {flex: "1 1 0px"}}));
});
const compactChrome = computed(() => ({
    titlebar: props.hiddenParts.includes("titlebar") ? 0 : (projection.value.sizes.titlebar ?? SHELL_TITLEBAR_HEIGHT),
    statusbar: projection.value.sizes.statusbar ?? SHELL_STATUSBAR_HEIGHT,
    activitybar: props.hiddenParts.includes("activitybar") ? null : (projection.value.sizes.activitybar ?? 0),
}));

// ── 呈现事实 ──────────────────────────────────────────────────────────────────

let lastFacts = "";
watch(projection, (next) => {
    const measured = extent.value;
    if (measured === null) return;
    const facts: ShellLayoutFacts = {extent: {width: measured.width, height: measured.height}, mode: next.mode, effectivePanel: next.effectivePanel, issues: next.issues};
    const key = JSON.stringify(facts);
    if (key === lastFacts) return;
    lastFacts = key;
    emit("layout", facts);
}, {immediate: true});

// ── Part 内容的落点、焦点与滚动 ──────────────────────────────────────────────

/** 当前网格里各 Part 的叶落点；没有的 Part 内容留在停放区。 */
const targets = shallowRef<Partial<Record<ShellPartId, Element>>>({});

/**
 * 浏览器把节点移到别处时会清掉它的滚动位置，焦点也会丢；停放区是 `display: none`，在那里设滚动位置不生效。所以滚动
 * 位置记在一张跨多次变化的表里：每次结构变化前记下仍可见的元素，搬完后给回到可见落点的元素还原。焦点只记这一次。
 */
const scrollMemory = new Map<Element, {readonly top: number; readonly left: number}>();

function captureMemory(): HTMLElement | null {
    const root = rootEl.value;
    if (root === null) return null;
    for (const element of root.querySelectorAll("[data-shell-slot] *")) {
        if (parkingEl.value?.contains(element) === true) continue;
        if (element.scrollTop !== 0 || element.scrollLeft !== 0) scrollMemory.set(element, {top: element.scrollTop, left: element.scrollLeft});
        else scrollMemory.delete(element);
    }
    const active = document.activeElement;
    return active instanceof HTMLElement && root.contains(active) ? active : null;
}

/** 搬完 DOM 后还原：可见的元素还原滚动位置；焦点只在原节点仍可见、用户也没有把焦点移出外壳时拿回，不抢菜单与对话框。 */
function restoreMemory(focus: HTMLElement | null): void {
    for (const [element, {top, left}] of scrollMemory) {
        if (!element.isConnected) {
            scrollMemory.delete(element);
            continue;
        }
        if (parkingEl.value?.contains(element) === true) continue;
        element.scrollTop = top;
        element.scrollLeft = left;
    }
    if (focus === null || !focus.isConnected || parkingEl.value?.contains(focus) === true) return;
    const current = document.activeElement;
    const inside = current !== null && (current === document.body || rootEl.value?.contains(current) === true);
    if (inside && current !== focus) focus.focus({preventScroll: true});
}

/** 焦点所在内容被停放时给它一个可见的去处；焦点已在外壳之外时不动。 */
function focusTarget(target: "panel-toggle" | "panel-title"): void {
    const root = rootEl.value;
    if (root === null) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !root.contains(active)) return;
    if (active instanceof HTMLElement && root.contains(active) && parkingEl.value?.contains(active) !== true) return;
    const element = root.querySelector<HTMLElement>(`[data-shell-focus-target="${target}"]`) ?? root;
    element.focus({preventScroll: true});
}

/**
 * 呈现为 0 的 Part 内容也要停放：最大化时的编辑器、拖到零的 Part 只是被压成 0 尺寸，内容若留在落点里，Tab 仍能进去、
 * 读屏仍会读到。停放区是 `inert` 的，放进去就不可交互（Spec 外壳一输出 10）。
 */
function parkedParts(): ReadonlySet<ShellPartId> {
    const parked = new Set<ShellPartId>();
    if (projection.value.effectivePanel.maximized) parked.add("editor");
    for (const part of SHELL_DRAG_COLLAPSIBLE_IDS) if (projection.value.dragCollapsed[part] === true) parked.add(part);
    return parked;
}

function syncTargets(): void {
    const root = rootEl.value;
    const parked = parkedParts();
    const next: Partial<Record<ShellPartId, Element>> = {};
    for (const part of SHELL_PART_IDS) {
        if (parked.has(part)) continue;
        const element = root?.querySelector(`[data-leaf="${part}"]`);
        if (element !== null && element !== undefined) next[part] = element;
    }
    targets.value = next;
}

let wasHidden = props.panel.hidden;
let wasMaximized = projection.value.effectivePanel.maximized;

// 结构变化前（flush: pre）记下焦点：渲染会换掉叶落点，Teleport 随后在下一轮搬内容，所以等两轮再恢复。
watch(projection, (next) => {
    const memory = captureMemory();
    const becameHidden = props.panel.hidden && !wasHidden;
    const becameMaximized = next.effectivePanel.maximized && !wasMaximized;
    wasHidden = props.panel.hidden;
    wasMaximized = next.effectivePanel.maximized;
    void nextTick(() => {
        syncTargets();
        void nextTick(() => {
            restoreMemory(memory);
            if (becameHidden) focusTarget("panel-toggle");
            else if (becameMaximized) focusTarget("panel-title");
        });
    });
}, {flush: "pre"});

watch(rootEl, () => void nextTick(syncTargets));

const shellStyle = {"--workbench-shell-gutter": `${String(SHELL_GUTTER_PX)}px`};
</script>

<template>
    <div
        ref="rootEl"
        class="workbench-shell-layout relative flex h-full w-full min-h-0 min-w-0 overflow-hidden"
        :style="shellStyle"
        tabindex="-1"
        data-workbench-shell
        :data-shell-layout="mode"
        :data-layout-diagnostics="diagnostics"
    >
        <GridRenderer
            v-if="mode === 'split'"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="disabled || extent === null"
            :context-key="contextKey"
            :revision="host.revision.value"
            :on-gesture-commit="acceptGesture"
            :on-issues="noteIssues"
        />

        <!-- 紧凑呈现：activitybar 仍是主体左侧通高列，其余 Part 在它右侧纵向排布，没有可拖边界。 -->
        <div v-else class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" data-shell-compact>
            <div v-if="compactChrome.titlebar > 0" class="flex w-full flex-none flex-col overflow-hidden" :style="{height: `${compactChrome.titlebar}px`}" data-leaf="titlebar"></div>
            <div class="flex min-h-0 w-full flex-1 overflow-hidden">
                <div v-if="compactChrome.activitybar !== null" class="flex min-h-0 flex-none flex-col overflow-hidden" :style="{width: `${compactChrome.activitybar}px`}" data-leaf="activitybar"></div>
                <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div v-for="leaf in compactLeaves" :key="leaf.id" class="flex min-h-0 w-full flex-col overflow-hidden" :style="leaf.style" :data-leaf="leaf.id"></div>
                </div>
            </div>
            <div class="flex w-full flex-none flex-col overflow-hidden" :style="{height: `${compactChrome.statusbar}px`}" data-leaf="statusbar"></div>
        </div>

        <!-- 停放区：没有落点的 Part 内容留在这里，保持挂载，不进焦点顺序与读屏。 -->
        <div ref="parkingEl" class="hidden" aria-hidden="true" inert data-shell-parking>
            <Teleport v-for="part in SHELL_PART_IDS" :key="part" :to="targets[part] ?? undefined" :disabled="targets[part] === undefined">
                <div :data-shell-slot="part" class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden">
                    <slot :name="part" :collapsed="part === 'panel' && effectivePanel.collapsed" :effective-panel="effectivePanel" :mode="mode"></slot>
                </div>
            </Teleport>
        </div>
    </div>
</template>

<style scoped>
/*
 * ActivityBar 与侧栏、右栏的卡片四周留白归外壳，组件自己不写宽度与外边距。留白加在叶里的内容包装上而不是叶上：
 * 拖到零的叶宽为 0，加在叶上的内边距会把它撑出 12px；加在里面，叶的 overflow: hidden 把它裁掉。
 */
[data-shell-slot="activitybar"],
[data-shell-slot="sidebar"],
[data-shell-slot="auxiliarybar"] {
    box-sizing: border-box;
    padding: var(--workbench-shell-gutter);
}
</style>
