<script setup lang="ts">
type CodeLine = {text: string; tone?: "added" | "removed" | "muted"};

const props = withDefaults(defineProps<{
    lines: CodeLine[];
    label?: string;
    startLine?: number | null;
    truncated?: boolean;
}>(), {
    label: "",
    startLine: null,
    truncated: false,
});

const {t} = useI18n();

const MARKS = {added: "+", removed: "-", muted: " "} as const;
</script>

<template>
    <div class="agent-code-block">
        <p v-if="props.label" class="agent-code-block__label" :title="props.label">{{ props.label }}</p>
        <div class="agent-code-block__scroll">
            <p v-if="props.lines.length === 0" class="agent-code-block__empty">{{ t("agentView.toolDetail.empty") }}</p>
            <div
                v-for="(line, index) in props.lines"
                v-else
                :key="index"
                class="agent-code-block__line"
                :data-tone="line.tone"
            >
                <span v-if="props.startLine !== null" class="agent-code-block__number">{{ props.startLine + index }}</span>
                <span v-if="line.tone === 'added' || line.tone === 'removed'" class="agent-code-block__mark" aria-hidden="true">{{ MARKS[line.tone] }}</span>
                <span class="agent-code-block__text">{{ line.text || " " }}</span>
            </div>
        </div>
        <p v-if="props.truncated" class="agent-code-block__note">{{ t("agentView.toolDetail.truncated") }}</p>
    </div>
</template>

<style scoped>
.agent-code-block {
    min-width: 0;
    overflow: hidden;
    border: var(--border-w, 1px) solid var(--divider);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-size: 11px;
}

.agent-code-block__label,
.agent-code-block__note,
.agent-code-block__empty {
    padding: 3px 8px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.agent-code-block__label {
    border-bottom: var(--border-w, 1px) solid var(--divider);
}

.agent-code-block__note {
    border-top: var(--border-w, 1px) solid var(--divider);
}

/* 长行不折行，在块内横向滚动，不撑宽消息流。 */
.agent-code-block__scroll {
    max-height: 280px;
    overflow: auto;
    padding: 4px 0;
    font-family: var(--font-mono);
    line-height: 1.6;
}

.agent-code-block__line {
    display: flex;
    width: max-content;
    min-width: 100%;
    padding: 0 8px;
    color: var(--text-secondary);
}

.agent-code-block__line[data-tone="added"] {
    background: color-mix(in srgb, var(--status-success) 12%, transparent);
    color: var(--text-main);
}

.agent-code-block__line[data-tone="removed"] {
    background: color-mix(in srgb, var(--status-danger) 12%, transparent);
    color: var(--text-main);
}

.agent-code-block__line[data-tone="muted"] {
    color: var(--text-muted);
}

.agent-code-block__number {
    flex-shrink: 0;
    min-width: 3ch;
    margin-right: 10px;
    color: var(--text-muted);
    text-align: right;
    user-select: none;
}

.agent-code-block__mark {
    flex-shrink: 0;
    width: 1ch;
    margin-right: 6px;
    user-select: none;
}

.agent-code-block__line[data-tone="added"] .agent-code-block__mark {
    color: var(--status-success);
}

.agent-code-block__line[data-tone="removed"] .agent-code-block__mark {
    color: var(--status-danger);
}

.agent-code-block__text {
    white-space: pre;
}
</style>
