<script setup lang="ts">
import type {ApiCheck, ApiDetection} from "@notnotype/nb-models/contract";
import {Button, IconButton, Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, ref, useId, watch} from "vue";

import {useModelsText} from "../text";

/**
 * 协议检测的结果块（docs/specs/models/settings-pages.md 输出 21）：四种协议各一行。受控：发起、取消与采纳都由页面做，这里只按
 * `state` 画，结果是否还对得上现在的配置按连接版本判断。
 */
export type ApiDetectState =
    | {readonly status: "idle"}
    | {readonly status: "running"}
    | {readonly status: "done"; readonly detection: ApiDetection}
    | {readonly status: "failed"; readonly code: string; readonly reason: string};

const props = withDefaults(defineProps<{
    state: ApiDetectState;
    /** 快照里这家现在的连接版本（`SnapshotProvider.connection`）。 */
    connection: string;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (e: "adopt", api: ApiCheck["api"], connection: string): void;
    (e: "detect", model: string): void;
}>();

const text = useModelsText();
const id = useId();

const NAMES: Record<ApiCheck["api"], string> = {
    "openai-completions": "OpenAI Chat Completions",
    "openai-responses": "OpenAI Responses",
    "anthropic-messages": "Anthropic Messages",
    "google-generative-ai": "Google Gemini",
};
const KNOWN_CODES = new Set(["http", "network", "timeout", "no-content", "endpoint-mismatch", "missing-key", "unknown-model", "transport-unsupported", "no-address", "cancelled"]);

const detection = computed(() => (props.state.status === "done" ? props.state.detection : null));
/** 现在的配置是哪一行试过的：快照的连接版本等于那一行改用之后的。都不等时结果已过期。 */
const currentApi = computed(() => detection.value?.results.find((row) => row.connection === props.connection)?.api ?? null);
const stale = computed(() => detection.value !== null && currentApi.value === null);

function outcomeText(row: ApiCheck): string {
    if (row.ok) return text("connection.detect.ms", {ms: String(row.ms ?? 0)});
    const code = row.code ?? "other";
    if (code === "http") return text("connection.detect.codes.http", {status: String(row.status ?? "")});
    return KNOWN_CODES.has(code) ? text(`connection.detect.codes.${code}` as "connection.detect.codes.network") : text("connection.detect.codes.other", {code});
}
/** 淡色一行：请求的路径（没发出时是地址）与原文的开头。 */
function lineOf(row: ApiCheck): string {
    const where = row.url ?? row.baseUrl;
    const message = row.message.replace(/\s+/gu, " ").trim();
    return message === "" ? where : `${where} · ${message}`;
}

// ---- 复制原文 ----
const copied = ref<string | null>(null);
watch(() => props.state, () => {
    copied.value = null;
});
async function copy(row: ApiCheck): Promise<void> {
    try {
        await navigator.clipboard.writeText(row.message);
        copied.value = row.api;
    } catch (error) {
        // 浏览器不给写剪贴板（没有焦点、权限被拒）：按钮不变成“已复制”，原文仍在悬停提示与淡色一行里，可以手动选中复制。
        console.warn("copying the provider response failed", error);
    }
}

// ---- 没有模型时填一个 ----
const modelDraft = ref("");
function detectWith(): void {
    const model = modelDraft.value.trim();
    if (model !== "" && !props.disabled) emit("detect", model);
}
</script>

<template>
    <div v-if="state.status !== 'idle'" class="api-detect" data-api-detect>
        <p v-if="state.status === 'running'" class="api-detect__note" aria-live="polite" data-api-detect-running>{{ text("connection.detect.running") }}</p>
        <template v-else-if="state.status === 'failed' && state.code === 'no-model'">
            <p class="api-detect__note">{{ text("connection.detect.needModel") }}</p>
            <div class="api-detect__model">
                <Input :id="`${id}-model`" v-model="modelDraft" size="sm" :aria-label="text('connection.detect.modelLabel')" :placeholder="text('connection.detect.modelLabel')" :disabled="disabled" data-api-detect-model @keydown.enter="detectWith" />
                <Button size="sm" variant="secondary" :disabled="disabled || modelDraft.trim() === ''" data-api-detect-run @click="detectWith">{{ text("connection.detect.run") }}</Button>
            </div>
        </template>
        <p v-else-if="state.status === 'failed'" class="api-detect__note api-detect__note--error" role="alert" data-api-detect-failed>{{ state.reason }}</p>
        <template v-else-if="detection !== null">
            <p class="api-detect__note" :class="{'api-detect__note--stale': stale}" aria-live="polite" :data-api-detect-stale="stale ? '' : undefined">
                {{ stale ? text("connection.detect.stale") : text("connection.detect.model", {model: detection.model}) }}
            </p>
            <ul class="api-detect__rows" :class="{'api-detect__rows--stale': stale}" :aria-label="text('connection.detect.title')">
                <li v-for="row in detection.results" :key="row.api" class="api-detect__row" :data-api-detect-row="row.api" :data-ok="row.ok ? '' : undefined">
                    <span :class="row.ok ? 'i-lucide-circle-check api-detect__icon--ok' : 'i-lucide-circle-x api-detect__icon--bad'" class="api-detect__icon" role="img" :aria-label="row.ok ? text('check.ok') : text('check.failed')" />
                    <span class="api-detect__name">{{ NAMES[row.api] }}</span>
                    <span class="api-detect__outcome" :class="{'api-detect__outcome--bad': !row.ok}">{{ outcomeText(row) }}</span>
                    <span class="api-detect__action">
                        <span v-if="row.api === currentApi" class="api-detect__using" data-api-detect-using>{{ text("connection.detect.using") }}</span>
                        <button
                            v-else-if="row.ok"
                            type="button"
                            class="api-detect__adopt nb-ui-focus-ring"
                            :disabled="disabled || stale"
                            :aria-label="text('connection.detect.adoptLabel', {name: NAMES[row.api]})"
                            data-api-detect-adopt
                            @click="emit('adopt', row.api, row.connection)"
                        >{{ text("connection.detect.adopt") }}</button>
                        <Tooltip v-else-if="row.message !== ''" :text="copied === row.api ? text('connection.detect.copied') : text('connection.detect.copy')">
                            <IconButton size="xs" :icon-class="copied === row.api ? 'i-lucide-check' : 'i-lucide-copy'" :aria-label="copied === row.api ? text('connection.detect.copied') : text('connection.detect.copyLabel', {name: NAMES[row.api]})" data-api-detect-copy @click="copy(row)" />
                        </Tooltip>
                    </span>
                    <span class="api-detect__line" :title="row.message === '' ? undefined : row.message">{{ lineOf(row) }}</span>
                </li>
            </ul>
        </template>
    </div>
</template>

<style scoped>
.api-detect {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    container-type: inline-size;
}

.api-detect__note {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.api-detect__note--error,
.api-detect__note--stale {
    color: var(--status-danger);
}

.api-detect__model {
    display: flex;
    gap: 8px;
}

.api-detect__rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    border: 1px solid color-mix(in srgb, var(--text-main) 10%, transparent);
    border-radius: 8px;
}

.api-detect__rows--stale {
    opacity: 0.5;
}

.api-detect__row {
    display: grid;
    grid-template-columns: 16px minmax(0, 11rem) minmax(0, 1fr) auto;
    grid-template-areas:
        "icon name outcome action"
        ". line line line";
    align-items: center;
    column-gap: 8px;
    padding: 4px 10px;
    font-size: var(--text-xs);
}

.api-detect__icon {
    grid-area: icon;
    width: 14px;
    height: 14px;
}

.api-detect__icon--ok {
    color: var(--status-success);
}

.api-detect__icon--bad,
.api-detect__outcome--bad {
    color: var(--status-danger);
}

.api-detect__name {
    grid-area: name;
    overflow: hidden;
    color: var(--text-main);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.api-detect__outcome {
    grid-area: outcome;
    overflow: hidden;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.api-detect__action {
    grid-area: action;
    display: flex;
    justify-content: flex-end;
    min-width: 4rem;
}

.api-detect__using {
    color: var(--text-muted);
}

.api-detect__adopt {
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    color: var(--accent-text);
    cursor: pointer;
}

.api-detect__adopt:disabled {
    color: var(--text-muted);
    cursor: default;
}

.api-detect__line {
    grid-area: line;
    overflow: hidden;
    /* 原文要能复制（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 窄：协议名与结果上下排，动作仍在行尾。 */
@container (max-width: 480px) {
    .api-detect__row {
        grid-template-columns: 16px minmax(0, 1fr) auto;
        grid-template-areas:
            "icon name action"
            ". outcome action"
            ". line line";
    }
}
</style>
