<script setup lang="ts">
import {BLANK_API} from "@notnotype/nb-models/config";
import type {BlankTemplate, ProviderApi} from "@notnotype/nb-models/config";
import type {Template} from "@notnotype/nb-models/contract";
import {Badge, Button, Dialog, Input, RadioGroup, Select} from "@notnotype/nb-ui/components";
import {computed, nextTick, reactive, ref, watch} from "vue";

import {composing} from "../composing";
import {useModelsText} from "../text";
import ProviderIcon from "./ProviderIcon.vue";

/**
 * “添加服务商”对话框（docs/specs/models/settings-pages.md 输出 3）：按模板添加，模板分组、组内多列，每行有图标、名称、模型数。
 * 空白模板与有地区的模板进第二步（名称、地址、协议，或地区）；别的点一下就加。已添加过的模板不停用（同一个模板可以建多份），
 * 要登录、传输不支持的停用并写原因。
 */
export type AddInput = {template: string; region?: string; name?: string; baseUrl?: string; api?: ProviderApi};

const props = withDefaults(defineProps<{
    open: boolean;
    /** 模板表；null 是还在读。 */
    templates: readonly Template[] | null;
    /** 已经有实例的模板 id。 */
    added?: readonly string[];
    /** 添加失败或读模板失败的原因。 */
    error?: string;
    busy?: boolean;
}>(), {added: () => [], error: "", busy: false});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "add", input: AddInput): void;
}>();

const text = useModelsText();
const addedSet = computed(() => new Set(props.added));
const query = ref("");
/** 第二步的对象：空白模板或有地区的模板；null 是第一步。 */
const step = ref<Template | null>(null);
const form = reactive({name: "", baseUrl: "", api: "openai-completions" as ProviderApi, region: ""});
const touched = ref(false);
const root = ref<HTMLElement | null>(null);

watch(() => props.open, (open) => {
    if (!open) return;
    query.value = "";
    step.value = null;
    touched.value = false;
});

const GROUPS = ["international", "china", "gateway", "other", "custom"] as const;
const BLANK_KEY: Record<BlankTemplate, "openai" | "anthropic" | "gemini"> = {"blank-openai": "openai", "blank-anthropic": "anthropic", "blank-gemini": "gemini"};

/** 模板的显示名：空白模板按界面语言，别的用目录里的名字。 */
function nameOf(template: Template): string {
    return template.blank ? text(`add.blank.${BLANK_KEY[template.id as BlankTemplate]}.name`) : template.name;
}
const hintOf = (template: Template): string => (template.blank ? text(`add.blank.${BLANK_KEY[template.id as BlankTemplate]}.hint`) : "");
const regionName = (id: string): string => (id === "global" || id === "cn" ? text(`add.region.${id}`) : id);

/** 搜索按名称、id、地区名匹配。 */
function matches(template: Template, needle: string): boolean {
    if (needle === "") return true;
    const haystack = [nameOf(template), template.id, ...template.regions.map((region) => regionName(region.id))];
    return haystack.some((item) => item.toLowerCase().includes(needle));
}

const sections = computed(() => {
    const needle = query.value.trim().toLowerCase();
    const list = (props.templates ?? []).filter((template) => matches(template, needle));
    return GROUPS.map((group) => ({group, templates: list.filter((template) => template.group === group)})).filter((section) => section.templates.length > 0);
});
/** 键盘顺序里第一个能点的（搜索框里回车选它）。 */
const firstAddable = computed(() => sections.value.flatMap((section) => section.templates).find((template) => template.addable) ?? null);

const reasonText = (template: Template): string => {
    switch (template.reason) {
        case "login": return text("add.reason.login");
        case "transport": return text("add.reason.transport");
        case "unsupported-auth": return text("add.reason.unsupportedAuth");
        case "needs-address": return text("add.reason.needsAddress");
        case null: return "";
    }
};

const API_OPTIONS = [
    {value: "openai-completions", label: "OpenAI Chat Completions"},
    {value: "openai-responses", label: "OpenAI Responses"},
    {value: "anthropic-messages", label: "Anthropic Messages"},
    {value: "google-generative-ai", label: "Google Gemini"},
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

let opener: string | null = null;
function choose(template: Template): void {
    if (!template.addable || props.busy) return;
    if (!template.blank && template.regions.length === 0) {
        emit("add", {template: template.id});
        return;
    }
    opener = template.id;
    Object.assign(form, {name: "", baseUrl: "", api: template.blank ? BLANK_API[template.id as BlankTemplate] : "openai-completions", region: template.regions[0]?.id ?? ""});
    touched.value = false;
    step.value = template;
}

/** 回车选第一个命中的模板（搜索框里）。 */
function pickFirst(event: KeyboardEvent): void {
    if (composing(event)) return;
    event.preventDefault();
    if (firstAddable.value !== null) choose(firstAddable.value);
}

function createOnEnter(event: KeyboardEvent): void {
    if (!composing(event)) create();
}

function create(): void {
    const template = step.value;
    if (template === null) return;
    touched.value = true;
    if (template.blank) {
        if (form.name.trim() === "" || form.baseUrl.trim() === "" || urlProblem.value !== "") return;
        emit("add", {template: template.id, name: form.name.trim(), baseUrl: form.baseUrl.trim(), api: form.api});
        return;
    }
    emit("add", {template: template.id, ...(form.region === "" ? {} : {region: form.region})});
}

// 进第二步：焦点放进第一个输入；返回第一步：焦点回到被点的那个模板。
watch(step, async (value) => {
    await nextTick();
    if (value !== null) {
        root.value?.querySelector<HTMLElement>("input")?.focus();
        return;
    }
    if (opener !== null) document.body.querySelector<HTMLElement>(`[data-add-provider="${CSS.escape(opener)}"]`)?.focus();
});
</script>

<template>
    <Dialog
        :open="open"
        size="lg"
        :title="text('add.title')"
        :show-footer="step !== null"
        closable
        :confirm-label="text('add.create')"
        :cancel-label="text('add.back')"
        show-cancel
        :busy="busy"
        :status="step !== null ? error : ''"
        data-add-provider-dialog
        initial-focus="[data-add-provider-search] input, input[data-add-provider-search]"
        :close-on-request="false"
        @confirm="create"
        @request-close="(reason) => (reason === 'cancel' ? (step = null) : emit('update:open', false))"
    >
        <div v-if="step === null" class="add-provider">
            <Input v-model="query" size="sm" icon-class="i-lucide-search" :placeholder="text('add.search')" :aria-label="text('add.search')" data-add-provider-search @keydown.enter="pickFirst" />
            <p v-if="error !== ''" class="add-provider__error" role="alert">{{ error }}</p>
            <p v-if="templates === null" class="add-provider__muted">{{ text("add.loading") }}</p>
            <p v-else-if="sections.length === 0" class="add-provider__muted">{{ text("add.noMatch") }}</p>
            <div v-else class="add-provider__sections">
                <section v-for="section in sections" :key="section.group" class="add-provider__section" :data-add-group="section.group">
                    <h4 class="add-provider__group">{{ text(`add.group.${section.group}`) }}</h4>
                    <ul class="add-provider__list">
                        <li v-for="template in section.templates" :key="template.id">
                            <button
                                type="button"
                                class="add-provider__row nb-ui-focus-ring-inset"
                                :disabled="!template.addable || busy"
                                :data-add-provider="template.id"
                                @click="choose(template)"
                            >
                                <ProviderIcon :icon="null" :template="template.logo ?? template.id" :name="nameOf(template)" :size="20" />
                                <span class="add-provider__name">
                                    <span class="add-provider__title">{{ nameOf(template) }}</span>
                                    <span v-if="hintOf(template) !== ''" class="add-provider__muted">{{ hintOf(template) }}</span>
                                    <span v-else-if="!template.addable" class="add-provider__muted">{{ reasonText(template) }}</span>
                                    <span v-else-if="template.modelCount > 0" class="add-provider__muted">{{ text("add.models", {count: template.modelCount}) }}<template v-if="template.regions.length > 0"> · {{ template.regions.map((region) => regionName(region.id)).join(" / ") }}</template></span>
                                </span>
                                <Badge v-if="template.addable && template.access === 'keyless'" size="sm" variant="soft" tone="success">{{ text("add.keyless") }}</Badge>
                                <span v-if="addedSet.has(template.id)" class="add-provider__added"><Badge size="sm" variant="soft">{{ text("add.added") }}</Badge><span class="add-provider__muted">{{ text("add.another") }}</span></span>
                            </button>
                        </li>
                    </ul>
                </section>
            </div>
        </div>
        <div v-else ref="root" class="add-provider__form">
            <template v-if="step.blank">
                <label class="add-provider__field">
                    <span>{{ text("add.customName") }}</span>
                    <Input v-model="form.name" size="sm" :invalid="touched && form.name.trim() === ''" data-field="name" @keydown.enter="createOnEnter" />
                </label>
                <label class="add-provider__field">
                    <span>{{ text("add.customUrl") }}</span>
                    <Input v-model="form.baseUrl" size="sm" placeholder="https://example.com/v1" :invalid="(touched && form.baseUrl.trim() === '') || (touched && urlProblem !== '')" data-field="baseUrl" @keydown.enter="createOnEnter" />
                    <small v-if="touched && urlProblem !== ''" class="add-provider__error" role="alert">{{ urlProblem }}</small>
                </label>
                <div class="add-provider__field">
                    <span>{{ text("connection.api.label") }}</span>
                    <Select v-model="form.api" :options="API_OPTIONS" size="sm" :aria-label="text('connection.api.label')" />
                </div>
            </template>
            <fieldset v-else class="add-provider__field add-provider__regions">
                <legend>{{ text("add.region.label") }}</legend>
                <RadioGroup v-model="form.region" :options="step.regions.map((region) => ({value: region.id, label: regionName(region.id), description: region.baseUrl}))" size="sm" :aria-label="text('add.region.label')" data-region-group />
            </fieldset>
        </div>
    </Dialog>
</template>

<style scoped>
.add-provider {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.add-provider__sections {
    display: flex;
    max-height: 420px;
    flex-direction: column;
    gap: var(--space-4);
    overflow-y: auto;
}

.add-provider__group {
    margin: 0 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    color: var(--text-secondary);
}

/* 组内多列：对话框装得下两列就两列，窄屏一列。 */
.add-provider__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    gap: 0 var(--space-3);
    margin: 0;
    padding: 0;
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

.add-provider__name {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    font-size: var(--text-sm);
}

.add-provider__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.add-provider__added {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
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

.add-provider__regions {
    margin: 0;
    padding: 0;
    border: 0;
}

</style>
