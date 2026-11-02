<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref, useId, watch} from "vue";
import {PopoverContent, PopoverPortal, PopoverRoot} from "reka-ui";
import Spinner from "../display/Spinner.vue";
import MenuRow from "./MenuRow.vue";
import PopupScrollbar from "./PopupScrollbar.vue";
import {usePopoverLayer} from "../../composables/usePopoverLayer";
import {usePopupScroll} from "../../composables/usePopupScroll";
import {toPopoverReference} from "./popover-anchor";
import {suggestionOptionId, type SuggestionMenuAnchor, type SuggestionMenuGroup, type SuggestionMenuItem, type SuggestionMenuPlacement} from "./suggestion-menu";

/**
 * 输入时弹出的候选菜单，焦点留在输入处（行为见同名 `.md`）。
 *
 * 定位走 reka 的 Popover 原语（底下是 floating-ui），与 DropdownMenu 同一套：传送、碰撞夹紧，以及
 * `--reka-popper-available-*` 给外框收矮、收窄；它也把浮层登记为一层，模态 `Dialog` 里照样能接收指针。
 * reka 不公开更底层的 Popper 原语，所以 Popover 给内容写死的三个属性在挂上后去掉，见 `stripDialogSemantics`。
 *
 * 锚点一律换成虚拟锚点并逐帧更新（`updatePositionStrategy: "always"`）：光标的矩形在同一个输入框里变化时，
 * floating-ui 的 autoUpdate 观察不到任何元素变化，只有逐帧读才跟得上。
 */
const props = withDefaults(defineProps<{
    groups: readonly SuggestionMenuGroup[];
    activeId: string | null;
    anchor?: SuggestionMenuAnchor | null;
    id?: string;
    label?: string;
    /** 列表名字来源的元素 id；与 `label` 二选一，给了 `label` 时不用它。 */
    labelledby?: string;
    loading?: boolean;
    loadingText?: string;
    emptyText?: string;
    placement?: SuggestionMenuPlacement;
    matchAnchorWidth?: boolean;
    sideOffset?: number;
    teleportTarget?: string;
}>(), {
    anchor: null,
    id: undefined,
    label: undefined,
    labelledby: undefined,
    loading: false,
    loadingText: "",
    emptyText: "",
    placement: "auto",
    matchAnchorWidth: false,
    sideOffset: 6,
    teleportTarget: undefined,
});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "highlight", id: string): void;
}>();

defineSlots<{
    header?: () => unknown;
}>();

/** 夹进窗口时四边留的距离，与可用空间的计算是同一个数。 */
const COLLISION_PADDING = 12;
/** `placement: "auto"` 时偏好的下方至少要有这么高，否则上方更宽就翻上去。 */
const MIN_SIDE_SPACE = 96;

const generatedId = useId();
const menuId = computed(() => props.id ?? `nb-suggestion-${generatedId}`);
const {zIndex} = usePopoverLayer();
const scroll = usePopupScroll();

const reference = computed(() => toPopoverReference(props.anchor));

/** 渲染用的分组：给每个可选项排上跨组累计的下标，与 `suggestionMenuOptions` 的顺序一致。 */
const rendered = computed(() => {
    let index = 0;
    return props.groups.map((group) => ({
        id: group.id,
        label: group.label,
        labelId: `${menuId.value}-group-${group.id}`,
        rows: group.items.map((item) => ({item, domId: item.disabled === true ? undefined : suggestionOptionId(menuId.value, index++)})),
    }));
});
/** 整个菜单（跨组）有一项带图标时，其余项也留出图标列，名称左边对齐。 */
const iconColumn = computed(() => props.groups.some((group) => group.items.some((item) => item.iconClass)));
const empty = computed(() => !props.loading && props.groups.every((group) => group.items.length === 0));

function isActive(item: SuggestionMenuItem): boolean {
    return item.disabled !== true && item.id === props.activeId;
}

function onPointermove(item: SuggestionMenuItem): void {
    if (item.disabled === true || item.id === props.activeId) return;
    emit("highlight", item.id);
}

/** `header` 里能接收焦点的元素（例如搜索框）照常按下；其余地方（项、内边距、标题、加载行）按下都不夺走输入处的焦点。 */
const FOCUSABLE = "input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex='-1'])";
function onSurfaceMousedown(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest(FOCUSABLE) !== null) return;
    event.preventDefault();
}

function onClick(item: SuggestionMenuItem): void {
    if (item.disabled !== true) emit("select", item.id);
}

watch(() => props.activeId, async () => {
    await nextTick();
    const row = rendered.value.flatMap((group) => group.rows).find((entry) => isActive(entry.item));
    if (row?.domId !== undefined) scroll.reveal(document.getElementById(row.domId));
});

/*
 * `placement: "auto"`：每帧按锚点上下的剩余空间选一侧。不交给 floating-ui 的 flip：flip 在整个菜单放不下时就翻，
 * 而这里要的是“下方还有 96px 就留在下方、由外框收矮”，翻转的门槛与菜单多高无关。
 */
const autoSide = ref<"top" | "bottom">("bottom");
let sideFrame: number | null = null;

function trackSide(): void {
    const anchor = reference.value;
    if (anchor === undefined) {
        sideFrame = null;
        return;
    }
    const rect = anchor.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - props.sideOffset - COLLISION_PADDING;
    const above = rect.top - props.sideOffset - COLLISION_PADDING;
    const next = below >= MIN_SIDE_SPACE || below >= above ? "bottom" : "top";
    if (next !== autoSide.value) autoSide.value = next;
    sideFrame = requestAnimationFrame(trackSide);
}

function stopTrackingSide(): void {
    if (sideFrame !== null) cancelAnimationFrame(sideFrame);
    sideFrame = null;
}

watch(() => [reference.value, props.placement] as const, ([anchor, placement]) => {
    stopTrackingSide();
    if (anchor !== undefined && placement === "auto") trackSide();
}, {immediate: true});
onBeforeUnmount(stopTrackingSide);

const side = computed(() => (props.placement === "auto" ? autoSide.value : props.placement));

const widthClass = computed(() => (props.matchAnchorWidth
    ? "w-[min(var(--reka-popper-anchor-width),var(--reka-popper-available-width))]"
    : "w-max min-w-[min(220px,var(--reka-popper-available-width))] max-w-[min(420px,var(--reka-popper-available-width))]"));

/**
 * Popover 给内容写死了 `role="dialog"`、指向触发器的 `aria-labelledby`（这里没有触发器，是悬空的引用）与焦点范围的
 * `tabindex="-1"`。候选菜单不是对话框，可访问的结构只有里面的 listbox，所以内容每次挂上后去掉这三个属性。Vue 只重写
 * 值变了的属性，这三个值不会变，去掉后不会被写回；reka 升级后若开始每次都写，`SuggestionMenu.test.ts` 会失败。
 */
function stripDialogSemantics(viewport: HTMLElement | null): void {
    const surface = viewport?.closest("[data-suggestion-menu]");
    for (const name of ["role", "aria-labelledby", "tabindex"]) surface?.removeAttribute(name);
}
watch(() => scroll.viewport.value, stripDialogSemantics, {flush: "post"});

defineExpose({
    /** 节点是否在浮层里（浮层传送出去了，不在宿主的 DOM 里）。 */
    contains(node: Node | null): boolean {
        const surface = scroll.viewport.value?.closest("[data-suggestion-menu]");
        return node !== null && surface !== null && surface !== undefined && surface.contains(node);
    },
});
</script>

<template>
    <PopoverRoot :open="reference !== undefined" :modal="false">
        <PopoverPortal :to="props.teleportTarget ?? 'body'">
            <PopoverContent
                :reference="reference"
                :side="side"
                align="start"
                :side-offset="props.sideOffset"
                :avoid-collisions="true"
                :side-flip="false"
                :collision-padding="COLLISION_PADDING"
                sticky="always"
                update-position-strategy="always"
                class="nb-ui-popover-surface nb-ui-menu-surface relative flex max-h-[var(--reka-popper-available-height)] flex-col overflow-hidden text-[var(--text-main)] outline-none"
                :class="widthClass"
                :style="{zIndex}"
                data-suggestion-menu
                @open-auto-focus.prevent
                @close-auto-focus.prevent
                @escape-key-down.prevent
                @pointer-down-outside.prevent
                @focus-outside.prevent
                @interact-outside.prevent
                v-bind="{onMousedown: onSurfaceMousedown}"
            >
                <div v-if="$slots.header" class="shrink-0" data-suggestion-menu-header>
                    <slot name="header" />
                </div>
                <div
                    :id="menuId"
                    :ref="scroll.setViewport"
                    role="listbox"
                    :aria-label="props.label"
                    :aria-labelledby="props.label === undefined ? props.labelledby : undefined"
                    class="nb-ui-popover-scroll w-full"
                    :class="scroll.fadeClass.value"
                    :style="scroll.viewportStyle.value"
                    @scroll="scroll.onScroll"
                >
                    <div
                        v-for="group in rendered"
                        :key="group.id"
                        :role="group.label === undefined ? 'presentation' : 'group'"
                        :aria-labelledby="group.label === undefined ? undefined : group.labelId"
                    >
                        <div v-if="group.label !== undefined" :id="group.labelId" class="nb-ui-menu-label">{{ group.label }}</div>
                        <div
                            v-for="row in group.rows"
                            :id="row.domId"
                            :key="row.item.id"
                            role="option"
                            class="nb-ui-menu-item"
                            :aria-selected="isActive(row.item) ? 'true' : 'false'"
                            :aria-disabled="row.item.disabled === true ? 'true' : undefined"
                            :data-highlighted="isActive(row.item) ? '' : undefined"
                            :data-disabled="row.item.disabled === true ? '' : undefined"
                            @pointermove="onPointermove(row.item)"
                            @click="onClick(row.item)"
                        >
                            <MenuRow :label="row.item.label" :lead-column="iconColumn" :icon="row.item.iconClass" muted-icon :hint="row.item.hint">
                                <template #trailing><span v-if="row.item.checked === true" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" data-suggestion-menu-checked></span></template>
                            </MenuRow>
                        </div>
                    </div>
                    <div v-if="empty" class="px-[10px] py-[6px] text-[length:var(--text-xs)] leading-4 text-[var(--text-muted)]" data-suggestion-menu-empty>{{ props.emptyText }}</div>
                </div>
                <div
                    v-if="props.loading"
                    class="flex shrink-0 items-center gap-2 px-[10px] py-[6px] text-[length:var(--text-xs)] leading-4 text-[var(--text-muted)]"
                    role="status"
                    data-suggestion-menu-loading
                >
                    <Spinner size="sm" />
                    <span>{{ props.loadingText }}</span>
                </div>
                <PopupScrollbar :scroll="scroll" />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
