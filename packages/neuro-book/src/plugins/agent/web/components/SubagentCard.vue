<script setup lang="ts">
/**
 * 子代理卡片（见同名 `.md`）。数据不进 ctx：后代的进度与每秒走的 `now` 从宿主注入（`subagent-store.ts`），推导在 `subagent-card.ts`。
 */
import {computed, inject, ref} from "vue";
import {Badge, IconButton, Spinner} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentViewAction, ToolCallView} from "@notnotype/nb-agent-ui";

import {cardModel, type CardState} from "../subagent-card";
import {subagentStoreKey} from "../subagent-store";
import {useAgentPageText} from "../text";

const props = defineProps<{call: ToolCallView; ctx: AgentConversationContext; services?: unknown; locale?: string}>();
const emit = defineEmits<{action: [action: AgentViewAction]}>();

const t = useAgentPageText();
const store = inject(subagentStoreKey, null);
const open = ref(false);

const model = computed(() => cardModel(props.call, store?.data.value.tree ?? new Map(), props.ctx.messages, props.ctx.run.status === "idle"));

const STATE_ICON: Readonly<Partial<Record<CardState, string>>> = {
    "dispatch-failed": "i-lucide-circle-x",
    waiting: "i-lucide-shield-alert",
    question: "i-lucide-message-circle-question",
    done: "i-lucide-check",
    failed: "i-lucide-circle-x",
    aborted: "i-lucide-circle-stop",
    interrupted: "i-lucide-circle-pause",
    unknown: "i-lucide-circle-help",
};
const spinning = computed(() => model.value.state === "running" || model.value.state === "preparing");

const duration = (ms: number): string => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
};
const meta = computed(() => {
    const parts: string[] = [];
    if (model.value.tools !== undefined) parts.push(t("conversation.subagent.tools", {count: model.value.tools}));
    if (model.value.startedAt !== undefined && spinning.value) parts.push(duration((store?.now.value ?? props.ctx.now) - model.value.startedAt));
    return parts.join(" · ");
});

const line = computed(() => {
    const {state, line: text, code} = model.value;
    switch (state) {
        case "preparing": return t("conversation.subagent.preparing");
        case "dispatch-failed": return t("conversation.subagent.dispatchFailed", {code: code ?? ""});
        case "running": return text === "" ? t("conversation.subagent.starting") : text;
        case "waiting": return t("conversation.subagent.waiting");
        case "question": return t("conversation.subagent.question", {text});
        case "done": return text === "" ? t("conversation.subagent.done") : text;
        case "failed": return text === "" ? t("conversation.subagent.failedNoLine") : t("conversation.subagent.failed", {line: text});
        case "aborted": return t("conversation.subagent.aborted");
        case "interrupted": return t("conversation.subagent.interrupted");
        case "unknown": return t("conversation.subagent.unknown");
    }
});

function openChild(): void {
    if (model.value.childId !== null) emit("action", {type: "session.select", sessionId: model.value.childId});
}
</script>

<template>
    <div class="sa-card" :data-state="model.state" data-subagent-card>
        <div class="sa-card__head">
            <span :class="[model.icon, 'sa-card__icon']" aria-hidden="true" />
            <span class="sa-card__name" :title="model.name">{{ model.name }}</span>
            <Badge v-if="model.background" size="sm" variant="soft">{{ t("conversation.subagent.background") }}</Badge>
            <span class="sa-card__meta" data-subagent-meta>{{ meta }}</span>
            <Spinner v-if="spinning" size="sm" class="sa-card__state" />
            <span v-else :class="[STATE_ICON[model.state], 'sa-card__state sa-card__state-icon']" aria-hidden="true" />
            <IconButton size="xs" icon-class="i-lucide-square-arrow-out-up-right" :disabled="model.childId === null" :title="t('conversation.subagent.open')" :aria-label="t('conversation.subagent.open')" data-subagent-open @click="openChild" />
        </div>
        <button type="button" class="sa-card__row nb-ui-focus-ring-inset" :disabled="model.result === undefined" :aria-expanded="model.result === undefined ? undefined : open" :title="model.result === undefined ? undefined : t(open ? 'conversation.subagent.hideResult' : 'conversation.subagent.showResult')" data-subagent-line @click="open = !open">
            <span class="sa-card__line">{{ line }}</span>
            <span v-if="model.result !== undefined" :class="[open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right', 'sa-card__chevron']" aria-hidden="true" />
        </button>
        <div v-if="open && model.result !== undefined" class="sa-card__result" data-subagent-result>{{ model.result }}</div>
    </div>
</template>

<style scoped>
.sa-card {
    min-width: 0;
    border: var(--border-w) solid var(--border-color);
    border-radius: var(--radius-control);
}

.sa-card[data-state="failed"],
.sa-card[data-state="dispatch-failed"] {
    border-color: var(--status-danger-border);
}

/* 卡头与进度行都是固定高度：文字多少、状态怎么变，卡片都不跳。 */
.sa-card__head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 4px 0 8px;
    border-bottom: var(--border-w) solid var(--border-color);
    font-size: var(--text-xs);
}

.sa-card__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.sa-card__name {
    min-width: 2em;
    overflow: hidden;
    color: var(--text-main);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-card__meta {
    flex-shrink: 0;
    margin-left: auto;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
}

.sa-card__state {
    flex-shrink: 0;
}

.sa-card__state-icon {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.sa-card[data-state="done"] .sa-card__state-icon {
    color: var(--status-success);
}

.sa-card[data-state="failed"] .sa-card__state-icon,
.sa-card[data-state="dispatch-failed"] .sa-card__state-icon,
.sa-card[data-state="failed"] .sa-card__line,
.sa-card[data-state="dispatch-failed"] .sa-card__line {
    color: var(--status-danger);
}

.sa-card[data-state="waiting"] .sa-card__state-icon,
.sa-card[data-state="waiting"] .sa-card__line {
    color: var(--status-warning);
}

.sa-card__row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: 0 0 var(--radius-control) var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    text-align: left;
}

.sa-card__row:not(:disabled) {
    cursor: pointer;
}

.sa-card__row:not(:disabled):hover {
    background: var(--bg-hover);
}

.sa-card__line {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-card__chevron {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.sa-card__result {
    max-height: 9.6em;
    overflow-y: auto;
    padding: 6px 10px;
    border-top: var(--border-w) solid var(--border-color);
    color: var(--text-main);
    font-size: var(--text-xs);
    line-height: 1.6;
    white-space: pre-wrap;
}
</style>
