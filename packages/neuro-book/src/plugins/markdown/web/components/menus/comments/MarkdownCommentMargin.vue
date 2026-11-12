<script setup lang="ts">
/** 批注页边（同名 .md）：稿纸右边按段落顶边排的一列卡片，与稿纸同在滚动容器里，随正文一起滚。 */
import type {CommentInfo} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import MarkdownCommentCard from "./MarkdownCommentCard.vue";
import type {CommentCardLabels} from "./MarkdownCommentCard.vue";
import {MARGIN_GAP, MARGIN_WIDTH} from "./margin-layout";

/** 页边的一张卡片：`info` 为 null 是还不在文档里的新批注（“待写”）。 */
export interface MarginItem {
    readonly key: string;
    readonly info: CommentInfo | null;
    /** `current` 是光标所在的那条（按钮显现、意见放开行数），`write` 在写，`idle` 其余。 */
    readonly mode: "current" | "write" | "idle";
    /** 卡片顶边对着的文档位置：批注第一行，待写的是选区起点（整块批注是块的位置）。 */
    readonly anchor: number;
}

/** 卡片之间的最小间距。 */
const ITEM_GAP = 6;

const props = defineProps<{
    editor: Editor;
    scroller: HTMLElement;
    items: ReadonlyArray<MarginItem>;
    /** 文档里批注的总数（“第 i 条，共 n 条”）。 */
    total: number;
    readonly: boolean;
    labels: CommentCardLabels;
    session: number;
    /** 每个事务加一：正文变了，位置要重排。 */
    version: number;
    /** 写着的字（宿主存，见卡片的 `draft`）。 */
    draft: string | null;
}>();
const emit = defineEmits<{
    (event: "edit", info: CommentInfo): void;
    (event: "remove", info: CommentInfo): void;
    (event: "previous", info: CommentInfo): void;
    (event: "next", info: CommentInfo): void;
    (event: "select", info: CommentInfo): void;
    (event: "submit", text: string): void;
    (event: "update:draft", text: string): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
}>();

/**
 * 每张卡片的 `top`，按卡片的 `key` 记：卡片增减时下标会变，按下标记的话还没重排的那一帧里卡片会拿到邻居的旧位置，加上位置过渡就
 * 是先滑向邻居再折回来。没有位置的卡片（新来的）藏着，排好之后才显示。
 */
const offsets = shallowRef<ReadonlyMap<string, number>>(new Map());
/** 位置落下之后的下一帧才显示的卡片：带着入场动画出现，位置过渡也只对它们开（见 `<style>`），所以第一次排位置不会滑动。 */
const ready = shallowRef<ReadonlySet<string>>(new Set());
const left = ref(0);
const elements = new Map<string, HTMLElement>();
const setElement = (key: string) => (element: unknown): void => {
    if (element instanceof HTMLElement) elements.set(key, element);
    else elements.delete(key);
};

/**
 * 一个文档位置的顶边（视口坐标）。批注在折叠的提示块里时内容没有盒子，`coordsAtPos` 给全 0：退回它最近的有盒子的祖先，也就是提示块
 * 自己（输出 33）。
 */
function topOf(editor: Editor, scroller: HTMLElement, wanted: number): number {
    // 换文档之后到第一次重算之前，位置可能超出新文档：夹在文档里，免得 `coordsAtPos` 抛错。
    const pos = Math.max(0, Math.min(wanted, editor.state.doc.content.size));
    const rect = editor.view.coordsAtPos(pos);
    if (rect.top !== 0 || rect.bottom !== 0 || rect.left !== 0 || rect.right !== 0) return rect.top;
    const {node} = editor.view.domAtPos(pos);
    let element: Element | null = node instanceof Element ? node : node.parentElement;
    while (element !== null && element !== scroller && element.getBoundingClientRect().height === 0) element = element.parentElement;
    return element === null ? 0 : element.getBoundingClientRect().top;
}

/** 每个卡片的 `top`：顶边对着批注第一行，靠得太近的往下让，顺序与文档里一致、不互相盖住。 */
function layout(): void {
    const {editor, scroller} = props;
    if (editor.isDestroyed) return;
    const base = scroller.getBoundingClientRect();
    const paper = scroller.querySelector<HTMLElement>(".markdown-control");
    left.value = paper === null ? 0 : Math.round(paper.getBoundingClientRect().right - base.left + scroller.scrollLeft + MARGIN_GAP);
    let bottom = Number.NEGATIVE_INFINITY;
    const next = new Map<string, number>();
    for (const item of props.items) {
        const y = Math.max(Math.round(topOf(editor, scroller, item.anchor) - base.top + scroller.scrollTop), bottom + ITEM_GAP);
        bottom = y + (elements.get(item.key)?.offsetHeight ?? 0);
        next.set(item.key, y);
    }
    const before = offsets.value;
    if (next.size !== before.size || [...next].some(([key, value]) => before.get(key) !== value)) offsets.value = next;
    promote();
}

// 一帧里多个触发合成一次量。
let frame = 0;
function schedule(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        layout();
    });
}

/** 位置已经落下的卡片，下一帧起显示：那时它们的 `top` 不再变，位置过渡不会从旧值滑过来。 */
let promoting = 0;
function promote(): void {
    if (promoting !== 0) return;
    promoting = requestAnimationFrame(() => {
        promoting = 0;
        const keys = props.items.filter((item) => offsets.value.has(item.key)).map((item) => item.key);
        if (keys.length !== ready.value.size || keys.some((key) => !ready.value.has(key))) ready.value = new Set(keys);
    });
}

/**
 * 稿纸在 `padding-inline-end` 的过渡里平移时（开关页边，`MarkdownControl`）它的右缘每帧都在动，页边要跟着：过渡进行中每帧重排一次。
 * 观察者看不到这种位置变化（尺寸没变）。
 */
let paperTransitions = 0;
let following = 0;
function follow(): void {
    if (following !== 0) return;
    following = requestAnimationFrame(() => {
        following = 0;
        layout();
        if (paperTransitions > 0) follow();
    });
}
const isPaperTransition = (event: TransitionEvent): boolean => event.target === props.scroller && event.propertyName.startsWith("padding");
function onPaperRun(event: TransitionEvent): void {
    if (!isPaperTransition(event)) return;
    paperTransitions += 1;
    follow();
}
function onPaperEnd(event: TransitionEvent): void {
    if (!isPaperTransition(event)) return;
    paperTransitions = Math.max(0, paperTransitions - 1);
    schedule();
}

let observer: ResizeObserver | null = null;
/** 观察滚动容器、稿纸与每张卡片：卡片的高度在渲染之后才知道（换了模式、意见变长都要再排一次），窗口变宽使段落重新折行而总高度不变时靠宽度。 */
function observeAll(): void {
    if (observer === null) return;
    observer.disconnect();
    observer.observe(props.scroller);
    const paper = props.scroller.querySelector(".markdown-control");
    if (paper !== null) observer.observe(paper);
    for (const element of elements.values()) observer.observe(element);
}
onMounted(() => {
    schedule();
    props.scroller.addEventListener("transitionrun", onPaperRun);
    props.scroller.addEventListener("transitionend", onPaperEnd);
    props.scroller.addEventListener("transitioncancel", onPaperEnd);
    if (typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(schedule);
    observeAll();
});
// 字体加载会让行高变。
document.fonts?.addEventListener("loadingdone", schedule);
onBeforeUnmount(() => {
    observer?.disconnect();
    document.fonts?.removeEventListener("loadingdone", schedule);
    props.scroller.removeEventListener("transitionrun", onPaperRun);
    props.scroller.removeEventListener("transitionend", onPaperEnd);
    props.scroller.removeEventListener("transitioncancel", onPaperEnd);
    for (const handle of [frame, promoting, following]) if (handle !== 0) cancelAnimationFrame(handle);
});
watch(() => [props.items, props.version, props.session] as const, () => {
    schedule();
    observeAll();
}, {flush: "post"});

defineExpose({
    /** 立刻排一次（组件测试里 rAF 不跑，用它）。 */
    layout,
});
</script>

<template>
    <div class="markdown-comment-margin" data-markdown-comment-margin :style="{left: `${left}px`, width: `${MARGIN_WIDTH}px`}">
        <TransitionGroup name="markdown-comment-card" tag="div">
            <div
                v-for="item in props.items"
                :key="item.key"
                :ref="setElement(item.key)"
                class="markdown-comment-margin__item"
                :class="{'markdown-comment-margin__item--current': item.mode !== 'idle'}"
                :data-mode="item.mode"
                :data-ready="ready.has(item.key) ? '' : undefined"
                :style="{top: `${offsets.get(item.key) ?? 0}px`}"
            >
                <MarkdownCommentCard
                    variant="margin"
                    :current="item.mode !== 'idle'"
                    :body="item.info?.body ?? ''"
                    :index="item.info?.index ?? props.total"
                    :total="item.info === null ? props.total + 1 : props.total"
                    :mode="item.mode === 'write' ? 'write' : 'view'"
                    :readonly="props.readonly"
                    :labels="props.labels"
                    :session="props.session"
                    :draft="props.draft"
                    @edit="item.info !== null && emit('edit', item.info)"
                    @remove="item.info !== null && emit('remove', item.info)"
                    @previous="item.info !== null && emit('previous', item.info)"
                    @next="item.info !== null && emit('next', item.info)"
                    @select="item.info !== null && emit('select', item.info)"
                    @submit="(text) => emit('submit', text)"
                    @update:draft="(text) => emit('update:draft', text)"
                    @cancel="emit('cancel')"
                    @dismiss="emit('dismiss')"
                />
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
/* 与稿纸同在滚动容器里、绝对定位：随正文滚，页边的高度不撑开滚动容器以外的东西。 */
.markdown-comment-margin {
    position: absolute;
    top: 0;
    pointer-events: none;
}

/*
 * 卡片：非当前的用淡底，当前的与写着的用浮层的底、描边与阴影；两种都带同宽的描边（透明或实色），切换时外框不变，没有左边框
 * 一类的侧边色条。位置落下之前（`data-ready` 之前）透明、不接收指针，也没有过渡；落下之后显示，入场一次，`top` 变了才滑动。
 */
.markdown-comment-margin__item {
    position: absolute;
    left: 0;
    right: 0;
    /* 不用 `visibility: hidden`：隐藏的元素拿不到焦点，待写的卡片一出来就要把焦点给输入框。 */
    opacity: 0;
    pointer-events: none;
    border: var(--border-w) solid transparent;
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--text-main) 5%, var(--bg-panel));
}

.markdown-comment-margin__item[data-ready] {
    opacity: 1;
    pointer-events: auto;
    animation: markdown-comment-card-in var(--motion-move) var(--ease-layout) backwards;
    transition: top var(--motion-move) var(--ease-layout),
        background-color var(--motion-fast) var(--ease-layout),
        border-color var(--motion-fast) var(--ease-layout),
        box-shadow var(--motion-fast) var(--ease-layout);
}

.markdown-comment-margin__item--current {
    border-color: var(--panel-outline);
    background: var(--overlay-surface);
    box-shadow: var(--elevation-popover);
}

@keyframes markdown-comment-card-in {
    from {
        opacity: 0;
        transform: translateX(8px);
    }
}

/* 卡片移除时淡出；绝对定位，不挤别的卡片。 */
/* 特异性要不低于 `[data-ready]` 上的 `transition`，否则整条盖掉，淡出没有动画。 */
.markdown-comment-margin__item[data-ready].markdown-comment-card-leave-active {
    pointer-events: none;
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}

.markdown-comment-margin__item[data-ready].markdown-comment-card-leave-to {
    opacity: 0;
}

/* 整个页边移除时（关开关、控件变窄）淡出；`MarkdownCommentLayer` 用 `<Transition name="markdown-comment-margin">` 包着它。 */
.markdown-comment-margin-leave-active {
    transition: opacity var(--motion-fast) var(--ease-dialog-leave);
}

.markdown-comment-margin-leave-to {
    opacity: 0;
}

.markdown-comment-margin :deep(.markdown-comment-card) {
    width: auto;
}
</style>
