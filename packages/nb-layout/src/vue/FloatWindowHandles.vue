<script setup lang="ts">
/** 浮动窗的手柄（同名 .md）：缩放和键盘移动。只算矩形。 */
import {computed, shallowRef} from "vue";

import type {GridRect} from "../grid-rects";
import type {GridExtent} from "../grid-types";
import {resizeFloatRect} from "../layout-doc";
import type {LayoutFloatResize} from "../layout-doc";
import {useLayoutText} from "./text";

defineOptions({name: "FloatWindowHandles"});

const props = withDefaults(defineProps<{
    rect: GridRect;
    min: GridExtent;
    max: GridExtent;
    moveIconClass?: string;
}>(), {moveIconClass: ""});

const emit = defineEmits<{
    (event: "preview", rect: GridRect | null): void;
    (event: "commit", rect: GridRect): void;
}>();

const text = useLayoutText();

interface Handle {
    readonly id: string;
    readonly direction: LayoutFloatResize;
    readonly cursor: string;
}

const CORNER: Handle = {id: "bottom-right", direction: {width: 1, height: 1}, cursor: "nwse-resize"};
const POINTER_HANDLES: ReadonlyArray<Handle> = [
    {id: "top", direction: {width: 0, height: -1}, cursor: "ns-resize"},
    {id: "right", direction: {width: 1, height: 0}, cursor: "ew-resize"},
    {id: "bottom", direction: {width: 0, height: 1}, cursor: "ns-resize"},
    {id: "left", direction: {width: -1, height: 0}, cursor: "ew-resize"},
    {id: "top-left", direction: {width: -1, height: -1}, cursor: "nwse-resize"},
    {id: "top-right", direction: {width: 1, height: -1}, cursor: "nesw-resize"},
    {id: "bottom-left", direction: {width: -1, height: 1}, cursor: "nesw-resize"},
];

/** 按键的步长：和 nb-ui 的 `useFloatingWindow` 一样。 */
const KEY_STEP = 10;
const KEY_STEP_FINE = 1;
const ARROWS: Readonly<Record<string, {readonly x: number; readonly y: number}>> = {ArrowLeft: {x: -1, y: 0}, ArrowRight: {x: 1, y: 0}, ArrowUp: {x: 0, y: -1}, ArrowDown: {x: 0, y: 1}};

const bounds = computed(() => ({min: props.min, max: props.max}));
const resizing = shallowRef<{readonly pointer: number; readonly direction: LayoutFloatResize; readonly start: GridRect; readonly from: {readonly x: number; readonly y: number}; current: GridRect} | null>(null);

function onPointerDown(event: PointerEvent, handle: Handle): void {
    if (event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    // 焦点给手柄：Esc 才有地方收。
    element.focus({preventScroll: true});
    resizing.value = {pointer: event.pointerId, direction: handle.direction, start: props.rect, from: {x: event.clientX, y: event.clientY}, current: props.rect};
    event.preventDefault();
    event.stopPropagation();
}

function onPointerMove(event: PointerEvent): void {
    const active = resizing.value;
    if (active === null || event.pointerId !== active.pointer) return;
    active.current = resizeFloatRect(active.start, active.direction, {x: event.clientX - active.from.x, y: event.clientY - active.from.y}, bounds.value);
    emit("preview", active.current);
}

function finish(commit: boolean): void {
    const active = resizing.value;
    if (active === null) return;
    resizing.value = null;
    emit("preview", null);
    if (commit) emit("commit", active.current);
}

function onPointerUp(event: PointerEvent): void {
    if (resizing.value?.pointer === event.pointerId) finish(true);
}

function onKeydown(event: KeyboardEvent, kind: "resize" | "move"): void {
    if (event.key === "Escape" && resizing.value !== null) {
        finish(false);
        event.stopPropagation();
        return;
    }
    const arrow = ARROWS[event.key];
    if (arrow === undefined || resizing.value !== null) return;
    const step = event.shiftKey ? KEY_STEP_FINE : KEY_STEP;
    const delta = {x: arrow.x * step, y: arrow.y * step};
    emit("commit", kind === "move" ? {...props.rect, x: props.rect.x + delta.x, y: props.rect.y + delta.y} : resizeFloatRect(props.rect, CORNER.direction, delta, bounds.value));
    event.preventDefault();
    event.stopPropagation();
}
</script>

<template>
    <div class="nb-float-handles" data-no-drag>
        <div
            v-for="handle in POINTER_HANDLES"
            :key="handle.id"
            class="nb-float-handle"
            :class="`nb-float-handle--${handle.id}`"
            :data-float-handle="handle.id"
            tabindex="-1"
            aria-hidden="true"
            :style="{cursor: handle.cursor}"
            @pointerdown="onPointerDown($event, handle)"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @lostpointercapture="finish(false)"
            @keydown="onKeydown($event, 'resize')"
        ></div>
        <button
            type="button"
            class="nb-float-handle nb-float-handle--bottom-right nb-ui-focus-ring"
            :data-float-handle="CORNER.id"
            :aria-label="text('floatWindow.resize')"
            :style="{cursor: CORNER.cursor}"
            @pointerdown="onPointerDown($event, CORNER)"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @lostpointercapture="finish(false)"
            @keydown="onKeydown($event, 'resize')"
        ></button>
        <button type="button" class="nb-float-move nb-ui-focus-ring" data-float-move-handle :aria-label="text('floatWindow.move')" @keydown="onKeydown($event, 'move')">
            <span v-if="moveIconClass !== ''" :class="moveIconClass" aria-hidden="true"></span>
        </button>
    </div>
</template>

<style scoped>
.nb-float-handles {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.nb-float-handle {
    position: absolute;
    padding: 0;
    border: none;
    background: transparent;
    outline-offset: -1px;
    pointer-events: auto;
    touch-action: none;
}

.nb-float-handle--top,
.nb-float-handle--bottom {
    right: 8px;
    left: 8px;
}

/* 上边只留一线：下面就是标签条，要留给拖动。 */
.nb-float-handle--top {
    top: 0;
    height: 3px;
}

.nb-float-handle--bottom {
    bottom: 0;
    height: 6px;
}

.nb-float-handle--left,
.nb-float-handle--right {
    top: 8px;
    bottom: 8px;
    width: 6px;
}

.nb-float-handle--left {
    left: 0;
}

.nb-float-handle--right {
    right: 0;
}

.nb-float-handle--top-left,
.nb-float-handle--top-right,
.nb-float-handle--bottom-left,
.nb-float-handle--bottom-right {
    width: 10px;
    height: 10px;
}

.nb-float-handle--top-left,
.nb-float-handle--top-right {
    top: 0;
    height: 6px;
}

.nb-float-handle--top-left {
    left: 0;
}

.nb-float-handle--top-right {
    right: 0;
}

.nb-float-handle--bottom-left {
    bottom: 0;
    left: 0;
}

.nb-float-handle--bottom-right {
    right: 0;
    bottom: 0;
}

/* 只给键盘：平时看不见也接不到指针，聚焦时露出来。指针移动窗口是拖标签条。 */
.nb-float-move {
    position: absolute;
    top: 2px;
    left: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--panel-surface);
    color: var(--text-secondary);
    opacity: 0;
    transform: translateX(-50%);
}

.nb-float-move:focus-visible {
    opacity: 1;
}
</style>
