<script setup lang="ts">
/**
 * 移动对话框：草稿是受控的模型。夹具当宿主：两个选择器照组件文档的用法接 `useEntryFind`，查一份内存里的条目。注入 canon 的翻译端口。
 */
import MoveDialog from "nbook/plugins/canon/web/components/entry-page/MoveDialog.vue";
import {useEntryFind, type EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const ENTRIES = [{id: "e2", name: "学院", kind: "组织"}, {id: "e3", name: "主角团", kind: "组织"}, {id: "e4", name: "星瑾", kind: "人物"}];
const find: EntryFind = async (query) => ({ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query))});
const parent = useEntryFind(() => find);
const sameAs = useEntryFind(() => find);
const subject = useLabSubject<typeof MoveDialog>(() => props.input, ["confirm"]);
</script>

<template>
    <MoveDialog data-lab-subject v-bind="subject.bindings.value" :parent-results="parent.results.value" :same-as-results="sameAs.results.value" @search-parent="parent.search" @search-same-as="sameAs.search" />
</template>
