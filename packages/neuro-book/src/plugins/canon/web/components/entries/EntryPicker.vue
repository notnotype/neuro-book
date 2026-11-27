<script setup lang="ts">
/**
 * 条目选择器（同名 .md）：nb-ui `SearchSelect` 的远程模式。搜索词经 `search` 交给宿主，结果（`results`）由宿主经
 * `useEntryFind` 查好传回；组件只管怎么列、要不要给“新建”。
 */
import {computed, ref} from "vue";

import {SearchSelect} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";
import type {EntryResults} from "./entry-picker";

const props = withDefaults(defineProps<{
    modelValue: string | null;
    selectedName?: string;
    results: EntryResults;
    exclude?: readonly string[];
    excludeReason?: string;
    createKind?: string;
    placeholder?: string;
    clearable?: boolean;
    id?: string;
    disabled?: boolean;
    readonly?: boolean;
    invalid?: boolean;
}>(), {
    selectedName: undefined,
    exclude: () => [],
    excludeReason: undefined,
    createKind: undefined,
    placeholder: undefined,
    clearable: true,
    id: undefined,
    disabled: false,
    readonly: false,
    invalid: false,
});

const emit = defineEmits<{
    (e: "update:modelValue", value: string | null): void;
    (e: "create", name: string): void;
    (e: "search", query: string): void;
}>();

const text = useCanonText();

/** “新建”那一行的值：条目 id 由内核生成、带前缀，不会是这个串。 */
const CREATE = "\u0000create";

/** 输入框里现在的搜索词（`SearchSelect` 发来的）。 */
const query = ref("");

function onSearch(word: string): void {
    query.value = word;
    emit("search", word);
}

const items = computed(() => (props.results.kind === "done" ? props.results.items : []));
const createName = computed(() => query.value.trim());
const offerCreate = computed(() => props.createKind !== undefined && props.results.kind === "done" && props.results.query === query.value && createName.value !== "" && !items.value.some((item) => item.name === createName.value));

const options = computed(() => [
    ...items.value.map((item) => {
        const excluded = props.exclude.includes(item.id);
        const note = excluded ? props.excludeReason ?? text("entryPicker.excluded") : item.note;
        return {value: item.id, label: item.name, description: [item.kind, note].filter((part) => part !== undefined && part !== "").join(" · ") || undefined, disabled: excluded};
    }),
    ...(offerCreate.value ? [{value: CREATE, label: text("entryPicker.create", {name: createName.value}), description: props.createKind, iconClass: "i-lucide-plus"}] : []),
]);

const emptyText = computed(() => {
    if (props.results.kind === "failed") return text("entryPicker.failed", {reason: props.results.reason});
    if (props.results.kind === "done") return text("entryPicker.empty");
    return text("entryPicker.searching");
});

/**
 * 在这里选中的那一项的名字。远程模式下输入框的名字只来自这一批结果或 `selectedName`：选中以后再打开（结果换成新的一次查找、
 * 查找中没有结果）或搜不到词后离开，结果里都没有它；宿主只在打开时知道当前值的名字，所以选中的名字由这里记着。
 */
const picked = ref<{readonly id: string; readonly name: string} | null>(null);
const shownName = computed(() => (picked.value !== null && picked.value.id === props.modelValue ? picked.value.name : props.selectedName));

function onUpdate(value: string): void {
    if (value === CREATE) {
        emit("create", createName.value);
        return;
    }
    const item = items.value.find((candidate) => candidate.id === value);
    picked.value = item === undefined ? null : {id: item.id, name: item.name};
    emit("update:modelValue", value === "" ? null : value);
}
</script>

<template>
    <SearchSelect
        :id="props.id"
        :model-value="props.modelValue ?? ''"
        :options="options"
        :filter="false"
        :selected-label="shownName"
        :clearable="props.clearable"
        :placeholder="props.placeholder ?? text('entryPicker.placeholder')"
        :empty-text="emptyText"
        :disabled="props.disabled"
        :readonly="props.readonly"
        :invalid="props.invalid"
        data-entry-picker
        @search="onSearch"
        @update:model-value="onUpdate"
    />
</template>
