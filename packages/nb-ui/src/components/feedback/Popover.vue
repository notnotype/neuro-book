<script setup lang="ts">
import {
    PopoverArrow,
    PopoverClose,
    PopoverContent,
    PopoverPortal,
    PopoverRoot,
    PopoverTrigger,
} from "reka-ui";
import {computed} from "vue";
import {usePopoverLayer} from "../../composables/usePopoverLayer";

const {zIndex: popoverZIndex} = usePopoverLayer();

/** 定位用的参照：一块会随滚动变的矩形（floating-ui 的虚拟元素）。 */
export interface PopoverReference {
    getBoundingClientRect(): DOMRect;
    readonly contextElement?: Element;
}


const props = withDefaults(defineProps<{
    open?: boolean;
    defaultOpen?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
    align?: "start" | "center" | "end";
    avoidCollisions?: boolean;
    modal?: boolean;
    contentClass?: string;
    arrow?: boolean;
    /**
     * 锚在调用方给的元素上，不用 `trigger` 插槽（同名 .md 的“锚在外部元素上”）：开关只由 `open` 决定，按 Escape 关掉后焦点回到它，
     * 在它上面按下不算点外面。默认不给。
     */
    anchor?: HTMLElement | null;
    /**
     * 定位用的矩形，代替 `anchor` 的外框（同名 .md 的“锚在外部元素上”）：锚点高到贴着它放不下面板时，调用方改贴锚点里的一小块。
     * 只管定位；焦点还给谁、按在哪里不算点外面仍看 `anchor`。默认不给。
     */
    reference?: PopoverReference | null;
    /**
     * 避让时以哪块区域为界（缺省是视口）：浮层不越出这块元素，例如编辑区里的浮层不盖到侧栏上。只在 `avoidCollisions` 时起作用。
     */
    collisionBoundary?: Element | readonly Element[] | null;
    /** 面板（读屏当作对话框）的可读名字。默认不给。 */
    label?: string;
}>(), {
    open: undefined,
    defaultOpen: false,
    side: "bottom",
    sideOffset: 6,
    align: "center",
    avoidCollisions: true,
    modal: false,
    contentClass: "",
    arrow: false,
    anchor: undefined,
    reference: null,
    collisionBoundary: null,
    label: undefined,
});

/** reka 要的是可变的数组；这里给它一份。 */
const boundary = computed(() => (props.collisionBoundary === null ? undefined : props.collisionBoundary instanceof Element ? props.collisionBoundary : [...props.collisionBoundary]));

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
}>();

/**
 * 锚点由调用方渲染，它的点击也由调用方处理（例如切换 `open`）：在它上面按下不当作点外面，否则原语先关掉、点击又打开，
 * 再点一次关不掉。
 */
function onInteractOutside(event: Event): void {
    const target = event.target;
    if (props.anchor != null && target instanceof Node && props.anchor.contains(target)) event.preventDefault();
}

/** 只有 Escape 关掉时把焦点还给锚点；点外面关掉时焦点留在用户点的地方（ui-development-spec 第 5 节第 5 条）。 */
let closedByEscape = false;

function onEscapeKeyDown(): void {
    closedByEscape = true;
}

function onCloseAutoFocus(event: Event): void {
    event.preventDefault();
    if (closedByEscape) props.anchor?.focus({preventScroll: true});
    closedByEscape = false;
}
</script>

<template>
    <PopoverRoot
        :open="props.open"
        :default-open="props.defaultOpen"
        :modal="props.modal"
        @update:open="(val) => emit('update:open', val)"
    >
        <PopoverTrigger v-if="props.anchor === undefined" as-child>
            <slot name="trigger" />
        </PopoverTrigger>

        <PopoverPortal>
            <PopoverContent
                :side="props.side"
                :side-offset="props.sideOffset"
                :align="props.align"
                :avoid-collisions="props.avoidCollisions"
                :collision-boundary="boundary"
                :reference="props.reference ?? props.anchor ?? undefined"
                :aria-label="props.label"
                :style="{
                    zIndex: popoverZIndex,
                }"
                class="nb-ui-popover-surface nb-ui-popover-motion relative p-3 text-[var(--text-main)] outline-none select-none max-w-[calc(100vw-32px)]"
                :class="props.contentClass"
                @close-auto-focus="onCloseAutoFocus"
                @escape-key-down="onEscapeKeyDown"
                @interact-outside="onInteractOutside"
            >
                <slot />

                <PopoverArrow
                    v-if="props.arrow"
                    class="fill-[color-mix(in_srgb,var(--bg-panel)_85%,transparent)] stroke-[color-mix(in_srgb,var(--text-main)_10%,transparent)] stroke-[1px]"
                />
            </PopoverContent>
        </PopoverPortal>
    </PopoverRoot>
</template>
