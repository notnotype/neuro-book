<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import {dragScrollTop, pageScrollTop, thumbGeometry} from "../../utils/scrollbar-geometry";
import type {ScrollMetrics} from "../../utils/scrollbar-geometry";

const props = defineProps<{
    /** 被滚动的元素；与本组件同一个父元素，父元素要定位（滚动条按它在父元素里的矩形摆放）。 */
    target: HTMLElement | null;
}>();

/** 最后一次滚动之后多久算“不在滚动”；之后的停留与淡出由样式的过渡负责。 */
const SCROLL_SETTLE_MS = 100;

const metrics = shallowRef<ScrollMetrics>({scrollTop: 0, clientHeight: 0, scrollHeight: 0});
const box = shallowRef({top: 0, left: 0, height: 0});
const hovered = ref(false);
const scrolling = ref(false);
const dragging = ref(false);

const thumb = computed(() => thumbGeometry(metrics.value));
const shown = computed(() => thumb.value !== null && (hovered.value || scrolling.value || dragging.value));

function measure(): void {
    const el = props.target;
    if (el === null) return;
    metrics.value = {scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight};
    box.value = {top: el.offsetTop, left: el.offsetLeft + el.offsetWidth, height: el.clientHeight};
}

let settle: ReturnType<typeof setTimeout> | null = null;

function onScroll(): void {
    measure();
    scrolling.value = true;
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
        settle = null;
        scrolling.value = false;
    }, SCROLL_SETTLE_MS);
}

function onEnter(): void {
    measure();
    hovered.value = true;
}

function onLeave(): void {
    hovered.value = false;
}

// 内容的高度变了（展开、加载、虚拟列表换行）滚动元素自己的尺寸不一定变：子元素也要观察，子元素换了重新观察。
let resize: ResizeObserver | null = null;
let children: MutationObserver | null = null;

function observeChildren(el: HTMLElement): void {
    if (resize === null) return;
    resize.disconnect();
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);
}

function attach(el: HTMLElement): () => void {
    const host = el.parentElement;
    el.classList.add("nb-ui-scrollbar-none");
    el.addEventListener("scroll", onScroll, {passive: true});
    host?.addEventListener("pointerenter", onEnter);
    host?.addEventListener("pointerleave", onLeave);
    if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(measure);
        observeChildren(el);
    }
    if (typeof MutationObserver !== "undefined") {
        children = new MutationObserver(() => observeChildren(el));
        children.observe(el, {childList: true});
    }
    measure();
    return () => {
        el.classList.remove("nb-ui-scrollbar-none");
        el.removeEventListener("scroll", onScroll);
        host?.removeEventListener("pointerenter", onEnter);
        host?.removeEventListener("pointerleave", onLeave);
        resize?.disconnect();
        children?.disconnect();
        resize = null;
        children = null;
        if (settle !== null) clearTimeout(settle);
        settle = null;
        hovered.value = false;
        scrolling.value = false;
        dragging.value = false;
    };
}

let detach: (() => void) | null = null;

watch(() => props.target, (el) => {
    detach?.();
    detach = el === null ? null : attach(el);
}, {immediate: true, flush: "post"});

onBeforeUnmount(() => detach?.());

// ── 指针 ─────────────────────────────────────────────────────────────────────

let dragStart: {y: number; metrics: ScrollMetrics} | null = null;

function onThumbDown(event: PointerEvent): void {
    if (event.button !== 0 || props.target === null) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    measure();
    dragStart = {y: event.clientY, metrics: metrics.value};
    dragging.value = true;
}

function onThumbMove(event: PointerEvent): void {
    if (dragStart === null || props.target === null) return;
    props.target.scrollTop = dragScrollTop(dragStart.metrics, event.clientY - dragStart.y);
}

function onThumbUp(): void {
    dragStart = null;
    dragging.value = false;
}

function onTrackDown(event: PointerEvent): void {
    if (event.button !== 0 || props.target === null) return;
    // 不让按下把焦点从滚动元素（例如树）拿走，也不开始选中文字。
    event.preventDefault();
    const top = (event.currentTarget as HTMLElement).getBoundingClientRect().top;
    measure();
    props.target.scrollTop = pageScrollTop(metrics.value, event.clientY - top);
}
</script>

<template>
    <div
        v-if="thumb !== null"
        class="nb-ui-overlay-scrollbar"
        :style="{top: `${box.top}px`, left: `${box.left}px`, height: `${box.height}px`}"
        :data-shown="shown ? '' : undefined"
        :data-dragging="dragging ? '' : undefined"
        aria-hidden="true"
        data-overlay-scrollbar
        @pointerdown="onTrackDown"
    >
        <div
            class="nb-ui-overlay-scrollbar__thumb"
            :style="{height: `${thumb.size}px`, transform: `translateY(${thumb.offset}px)`}"
            data-overlay-scrollbar-thumb
            @pointerdown.stop="onThumbDown"
            @pointermove="onThumbMove"
            @pointerup="onThumbUp"
            @pointercancel="onThumbUp"
            @lostpointercapture="onThumbUp"
        ></div>
    </div>
</template>

<style scoped>
/*
 * 轨道宽是滑块宽（`--scrollbar-w`）加 4px，滑块靠右留 2px；`left` 给的是滚动元素的右缘，轨道用 `translate` 退回自己的
 * 一个宽度，这样滑块粗细换了，轨道仍贴在右缘，不必在脚本里知道它有多宽。
 *
 * 显隐的时机照 VS Code（`--motion-reveal-*`）：出现时淡入；消失先停一会儿再淡出（过渡延迟写在隐藏态上，显示态没有
 * 延迟）。看不见时不接指针，免得挡住下面的内容。系统减少动画时这几个时长都是 0。
 */
.nb-ui-overlay-scrollbar {
    position: absolute;
    width: calc(var(--scrollbar-w) + 4px);
    translate: -100% 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--motion-reveal-out) linear var(--motion-reveal-hold);
}

.nb-ui-overlay-scrollbar[data-shown] {
    opacity: 1;
    pointer-events: auto;
    transition: opacity var(--motion-reveal-in) linear;
}

.nb-ui-overlay-scrollbar__thumb {
    position: absolute;
    top: 0;
    right: 2px;
    width: var(--scrollbar-w);
    border-radius: calc(var(--scrollbar-w) / 2);
    background: color-mix(in srgb, var(--text-main) var(--scrollbar-thumb-mix), transparent);
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.nb-ui-overlay-scrollbar__thumb:hover {
    background: color-mix(in srgb, var(--text-main) var(--scrollbar-thumb-hover-mix), transparent);
}

.nb-ui-overlay-scrollbar[data-dragging] .nb-ui-overlay-scrollbar__thumb {
    background: color-mix(in srgb, var(--text-main) var(--scrollbar-thumb-active-mix), transparent);
}
</style>
