<script setup lang="ts">
import {Collapsible, Dialog, Input, NumberInput, Switch} from "@notnotype/nb-ui/components";
import {computed, reactive, ref, watch} from "vue";

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
const form = reactive({id: "", name: "", group: "", contextWindow: "", maxOutput: "", vision: false, reasoning: false, compactAt: "", price: ["", "", "", ""] as string[]});
const headers = ref<Record<string, string>>({});
const touched = ref(false);

// 每次打开都从当前的模型重填（关掉再开丢掉没保存的改动）。
watch(() => [props.open, props.model] as const, ([open, model]) => {
    if (!open) return;
    touched.value = false;
    Object.assign(form, {
        id: model?.id ?? "",
        name: model === null || model.name === model.id ? "" : model.name,
        group: model?.group ?? "",
        contextWindow: blank(model?.contextWindow),
        maxOutput: blank(model?.maxOutput),
        vision: model?.vision ?? false,
        reasoning: model?.reasoning ?? false,
        compactAt: blank(model?.compactAt),
        price: model?.price === null || model?.price === undefined ? ["", "", "", ""] : model.price.map(String),
    });
    headers.value = {...model?.headers};
}, {immediate: true});

const positive = (value: string): boolean => /^[1-9]\d*$/u.test(value.trim());
const PRICE = /^\d+(\.\d+)?$/u;

const problems = computed(() => {
    const found: Partial<Record<"id" | "contextWindow" | "maxOutput" | "compactAt" | "price", string>> = {};
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
    if (form.compactAt.trim() !== "" && !positive(form.compactAt)) found.compactAt = text("edit.positive");
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
        ...optional("compactAt", form.compactAt.trim() === "" ? undefined : Number(form.compactAt)),
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
        // 全部留空是“未知”；填了一部分时没填的按 0。
        price: prices.every((value) => value === "") ? null : prices.map((value) => (value === "" ? 0 : Number(value))) as [number, number, number, number],
    });
}

const PRICE_LABELS = ["edit.priceInput", "edit.priceOutput", "edit.priceCacheRead", "edit.priceCacheWrite"] as const;
const title = computed(() => (props.model === null ? text("edit.addTitle") : text("edit.title", {name: props.model.name})));
</script>

<template>
    <Dialog
        :model-value="open"
        size="md"
        :title="title"
        show-cancel
        closable
        :confirm-label="text('edit.save')"
        :cancel-label="text('edit.cancel')"
        :busy="busy"
        :status="error"
        data-model-edit-dialog
        @update:model-value="(value: boolean) => emit('update:open', value)"
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
                    <label class="model-edit__field">
                        <span>{{ text("edit.compactAt") }}</span>
                        <NumberInput v-model="form.compactAt" :placeholder="text('edit.compactPlaceholder')" :invalid="shown('compactAt') !== undefined" data-field="compactAt" />
                        <small v-if="shown('compactAt')" class="model-edit__problem">{{ shown("compactAt") }}</small>
                    </label>
                </div>
                <p class="model-edit__hint">{{ text("edit.compactHint") }}</p>
            </section>
            <Collapsible>
                <template #trigger>
                    <button type="button" class="model-edit__advanced"><span class="i-lucide-chevron-right model-edit__advanced-icon" aria-hidden="true" />{{ text("edit.advanced") }}<span class="model-edit__muted">{{ text("connection.headers.label") }}</span></button>
                </template>
                <div class="model-edit__advanced-body">
                    <HeadersEditor :headers="headers" :hint="text('edit.headersHint')" @commit="(next) => (headers = next)" />
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
