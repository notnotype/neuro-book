<script setup lang="ts">
/**
 * “消息”视图的外框（同名 .md）：聊天区加借给侧轨的视图段（`AgentMessagesSegment`）。视图段在哪由宿主给的 `placement` 定：
 * 送进侧轨（`rail`）、画在自己的右边缘（`edge`，浮动窗）、没有（`none`）。`rail` 与 `edge` 之间换的是同一个视图段实例，
 * 只换 `Teleport` 的去处，搜索词、当前页、焦点与滚动位置都在（搬完由视图段放回去）；聊天区一直是同一份 DOM。
 */
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

import type {AgentLocale, MessagesContactSection, MessagesRecentSession} from "../../types";
import type {MessagesSegmentPlacement} from "./placement";
import AgentMessagesSegment from "./AgentMessagesSegment.vue";

const props = withDefaults(defineProps<{
    placement: MessagesSegmentPlacement;
    expanded: boolean;
    sections: readonly MessagesContactSection[];
    selected: {readonly kind: "contact"; readonly key: string} | {readonly kind: "session"; readonly id: string} | null;
    recentSessions: readonly MessagesRecentSession[];
    tab: "bot" | "sessions";
    weak?: boolean;
    now: number;
    locale?: AgentLocale;
}>(), {weak: false, locale: undefined});

const emit = defineEmits<{
    "update:tab": [tab: "bot" | "sessions"];
    "open-contact": [key: string];
    "open-session": [id: string];
    "new-session": [];
    "show-list": [tab: "bot" | "sessions"];
    "retry-contacts": [sectionKey: string];
    "escape-search": [];
    "toggle-expanded": [];
}>();

defineSlots<{default(): unknown; sessions(): unknown}>();

const botQuery = defineModel<string>("botQuery", {default: ""});

/**
 * 侧轨的两个位置；不是元素（合同里写成 `object`）时不画。同一对元素不换引用：`placement` 随轨宽、“窗口太窄”换新对象（拖轨宽时每帧一次），
 * 视图段按 `targets` 的变化放回焦点与滚动，元素没换时不该触发。
 */
const targets = computed((previous?: {readonly main: HTMLElement; readonly foot: HTMLElement} | null) => {
    const placement = props.placement;
    if (placement.kind !== "rail" || !(placement.main instanceof HTMLElement) || !(placement.foot instanceof HTMLElement)) return null;
    return previous != null && previous.main === placement.main && previous.foot === placement.foot ? previous : {main: placement.main, foot: placement.foot};
});
const edgeWidth = computed(() => (props.placement.kind === "edge" ? props.placement.width : null));

/*
 * 画在右边缘时，展开与收起由工作台把窗加宽或减宽同样的量，窗的宽度走一段布局过渡，视图段的宽这一次渲染就到位
 * （docs/specs/ui/workbench-layout.md 输出 51 的“过渡”）。照常排的话聊天区 = 窗宽 − 视图段宽，过渡里先被挤窄（或撑宽）再回来，文字跟着重排两次。
 * 所以展开状态与宽度一起变的那一刻，按改之前的宽固定住聊天区，视图段那一栏改成占剩下的、裁掉多出的，里面的内容按新宽排在最终位置：
 * 窗的边扫过去把它露出来或盖住，聊天区与视图段都不动。窗宽到了“聊天区 + 新宽”就放开；窗一直没到（被夹取、过渡中途改了尺寸）时，
 * 宽度连续 HOLD_STILL_FRAMES 帧不变也放开：换宽之后窗要等一两帧才开始动，这个数要比它大得多。
 * 只改宽度的（拖轨宽手柄、键盘、双击回缺省）不过渡，窗与视图段同一次到位，不固定；固定着的时候来了这种改动就放开，免得按旧的终点等下去。
 * 要固定的宽不在换宽的那一刻量：网格的窗在同一次更新里先改，减少动态效果时它这一刻已经到了终点，量到的是“新窗宽 − 旧视图段宽”。
 * 所以平时由 `ResizeObserver` 记下聊天区的宽（它在渲染之后回调，换宽那次更新里读到的还是之前的），固定着的时候不记。
 */
const HOLD_STILL_FRAMES = 30;
const rootRef = ref<HTMLElement | null>(null);
const chatRef = ref<HTMLElement | null>(null);
const heldChat = ref<number | null>(null);
let holdFrame = 0;
let restingChat: number | null = null;
let chatObserver: ResizeObserver | null = null;

onMounted(() => {
    const chat = chatRef.value;
    if (chat === null || typeof ResizeObserver === "undefined") return;
    chatObserver = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined && heldChat.value === null) restingChat = entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width;
    });
    chatObserver.observe(chat);
});

function release(): void {
    if (holdFrame !== 0) cancelAnimationFrame(holdFrame);
    holdFrame = 0;
    heldChat.value = null;
}

function holdUntil(root: HTMLElement, target: number): void {
    if (holdFrame !== 0) cancelAnimationFrame(holdFrame);
    let last = -1;
    let still = 0;
    const tick = (): void => {
        const width = root.getBoundingClientRect().width;
        if (Math.abs(width - target) < 0.5 || still >= HOLD_STILL_FRAMES) {
            holdFrame = 0;
            heldChat.value = null;
            return;
        }
        still = width === last ? still + 1 : 0;
        last = width;
        holdFrame = requestAnimationFrame(tick);
    };
    holdFrame = requestAnimationFrame(tick);
}

// 连着展开收起两次时沿用第一次固定的宽。
watch(() => [edgeWidth.value, props.expanded] as const, ([width, expanded], [previousWidth, previousExpanded]) => {
    if (width === previousWidth) return;
    const root = rootRef.value;
    const chat = chatRef.value;
    if (width === null || previousWidth === null || expanded === previousExpanded || root === null || chat === null) {
        release();
        return;
    }
    const held = heldChat.value ?? restingChat ?? chat.getBoundingClientRect().width;
    heldChat.value = held;
    holdUntil(root, held + width);
}, {flush: "pre"});

onBeforeUnmount(() => {
    release();
    chatObserver?.disconnect();
});

const chatStyle = computed(() => (heldChat.value === null ? undefined : {flex: "0 0 auto", width: `${heldChat.value}px`}));
const edgeStyle = computed(() => {
    if (edgeWidth.value === null) return undefined;
    return heldChat.value === null ? {width: `${edgeWidth.value}px`} : {flex: "1 1 0", minWidth: "0", overflow: "hidden"};
});
const edgeBodyStyle = computed(() => (edgeWidth.value === null ? undefined : {width: `${edgeWidth.value}px`}));

const segmentRef = ref<InstanceType<typeof AgentMessagesSegment> | null>(null);
defineExpose({focusSearch: (page: "bot" | "sessions") => segmentRef.value?.focusSearch(page)});
</script>

<template>
    <div ref="rootRef" class="acv-messages" :data-messages-placement="props.placement.kind">
        <div ref="chatRef" class="acv-messages__chat" :style="chatStyle" data-messages-chat>
            <slot />
        </div>
        <!--
            送进侧轨时这一栏是空的、不占位；画在右边缘时是窗里的一栏。none 时藏起来、不卸载：从浮动窗归位时中间有一刻没有地方（窗拆了、右轨的元素下一次渲染才挂上），
            卸掉的话视图段记着的焦点与滚动跟着丢（views.md 输出 21）。
        -->
        <aside
            v-show="props.placement.kind === 'edge' || targets !== null"
            class="acv-messages__edge"
            :class="{'acv-messages__edge--away': targets !== null}"
            :style="edgeStyle"
            :data-float-rail="props.placement.kind === 'edge' ? '' : undefined"
        >
            <div class="acv-messages__edge-body" :style="edgeBodyStyle">
                <AgentMessagesSegment
                    ref="segmentRef"
                    v-model:bot-query="botQuery"
                    :targets="targets"
                    :expanded="props.expanded"
                    :sections="props.sections"
                    :selected="props.selected"
                    :recent-sessions="props.recentSessions"
                    :tab="props.tab"
                    :weak="props.weak"
                    :too-narrow="props.placement.kind !== 'none' && props.placement.tooNarrow === true"
                    :width="props.placement.kind === 'none' ? null : props.placement.width"
                    :now="props.now"
                    :locale="props.locale"
                    @update:tab="emit('update:tab', $event)"
                    @open-contact="emit('open-contact', $event)"
                    @open-session="emit('open-session', $event)"
                    @new-session="emit('new-session')"
                    @show-list="emit('show-list', $event)"
                    @retry-contacts="emit('retry-contacts', $event)"
                    @escape-search="emit('escape-search')"
                    @toggle-expanded="emit('toggle-expanded')"
                >
                    <template #sessions><slot name="sessions" /></template>
                </AgentMessagesSegment>
            </div>
        </aside>
    </div>
</template>

<style scoped>
.acv-messages {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
}

.acv-messages__chat {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    min-height: 0;
}

/* 右边缘的一栏（浮动窗）。宽度写在里面那层：换宽的过渡里外层只是一扇裁切窗，见脚本里固定聊天区那段。 */
.acv-messages__edge {
    display: flex;
    flex: 0 0 auto;
    height: 100%;
    min-height: 0;
}

/* 顶上让出宿主盖在右上角的按钮（`--acv-segment-inset-top`，缺省 0）。 */
.acv-messages__edge-body {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding-top: var(--acv-segment-inset-top, 0px);
    border-inline-start: var(--border-w) solid var(--border-color);
}

.acv-messages__edge--away {
    display: none;
}
</style>
