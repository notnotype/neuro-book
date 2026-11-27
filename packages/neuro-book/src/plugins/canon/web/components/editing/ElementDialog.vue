<script setup lang="ts">
/**
 * 列表元素的对话框（同名 .md）：受控，各值与查找结果都由宿主给。
 */
import {Dialog, Field, Input, SegmentedControl} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";
import type {EditIntent} from "./confirm-bar";
import type {ElementField} from "./element-dialog";
import EntryPicker from "../entries/EntryPicker.vue";
import type {EntryResults} from "../entries/entry-picker";
import FieldInput from "./FieldInput.vue";

const props = withDefaults(defineProps<{
    open: boolean;
    title: string;
    keyed: boolean;
    editing: boolean;
    keyValue: string | null;
    keyName?: string;
    keyResults: EntryResults;
    label: string;
    fields: readonly ElementField[];
    values: Readonly<Record<string, unknown>>;
    refNames?: Readonly<Record<string, string>>;
    refResults: EntryResults;
    intents: readonly EditIntent[];
    intent: EditIntent;
    saving?: boolean;
    error?: string;
}>(), {keyName: undefined, refNames: () => ({}), saving: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:keyValue", value: string | null): void;
    (event: "search-key", query: string): void;
    (event: "update:label", value: string): void;
    (event: "update:value", field: string, value: unknown): void;
    (event: "search-ref", field: string, query: string): void;
    (event: "update:intent", value: EditIntent): void;
    (event: "confirm"): void;
}>();

const text = useCanonText();
</script>

<template>
    <Dialog
        :open="props.open"
        :title="props.title"
        show-cancel
        :confirm-label="text('edit.save')"
        :busy="props.saving"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="emit('confirm')"
    >
        <div class="flex flex-col gap-3" data-element-dialog>
            <Field v-if="props.keyed" :label="text('list.key')">
                <EntryPicker :model-value="props.keyValue" :selected-name="props.keyName" :results="props.keyResults" :disabled="props.editing" @search="(query: string) => emit('search-key', query)" @update:model-value="(value: string | null) => emit('update:keyValue', value)" />
            </Field>
            <Field v-else :label="text('list.label')">
                <Input :model-value="props.label" @update:model-value="(value: string) => emit('update:label', value)" />
            </Field>
            <Field v-for="field in props.fields" :key="field.id" :label="field.label">
                <p v-if="field.semantic && props.editing" class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ String(props.values[field.id] ?? "") || text("value.unknown") }}<span class="ml-2 text-[var(--text-muted)]">{{ text("list.semanticReadOnly") }}</span></p>
                <FieldInput v-else :kind="field.kind" :value="props.values[field.id]" :label="field.label" :options="field.options ?? []" :unit="field.unit ?? ''" :ref-results="props.refResults" :ref-name="props.refNames[field.id]" @update:value="(value: unknown) => emit('update:value', field.id, value)" @search-ref="(query: string) => emit('search-ref', field.id, query)" />
            </Field>
            <div v-if="props.intents.length > 1" class="flex items-center gap-2 text-[length:var(--text-sm)]">
                <span class="text-[var(--text-secondary)]">{{ text("edit.intent") }}</span>
                <SegmentedControl size="sm" :aria-label="text('edit.intent')" :model-value="props.intent" :options="props.intents.map((intent) => ({value: intent, label: text(intent === 'creative' ? 'edit.creative' : 'edit.story')}))" @update:model-value="(value) => emit('update:intent', value as EditIntent)" />
            </div>
            <p v-if="props.error !== ''" role="alert" class="text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ props.error }}</p>
        </div>
    </Dialog>
</template>
