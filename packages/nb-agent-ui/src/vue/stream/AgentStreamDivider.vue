<script setup lang="ts">
/**
 * 轮与轮之间的一条线（同名 .md）：按天或未读。放在哪由对话视图算（`stream-dividers.ts`）。
 */
import {computed} from "vue";

import {dayDividerLabel} from "../../format";
import {useAgentText} from "../text";

defineOptions({name: "AgentStreamDivider"});

const props = defineProps<{
    kind: "day" | "unread";
    at?: number;
    today: number;
}>();

const {t, locale} = useAgentText();

const label = computed(() => {
    if (props.kind === "unread") return t("stream.unread");
    const day = dayDividerLabel(props.at ?? 0, props.today, locale.value);
    if (day.kind === "date") return day.text;
    return t(day.kind === "today" ? "stream.today" : "stream.yesterday");
});
</script>

<template>
    <p
        class="acv-stream-divider"
        :class="{'acv-stream-divider--unread': props.kind === 'unread'}"
        role="separator"
        :aria-label="label"
        :data-day-divider="props.kind === 'day' ? '' : undefined"
        :data-unread-divider="props.kind === 'unread' ? '' : undefined"
    >
        <span aria-hidden="true">{{ label }}</span>
    </p>
</template>

<style scoped>
/* 画法同压缩分隔线（AgentTurnBlock 的 .acv-divider）；它在上一轮 24px 的底边距之下，自己只留下边距。 */
.acv-stream-divider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-stream-divider::before,
.acv-stream-divider::after {
    content: "";
    flex: 1;
    border-top: var(--border-w, 1px) solid var(--divider);
}

.acv-stream-divider--unread {
    color: var(--accent-text);
}

.acv-stream-divider--unread::before,
.acv-stream-divider--unread::after {
    border-color: var(--accent-main);
}
</style>
