<script setup lang="ts">
/**
 * 列表元素的对话框：开关、名字、指向的条目与意图是受控的模型；各子字段的值按字段发（不是 v-model），夹具当宿主自己存。
 * 两个选择器照组件文档的用法接 `useEntryFind`，查一份内存里的条目。注入 canon 的翻译端口。
 */
import {shallowRef, watch} from "vue";

import ElementDialog from "nbook/plugins/canon/web/components/editing/ElementDialog.vue";
import {useEntryFind, type EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const ENTRIES = [{id: "k1", name: "学院的秘密", kind: "知识点"}, {id: "k2", name: "星瑕的身世", kind: "知识点"}];
const find: EntryFind = async (query) => ({ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query))});
const keys = useEntryFind(() => find);
const refs = useEntryFind(() => find);
const subject = useLabSubject<typeof ElementDialog>(() => props.input, ["confirm"]);
const values = shallowRef<Record<string, unknown>>({});
watch(() => props.input?.props?.values, (given) => (values.value = {...(given as Record<string, unknown> | undefined)}), {immediate: true});
</script>

<template>
    <ElementDialog
        data-lab-subject
        v-bind="subject.bindings.value"
        :values="values"
        :key-results="keys.results.value"
        :ref-results="refs.results.value"
        @search-key="keys.search"
        @search-ref="(_field: string, query: string) => refs.search(query)"
        @update:value="(field: string, value: unknown) => (values = {...values, [field]: value})"
    />
</template>
