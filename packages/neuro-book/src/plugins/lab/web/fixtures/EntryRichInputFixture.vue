<script setup lang="ts">
/** 条目主文字的富文本输入框的夹具：整篇是受控的模型（Lab 用受控模型时，交出的整篇传回来就是回声）。 */
import EntryRichInput from "nbook/plugins/canon/web/components/EntryRichInput.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EntryRichInput>(() => props.input, ["update:modelValue", "focus", "blur"]);
</script>

<template>
    <EntryRichInput data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
