<script setup lang="ts">
import {Badge, Button, Dialog, Input, Select} from "@notnotype/nb-ui/components";
import {computed, nextTick, reactive, ref, watch} from "vue";

import type {CatalogProvider} from "../../shared/contracts";
import {useModelsText} from "../text";

/**
 * “添加服务商”对话框（docs/specs/models/settings-pages.md 输出 3）：可搜索的 OMP 目录列表，最后一项是自定义 OpenAI 兼容服务商；
 * 选自定义时换成名称、地址与接口格式的小表单。已添加的停用，只能登录的停用并写明第一版不支持。
 */
type Api = "openai-completions" | "openai-responses" | "anthropic-messages";

const props = withDefaults(defineProps<{
    open: boolean;
    /** 目录；null 是还在读。 */
    catalog: readonly CatalogProvider[] | null;
    /** 添加失败或读目录失败的原因。 */
    error?: string;
    busy?: boolean;
}>(), {error: "", busy: false});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "add-catalog", id: string): void;
    (e: "add-custom", source: {name: string; baseUrl: string; api: Api}): void;
}>();

const text = useModelsText();
const query = ref("");
const custom = ref(false);
const form = reactive({name: "", baseUrl: "", api: "openai-completions" as Api});
const touched = ref(false);

watch(() => props.open, (open) => {
    if (!open) return;
    query.value = "";
    custom.value = false;
    touched.value = false;
    Object.assign(form, {name: "", baseUrl: "", api: "openai-completions"});
});

const matches = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return (props.catalog ?? []).filter((item) => needle === "" || item.name.toLowerCase().includes(needle) || item.id.includes(needle));
});

const selectable = (item: CatalogProvider): boolean => !item.added && (item.access === "key" || item.access === "keyless");

const API_OPTIONS = [
    {value: "openai-completions", label: "OpenAI Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses"},
    {value: "anthropic-messages", label: "Anthropic Messages"},
];

/** 地址要以 http:// 或 https:// 开头、能解析；写进去用不了的地址在这里拦住。 */
const urlProblem = computed(() => {
    const value = form.baseUrl.trim();
    if (value === "") return "";
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? "" : text("connection.url.invalid");
    } catch {
        return text("connection.url.invalid");
    }
});

function create(): void {
    touched.value = true;
    if (form.name.trim() === "" || form.baseUrl.trim() === "" || urlProblem.value !== "") return;
    emit("add-custom", {name: form.name.trim(), baseUrl: form.baseUrl.trim(), api: form.api});
}

const formRoot = ref<HTMLElement | null>(null);
// 进到自定义表单：被点的那一行随列表卸掉，焦点放进名称框。
watch(custom, async (value) => {
    if (!value) return;
    await nextTick();
    formRoot.value?.querySelector<HTMLInputElement>("input")?.focus();
});
</script>

<template>
    <Dialog
        :open="open"
        size="md"
        :title="text('add.title')"
        :show-footer="custom"
        closable
        :confirm-label="text('add.create')"
        :cancel-label="text('add.back')"
        show-cancel
        :busy="busy"
        :status="custom ? error : ''"
        data-add-provider-dialog
        :close-on-request="false"
        @confirm="create"
        @request-close="(reason) => (reason === 'cancel' ? (custom = false) : emit('update:open', false))"
    >
        <div v-if="!custom" class="add-provider">
            <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="text('add.search')" :aria-label="text('add.search')" data-add-provider-search />
            <p v-if="error !== ''" class="add-provider__error" role="alert">{{ error }}</p>
            <p class="add-provider__group">{{ text("add.catalog") }}</p>
            <p v-if="catalog === null" class="add-provider__muted">{{ text("manage.loading") }}</p>
            <p v-else-if="matches.length === 0" class="add-provider__muted">{{ text("add.noMatch") }}</p>
            <ul v-else class="add-provider__list">
                <li v-for="item in matches" :key="item.id">
                    <button type="button" class="add-provider__row nb-ui-focus-ring-inset" :disabled="!selectable(item) || busy" :data-add-provider="item.id" @click="emit('add-catalog', item.id)">
                        <span class="i-lucide-cloud add-provider__icon" aria-hidden="true" />
                        <span class="add-provider__name">{{ item.name }}</span>
                        <Badge v-if="item.added" size="sm" variant="soft">{{ text("add.added") }}</Badge>
                        <Badge v-else-if="item.access === 'keyless'" size="sm" variant="soft" tone="success">{{ text("add.keyless") }}</Badge>
                        <span v-else-if="item.access === 'login'" class="add-provider__muted">{{ text("add.login") }}</span>
                        <span v-else-if="item.access === 'unsupported'" class="add-provider__muted">{{ text("add.unsupported") }}</span>
                    </button>
                </li>
            </ul>
            <p class="add-provider__group">{{ text("add.other") }}</p>
            <button type="button" class="add-provider__row nb-ui-focus-ring-inset" :disabled="busy" data-add-provider="custom" @click="custom = true">
                <span class="i-lucide-server add-provider__icon" aria-hidden="true" />
                <span class="add-provider__name">{{ text("add.custom") }}<span class="add-provider__muted">{{ text("add.customHint") }}</span></span>
            </button>
        </div>
        <div v-else ref="formRoot" class="add-provider__form">
            <label class="add-provider__field">
                <span>{{ text("add.customName") }}</span>
                <Input v-model="form.name" size="sm" :invalid="touched && form.name.trim() === ''" data-field="name" @keydown.enter="create" />
            </label>
            <label class="add-provider__field">
                <span>{{ text("add.customUrl") }}</span>
                <Input v-model="form.baseUrl" size="sm" placeholder="https://example.com/v1" :invalid="(touched && form.baseUrl.trim() === '') || (touched && urlProblem !== '')" data-field="baseUrl" @keydown.enter="create" />
                <small v-if="touched && urlProblem !== ''" class="add-provider__error" role="alert">{{ urlProblem }}</small>
            </label>
            <div class="add-provider__field">
                <span>{{ text("connection.api.label") }}</span>
                <Select v-model="form.api" :options="API_OPTIONS" size="sm" :aria-label="text('connection.api.label')" />
            </div>
        </div>
    </Dialog>
</template>

<style scoped>
.add-provider {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.add-provider__group {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
}

.add-provider__list {
    display: flex;
    max-height: 320px;
    flex-direction: column;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
}

.add-provider__row {
    display: flex;
    width: 100%;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.add-provider__row:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.add-provider__row:disabled {
    cursor: not-allowed;
    opacity: 0.6;
}

.add-provider__icon {
    flex-shrink: 0;
    color: var(--text-muted);
}

.add-provider__name {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    font-size: var(--text-sm);
}

.add-provider__muted {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.add-provider__error {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.add-provider__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.add-provider__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
</style>
