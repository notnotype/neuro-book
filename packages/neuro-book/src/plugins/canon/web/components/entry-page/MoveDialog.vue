<script setup lang="ts">
/**
 * 移动对话框（同名 .md）：受控，填的东西与两个选择器的结果都由宿主给。
 */
import {Dialog, Field, Input, Select} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";
import EntryPicker from "../entries/EntryPicker.vue";
import type {EntryResults} from "../entries/entry-picker";
import type {MoveDraft} from "./move-dialog";

const props = withDefaults(defineProps<{
    open: boolean;
    entry: {readonly id: string; readonly name: string};
    draft: MoveDraft;
    parentResults: EntryResults;
    sameAsResults: EntryResults;
    chapters?: readonly {readonly id: string; readonly index: number}[];
    saving?: boolean;
    error?: string;
}>(), {chapters: () => [], saving: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "update:draft", value: MoveDraft): void;
    (event: "search-parent", query: string): void;
    (event: "search-same-as", query: string): void;
    (event: "confirm"): void;
}>();

const text = useCanonText();
const START = "\u0000start";
const patch = (change: Partial<MoveDraft>): void => emit("update:draft", {...props.draft, ...change});
</script>

<template>
    <Dialog
        :open="props.open"
        :title="text('move.title', {name: props.entry.name})"
        show-cancel
        :confirm-label="text('move.confirm')"
        :busy="props.saving"
        :close-on-request="!props.saving"
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="emit('confirm')"
    >
        <div class="flex flex-col gap-3" data-move-dialog>
            <Field :label="text('move.parent')">
                <EntryPicker
                    :model-value="props.draft.parent"
                    :selected-name="props.draft.parentName"
                    :results="props.parentResults"
                    :exclude="[props.entry.id]"
                    :exclude-reason="text('move.self')"
                    :placeholder="text('move.top')"
                    @search="(query: string) => emit('search-parent', query)"
                    @update:model-value="(value: string | null) => patch({parent: value, parentName: ''})"
                />
            </Field>
            <Field :label="text('move.folder')">
                <Input :model-value="props.draft.folder" @update:model-value="(value: string) => patch({folder: value})" />
            </Field>
            <Field :label="text('move.kind')">
                <Input :model-value="props.draft.kind" @update:model-value="(value: string) => patch({kind: value})" />
            </Field>
            <Field :label="text('move.order')">
                <Select :options="[{value: 'keep', label: text('move.keep')}, {value: 'first', label: text('move.first')}]" :model-value="props.draft.order" @update:model-value="(value: string) => patch({order: value === 'first' ? 'first' : 'keep'})" />
            </Field>
            <Field :label="text('newEntry.appears')">
                <Select :options="[{value: START, label: text('newEntry.fromStart')}, ...props.chapters.map((chapter) => ({value: chapter.id, label: text('newEntry.chapterStart', {index: chapter.index})}))]" :model-value="props.draft.appears ?? START" @update:model-value="(value: string) => patch({appears: value === START ? null : value})" />
            </Field>
            <Field :label="text('newEntry.sameAs')">
                <EntryPicker
                    :model-value="props.draft.sameAs"
                    :selected-name="props.draft.sameAsName"
                    :results="props.sameAsResults"
                    :exclude="[props.entry.id]"
                    :exclude-reason="text('move.self')"
                    :placeholder="text('move.notSameAs')"
                    @search="(query: string) => emit('search-same-as', query)"
                    @update:model-value="(value: string | null) => patch({sameAs: value, sameAsName: ''})"
                />
            </Field>
            <p v-if="props.error !== ''" role="alert" class="text-[length:var(--text-sm)] text-[var(--status-danger)]">{{ props.error }}</p>
        </div>
    </Dialog>
</template>
