<script setup lang="ts">
/** 批注页边（同名 .md）：稿纸右边按段排的一列槽位，与稿纸同在滚动容器里，随正文一起滚。 */
import type {CommentInfo} from "@notnotype/nb-markdown/editor";
import type {Editor} from "@tiptap/core";
import {onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";

import MarkdownCommentCard from "./MarkdownCommentCard.vue";
import type {CommentCardLabels} from "./MarkdownCommentCard.vue";
import {MARGIN_GAP, MARGIN_WIDTH, MIN_CAP_LINES, slotRange, SLOT_GAP} from "./margin-layout";

/** 页边的一个槽位（输出 33）：一段一个，同一段的几条批注合用。`infos` 为空是还不在文档里的新批注（“待写”）。 */
export interface MarginSlot {
    /** 槽位身份：这一段的位置经事务映射后沿用的 key（宿主记）。 */
    readonly key: string;
    /** 这一段的起点位置。 */
    readonly anchor: number;
    /** 文档顺序里下一段的起点；没有为 null。 */
    readonly next: number | null;
    readonly nextCommented: boolean;
    readonly infos: ReadonlyArray<CommentInfo>;
    /** 显示 `infos` 里的哪一条。 */
    readonly active: number;
    /** `current` 是光标所在的那条在这一段里（按钮显现），`write` 在写，`idle` 其余。 */
    readonly mode: "current" | "write" | "idle";
    /** 展开：卡片浮在后面的槽位上面，槽位自己的位置与占位不变。 */
    readonly expanded: boolean;
}

/** 一个槽位量出来的结果：`top` 是槽位顶边，`idle` 是槽位占位的高度，`height` 是卡片面的高度（展开时比 `idle` 高），`lines` 是意见限几行。 */
interface SlotLayout {
    readonly top: number;
    readonly lines: number;
    readonly idle: number;
    readonly height: number;
}

const props = defineProps<{
    editor: Editor;
    scroller: HTMLElement;
    slots: ReadonlyArray<MarginSlot>;
    /** 文档里批注的总数（卡片的序号用，页边里不画计数）。 */
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
    /** `expand`：点卡片的空白展开；点同一段里的箭头切换时不展开。 */
    (event: "select", info: CommentInfo, expand: boolean): void;
    (event: "submit", text: string): void;
    (event: "update:draft", text: string): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
}>();

/**
 * 每个槽位的位置与高度，按槽位的 `key` 记：槽位增减时下标会变，按下标记的话还没重排的那一帧里槽位会拿到邻居的旧位置，加上位置过渡就是先滑向
 * 邻居再折回来。还没有结果的槽位（新来的）藏着，排好之后才显示。
 */
const layouts = shallowRef<ReadonlyMap<string, SlotLayout>>(new Map());
/** 位置落下之后的下一帧才显示的槽位：带着入场动画出现，位置与高度的过渡也只对它们开（见 `<style>`），所以第一次排位置不会滑动。 */
const ready = shallowRef<ReadonlySet<string>>(new Set());
const left = ref(0);
const elements = new Map<string, HTMLElement>();
const setElement = (key: string) => (element: unknown): void => {
    if (element instanceof HTMLElement) elements.set(key, element);
    else elements.delete(key);
};

interface Box {
    readonly top: number;
    readonly bottom: number;
}

/**
 * 一段的盒子（视口坐标）。折叠的提示块里的内容没有盒子（高度 0）：退回它最近的有盒子的祖先，也就是提示块自己（输出 33）。位置可能超出文档
 * （换文档之后到第一次重算之前）：夹在文档里，免得 `nodeDOM` 抛错。取不到盒子为 null。
 */
function boxOf(editor: Editor, scroller: HTMLElement, wanted: number): Box | null {
    const pos = Math.max(0, Math.min(wanted, editor.state.doc.content.size));
    const dom = editor.view.nodeDOM(pos);
    let element: Element | null = dom instanceof Element ? dom : dom?.parentElement ?? null;
    while (element !== null && element !== scroller && element.getBoundingClientRect().height === 0) element = element.parentElement;
    if (element === null || element === scroller) return null;
    const rect = element.getBoundingClientRect();
    return {top: rect.top, bottom: rect.bottom};
}

const FALLBACK_LINE_HEIGHT = 22;

const px = (value: string): number => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : 0;
};

/** 卡片的尺寸：行高、一行意见的卡片高度、卡片上下的内边距与描边。读自第一张卡片的真实样式；还没有卡片时为 null。 */
function measureCard(): {readonly lineHeight: number; readonly chrome: number} | null {
    for (const element of elements.values()) {
        const surface = element.querySelector<HTMLElement>(".markdown-comment-margin__surface");
        const card = surface?.querySelector<HTMLElement>("[data-markdown-comment-card]");
        if (surface === null || surface === undefined || card === null || card === undefined) continue;
        const style = getComputedStyle(card);
        // 没有排版（量不到行高）时按一个常见的行高，免得限行数算成无穷大。
        const line = px(style.lineHeight) || px(style.fontSize) * 1.55 || FALLBACK_LINE_HEIGHT;
        const borders = px(getComputedStyle(surface).borderTopWidth) + px(getComputedStyle(surface).borderBottomWidth);
        return {lineHeight: line, chrome: px(style.paddingTop) + px(style.paddingBottom) + borders};
    }
    return null;
}

/**
 * 卡片的自然高度（含描边）：没展开的卡片是意见限到 `lines` 行之后的样子；还没渲染为 null。
 * 没展开的卡片不读卡片的实际高度：收起时卡片里的限行晚一个过渡才生效（`MarkdownCommentCard.vue` 的 `__body--clamped`），那一阵卡片还是展开时的高度，
 * 读到的就是错的。改由意见全文的高度（`scrollHeight` 不管限不限行都是全文）和行数算。展开的、写着的卡片不限行，读实际高度。
 */
function naturalOf(key: string, expanded: boolean, metrics: {readonly lineHeight: number; readonly chrome: number}, lines: number): number | null {
    const surface = elements.get(key)?.querySelector<HTMLElement>(".markdown-comment-margin__surface");
    const card = surface?.querySelector<HTMLElement>("[data-markdown-comment-card]");
    if (surface === null || surface === undefined || card === null || card === undefined) return null;
    const body = expanded ? null : card.querySelector<HTMLElement>("[data-markdown-comment-body]");
    if (body === null) return card.offsetHeight + (surface.offsetHeight - surface.clientHeight);
    return metrics.chrome + Math.min(body.scrollHeight, lines * metrics.lineHeight);
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/**
 * 每个槽位的位置与高度：顶边对这一段的顶边；高度的范围见 `slotRange`，卡片的自然高度夹在里面，展开的卡片面可以比槽位高（槽位仍占展开之前的
 * 高度，别的槽位不因展开或收回重排）。限的行数由范围的上限算，自然高度再由意见全文与行数算（`naturalOf`），一遍就够；卡片的实际高度变了
 * （换了模式、意见变长）由观察者再触发一遍。
 */
function layout(): void {
    const {editor, scroller} = props;
    if (editor.isDestroyed) return;
    const base = scroller.getBoundingClientRect();
    const paper = scroller.querySelector<HTMLElement>(".markdown-control");
    left.value = paper === null ? 0 : Math.round(paper.getBoundingClientRect().right - base.left + scroller.scrollLeft + MARGIN_GAP);
    const metrics = measureCard();
    const before = layouts.value;
    const next = new Map<string, SlotLayout>();
    let bottom = Number.NEGATIVE_INFINITY;
    for (const slot of props.slots) {
        const box = boxOf(editor, scroller, slot.anchor);
        if (box === null || metrics === null) continue;
        const nextBox = slot.next === null ? null : boxOf(editor, scroller, slot.next);
        const range = slotRange(
            {top: box.top, height: box.bottom - box.top, nextBottom: nextBox === null ? null : nextBox.bottom, nextCommented: slot.nextCommented},
            {oneLine: metrics.chrome + metrics.lineHeight, minCap: metrics.chrome + MIN_CAP_LINES * metrics.lineHeight},
        );
        const lines = Math.max(1, Math.floor((range.max - metrics.chrome) / metrics.lineHeight));
        const natural = naturalOf(slot.key, slot.expanded || slot.mode === "write", metrics, lines);
        const prior = before.get(slot.key);
        // 展开时槽位仍占展开之前的高度：展开之前量到的，没有（待写的卡片一出来就是展开的）就取最小高度。
        const idle = slot.expanded ? prior?.idle ?? range.min : natural === null ? range.min : clamp(natural, range.min, range.max);
        const top = Math.round(box.top - base.top + scroller.scrollTop);
        // 一行的短段放一行意见时卡片比这一段稍高，往下让到与前一个槽位隔开 `SLOT_GAP`。展开的槽位照样按展开之前的高度占位，所以展开、收回都不动别的槽位；
        // 待写的新批注（没有批注）浮着，不占位，也不被前面的槽位推开。
        const floats = slot.infos.length === 0;
        const y = floats ? top : Math.max(top, bottom + SLOT_GAP);
        if (!floats) bottom = y + idle;
        next.set(slot.key, {
            top: y,
            lines,
            idle,
            height: slot.expanded ? Math.max(idle, natural ?? idle) : idle,
        });
    }
    const same = next.size === before.size && [...next].every(([key, value]) => {
        const old = before.get(key);
        return old !== undefined && old.top === value.top && old.lines === value.lines && old.idle === value.idle && old.height === value.height;
    });
    if (!same) layouts.value = next;
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

/** 位置已经落下的槽位，下一帧起显示：那时它们的 `top` 与高度不再变，过渡不会从旧值滑过来。 */
let promoting = 0;
function promote(): void {
    if (promoting !== 0) return;
    promoting = requestAnimationFrame(() => {
        promoting = 0;
        const keys = props.slots.filter((slot) => layouts.value.has(slot.key)).map((slot) => slot.key);
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
/**
 * 观察滚动容器、稿纸与每张卡片：卡片的自然高度在渲染之后才知道（换了模式、意见变长、限行数变了都要再排一次），窗口变宽使段落重新折行而总高度
 * 不变时靠宽度。槽位自己的高度是排出来的，不观察。
 */
function observeAll(): void {
    if (observer === null) return;
    observer.disconnect();
    observer.observe(props.scroller);
    const paper = props.scroller.querySelector(".markdown-control");
    if (paper !== null) observer.observe(paper);
    for (const element of elements.values()) {
        const card = element.querySelector("[data-markdown-comment-card]");
        if (card !== null) observer.observe(card);
    }
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
watch(() => [props.slots, props.version, props.session] as const, () => {
    schedule();
    observeAll();
}, {flush: "post"});

/** 槽位里显示的那条；待写的新批注没有。 */
const activeInfo = (slot: MarginSlot): CommentInfo | null => slot.infos[slot.active] ?? null;
/** 同一段里切换：点箭头选中相邻的一条（成为当前批注、光标过去），不展开。 */
function step(slot: MarginSlot, direction: -1 | 1): void {
    const target = slot.infos[slot.active + direction];
    if (target !== undefined) emit("select", target, false);
}

defineExpose({
    /** 立刻排一次（组件测试里 rAF 不跑，用它）。 */
    layout,
});
</script>

<template>
    <div class="markdown-comment-margin" data-markdown-comment-margin :style="{left: `${left}px`, width: `${MARGIN_WIDTH}px`}">
        <TransitionGroup name="markdown-comment-card" tag="div">
            <div
                v-for="slot in props.slots"
                :key="slot.key"
                :ref="setElement(slot.key)"
                class="markdown-comment-margin__item"
                :data-mode="slot.mode"
                :data-expanded="slot.expanded ? '' : undefined"
                :data-ready="ready.has(slot.key) ? '' : undefined"
                :style="{top: `${layouts.get(slot.key)?.top ?? 0}px`, height: layouts.has(slot.key) ? `${layouts.get(slot.key)?.idle}px` : undefined}"
            >
                <div
                    class="markdown-comment-margin__surface"
                    :class="{'nb-ui-popover-surface': slot.mode !== 'idle' || slot.expanded}"
                    :style="{height: layouts.has(slot.key) ? `${layouts.get(slot.key)?.height}px` : undefined, '--markdown-comment-lines': String(layouts.get(slot.key)?.lines ?? 3)}"
                >
                    <MarkdownCommentCard
                        variant="margin"
                        :current="slot.mode !== 'idle'"
                        :expanded="slot.expanded"
                        :pager="slot.infos.length > 1 ? {index: slot.active, count: slot.infos.length} : undefined"
                        :body="activeInfo(slot)?.body ?? ''"
                        :index="activeInfo(slot)?.index ?? props.total"
                        :total="activeInfo(slot) === null ? props.total + 1 : props.total"
                        :mode="slot.mode === 'write' ? 'write' : 'view'"
                        :readonly="props.readonly"
                        :labels="props.labels"
                        :session="props.session"
                        :draft="props.draft"
                        @edit="activeInfo(slot) !== null && emit('edit', activeInfo(slot) as CommentInfo)"
                        @remove="activeInfo(slot) !== null && emit('remove', activeInfo(slot) as CommentInfo)"
                        @previous="step(slot, -1)"
                        @next="step(slot, 1)"
                        @select="activeInfo(slot) !== null && emit('select', activeInfo(slot) as CommentInfo, true)"
                        @submit="(text) => emit('submit', text)"
                        @update:draft="(text) => emit('update:draft', text)"
                        @cancel="emit('cancel')"
                        @dismiss="emit('dismiss')"
                    />
                </div>
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
/* 与稿纸同在滚动容器里、绝对定位：随正文滚，页边的高度不撑开滚动容器以外的东西。自成层叠上下文：槽位的 `z-index` 只在页边里比。 */
.markdown-comment-margin {
    position: absolute;
    top: 0;
    isolation: isolate;
    pointer-events: none;
}

/*
 * 槽位：只是占位（顶边对着一段、高度是展开之前的高度），不画任何东西、不接收指针；可见的是里面的卡片面。位置落下之前（`data-ready` 之前）
 * 透明、不接收指针，也没有过渡；落下之后显示，入场一次，`top` 变了才滑动。
 */
.markdown-comment-margin__item {
    position: absolute;
    left: 0;
    right: 0;
    /* 不用 `visibility: hidden`：隐藏的元素拿不到焦点，待写的卡片一出来就要把焦点给输入框。 */
    opacity: 0;
    pointer-events: none;
}

.markdown-comment-margin__item[data-ready] {
    opacity: 1;
    animation: markdown-comment-card-in var(--motion-move) var(--ease-layout) backwards;
    transition: top var(--motion-move) var(--ease-layout);
}

/* 展开的在当前的上面，当前的在其余的上面：展开的卡片面会盖住后面的槽位。 */
.markdown-comment-margin__item[data-mode="current"] {
    z-index: 1;
}

.markdown-comment-margin__item[data-expanded] {
    z-index: 2;
}

/*
 * 卡片面：非当前的用实心的淡底（层级轴，不开模糊）；当前的、展开的与写着的是浮层（会盖住后面的槽位），面、描边、阴影与磨砂都来自浮层基座
 * `.nb-ui-popover-surface`（组件上按状态加这个类，不在这里再写一遍：ui-development-spec 第 3 节“浮层外框”），和浮层里的批注卡片是同一种材质。
 * 两种都带同宽的描边（透明或实色）与同一档圆角，切换时外框不变，没有左边框一类的侧边色条。
 * 高度是排出来的（`MarkdownCommentMargin.vue`），展开时比槽位高、向下长，高度变化有过渡。
 */
.markdown-comment-margin__surface {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    overflow: hidden;
}

/* 淡底只在没用浮层基座的时候写：这里的规则不在 `@layer` 里，写在基座之上会把基座整个压掉。 */
.markdown-comment-margin__surface:not(.nb-ui-popover-surface) {
    border: var(--border-w) solid transparent;
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--text-main) 5%, var(--bg-panel));
}

.markdown-comment-margin__item[data-ready] .markdown-comment-margin__surface {
    pointer-events: auto;
    transition: height var(--motion-move) var(--ease-layout),
        background-color var(--motion-fast) var(--ease-layout),
        border-color var(--motion-fast) var(--ease-layout),
        box-shadow var(--motion-fast) var(--ease-layout),
        backdrop-filter var(--motion-fast) var(--ease-layout);
}

/*
 * 收起时意见晚一个过渡的时长才限行：卡片面的高度正在往回收（上面 `height` 的过渡），文字等它收完才被截成几行加省略号；不然文字先一下跳成几行、
 * 框再慢慢缩，看上去没有收起的动画。限行的几个属性是离散的，用 `allow-discrete` 延后切换；展开是回到不限行的样式，那一边没有过渡，立刻切。
 * 只对已显示（`data-ready`）的槽位开：第一次显示时限行要一步到位，不然文字多亮着 `--motion-move` 才出省略号。
 * 因此“限没限行”不是卡片高度的依据：没展开的卡片的自然高度由意见全文的高度与行数算（`naturalOf`）。
 */
.markdown-comment-margin__item[data-ready] :deep(.markdown-comment-card__body--clamped) {
    transition: display 0s var(--motion-move) allow-discrete, overflow 0s var(--motion-move) allow-discrete, max-height 0s var(--motion-move) allow-discrete,
        -webkit-box-orient 0s var(--motion-move) allow-discrete, -webkit-line-clamp 0s var(--motion-move) allow-discrete, line-clamp 0s var(--motion-move) allow-discrete;
}

@keyframes markdown-comment-card-in {
    from {
        opacity: 0;
        transform: translateX(8px);
    }
}

/* 槽位移除时淡出；绝对定位，不挤别的槽位。 */
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
