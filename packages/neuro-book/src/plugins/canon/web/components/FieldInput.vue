<script setup lang="ts">
/**
 * 按字段的种类画一个输入控件（同名 .md）：确认条与列表元素对话框共用。受控。
 */
import {Input, NumberInput, Select, Switch, Textarea} from "@notnotype/nb-ui/components";

import type {ConfirmBarKind} from "./confirm-bar";
import EntryPicker from "./EntryPicker.vue";
import type {EntryResults} from "./entry-picker";
import ImageInput from "./ImageInput.vue";
import type {ImageValue} from "./image-input";
import SuggestInput from "./SuggestInput.vue";

const props = withDefaults(defineProps<{
    kind: ConfirmBarKind;
    value: unknown;
    label: string;
    options?: readonly string[];
    unit?: string;
    refResults?: EntryResults;
    refName?: string;
    /** 文字的行数；1 是单行输入框（就地改的浮层里的短文字）。 */
    rows?: number;
    /** 放在就地改的编辑卡里：建议值嵌在输入框下面，成段的文字按内容长高。默认 false。 */
    inline?: boolean;
    /** 成段的文字在原处改（输出 51）：字号、行高与卡片上的原文一样，长到 8 行封顶、再多在框里滚。默认 false。 */
    prose?: boolean;
}>(), {options: () => [], unit: "", refResults: () => ({kind: "idle"}), refName: undefined, rows: 2, inline: false, prose: false});

const emit = defineEmits<{
    (event: "update:value", value: unknown): void;
    (event: "search-ref", query: string): void;
}>();
</script>

<template>
    <div class="flex min-w-0 flex-wrap items-center gap-2" data-field-input>
        <NumberInput v-if="props.kind === 'number'" class="w-40" size="sm" :aria-label="props.label" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <SuggestInput v-else-if="props.kind === 'suggest'" :class="props.inline ? 'w-full' : 'w-64 max-w-full'" :label="props.label" :suggestions="props.options" :inline="props.inline" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <Select v-else-if="props.kind === 'enum'" class="w-48" size="sm" :aria-label="props.label" :options="props.options.map((option) => ({value: option, label: option}))" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <Switch v-else-if="props.kind === 'boolean'" size="sm" :aria-label="props.label" :model-value="props.value === true" @update:model-value="(value: boolean) => emit('update:value', value)" />
        <EntryPicker v-else-if="props.kind === 'ref'" class="w-72 max-w-full" :aria-label="props.label" :model-value="typeof props.value === 'string' ? props.value : null" :selected-name="props.refName" :results="props.refResults" @search="(query: string) => emit('search-ref', query)" @update:model-value="(value: string | null) => emit('update:value', value)" />
        <ImageInput v-else-if="props.kind === 'image'" class="w-full" :model-value="(props.value as ImageValue | null) ?? null" @update:model-value="(value: ImageValue | null) => emit('update:value', value)" />
        <Input v-else-if="props.rows === 1" class="w-full" size="sm" :aria-label="props.label" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <Textarea v-else class="w-full" :class="props.prose ? 'field-input__prose' : ''" :rows="props.rows" :autosize="props.inline" :max-rows="props.prose ? 8 : 12" :aria-label="props.label" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <span v-if="props.unit !== '' && props.kind === 'number'" class="text-[var(--text-muted)]">{{ props.unit }}</span>
    </div>
</template>

<style scoped>
/* 与人物、形象卡片上成段的原文同一字号与行高（CharacterCard、LookCard 的 `__passage`），点下去字不跳。 */
.field-input__prose {
    font-size: 1rem;
    line-height: 1.85;
}
</style>
