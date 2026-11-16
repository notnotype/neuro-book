<script setup lang="ts">
/**
 * 子代理入口与浮层（见同名 `.md`，conversation.md 输出 43）。行与个数在 `subagents-panel.ts`；后代的数据、`now`、停止与收口结果
 * 经宿主注入的 `subagentStoreKey` 取，动作名经 `toolActionKey`，与子代理卡片相同。
 */
import {computed, inject, watch} from "vue";
import {IconButton, Popover, Spinner} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {modelErrorText} from "@notnotype/nb-agent-ui";

import type {ProfileEntry} from "../../shared/contracts";
import {duration} from "../subagent-card";
import {subagentStoreKey, toolActionKey} from "../subagent-store";
import {panelRows, panelSummary} from "../subagents-panel";
import type {PanelRow, RowState, RunResults, SeenErrors} from "../subagents-panel";
import {useAgentPageText} from "../text";

defineOptions({name: "SubagentsEntry"});

const props = defineProps<{
    profiles: readonly ProfileEntry[];
    seen: SeenErrors;
    results: RunResults;
}>();

const emit = defineEmits<{
    (e: "select", sessionId: string): void;
}>();

const t = useAgentPageText();
const port = useText();
const store = inject(subagentStoreKey, null);
const actionOf = inject(toolActionKey, null);
/** 浮层开着没有；宿主可以 `v-model:open`（Lab 的场景开着摆）。 */
const open = defineModel<boolean>("open", {default: false});

const rows = computed(() => (store === null ? [] : panelRows(store.data.value.sessionId, store.data.value.tree)));
const summary = computed(() => panelSummary(rows.value, props.seen));
const summaryText = computed(() => [
    t("conversation.subagents.total", {count: summary.value.total}),
    ...(summary.value.running > 0 ? [t("conversation.subagents.running", {count: summary.value.running})] : []),
    ...(summary.value.waiting > 0 ? [t("conversation.subagents.waiting", {count: summary.value.waiting})] : []),
].join(" · "));

/** 开着时列出的出错都算看过，收口了的行去取结果；开着期间新出现的也一样。 */
watch([open, rows], ([isOpen, list]) => {
    if (!isOpen || store === null) return;
    props.seen.markRows(list);
    for (const row of list) {
        const ended = row.ended;
        if (ended !== null) props.results.load(row.id, ended.runId, () => store.runResult(row.id, ended.runId));
    }
}, {immediate: true});

const STATE_ICON: Readonly<Partial<Record<RowState, string>>> = {
    waiting: "i-lucide-shield-alert",
    question: "i-lucide-message-circle-question",
    done: "i-lucide-check",
    failed: "i-lucide-circle-x",
    aborted: "i-lucide-circle-stop",
    interrupted: "i-lucide-circle-pause",
    unknown: "i-lucide-circle-help",
};

function stateText(state: RowState): string {
    switch (state) {
        case "running": return t("conversation.subagent.running");
        case "waiting": return t("conversation.subagent.waiting");
        case "question": return t("conversation.subagents.question");
        case "done": return t("conversation.subagent.done");
        case "failed": return t("conversation.subagent.failedNoLine");
        case "aborted": return t("conversation.subagent.aborted");
        case "interrupted": return t("conversation.subagents.interrupted");
        case "unknown": return t("conversation.subagent.unknown");
    }
}

const nameOf = (row: PanelRow): string => props.profiles.find((profile) => profile.key === row.profile)?.name ?? t("conversation.subagents.unnamed");

/** 注册表里的动作名（“读取”）；查不到时写工具名。 */
const action = (tool: string): string => {
    const label = actionOf?.(tool) ?? null;
    return label === null ? tool : port.t(label);
};

/** 第二行：等你处理写等什么，运行中写次数、用时与当前一步，收口了的写结果（取到之前为空，只看右边的状态）。 */
function detail(row: PanelRow): string {
    switch (row.state) {
        case "waiting": {
            const waiting = row.waitingFor;
            if (waiting?.kind === "approval") return t("conversation.subagent.waitingApproval", {tool: action(waiting.tool)});
            if (waiting?.kind === "question") return t("conversation.subagent.waitingAnswer", {text: waiting.text});
            if (waiting?.kind === "mode-switch") return t("conversation.subagent.waitingMode");
            return "";
        }
        case "question": return row.question ?? "";
        case "running": {
            const parts: string[] = [];
            if (row.tools !== undefined) parts.push(t("conversation.subagent.tools", {count: row.tools}));
            if (row.startedAt !== undefined) parts.push(duration((store?.now.value ?? row.startedAt) - row.startedAt));
            if (row.step !== undefined) parts.push(row.step.target === undefined ? action(row.step.tool) : `${action(row.step.tool)} ${row.step.target}`);
            return parts.join(" · ");
        }
        case "done":
        case "failed": {
            const result = row.ended === null ? undefined : props.results.get(row.id, row.ended.runId);
            if (result === undefined) return "";
            if (row.state === "failed") return result.error === null ? "" : port.t(modelErrorText(result.error.kind));
            return result.text.split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
        }
        default: return "";
    }
}

function select(row: PanelRow): void {
    open.value = false;
    emit("select", row.id);
}

function stop(row: PanelRow): void {
    void store?.stopRun(row.id);
}
</script>

<template>
    <span v-if="rows.length > 0" class="sa-root">
        <Popover v-model:open="open" side="bottom" align="end" content-class="sa-panel">
            <template #trigger>
                <button
                    type="button"
                    class="sa-entry nb-ui-focus-ring"
                    :class="{'is-open': open}"
                    :aria-label="summary.dot ? t('conversation.subagents.entryAttention', {count: summary.total}) : t('conversation.subagents.entry', {count: summary.total})"
                    data-subagents-entry
                >
                    <span class="i-lucide-bot sa-entry__icon" aria-hidden="true" />
                    <span class="sa-entry__count">{{ summary.total }}</span>
                    <span v-if="summary.dot" class="sa-entry__dot" aria-hidden="true" data-subagents-dot />
                </button>
            </template>
            <div class="sa-panel__head">
                <span class="sa-panel__title">{{ t("conversation.subagents.title") }}</span>
                <span class="sa-panel__summary" data-subagents-summary>{{ summaryText }}</span>
            </div>
            <ul class="sa-list">
                <li v-for="row in rows" :key="row.id" class="sa-row" :class="`is-${row.state}`" :data-subagent-row="row.id">
                    <button type="button" class="sa-row__main nb-ui-focus-ring-inset" :style="{paddingLeft: `${8 + row.depth * 16}px`}" @click="select(row)">
                        <span :class="[row.icon, 'sa-row__icon']" aria-hidden="true" />
                        <span class="sa-row__text">
                            <span class="sa-row__title">
                                <span class="sa-row__name">{{ nameOf(row) }}</span>
                                <span v-if="row.task !== ''" class="sa-row__task">{{ row.task }}</span>
                            </span>
                            <span v-if="detail(row) !== ''" class="sa-row__detail" data-subagent-detail>{{ detail(row) }}</span>
                        </span>
                        <span class="sa-row__state" data-subagent-state>
                            <Spinner v-if="row.state === 'running'" size="sm" :label="stateText(row.state)" />
                            <span v-else :class="[STATE_ICON[row.state], 'sa-row__state-icon']" aria-hidden="true" />
                            {{ stateText(row.state) }}
                        </span>
                    </button>
                    <IconButton
                        v-if="row.state === 'running'"
                        class="sa-row__stop"
                        size="xs"
                        icon-class="i-lucide-square"
                        :title="t('conversation.subagents.stop', {name: nameOf(row)})"
                        :aria-label="t('conversation.subagents.stop', {name: nameOf(row)})"
                        data-subagent-stop
                        @click="stop(row)"
                    />
                </li>
            </ul>
            <p class="sa-panel__hint">{{ t("conversation.subagents.hint") }}</p>
        </Popover>
    </span>
</template>

<style scoped>
.sa-root {
    display: inline-flex;
}

.sa-entry {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.sa-entry:hover,
.sa-entry.is-open {
    background: var(--bg-hover);
    color: var(--text-main);
}

.sa-entry__icon {
    width: 14px;
    height: 14px;
}

.sa-entry__count {
    font-variant-numeric: tabular-nums;
}

.sa-entry__dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 7px;
    height: 7px;
    border: 1.5px solid var(--panel-surface);
    border-radius: 50%;
    background: var(--status-danger);
}

.sa-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

.sa-panel__head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 4px 6px;
}

.sa-panel__title {
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 600;
}

.sa-panel__summary,
.sa-panel__hint {
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.sa-panel__hint {
    margin: 6px 0 0;
    padding: 0 4px;
}

.sa-row {
    position: relative;
    display: flex;
    align-items: center;
}

.sa-row__main {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding-right: 8px;
    border-radius: var(--radius-control);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.sa-row__main:hover {
    background: var(--bg-hover);
}

.sa-row__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--accent-text);
}

.sa-row__text {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
}

.sa-row__title {
    display: flex;
    min-width: 0;
    gap: 6px;
    font-size: var(--text-xs);
}

.sa-row__name {
    flex-shrink: 0;
    color: var(--text-main);
    font-weight: var(--weight-medium);
}

.sa-row__task {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-row__detail {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-row.is-waiting .sa-row__detail,
.sa-row.is-waiting .sa-row__state {
    color: var(--status-warning);
}

.sa-row.is-failed .sa-row__detail,
.sa-row.is-failed .sa-row__state {
    color: var(--status-danger);
}

.sa-row__state {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.sa-row.is-done .sa-row__state-icon {
    color: var(--status-success);
}

.sa-row__state-icon {
    width: 12px;
    height: 12px;
}

/* 停止按钮压在状态上：只在悬停或键盘进到这一行时出现，平时不占位、不挡状态文字。 */
.sa-row__stop {
    position: absolute;
    right: 6px;
    opacity: 0;
    pointer-events: none;
}

.sa-row:hover .sa-row__stop,
.sa-row:focus-within .sa-row__stop {
    opacity: 1;
    pointer-events: auto;
}

/* 浮层的外框是 Popover 的元素，scoped 够不到：经 `contentClass` 挂上这个类。原子类在 Tailwind 的 utilities 层里，这里不分层，盖得过它的 p-3。 */
:global(.sa-panel) {
    width: 340px;
    padding: 10px 6px 8px;
}
</style>
