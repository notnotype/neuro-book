<script setup lang="ts">
/**
 * 按字段的种类画一个输入控件（同名 .md）：确认条与列表元素对话框共用。受控。
 */
import {NumberInput, Select, Switch, Textarea} from "@notnotype/nb-ui/components";

import type {ConfirmBarKind} from "./confirm-bar";
import EntryPicker from "./EntryPicker.vue";
import type {EntryResults} from "./entry-picker";
import ImageInput from "./ImageInput.vue";
import type {ImageValue} from "./image-input";

const props = withDefaults(defineProps<{
    kind: ConfirmBarKind;
    value: unknown;
    label: string;
    options?: readonly string[];
    unit?: string;
    refResults?: EntryResults;
    refName?: string;
    rows?: number;
}>(), {options: () => [], unit: "", refResults: () => ({kind: "idle"}), refName: undefined, rows: 2});

const emit = defineEmits<{
    (event: "update:value", value: unknown): void;
    (event: "search-ref", query: string): void;
}>();
</script>

<template>
    <div class="flex min-w-0 flex-wrap items-center gap-2" data-field-input>
        <NumberInput v-if="props.kind === 'number'" class="w-40" size="sm" :aria-label="props.label" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <Select v-else-if="props.kind === 'enum'" class="w-48" size="sm" :aria-label="props.label" :options="props.options.map((option) => ({value: option, label: option}))" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <Switch v-else-if="props.kind === 'boolean'" size="sm" :aria-label="props.label" :model-value="props.value === true" @update:model-value="(value: boolean) => emit('update:value', value)" />
        <EntryPicker v-else-if="props.kind === 'ref'" class="w-72 max-w-full" :aria-label="props.label" :model-value="typeof props.value === 'string' ? props.value : null" :selected-name="props.refName" :results="props.refResults" @search="(query: string) => emit('search-ref', query)" @update:model-value="(value: string | null) => emit('update:value', value)" />
        <ImageInput v-else-if="props.kind === 'image'" class="w-full" :model-value="(props.value as ImageValue | null) ?? null" @update:model-value="(value: ImageValue | null) => emit('update:value', value)" />
        <Textarea v-else class="w-full" :rows="props.rows" :aria-label="props.label" :model-value="String(props.value ?? '')" @update:model-value="(value: string) => emit('update:value', value)" />
        <span v-if="props.unit !== '' && props.kind === 'number'" class="text-[var(--text-muted)]">{{ props.unit }}</span>
    </div>
</template>
