<script setup lang="ts">
import {Collapsible, Dialog, Input, NumberInput, Select, Switch} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, watch} from "vue";

import type {CompactionSetting} from "../../shared/compaction";
import type {SnapshotModel} from "../../shared/contracts";
import type {ModelConfig} from "../../shared/settings";
import {useModelsText} from "../text";
import HeadersEditor from "./HeadersEditor.vue";

/**
 * 编辑模型的对话框（docs/specs/models/settings-pages.md 输出 9）；`model` 为 null 时是“手动添加”（只有自定义服务商有）。
 * 表单是这里的草稿，“保存”时校验，合格才交出模型配置，关闭不写。目录模型的能力、上限与单价来自目录，只读。
 */
const props = withDefaults(defineProps<{
    open: boolean;
    providerKind: "catalog" | "custom";
    /** 编辑的模型；null 是手动添加。 */
    model: SnapshotModel | null;
    /** 这家已有的模型 id，手动添加时查重。 */
    takenIds?: readonly string[];
    /** 保存进行中（父组件在写）。 */
    busy?: boolean;
    /** 保存失败的原因，显示在页脚。 */
    error?: string;
}>(), {takenIds: () => [], busy: false, error: ""});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    /** 合格的模型配置；父组件写入成功后关掉对话框。 */
    (e: "save", model: ModelConfig): void;
}>();

const text = useModelsText();
const fromCatalog = computed(() => props.providerKind === "catalog");
const adding = computed(() => props.model === null);

const blank = (value: number | null | undefined): string => (value === null || value === undefined ? "" : String(value));
const form = reactive({id: "", name: "", group: "", contextWindow: "", maxOutput: "", vision: false, reasoning: false, compactMode: "follow" as "follow" | CompactionSetting["mode"], compactValue: "", price: ["", "", "", ""] as string[]});
const headers = ref<Record<string, string>>({});
/** 请求头里有没填完的行：保存要拦住，不悄悄丢掉它们。 */
const headersPending = ref(false);
const touched = ref(false);

// 只在打开时从当前的模型填一次（关掉再开丢掉没保存的改动）；开着时别处改了这个模型不打断正在填的表单（输出 16）。
watch(() => props.open, (open) => {
    if (!open) return;
    const model = props.model;
    touched.value = false;
    Object.assign(form, {
        id: model?.id ?? "",
        name: model === null || model.name === model.id ? "" : model.name,
        group: model?.group ?? "",
        contextWindow: blank(model?.contextWindow),
        maxOutput: blank(model?.maxOutput),
        vision: model?.vision ?? false,
        reasoning: model?.reasoning ?? false,
        compactMode: model?.compaction?.mode ?? "follow",
        compactValue: blank(model?.compaction?.value),
        price: model?.price === null || model?.price === undefined ? ["", "", "", ""] : model.price.map(String),
    });
    headers.value = {...model?.headers};
    headersPending.value = false;
}, {immediate: true});

/** 三种模式的数值不是同一种量（窗口大小、百分比、token 数）：换模式时清掉，不让上一种模式的数字当成下一种的值通过校验。 */
function setCompactMode(mode: string): void {
    form.compactMode = mode as typeof form.compactMode;
    form.compactValue = "";
}

const positive = (value: string): boolean => /^[1-9]\d*$/u.test(value.trim());
const PRICE = /^\d+(\.\d+)?$/u;

const problems = computed(() => {
    const found: Partial<Record<"id" | "contextWindow" | "maxOutput" | "compactValue" | "price" | "headers", string>> = {};
    if (adding.value) {
        if (form.id.trim() === "") found.id = text("edit.required");
        else if (props.takenIds.includes(form.id.trim())) found.id = text("edit.idTaken");
    }
    if (!fromCatalog.value) {
        if (form.contextWindow.trim() === "") found.contextWindow = text("edit.required");
        else if (!positive(form.contextWindow)) found.contextWindow = text("edit.positive");
        if (form.maxOutput.trim() !== "" && !positive(form.maxOutput)) found.maxOutput = text("edit.positive");
        if (form.price.some((value) => value.trim() !== "" && !PRICE.test(value.trim()))) found.price = text("edit.nonNegative");
    }
    // 预留量的基数可以留空（按窗口）；百分比与固定值要填，百分比不超过 100。
    const value = form.compactValue.trim();
    if (form.compactMode === "percent" && (!positive(value) || Number(value) > 100)) found.compactValue = text("edit.percent");
    else if (form.compactMode === "tokens" && !positive(value)) found.compactValue = text("edit.positive");
    else if (form.compactMode === "reserve" && value !== "" && !positive(value)) found.compactValue = text("edit.positive");
    if (headersPending.value) found.headers = text("edit.headersPending");
    return found;
});

const shown = (key: keyof typeof problems.value): string | undefined => (touched.value ? problems.value[key] : undefined);

function save(): void {
    touched.value = true;
    if (Object.keys(problems.value).length > 0) return;
    const name = form.name.trim();
    const group = form.group.trim();
    const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : {[key]: value} as Record<K, V>);
    const base: ModelConfig = {
        id: adding.value ? form.id.trim() : props.model!.id,
        enabled: props.model?.enabled ?? true,
        ...optional("name", name === "" ? undefined : name),
        ...optional("group", group === "" ? undefined : group),
        ...optional("compaction", form.compactMode === "follow" ? undefined : {mode: form.compactMode, ...(form.compactValue.trim() === "" ? {} : {value: Number(form.compactValue)})} as CompactionSetting),
        ...optional("headers", Object.keys(headers.value).length === 0 ? undefined : headers.value),
    };
    if (fromCatalog.value) {
        emit("save", base);
        return;
    }
    const prices = form.price.map((value) => value.trim());
    emit("save", {
        ...base,
        contextWindow: Number(form.contextWindow),
        ...optional("maxOutput", form.maxOutput.trim() === "" ? undefined : Number(form.maxOutput)),
        vision: form.vision,
        reasoning: form.reasoning,
        // 推理档对话框里不编辑，原样带回（整条替换写入，漏了就丢了）。
        ...optional("efforts", props.model === null || props.model.efforts.length === 0 ? undefined : [...props.model.efforts]),
        // 全部留空是“未知”；填了一部分时没填的按 0。
        price: prices.every((value) => value === "") ? null : prices.map((value) => (value === "" ? 0 : Number(value))) as [number, number, number, number],
    });
}

const COMPACT_MODES = computed(() => (["follow", "reserve", "percent", "tokens"] as const).map((value) => ({value, label: text(`edit.compactMode.${value}`)})));
const PRICE_LABELS = ["edit.priceInput", "edit.priceOutput", "edit.priceCacheRead", "edit.priceCacheWrite"] as const;
const title = computed(() => (props.model === null ? text("edit.addTitle") : text("edit.title", {name: props.model.name})));
</script>

<template>
    <Dialog
        :open="open"
        size="md"
        :title="title"
        show-cancel
        closable
        :confirm-label="text('edit.save')"
        :cancel-label="text('edit.cancel')"
        :busy="busy"
        :status="error"
        data-model-edit-dialog
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="save"
    >
        <div class="model-edit">
            <section class="model-edit__section">
                <h4>{{ text("edit.basic") }}</h4>
                <div class="model-edit__grid">
                    <label class="model-edit__field">
                        <span>{{ text("edit.id") }}</span>
                        <Input v-model="form.id" size="sm" :readonly="!adding" :invalid="shown('id') !== undefined" data-field="id" />
                        <small v-if="shown('id')" class="model-edit__problem">{{ shown("id") }}</small>
                    </label>
                    <label class="model-edit__field">
                        <span>{{ text("edit.name") }}</span>
                        <Input v-model="form.name" size="sm" :placeholder="text('edit.namePlaceholder')" data-field="name" />
                    </label>
                    <label class="model-edit__field">
                        <span>{{ text("edit.group") }}</span>
                        <Input v-model="form.group" size="sm" :placeholder="text('edit.namePlaceholder')" data-field="group" />
                    </label>
                </div>
            </section>
            <section class="model-edit__section">
                <h4>{{ text("edit.capabilities") }}</h4>
                <p v-if="fromCatalog" class="model-edit__hint">{{ text("edit.catalogFixed") }}</p>
                <div class="model-edit__grid">
                    <label class="model-edit__field">
                        <span>{{ text("edit.contextWindow") }}</span>
                        <NumberInput v-model="form.contextWindow" :readonly="fromCatalog" :placeholder="fromCatalog ? '' : text('edit.required')" :invalid="shown('contextWindow') !== undefined" data-field="contextWindow" />
                        <small v-if="shown('contextWindow')" class="model-edit__problem">{{ shown("contextWindow") }}</small>
                    </label>
                    <label class="model-edit__field">
                        <span>{{ text("edit.maxOutput") }}</span>
                        <NumberInput v-model="form.maxOutput" :readonly="fromCatalog" :invalid="shown('maxOutput') !== undefined" data-field="maxOutput" />
                        <small v-if="shown('maxOutput')" class="model-edit__problem">{{ shown("maxOutput") }}</small>
                    </label>
                    <div class="model-edit__switch"><Switch v-model="form.vision" size="sm" :readonly="fromCatalog" :aria-label="text('caps.vision')" /><span>{{ text("caps.vision") }}</span></div>
                    <div class="model-edit__switch"><Switch v-model="form.reasoning" size="sm" :readonly="fromCatalog" :aria-label="text('caps.reasoning')" /><span>{{ text("caps.reasoning") }}</span></div>
                </div>
            </section>
            <section class="model-edit__section">
                <h4>{{ text("edit.price") }}</h4>
                <p class="model-edit__hint">{{ fromCatalog ? text("edit.catalogFixed") : text("edit.priceHint") }}</p>
                <div class="model-edit__grid model-edit__grid--four">
                    <label v-for="(label, index) in PRICE_LABELS" :key="label" class="model-edit__field">
                        <span>{{ text(label) }}</span>
                        <NumberInput v-model="form.price[index]" :readonly="fromCatalog" :invalid="shown('price') !== undefined" />
                    </label>
                </div>
                <small v-if="shown('price')" class="model-edit__problem">{{ shown("price") }}</small>
            </section>
            <section class="model-edit__section">
                <h4>{{ text("edit.compaction") }}</h4>
                <div class="model-edit__grid">
                    <div class="model-edit__field">
                        <span>{{ text("edit.compactTrigger") }}</span>
                        <Select :model-value="form.compactMode" :options="COMPACT_MODES" size="sm" :aria-label="text('edit.compactTrigger')" data-field="compactMode" @update:model-value="setCompactMode" />
                    </div>
                    <label v-if="form.compactMode !== 'follow'" class="model-edit__field">
                        <span>{{ text(`edit.compactValue.${form.compactMode}`) }}</span>
                        <NumberInput v-model="form.compactValue" :placeholder="form.compactMode === 'reserve' ? text('edit.compactPlaceholder') : ''" :invalid="shown('compactValue') !== undefined" data-field="compactValue" />
                        <small v-if="shown('compactValue')" class="model-edit__problem">{{ shown("compactValue") }}</small>
                    </label>
                </div>
                <p v-if="form.compactMode === 'reserve'" class="model-edit__hint">{{ text("edit.compactHint") }}</p>
            </section>
            <Collapsible>
                <template #trigger>
                    <button type="button" class="model-edit__advanced"><span class="i-lucide-chevron-right model-edit__advanced-icon" aria-hidden="true" />{{ text("edit.advanced") }}<span class="model-edit__muted">{{ text("connection.headers.label") }}</span></button>
                </template>
                <div class="model-edit__advanced-body">
                    <HeadersEditor :headers="headers" :hint="text('edit.headersHint')" @commit="(next) => (headers = next)" @pending="(value) => (headersPending = value)" />
                    <small v-if="shown('headers')" class="model-edit__problem">{{ shown("headers") }}</small>
                </div>
            </Collapsible>
        </div>
    </Dialog>
</template>

<style scoped>
.model-edit {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.model-edit__section h4 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
}

.model-edit__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-4) var(--space-5);
}

.model-edit__grid--four {
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.model-edit__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}

.model-edit__switch {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
}

.model-edit__hint {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.model-edit__problem {
    font-size: var(--text-xs);
    color: var(--status-danger);
}

.model-edit__advanced {
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

.model-edit__advanced[data-state="open"] .model-edit__advanced-icon {
    transform: rotate(90deg);
}

.model-edit__muted {
    font-weight: var(--weight-normal);
    color: var(--text-muted);
}

.model-edit__advanced-body {
    padding-top: var(--space-3);
}

@container (max-width: 520px) {
    .model-edit__grid,
    .model-edit__grid--four {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
