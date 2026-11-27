<script setup lang="ts">
/**
 * 条目选择器：选中的条目是受控的模型。夹具当宿主：照组件文档的用法接 `useEntryFind`，查的是一份内存里的条目（按名字或
 * 别名包含搜索词），场景 id 以 `failed` 开头的查找一律失败。注入 canon 的翻译端口（`canon-text.ts`）。
 */
import EntryPicker from "nbook/plugins/canon/web/components/entries/EntryPicker.vue";
import {useEntryFind, type EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const ENTRIES = [
    {id: "e1", name: "星瑕", kind: "人物", aliases: ["小瑕"]},
    {id: "e2", name: "星瑾", kind: "人物", aliases: []},
    {id: "e3", name: "星辰议会", kind: "组织", aliases: []},
    {id: "e4", name: "哥哥能回溯", kind: "知识点", aliases: []},
    {id: "e5", name: "守护之星", kind: "物品", aliases: [], note: "还没出场"},
];

const find: EntryFind = async (query) => {
    if (props.scene.startsWith("failed")) return {ok: false, reason: "作品打不开"};
    return {
        ok: true,
        items: ENTRIES.filter((entry) => entry.name.includes(query) || entry.aliases.some((alias) => alias.includes(query))).map((entry) => ({
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            ...(entry.note === undefined ? {} : {note: entry.note}),
            ...(query !== "" && !entry.name.includes(query) ? {note: `别名：${entry.aliases.find((alias) => alias.includes(query))!}`} : {}),
        })),
    };
};

const finder = useEntryFind(() => find);
const subject = useLabSubject<typeof EntryPicker>(() => props.input, ["update:modelValue", "create"]);
</script>

<template>
    <EntryPicker data-lab-subject v-bind="subject.bindings.value" :results="finder.results.value" @search="finder.search" />
</template>
