<script setup lang="ts">
/**
 * 按种类画的字段输入：值是受控的模型。引用种类照组件文档的用法接 `useEntryFind`，查一份内存里的条目。注入 canon 的翻译端口。
 */
import FieldInput from "nbook/plugins/canon/web/components/editing/FieldInput.vue";
import {useEntryFind, type EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const ENTRIES = [{id: "e2", name: "雾崎", kind: "人物"}, {id: "e4", name: "星瑾", kind: "人物"}];
const find: EntryFind = async (query) => ({ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query))});
const refs = useEntryFind(() => find);
const subject = useLabSubject<typeof FieldInput>(() => props.input, ["update:value"]);
</script>

<template>
    <FieldInput data-lab-subject v-bind="subject.bindings.value" :ref-results="refs.results.value" @search-ref="refs.search" />
</template>
