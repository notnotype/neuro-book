<script setup lang="ts">
import {Button, Collapsible, InfoTip, Input, Select} from "@notnotype/nb-ui/components";
import {computed, ref, useId, watch} from "vue";

import type {SnapshotProvider} from "../../shared/contracts";
import type {CheckState} from "../models-store";
import {checkKey} from "../models-store";
import {useModelsText} from "../text";
import HeadersEditor from "./HeadersEditor.vue";
import ModelRow from "./ModelRow.vue";

/**
 * 一家服务商的详情（docs/specs/models/settings-pages.md 输出 4 到 8）：上面是连接（密钥、地址、接口格式、默认收起的高级），下面是按
 * 系列分组的模型列表。受控：改了什么就发对应的事件，写入由页面做；输入框在失焦或回车时才发（改了就写，没有保存按钮）。
 */
type ProviderPatch = {name?: string; baseUrl?: string | null; api?: "openai-completions" | "openai-responses" | "anthropic-messages"; auth?: "default" | "bearer" | "none"; headers?: Record<string, string>};

const props = withDefaults(defineProps<{
    provider: SnapshotProvider;
    checks?: ReadonlyMap<string, CheckState>;
    /** 模型 id → 绑着它的角色名。 */
    roleUsage?: ReadonlyMap<string, readonly string[]>;
    disabled?: boolean;
}>(), {checks: () => new Map(), roleUsage: () => new Map(), disabled: false});

const emit = defineEmits<{
    (e: "set-key", value: string): void;
    (e: "clear-key"): void;
    (e: "update", patch: ProviderPatch): void;
    (e: "toggle-model", id: string, enabled: boolean): void;
    (e: "check", id: string): void;
    (e: "check-all"): void;
    (e: "cancel-checks"): void;
    (e: "edit-model", id: string): void;
    (e: "add-model"): void;
    (e: "manage"): void;
}>();

const text = useModelsText();
const id = useId();

// ---- 密钥 ----
/** `env:` 引用不是密钥，照原样显示；存在库里的密钥不回到浏览器，框里是空的。 */
const keyCurrent = computed(() => (props.provider.key.kind === "env" ? `env:${props.provider.key.name}` : ""));
const keyDraft = ref(keyCurrent.value);
watch(keyCurrent, (value) => {
    keyDraft.value = value;
});
const keyless = computed(() => props.provider.auth === "none");
const keyPlaceholder = computed(() => {
    switch (props.provider.key.kind) {
        case "stored": return text("connection.key.stored");
        case "keyless": return text("connection.key.keyless");
        default: return text("connection.key.empty");
    }
});
const keyProblem = computed(() => (props.provider.key.kind === "env" && !props.provider.key.found ? text("connection.key.envMissing", {name: props.provider.key.name}) : ""));
const keyNote = computed(() => (props.provider.key.kind === "env" && props.provider.key.found ? text("connection.key.envFound", {name: props.provider.key.name}) : ""));

function commitKey(): void {
    const value = keyDraft.value.trim();
    if (value === "" || value === keyCurrent.value) return;
    emit("set-key", value);
    // 原文密钥写完就不留在浏览器里（输出“边界”一节）。
    if (!value.startsWith("env:")) keyDraft.value = "";
}

// ---- 地址与接口 ----
const ENDPOINT: Record<string, string> = {"openai-completions": "/chat/completions", "openai-responses": "/responses", "anthropic-messages": "/v1/messages"};
const effectiveUrl = computed(() => props.provider.baseUrl ?? props.provider.catalogBaseUrl ?? "");
const urlDraft = ref(effectiveUrl.value);
watch(effectiveUrl, (value) => {
    urlDraft.value = value;
});
const overridden = computed(() => props.provider.kind === "catalog" && props.provider.baseUrl !== null && props.provider.baseUrl !== props.provider.catalogBaseUrl);
const requestUrl = computed(() => `${effectiveUrl.value.replace(/\/$/u, "")}${ENDPOINT[props.provider.api ?? ""] ?? ""}`);

function commitUrl(): void {
    const value = urlDraft.value.trim();
    if (value === "" || value === effectiveUrl.value) {
        urlDraft.value = effectiveUrl.value;
        return;
    }
    emit("update", {baseUrl: props.provider.kind === "catalog" && value === props.provider.catalogBaseUrl ? null : value});
}

const API_OPTIONS = [
    {value: "openai-completions", label: "OpenAI Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses"},
    {value: "anthropic-messages", label: "Anthropic Messages"},
];
const authOptions = computed(() => [
    {value: "default", label: text("connection.auth.default")},
    {value: "bearer", label: text("connection.auth.bearer")},
    {value: "none", label: text("connection.auth.none")},
]);

// ---- 模型 ----
const groups = computed(() => {
    const byGroup = new Map<string, SnapshotProvider["models"][number][]>();
    for (const model of props.provider.models) byGroup.set(model.group, [...(byGroup.get(model.group) ?? []), model]);
    return [...byGroup].map(([group, models]) => ({group, models}));
});
const enabledCount = computed(() => props.provider.models.filter((model) => model.enabled).length);
const folded = ref(new Set<string>());
function fold(group: string): void {
    const next = new Set(folded.value);
    if (!next.delete(group)) next.add(group);
    folded.value = next;
}
const checking = computed(() => props.provider.models.some((model) => props.checks.get(checkKey(props.provider.id, model.id))?.status === "running"));
</script>

<template>
    <div class="provider-detail" :data-provider-detail="provider.id">
        <section class="provider-detail__group">
            <h3 class="provider-detail__title">{{ text("connection.title") }}</h3>
            <div class="provider-detail__form">
                <div v-if="!keyless" class="provider-detail__field">
                    <div class="provider-detail__field-head">
                        <span class="provider-detail__label"><label :for="`${id}-key`">{{ text("connection.key.label") }}</label><InfoTip :text="text('connection.key.hint')" /></span>
                        <button v-if="provider.key.kind === 'stored' || provider.key.kind === 'env'" type="button" class="provider-detail__link provider-detail__link--danger" :disabled="disabled" data-key-clear @click="emit('clear-key')">{{ text("connection.key.clear") }}</button>
                    </div>
                    <Input
                        :id="`${id}-key`"
                        v-model="keyDraft"
                        :type="keyDraft.startsWith('env:') ? 'text' : 'password'"
                        size="sm"
                        :placeholder="keyPlaceholder"
                        :invalid="keyProblem !== ''"
                        :disabled="disabled"
                        autocomplete="off"
                        data-key-input
                        @focusout="commitKey"
                        @keydown.enter="commitKey"
                    />
                    <p v-if="keyProblem !== ''" class="provider-detail__hint provider-detail__hint--error" data-key-problem>{{ keyProblem }}</p>
                    <p v-else-if="keyNote !== ''" class="provider-detail__hint">{{ keyNote }}</p>
                </div>
                <div class="provider-detail__field">
                    <div class="provider-detail__field-head">
                        <span class="provider-detail__label"><label :for="`${id}-url`">{{ text("connection.url.label") }}</label><InfoTip :text="text('connection.url.hint', {url: requestUrl})" /></span>
                        <button v-if="overridden" type="button" class="provider-detail__link" :disabled="disabled" data-url-restore @click="emit('update', {baseUrl: null})">{{ text("connection.url.restore") }}</button>
                    </div>
                    <Input :id="`${id}-url`" v-model="urlDraft" size="sm" :disabled="disabled" data-url-input @focusout="commitUrl" @keydown.enter="commitUrl" />
                    <p v-if="overridden" class="provider-detail__hint">{{ text("connection.url.overridden", {url: provider.catalogBaseUrl ?? ""}) }}</p>
                </div>
                <div v-if="provider.kind === 'custom'" class="provider-detail__field">
                    <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.api.label") }}</span></div>
                    <Select :model-value="provider.api ?? 'openai-completions'" :options="API_OPTIONS" size="sm" :disabled="disabled" :aria-label="text('connection.api.label')" @update:model-value="(value: string) => emit('update', {api: value as ProviderPatch['api']})" />
                </div>
                <Collapsible>
                    <template #trigger>
                        <button type="button" class="provider-detail__advanced" data-provider-advanced>
                            <span class="i-lucide-chevron-right provider-detail__advanced-icon" aria-hidden="true" />
                            {{ text("connection.advanced") }}<span class="provider-detail__muted">{{ text("connection.advancedHint") }}</span>
                        </button>
                    </template>
                    <div class="provider-detail__advanced-body">
                        <div class="provider-detail__field">
                            <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.auth.label") }}<InfoTip :text="text('connection.auth.hint')" /></span></div>
                            <Select :model-value="provider.auth" :options="authOptions" size="sm" :disabled="disabled" :aria-label="text('connection.auth.label')" @update:model-value="(value: string) => emit('update', {auth: value as ProviderPatch['auth']})" />
                        </div>
                        <div class="provider-detail__field">
                            <div class="provider-detail__field-head"><span class="provider-detail__label">{{ text("connection.headers.label") }}<InfoTip :text="text('connection.headers.hint')" /></span></div>
                            <HeadersEditor :headers="provider.headers" :disabled="disabled" @commit="(headers) => emit('update', {headers})" />
                        </div>
                    </div>
                </Collapsible>
            </div>
        </section>

        <section class="provider-detail__group">
            <div class="provider-detail__title provider-detail__title--actions">
                <h3>{{ text("models.title") }}</h3>
                <span class="provider-detail__muted">{{ text("models.enabled", {count: enabledCount}) }}</span>
                <span class="provider-detail__spacer" />
                <Button size="sm" variant="ghost" icon-class="i-lucide-list-checks" :disabled="disabled" data-models-manage @click="emit('manage')">{{ text("models.manage") }}</Button>
                <Button v-if="provider.kind === 'custom'" size="sm" variant="ghost" icon-class="i-lucide-plus" :disabled="disabled" data-models-add @click="emit('add-model')">{{ text("models.add") }}</Button>
                <Button v-if="checking" size="sm" variant="ghost" icon-class="i-lucide-square" data-models-cancel @click="emit('cancel-checks')">{{ text("models.cancelChecks") }}</Button>
                <Button v-else size="sm" variant="ghost" icon-class="i-lucide-activity" :disabled="disabled || enabledCount === 0" data-models-check-all @click="emit('check-all')">{{ text("models.checkAll") }}</Button>
            </div>
            <p v-if="provider.models.length === 0" class="provider-detail__empty">{{ text("models.empty") }}</p>
            <section v-for="group in groups" :key="group.group" class="provider-detail__series">
                <button type="button" class="provider-detail__series-title" :aria-expanded="!folded.has(group.group)" @click="fold(group.group)">
                    <span :class="folded.has(group.group) ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" aria-hidden="true" />
                    {{ group.group }}<span class="provider-detail__series-count">{{ group.models.length }}</span>
                </button>
                <ul v-if="!folded.has(group.group)" class="provider-detail__models">
                    <ModelRow
                        v-for="model in group.models"
                        :key="model.id"
                        :model="model"
                        :check="checks.get(checkKey(provider.id, model.id))"
                        :roles="roleUsage.get(model.id) ?? []"
                        :disabled="disabled"
                        @toggle="(enabled) => emit('toggle-model', model.id, enabled)"
                        @check="emit('check', model.id)"
                        @edit="emit('edit-model', model.id)"
                    />
                </ul>
            </section>
        </section>
    </div>
</template>

<style scoped>
.provider-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
}

.provider-detail__title {
    margin: 0 0 var(--space-2);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

/* 按钮放不下时（窄窗口、英文）换到下一行，不撑出页面。 */
.provider-detail__title--actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
}

.provider-detail__title--actions h3 {
    margin: 0;
    font: inherit;
    white-space: nowrap;
}

.provider-detail__title--actions > .provider-detail__muted {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.provider-detail__title--actions > :deep(button) {
    flex-shrink: 0;
}

.provider-detail__spacer {
    flex: 1;
}

/* 标签在上的表单（同旧应用的连接一节），宽度封顶，地址这类长值也放得下。 */
.provider-detail__form {
    display: flex;
    max-width: 560px;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-2);
}

.provider-detail__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.provider-detail__field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
}

.provider-detail__label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.provider-detail__link {
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    color: var(--accent-text);
    cursor: pointer;
}

.provider-detail__link:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}

.provider-detail__link--danger {
    color: var(--status-danger);
}

.provider-detail__hint {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.provider-detail__hint--error {
    color: var(--status-danger);
}

.provider-detail__advanced {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text-secondary);
    cursor: pointer;
}

.provider-detail__advanced[data-state="open"] .provider-detail__advanced-icon {
    transform: rotate(90deg);
}

.provider-detail__advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-3) 0 0 var(--space-5);
}

.provider-detail__muted {
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.provider-detail__empty {
    margin: var(--space-4) 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.provider-detail__series {
    margin-top: var(--space-2);
}

.provider-detail__series-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    border: 0;
    background: none;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
    cursor: pointer;
}

.provider-detail__series-count {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.provider-detail__models {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
