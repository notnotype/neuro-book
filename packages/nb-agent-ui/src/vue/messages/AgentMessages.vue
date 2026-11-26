<script setup lang="ts">
/**
 * “消息”视图的外框（同名 .md）：聊天区加借给侧轨的视图段（`AgentMessagesSegment`）。视图段在哪由宿主给的 `placement` 定：
 * 送进侧轨（`rail`）、画在自己的右边缘（`edge`，浮动窗）、没有（`none`）。`rail` 与 `edge` 之间换的是同一个视图段实例，
 * 只换 `Teleport` 的去处，搜索词、当前页、焦点与滚动位置都在（搬完由视图段放回去）；聊天区一直是同一份 DOM。
 */
import {computed, ref} from "vue";

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

/** 侧轨的两个位置；不是元素（合同里写成 `object`）时不画。 */
const targets = computed(() => {
    const placement = props.placement;
    return placement.kind === "rail" && placement.main instanceof HTMLElement && placement.foot instanceof HTMLElement ? {main: placement.main, foot: placement.foot} : null;
});
const edgeStyle = computed(() => (props.placement.kind === "edge" ? {width: `${props.placement.width}px`} : undefined));

const segmentRef = ref<InstanceType<typeof AgentMessagesSegment> | null>(null);
defineExpose({focusSearch: (page: "bot" | "sessions") => segmentRef.value?.focusSearch(page)});
</script>

<template>
    <div class="acv-messages" :data-messages-placement="props.placement.kind">
        <div class="acv-messages__chat" data-messages-chat>
            <slot />
        </div>
        <!-- 送进侧轨时这一栏是空的、不占位；画在右边缘时是窗里的一栏。 -->
        <aside
            v-if="props.placement.kind === 'edge' || targets !== null"
            class="acv-messages__edge"
            :class="{'acv-messages__edge--away': targets !== null}"
            :style="edgeStyle"
            :data-float-rail="props.placement.kind === 'edge' ? '' : undefined"
        >
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
                :too-narrow="props.placement.kind === 'edge' && props.placement.tooNarrow === true"
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

/* 右边缘的一栏（浮动窗）：顶上让出宿主盖在右上角的按钮（`--acv-segment-inset-top`，缺省 0）。 */
.acv-messages__edge {
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
