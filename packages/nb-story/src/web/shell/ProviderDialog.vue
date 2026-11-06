<script setup lang="ts">
// 添加或编辑一个自定义服务商（同名 .md）。校验用配置的 schema（ProviderSchema），不另写一份规则。
import {computed, ref, watch} from "vue";
import {Badge, Button, Checkbox, Dialog, Field, IconButton, Input, Select} from "@notnotype/nb-ui/components";
import {Compile} from "typebox/compile";

import {ENV_NAME_PATTERN, PROVIDER_ID_PATTERN, ProviderSchema, type CustomModelConfig, type ProviderApi, type ProviderConfig} from "../../contract/config-schema";
import {formatTokenCount} from "../qa/models";

type Discovered = {state: "found" | "empty" | "not_supported" | "auth" | "unreachable" | "failed"; status: number | null; message: string | null; models: {id: string}[]; keySet: boolean};
type Suggestion = {from: string; contextWindow: number | null; maxTokens: number | null; reasoning: boolean; images: boolean};

const props = defineProps<{
    open: boolean;
    provider: {id: string; config: ProviderConfig} | null;
    takenIds: readonly string[];
    keys: Readonly<Record<string, boolean>>;
    discover: (input: {api: "openai-completions" | "openai-responses"; baseUrl: string; apiKeyEnv: string}) => Promise<Discovered>;
    suggest: (modelId: string) => Suggestion | null;
}>();

const emit = defineEmits<{
    (e: "update:open", open: boolean): void;
    (e: "save", value: {id: string; config: ProviderConfig}): void;
}>();

defineOptions({inheritAttrs: false});

const checkProvider = Compile(ProviderSchema);
const ENV_NAME = new RegExp(ENV_NAME_PATTERN, "u");
const PROVIDER_ID = new RegExp(PROVIDER_ID_PATTERN, "u");

const APIS: {label: string; value: ProviderApi; description?: string}[] = [
    {label: "OpenAI Chat Completions", value: "openai-completions", description: "大多数兼容服务"},
    {label: "OpenAI Responses", value: "openai-responses", description: "GPT 系列要思考摘要时用"},
    {label: "Anthropic Messages", value: "anthropic-messages"},
    {label: "Google Gemini", value: "google-generative-ai"},
];
const TRISTATE = [{label: "自动", value: "auto"}, {label: "是", value: "yes"}, {label: "否", value: "no"}];

/** 表里的一行：数字按文字编辑（空是“自动”），推理与图片三选一；单价编辑时原样带着。 */
type Row = {key: number; id: string; contextWindow: string; maxTokens: string; reasoning: string; images: string; price?: CustomModelConfig["price"]; name?: string};

const name = ref("");
const api = ref<ProviderApi>("openai-completions");
const baseUrl = ref("");
const apiKeyEnv = ref("");
const rows = ref<Row[]>([]);
const error = ref("");
const discovering = ref(false);
const discovered = ref<Discovered | null>(null);
const pickedFound = ref<string[]>([]);
let nextKey = 0;

const tri = (value: boolean | undefined) => (value === undefined ? "auto" : value ? "yes" : "no");
function rowOf(model: CustomModelConfig): Row {
    return {
        key: (nextKey += 1),
        id: model.id,
        contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
        maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
        reasoning: tri(model.reasoning),
        images: tri(model.images),
        ...(model.price === undefined ? {} : {price: model.price}),
        ...(model.name === undefined ? {} : {name: model.name}),
    };
}

// 每次打开都按 provider 重新填：上一次没保存的改动属于上一次。
watch(() => props.open, open => {
    if (!open) return;
    const config = props.provider?.config;
    name.value = config?.name ?? props.provider?.id ?? "";
    api.value = config?.api ?? "openai-completions";
    baseUrl.value = config?.baseUrl ?? "";
    apiKeyEnv.value = config?.apiKeyEnv ?? "";
    rows.value = (config?.models ?? []).map(rowOf);
    error.value = "";
    discovered.value = null;
    pickedFound.value = [];
}, {immediate: true});

/** 新建时的 id：名称里的小写字母、数字连成一串，用连字符分开；没有可用的字（例如全是中文）时用 custom-N。 */
const newId = computed(() => {
    const slug = name.value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
    const taken = new Set(props.takenIds);
    if (slug !== "" && !taken.has(slug)) return slug;
    for (let index = 1; ; index += 1) {
        const id = `${slug === "" ? "custom" : slug}-${index}`;
        if (!taken.has(id)) return id;
    }
});
const id = computed(() => props.provider?.id ?? newId.value);

const keyState = computed(() => {
    const env = apiKeyEnv.value.trim();
    if (env === "" || !ENV_NAME.test(env)) return null;
    return env in props.keys ? (props.keys[env] ? "set" : "unset") : "unknown";
});

function addRow(modelId = ""): void {
    rows.value = [...rows.value, {key: (nextKey += 1), id: modelId, contextWindow: "", maxTokens: "", reasoning: "auto", images: "auto"}];
}

function removeRow(key: number): void {
    rows.value = rows.value.filter(row => row.key !== key);
}

function placeholder(row: Row, field: "contextWindow" | "maxTokens"): string {
    const value = props.suggest(row.id.trim())?.[field] ?? null;
    return value === null ? "自动" : `自动（目录 ${formatTokenCount(value)}）`;
}

function triPlaceholder(row: Row, field: "reasoning" | "images"): string {
    const suggestion = props.suggest(row.id.trim());
    return suggestion === null ? "自动" : `自动（目录：${suggestion[field] ? "是" : "否"}）`;
}

const canDiscover = computed(() => (api.value === "openai-completions" || api.value === "openai-responses") && baseUrl.value.trim() !== "" && ENV_NAME.test(apiKeyEnv.value.trim()));

async function readModels(): Promise<void> {
    if (!canDiscover.value || discovering.value) return;
    discovering.value = true;
    discovered.value = null;
    try {
        discovered.value = await props.discover({api: api.value as "openai-completions" | "openai-responses", baseUrl: baseUrl.value.trim(), apiKeyEnv: apiKeyEnv.value.trim()});
        pickedFound.value = [];
    } catch (cause) {
        discovered.value = {state: "failed", status: null, message: cause instanceof Error ? cause.message : String(cause), models: [], keySet: false};
    } finally {
        discovering.value = false;
    }
}

const discoveryText = computed(() => {
    const result = discovered.value;
    if (result === null) return api.value === "openai-completions" || api.value === "openai-responses" ? "可以从服务读模型列表；读不到的手动添加。" : "这种接口读不了模型列表，手动添加。";
    switch (result.state) {
        case "found": return `从服务读到 ${result.models.length} 个模型。`;
        case "empty": return "服务回了空的模型列表，手动添加。";
        case "not_supported": return "这个服务没有 /models（404），手动添加。";
        case "auth": return `密钥不对（${result.status}）${result.keySet ? "" : "，而且这个环境变量服务启动时没有值"}。`;
        case "unreachable": return `连不上：${result.message ?? ""}`;
        case "failed": return `读不了：${result.message ?? (result.status === null ? "" : `服务回了 ${result.status}`)}`;
    }
});
const foundNew = computed(() => (discovered.value?.models ?? []).map(model => model.id).filter(modelId => !rows.value.some(row => row.id.trim() === modelId)));

function addFound(): void {
    for (const modelId of pickedFound.value) addRow(modelId);
    pickedFound.value = [];
}

function toggleFound(modelId: string): void {
    pickedFound.value = pickedFound.value.includes(modelId) ? pickedFound.value.filter(item => item !== modelId) : [...pickedFound.value, modelId];
}

function parseCount(text: string): number | undefined | null {
    const trimmed = text.trim();
    if (trimmed === "") return undefined;
    return /^\d+$/u.test(trimmed) && Number(trimmed) > 0 ? Number(trimmed) : null;
}

function save(): void {
    error.value = "";
    if (!PROVIDER_ID.test(id.value) || (props.provider === null && props.takenIds.includes(id.value))) {
        error.value = `id ${id.value} 不能用：只能有小写字母、数字与连字符，也不能与已有的服务商重名`;
        return;
    }
    if (!ENV_NAME.test(apiKeyEnv.value.trim())) {
        // 不回显原文：多半是把密钥本身贴进来了。
        error.value = "密钥环境变量名只能是字母、数字、下划线，也不能像密钥（例如 MY_API_KEY）；这里要填变量名，不是密钥本身";
        return;
    }
    const models: CustomModelConfig[] = [];
    for (const row of rows.value) {
        const modelId = row.id.trim();
        if (modelId === "") continue;
        if (models.some(model => model.id === modelId)) {
            error.value = `模型 ${modelId} 写了两次`;
            return;
        }
        const contextWindow = parseCount(row.contextWindow);
        const maxTokens = parseCount(row.maxTokens);
        if (contextWindow === null || maxTokens === null) {
            error.value = `模型 ${modelId} 的上下文与单次输出上限要写正整数，或者留空`;
            return;
        }
        models.push({
            id: modelId,
            ...(row.name === undefined ? {} : {name: row.name}),
            ...(contextWindow === undefined ? {} : {contextWindow}),
            ...(maxTokens === undefined ? {} : {maxTokens}),
            ...(row.reasoning === "auto" ? {} : {reasoning: row.reasoning === "yes"}),
            ...(row.images === "auto" ? {} : {images: row.images === "yes"}),
            ...(row.price === undefined ? {} : {price: row.price}),
        });
    }
    const config: ProviderConfig = {...(name.value.trim() === "" || name.value.trim() === id.value ? {} : {name: name.value.trim()}), api: api.value, baseUrl: baseUrl.value.trim(), apiKeyEnv: apiKeyEnv.value.trim(), models};
    if (!checkProvider.Check(config)) {
        const first = [...checkProvider.Errors(config)][0];
        error.value = `服务商的写法不对：${first === undefined ? "" : `${first.instancePath || "/"} ${first.message}`}`;
        return;
    }
    emit("save", {id: id.value, config});
    emit("update:open", false);
}
</script>

<template>
    <Dialog :open="props.open" :title="props.provider === null ? '添加自定义服务商' : `编辑服务商 ${props.provider.id}`" size="lg" closable @update:open="emit('update:open', $event)">
        <div class="pd" data-provider-dialog>
            <div class="pd-grid">
                <Field label="名称" :description="props.provider === null ? `id：${id}（由名称生成，建好后不能改）` : `id：${id}`">
                    <Input v-model="name" placeholder="例如 jiji、公司网关" data-provider-name />
                </Field>
                <Field label="接口">
                    <Select v-model="api" :options="APIS" data-provider-api />
                </Field>
                <Field label="服务地址" class="pd-wide">
                    <Input v-model="baseUrl" placeholder="https://api.example.com/v1" data-provider-base-url />
                </Field>
                <Field label="密钥环境变量" description="密钥不写进配置：在启动服务的终端里设好这个变量">
                    <div class="pd-key">
                        <Input v-model="apiKeyEnv" placeholder="MY_API_KEY" data-provider-key-env />
                        <Badge v-if="keyState === 'set'" size="sm" variant="soft" tone="success" dot>已设置</Badge>
                        <Badge v-else-if="keyState === 'unset'" size="sm" variant="soft" tone="warning" dot>没有值</Badge>
                        <Badge v-else-if="keyState === 'unknown'" size="sm" variant="outline">保存后才知道</Badge>
                    </div>
                </Field>
            </div>

            <div class="pd-models-head">
                <span class="pd-title">模型</span>
                <span class="pd-note" data-provider-discovery>{{ discoveryText }}</span>
                <Button size="sm" variant="secondary" icon-class="i-lucide-refresh-cw" :disabled="!canDiscover || discovering" data-provider-discover @click="readModels">{{ discovering ? "读取中…" : "从服务读取" }}</Button>
                <Button size="sm" variant="ghost" icon-class="i-lucide-plus" data-provider-add-model @click="addRow()">手动添加</Button>
            </div>
            <!-- 窄屏时模型表在自己的框里横向滚动，每列留最小宽度，不把输入框压没。 -->
            <div v-if="rows.length > 0" class="pd-table-wrap">
            <table class="pd-table">
                <thead>
                    <tr><th>模型名</th><th>上下文</th><th>单次输出</th><th>推理</th><th>图片</th><th /></tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows" :key="row.key" data-provider-model-row>
                        <td><Input v-model="row.id" size="sm" placeholder="模型名" data-provider-model-id /></td>
                        <td><Input v-model="row.contextWindow" size="sm" inputmode="numeric" :placeholder="placeholder(row, 'contextWindow')" /></td>
                        <td><Input v-model="row.maxTokens" size="sm" inputmode="numeric" :placeholder="placeholder(row, 'maxTokens')" /></td>
                        <td :title="triPlaceholder(row, 'reasoning')"><Select v-model="row.reasoning" size="sm" :options="TRISTATE" /></td>
                        <td :title="triPlaceholder(row, 'images')"><Select v-model="row.images" size="sm" :options="TRISTATE" /></td>
                        <td><IconButton size="sm" icon-class="i-lucide-x" aria-label="去掉这个模型" @click="removeRow(row.key)" /></td>
                    </tr>
                </tbody>
            </table>
            </div>
            <div v-if="foundNew.length > 0" class="pd-found" data-provider-found>
                <span class="pd-note">读到的模型，勾选后加进表：</span>
                <div class="pd-found-list">
                    <Checkbox v-for="modelId in foundNew" :key="modelId" :model-value="pickedFound.includes(modelId)" :label="modelId" @update:model-value="toggleFound(modelId)" />
                </div>
                <Button size="sm" variant="secondary" :disabled="pickedFound.length === 0" data-provider-add-found @click="addFound">加入（{{ pickedFound.length }}）</Button>
            </div>
        </div>
        <template #footer>
            <div class="pd-foot">
                <span class="pd-error" role="alert" data-provider-error>{{ error }}</span>
                <Button variant="secondary" @click="emit('update:open', false)">取消</Button>
                <Button data-provider-save @click="save">保存</Button>
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
.pd { display: flex; flex-direction: column; gap: 12px; }
.pd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 14px; }
.pd-wide { grid-column: 1 / -1; }
.pd-key { display: flex; align-items: center; gap: 8px; }
.pd-key > :first-child { flex: 1; min-width: 0; }
.pd-models-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pd-title { font-weight: var(--weight-strong); font-size: var(--text-sm); }
.pd-note { flex: 1; min-width: 12em; color: var(--text-muted); font-size: var(--text-xs); }
.pd-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.pd-table th { padding: 4px 6px; border-bottom: 1px solid var(--divider); color: var(--text-muted); font-size: var(--text-xs); font-weight: normal; text-align: left; }
.pd-table td { padding: 4px 6px; border-bottom: 1px solid var(--divider); vertical-align: middle; }
.pd-table-wrap { overflow-x: auto; }
.pd-table td { min-width: 6.5em; }
.pd-table td:first-child { min-width: 10em; }
.pd-table td:last-child { min-width: 0; }
.pd-found { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--divider); border-radius: var(--radius-control); }
.pd-found-list { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.pd-foot { display: flex; align-items: center; gap: 8px; width: 100%; }
.pd-error { flex: 1; min-width: 0; color: var(--status-danger); font-size: var(--text-xs); }
</style>
