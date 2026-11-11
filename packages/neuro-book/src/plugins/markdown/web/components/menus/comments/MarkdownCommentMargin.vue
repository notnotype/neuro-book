<script setup lang="ts">
/** 批注页边（同名 .md）：稿纸右边按段落顶边排的一列卡片，与稿纸同在滚动容器里，随正文一起滚。 */
import type {CommentInfo} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import MarkdownCommentCard from "./MarkdownCommentCard.vue";
import type {CommentCardLabels} from "./MarkdownCommentCard.vue";
import {MARGIN_GAP, MARGIN_WIDTH} from "./margin-layout";

/** 页边的一张卡片：`info` 为 null 是还不在文档里的新批注（“待写”）。 */
export interface MarginItem {
    readonly key: string;
    readonly info: CommentInfo | null;
    readonly mode: "view" | "write" | "compact";
    /** 卡片顶边对着的文档位置：批注第一行，待写的是选区起点。 */
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

const offsets = ref<number[]>([]);
const left = ref(0);
const elements = new Map<number, HTMLElement>();
const setElement = (index: number) => (element: unknown): void => {
    if (element instanceof HTMLElement) elements.set(index, element);
    else elements.delete(index);
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
    const next = props.items.map((item, index) => {
        const y = Math.max(Math.round(topOf(editor, scroller, item.anchor) - base.top + scroller.scrollTop), bottom + ITEM_GAP);
        bottom = y + (elements.get(index)?.offsetHeight ?? 0);
        return y;
    });
    if (next.length !== offsets.value.length || next.some((value, index) => value !== offsets.value[index])) offsets.value = next;
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
    if (typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(schedule);
    observeAll();
});
// 字体加载会让行高变。
document.fonts?.addEventListener("loadingdone", schedule);
onBeforeUnmount(() => {
    observer?.disconnect();
    document.fonts?.removeEventListener("loadingdone", schedule);
    if (frame !== 0) cancelAnimationFrame(frame);
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
        <div
            v-for="(item, index) in props.items"
            :key="item.key"
            :ref="setElement(index)"
            class="markdown-comment-margin__item"
            :class="{'markdown-comment-margin__item--current': item.mode !== 'compact', 'nb-ui-popover-surface': item.mode !== 'compact'}"
            :data-mode="item.mode"
            :style="offsets[index] === undefined ? {top: '0px', visibility: 'hidden'} : {top: `${offsets[index]}px`}"
        >
            <MarkdownCommentCard
                :body="item.info?.body ?? ''"
                :index="item.info?.index ?? props.total"
                :total="item.info === null ? props.total + 1 : props.total"
                :mode="item.mode === 'write' ? 'write' : 'view'"
                :compact="item.mode === 'compact'"
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
    </div>
</template>

<style scoped>
/* 与稿纸同在滚动容器里、绝对定位：随正文滚，页边的高度不撑开滚动容器以外的东西。 */
.markdown-comment-margin {
    position: absolute;
    top: 0;
    pointer-events: none;
}

.markdown-comment-margin__item {
    position: absolute;
    left: 0;
    right: 0;
    pointer-events: auto;
    overflow: hidden;
    border-radius: var(--radius-control);
    border-left: 2px solid var(--status-warning-border);
    background: color-mix(in srgb, var(--text-main) 5%, var(--bg-panel));
}

/* 展开的一条（光标所在的、在写的）用浮层的底与阴影，与浮层里的同一张卡片。 */
.markdown-comment-margin__item--current {
    background: var(--overlay-surface);
    border-left-color: var(--status-warning);
}

.markdown-comment-margin :deep(.markdown-comment-card) {
    width: auto;
}

</style>
