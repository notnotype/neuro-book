<script setup lang="ts">
import type {ApiCheck, ApiDetection} from "@notnotype/nb-models/contract";
import {Button, CopyButton, Input} from "@notnotype/nb-ui/components";
import {computed, ref, useId} from "vue";

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

// 两个根：常驻的播报区与结果块；attrs 落在结果块上。
defineOptions({inheritAttrs: false});

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
const KNOWN_CODES = new Set(["http", "network", "timeout", "no-content", "endpoint-mismatch", "missing-key", "unknown-model", "transport-unsupported", "no-address", "cancelled", "proxy-unsupported", "proxy-invalid", "proxy-unreadable"]);

const detection = computed(() => (props.state.status === "done" ? props.state.detection : null));
/** 现在的配置是哪一行试过的：快照的连接版本等于那一行改用之后的。 */
const currentApi = computed(() => detection.value?.results.find((row) => row.connection === props.connection)?.api ?? null);
/**
 * 结果已过期：快照的连接版本既不是检测时的、也不是哪一行改用之后的。只看行不够：混合协议的模板跟随时每个模型各用各的协议，
 * 哪一行都不是现在的配置，结果仍然有效。
 */
const stale = computed(() => detection.value !== null && detection.value.connection !== props.connection && currentApi.value === null);
/**
 * 读屏播报：播报区常驻（随内容一起插入的区域常常不播），状态变了换一句。失败的原因块自己是 `role="alert"`，这里不重复。
 */
const announcement = computed(() => {
    const state = props.state;
    if (state.status === "running") return text("connection.detect.running");
    if (state.status === "failed") return state.code === "no-model" ? text("connection.detect.needModel") : "";
    if (state.status !== "done") return "";
    return stale.value ? text("connection.detect.stale") : text("connection.detect.done", {count: String(state.detection.results.filter((row) => row.ok).length)});
});

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

// ---- 没有模型时填一个 ----
const modelDraft = ref("");
/**
 * 回车要拦下默认动作：页面随后把焦点交给“检测协议”按钮（这时是“取消协议检测”），不拦时同一次按键的 keypress 落到按钮上，
 * 刚开始的检测就被取消了。
 */
function detectWith(): void {
    const model = modelDraft.value.trim();
    if (model !== "" && !props.disabled) emit("detect", model);
}
</script>

<template>
    <p class="sr-only" role="status" aria-atomic="true" data-api-detect-announce>{{ announcement }}</p>
    <div v-if="state.status !== 'idle'" v-bind="$attrs" class="api-detect" data-api-detect>
        <p v-if="state.status === 'running'" class="api-detect__note" data-api-detect-running>{{ text("connection.detect.running") }}</p>
        <template v-else-if="state.status === 'failed' && state.code === 'no-model'">
            <p class="api-detect__note">{{ text("connection.detect.needModel") }}</p>
            <div class="api-detect__model">
                <Input :id="`${id}-model`" v-model="modelDraft" size="sm" :aria-label="text('connection.detect.modelLabel')" :placeholder="text('connection.detect.modelLabel')" :disabled="disabled" data-api-detect-model @keydown.enter.prevent="detectWith" />
                <Button size="sm" variant="secondary" :disabled="disabled || modelDraft.trim() === ''" data-api-detect-run @click="detectWith">{{ text("connection.detect.run") }}</Button>
            </div>
        </template>
        <p v-else-if="state.status === 'failed'" class="api-detect__note api-detect__note--error" role="alert" data-api-detect-failed>{{ state.reason }}</p>
        <template v-else-if="detection !== null">
            <p class="api-detect__note" :class="{'api-detect__note--stale': stale}" :data-api-detect-stale="stale ? '' : undefined">
                {{ stale ? text("connection.detect.stale") : text("connection.detect.model", {model: detection.model}) }}
            </p>
            <ul class="api-detect__rows" :class="{'api-detect__rows--stale': stale}" :aria-label="text('connection.detect.title')">
                <li v-for="row in detection.results" :key="row.api" class="api-detect__row" :data-api-detect-row="row.api" :data-ok="row.ok ? '' : undefined">
                    <span :class="row.ok ? 'i-lucide-circle-check api-detect__icon--ok' : 'i-lucide-circle-x api-detect__icon--bad'" class="api-detect__icon" role="img" :aria-label="row.ok ? text('check.ok') : text('check.failed')" />
                    <span class="api-detect__name">{{ NAMES[row.api] }}</span>
                    <span class="api-detect__outcome" :class="{'api-detect__outcome--bad': !row.ok}" data-api-detect-outcome>{{ outcomeText(row) }}</span>
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
                        <CopyButton v-else-if="row.message !== ''" :text="row.message" icon-only :label="text('connection.detect.copyLabel', {name: NAMES[row.api]})" data-api-detect-copy />
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

/* 失败原因是这一行最要读到的：换行，不截断（英文与窄容器下放不下一行）。 */
.api-detect__outcome {
    grid-area: outcome;
    min-width: 0;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
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
