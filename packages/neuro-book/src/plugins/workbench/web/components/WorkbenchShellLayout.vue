<script setup lang="ts">
/**
 * 外壳的纯布局（同名 .md）：测量、网格、七个 Part 的落点、手势结算与呈现事实。测量与落账用 nb-ui 的共享宿主
 * （`useLayoutExtent`、`useGridLayout`，docs/specs/ui/nested-grid.md），这里只加外壳自己的事：位置与对齐决定的树、
 * 落账前的整批核对与落账后的补丁、Part 内容的稳定寿命与焦点策略。
 */
import {NestedGrid, useGridLayout, useLayoutExtent} from "@notnotype/nb-layout/vue";
import type {GridGestureCommit, GridGesturePreview} from "@notnotype/nb-layout";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import {SHELL_CARD_PARTS, shellCardInset, shellCards} from "../shell/cards";
import type {ShellCardPart} from "../shell/cards";
import {createShellGrid, projectShell, SHELL_ROOT_ID, shellGestureProblem, shellPatch} from "../shell/layout";
import {revealZones} from "../shell/reveal";
import type {RevealPart} from "../shell/reveal";
import {TeleportMemory} from "../shell/teleport-memory";
import type {PanelState} from "../shell/panel-state";
import {SHELL_DRAG_COLLAPSIBLE_IDS, SHELL_PART_IDS, SHELL_STATUSBAR_HEIGHT, SHELL_TITLEBAR_HEIGHT} from "../shell/sizes";
import type {ShellDragCollapseMap, ShellEffectivePanel, ShellHideablePart, ShellLayoutFacts, ShellLayoutMode, ShellPartId, ShellSizePatch, ShellSizePreferences} from "../shell/sizes";

defineOptions({name: "WorkbenchShellLayout"});

const props = withDefaults(defineProps<{
    sizes: ShellSizePreferences;
    panel: PanelState;
    contextKey: string;
    hiddenParts?: ReadonlyArray<ShellHideablePart>;
    dragCollapsedParts?: ShellDragCollapseMap;
    disabled?: boolean;
    /** 三层 Teleport 共用的滚动与焦点记忆；不给时自建一份（Lab 场景只有这一层）。 */
    memory?: TeleportMemory;
}>(), {hiddenParts: () => [], dragCollapsedParts: () => ({}), disabled: false, memory: undefined});

const emit = defineEmits<{
    (event: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    (event: "layout", facts: ShellLayoutFacts): void;
    /** 手势预览里已经被拉出来、投影里还收着的部件（拖到零的 Part、最大化下的编辑器）；手势结束或预览撤回时发空集。 */
    (event: "preview", parts: ReadonlyArray<ShellPartId>): void;
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

/**
 * 主题的缝宽（`--shell-gap`）进几何：活动栏叶宽要加上它（`projectShell` 的 `cardGap`）。主题写在文档根上，换主题或明暗时
 * 文档根的属性与内联变量会变，这时重读。
 */
const cardGap = ref(0);
function readCardGap(): void {
    const root = rootEl.value;
    if (root === null) return;
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--shell-gap"));
    cardGap.value = Number.isFinite(value) ? value : 0;
}
let themeObserver: MutationObserver | null = null;
onMounted(() => {
    readCardGap();
    themeObserver = new MutationObserver(readCardGap);
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-nb-theme", "data-nb-appearance", "style"]});
});
onBeforeUnmount(() => themeObserver?.disconnect());

const projection = computed(() => projectShell({
    extent: extent.value ?? {width: 0, height: 0},
    preferences: props.sizes,
    panel: props.panel,
    hiddenParts: props.hiddenParts,
    dragCollapsedParts: props.dragCollapsedParts,
    cardGap: cardGap.value,
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

// 记忆在组件一生里不换：中途换一份会丢掉已记下的滚动位置。
const memory = props.memory ?? new TeleportMemory();
watch(parkingEl, (element, previous) => memory.parking(element, previous), {immediate: true});
watch(rootEl, (element, _previous, onCleanup) => {
    if (element !== null) onCleanup(memory.track(element));
}, {immediate: true});

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
function projectedParked(): ReadonlySet<ShellPartId> {
    const parked = new Set<ShellPartId>();
    if (projection.value.effectivePanel.maximized) parked.add("editor");
    for (const part of SHELL_DRAG_COLLAPSIBLE_IDS) if (projection.value.dragCollapsed[part] === true) parked.add(part);
    return parked;
}

/**
 * 拖动中已经被拉出来的部件：投影里还是拖到零（或最大化下的编辑器），但手势预览已经给了它尺寸，内容先搬回落点，拖的过程中
 * 就看得到（输出 8）。只在拉出时提前搬，往零拖时等落账再停放：拖过阈值又拖回来，内容不闪。手势结束或取消时清空——落账后
 * 投影已经展开它；取消则回到停放区。
 */
const previewShown = shallowRef<ReadonlySet<ShellPartId>>(new Set());

/** 拖动中已经拖到零、投影里还有尺寸的部件：只影响卡片（下面的 `cards`），内容照旧等落账再停放。 */
const previewZeroed = shallowRef<ReadonlySet<ShellPartId>>(new Set());

function onGesturePreview(preview: GridGesturePreview<unknown>): void {
    const shown = new Set<ShellPartId>();
    for (const part of projectedParked()) {
        const size = preview.layout.sizes[part];
        if (size !== undefined && size.width > 0 && size.height > 0) shown.add(part);
    }
    const zeroed = new Set<ShellPartId>();
    for (const part of SHELL_DRAG_COLLAPSIBLE_IDS) {
        const size = preview.layout.sizes[part];
        if ((projection.value.sizes[part] ?? 0) > 0 && size !== undefined && (size.width <= 0 || size.height <= 0)) zeroed.add(part);
    }
    if (!sameParts(zeroed, previewZeroed.value)) previewZeroed.value = zeroed;
    if (sameParts(shown, previewShown.value)) return;
    setPreviewShown(shown);
}

function onGestureSettled(): void {
    if (previewZeroed.value.size > 0) previewZeroed.value = new Set();
    if (previewShown.value.size === 0) return;
    setPreviewShown(new Set());
}

function sameParts(a: ReadonlySet<ShellPartId>, b: ReadonlySet<ShellPartId>): boolean {
    return a.size === b.size && [...a].every((part) => b.has(part));
}

/**
 * 换预览集合并搬内容：与投影变化同一套先后——先记下滚动与焦点，下一轮按新落点搬，再下一轮恢复。宿主同时拿到集合，让视图
 * 的首次加载与“可见”跟着预览走（第一次拉出拖到零的面板时视图就加载，不等松手），持久的拖到零位仍等落账。
 */
function setPreviewShown(shown: ReadonlySet<ShellPartId>): void {
    const focus = memory.capture(rootEl.value);
    previewShown.value = shown;
    emit("preview", [...shown]);
    void nextTick(() => {
        syncTargets();
        void nextTick(() => memory.restore(focus, rootEl.value));
    });
}

function parkedParts(): ReadonlySet<ShellPartId> {
    const parked = new Set(projectedParked());
    for (const part of previewShown.value) parked.delete(part);
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
    const focus = memory.capture(rootEl.value);
    const becameHidden = props.panel.hidden && !wasHidden;
    const becameMaximized = next.effectivePanel.maximized && !wasMaximized;
    wasHidden = props.panel.hidden;
    wasMaximized = next.effectivePanel.maximized;
    void nextTick(() => {
        syncTargets();
        void nextTick(() => {
            memory.restore(focus, rootEl.value);
            if (becameHidden) focusTarget("panel-toggle");
            else if (becameMaximized) focusTarget("panel-title");
        });
    });
}, {flush: "pre"});

watch(rootEl, () => void nextTick(syncTargets));

// ── 卡片 ──────────────────────────────────────────────────────────────────────

/**
 * 各部件四边挨着什么；缝宽与卡片样式是主题变量，平铺的主题缝宽为 0，下面的内边距都是 0。卡片跟着拖动中的预览走：已经
 * 拉出来的部件按有尺寸算，已经拖到零的按零算。投影要等松手才落账，不这样算的话侧栏从零拉出时活动栏要等松手才与它相连，
 * 拖到零时活动栏要等松手才变回四角都圆的独立卡片。
 */
const cards = computed(() => {
    const shown = previewShown.value;
    const zeroed = previewZeroed.value;
    if (shown.size === 0 && zeroed.size === 0) return shellCards(projection.value);
    const sizes = {...projection.value.sizes};
    for (const part of shown) if ((sizes[part] ?? 0) <= 0) sizes[part] = 1;
    for (const part of zeroed) sizes[part] = 0;
    return shellCards({...projection.value, sizes});
});

/**
 * 哪些部件套卡片包装按部件身份定，不看当前投影：包装随隐藏、拖到零出现或消失的话，插槽会换到另一处渲染，
 * 部件内容被销毁重建（资源管理器的展开状态、编辑器都会丢）。
 */
const CARD_PARTS: ReadonlySet<ShellPartId> = new Set(SHELL_CARD_PARTS);

function cardOf(part: ShellPartId) {
    return cards.value[part as ShellCardPart];
}

function slotStyle(part: ShellPartId): Record<string, string> {
    const edges = cardOf(part);
    if (edges === undefined) return {};
    return {padding: [edges.top, edges.right, edges.bottom, edges.left].map(shellCardInset).join(" ")};
}

/** 活动栏与侧栏相连时，两张卡片相接的一侧不圆、不留缝（活动栏是 start，侧栏是 end）。 */
function joinOf(part: ShellPartId): "start" | "end" | undefined {
    const edges = cardOf(part);
    if (edges?.right.kind === "joined") return "start";
    if (edges?.left.kind === "joined") return "end";
    return undefined;
}

/**
 * 拖动时浮出的预备区（docs/specs/ui/workbench-shell.md 外壳三输出 20）：此刻没显示的侧栏、右栏、面板显示出来会在的矩形，
 * 换成视口坐标。拖动会话在拿起时取一次；网格根量不出来（紧凑呈现、还没挂上）时没有。
 */
function revealZoneRects(): Array<{part: RevealPart; rect: {left: number; top: number; right: number; bottom: number}}> {
    const measured = extent.value;
    const origin = rootEl.value?.querySelector<HTMLElement>(`[data-splitter="${SHELL_ROOT_ID}"]`)?.getBoundingClientRect();
    if (measured === null || origin === undefined) return [];
    const zones = revealZones({extent: measured, preferences: props.sizes, panel: props.panel, hiddenParts: props.hiddenParts, dragCollapsedParts: props.dragCollapsedParts, cardGap: cardGap.value});
    return zones.map(({part, rect}) => ({part, rect: {left: origin.left + rect.left, top: origin.top + rect.top, right: origin.left + rect.right, bottom: origin.top + rect.bottom}}));
}

defineExpose({revealZoneRects});
</script>

<template>
    <div
        ref="rootEl"
        class="workbench-shell-layout relative flex h-full w-full min-h-0 min-w-0 overflow-hidden"
        tabindex="-1"
        data-workbench-shell
        :data-shell-layout="mode"
        :data-layout-diagnostics="diagnostics"
    >
        <NestedGrid
            v-if="mode === 'split'"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="disabled || extent === null"
            :context-key="contextKey"
            :revision="host.revision.value"
            :on-gesture-commit="acceptGesture"
            :on-issues="noteIssues"
            @gesture-update="onGesturePreview"
            @gesture-end="onGestureSettled"
            @gesture-cancel="onGestureSettled"
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
                <div :data-shell-slot="part" class="box-border flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden" :style="slotStyle(part)">
                    <div v-if="CARD_PARTS.has(part)" class="workbench-shell-card" :data-shell-card="part" :data-shell-join="joinOf(part)">
                        <slot :name="part" :collapsed="part === 'panel' && effectivePanel.collapsed" :effective-panel="effectivePanel" :mode="mode"></slot>
                    </div>
                    <slot v-else :name="part" :collapsed="part === 'panel' && effectivePanel.collapsed" :effective-panel="effectivePanel" :mode="mode"></slot>
                </div>
            </Teleport>
        </div>
    </div>
</template>

<style scoped>
/*
 * 卡片外壳（docs/specs/ui/workbench-shell.md 输出 38）：缝、圆角、投影与接缝颜色都是主题变量，缺省即平铺（缝 0、无圆角、
 * 接缝是 --divider）。部件自己画面板底色，卡片包装只负责把它裁成圆角并投影。
 */
.workbench-shell-layout {
    --nb-splitter-seam: var(--shell-seam, var(--divider));
}

.workbench-shell-card {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--shell-card-radius, 0px);
    box-shadow: var(--shell-card-shadow, none);
}

.workbench-shell-card[data-shell-join="start"] {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
}

.workbench-shell-card[data-shell-join="end"] {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
}

/* 相连的活动栏与侧栏之间一条两端不碰顶底的短线；不需要时主题把颜色设成透明。 */
.workbench-shell-card[data-shell-join="start"]::after {
    content: "";
    position: absolute;
    inset-block: 10px;
    inset-inline-end: 0;
    z-index: 1;
    width: var(--border-w);
    background: var(--shell-join-divider, transparent);
    pointer-events: none;
}
</style>
