<script setup lang="ts">
/**
 * 条目主文字的富文本输入框的夹具：整篇是受控的模型（Lab 用受控模型时，交出的整篇传回来就是回声）。夹具当宿主给 `@` 的找条目：
 * 查一份内存里的条目（场景输入要能 JSON 往返，放不进函数）。
 */
import type {EntryFind} from "nbook/plugins/canon/web/components/entries/entry-picker";
import EntryRichInput from "nbook/plugins/canon/web/components/text/EntryRichInput.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EntryRichInput>(() => props.input, ["update:modelValue", "focus", "blur", "discarded"]);

const ENTRIES = [
    {id: "e2", name: "星瑾", kind: "人物"},
    {id: "e3", name: "星辰议会", kind: "组织"},
    {id: "e4", name: "哥哥能回溯", kind: "知识点"},
];
const find: EntryFind = async (query) => ({ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query))});
</script>

<template>
    <EntryRichInput data-lab-subject class="w-full" :find="find" v-bind="subject.bindings.value" />
</template>
