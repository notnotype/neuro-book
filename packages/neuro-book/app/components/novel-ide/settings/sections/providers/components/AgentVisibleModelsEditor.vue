<script setup lang="ts">
import {computed} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/sections/providers/components/NovelIdeModelSelect.vue";
import type {AgentVisibleModelDraft} from "nbook/app/components/novel-ide/settings/sections/providers/model-settings-draft";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";

const props = defineProps<{
    modelValue: AgentVisibleModelDraft[];
    models: EnabledModelOptionDto[];
    defaultModelKey: string | null;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: AgentVisibleModelDraft[]): void;
}>();

const {t} = useI18n();

const defaultModelLabel = computed(() => props.models.find((model) => model.key === props.defaultModelKey)?.label ?? props.defaultModelKey ?? "");
const canAdd = computed(() => props.models.some((model) => !props.modelValue.some((entry) => entry.modelKey === model.key)));

/** 返回当前行可选择的模型；其它行已占用的 key 不重复出现。 */
function availableModels(index: number): EnabledModelOptionDto[] {
    const current = props.modelValue[index]?.modelKey;
    const used = new Set(props.modelValue.filter((_, entryIndex) => entryIndex !== index).map((entry) => entry.modelKey));
    return props.models.filter((model) => model.key === current || !used.has(model.key));
}

/** 当前 key 是否仍指向可运行模型。 */
function modelAvailable(modelKey: string): boolean {
    return props.models.some((model) => model.key === modelKey);
}

/** 新增首个尚未进入清单的可运行模型。 */
function addEntry(): void {
    const model = props.models.find((option) => !props.modelValue.some((entry) => entry.modelKey === option.key));
    if (!model) {
        return;
    }
    emit("update:modelValue", [...props.modelValue, {modelKey: model.key, note: ""}]);
}

/** 更新单行字段，始终生成新数组，避免直接修改 props。 */
function updateEntry(index: number, patch: Partial<AgentVisibleModelDraft>): void {
    emit("update:modelValue", props.modelValue.map((entry, entryIndex) => entryIndex === index ? {...entry, ...patch} : entry));
}

/** 删除指定清单条目。 */
function removeEntry(index: number): void {
    emit("update:modelValue", props.modelValue.filter((_, entryIndex) => entryIndex !== index));
}

/** 使用明确的上下按钮调整 prompt 展示顺序。 */
function moveEntry(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= props.modelValue.length) {
        return;
    }
    const next = [...props.modelValue];
    [next[index], next[target]] = [next[target]!, next[index]!];
    emit("update:modelValue", next);
}
</script>

<template>
    <!-- Agent 可见模型清单：Global-only，顺序直接进入 leader prompt。 -->
    <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2">
                    <div class="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--accent-bg)] text-[var(--accent-text)]">
                        <span class="i-lucide-list-checks h-3.5 w-3.5"></span>
                    </div>
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.agentVisibleModelsTitle") }}</h4>
                </div>
                <p class="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{{ t("settings.panels.models.agentVisibleModelsDescription") }}</p>
            </div>
            <button type="button" class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50" :disabled="!canAdd" @click="addEntry">
                <span class="i-lucide-plus h-3.5 w-3.5"></span>
                {{ t("settings.panels.models.agentVisibleModelsAdd") }}
            </button>
        </div>

        <div v-if="modelValue.length > 5" class="mt-3 flex items-start gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-xs text-[var(--status-warning)]">
            <span class="i-lucide-triangle-alert mt-0.5 h-3.5 w-3.5 shrink-0"></span>
            <span>{{ t("settings.panels.models.agentVisibleModelsOverLimit", {count: modelValue.length}) }}</span>
        </div>

        <div v-if="modelValue.length === 0" class="mt-4 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-input)] px-4 py-4 text-xs leading-5 text-[var(--text-secondary)]">
            {{ defaultModelLabel
                ? t("settings.panels.models.agentVisibleModelsEmptyDefault", {model: defaultModelLabel})
                : t("settings.panels.models.agentVisibleModelsEmptyUnavailable") }}
        </div>

        <div v-else class="mt-4 space-y-3">
            <!-- 每行 = 模型 key + 给 Agent 看的用途说明 + 排序操作。 -->
            <div v-for="(entry, index) in modelValue" :key="`${entry.modelKey}:${String(index)}`" class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)] p-3">
                <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                    <NovelIdeModelSelect :model-value="entry.modelKey" :models="availableModels(index)" :placeholder="t('settings.panels.models.agentVisibleModelsSelect')" @update:model-value="updateEntry(index, {modelKey: $event ?? ''})" />
                    <FormInput :model-value="entry.note" :placeholder="t('settings.panels.models.agentVisibleModelsNotePlaceholder')" @update:model-value="updateEntry(index, {note: $event})" />
                    <div class="flex items-center justify-end gap-1">
                        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-35" :title="t('settings.panels.models.agentVisibleModelsMoveUp')" :disabled="index === 0" @click="moveEntry(index, -1)"><span class="i-lucide-arrow-up h-3.5 w-3.5"></span></button>
                        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-35" :title="t('settings.panels.models.agentVisibleModelsMoveDown')" :disabled="index === modelValue.length - 1" @click="moveEntry(index, 1)"><span class="i-lucide-arrow-down h-3.5 w-3.5"></span></button>
                        <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" :title="t('settings.panels.models.agentVisibleModelsRemove')" @click="removeEntry(index)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                    </div>
                </div>
                <p v-if="entry.modelKey && !modelAvailable(entry.modelKey)" class="mt-2 text-[11px] text-[var(--status-warning)]">{{ t("settings.panels.models.agentVisibleModelsInvalid", {model: entry.modelKey}) }}</p>
            </div>
        </div>
    </section>
</template>
