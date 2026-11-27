<script setup lang="ts">
/**
 * “添加设定组”对话框的夹具：注入 canon 的翻译端口（`canon-text.ts`）。开关是受控的模型；加了什么、切到哪一组记成事件。
 */
import AddComponentDialog from "nbook/plugins/canon/web/components/AddComponentDialog.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof AddComponentDialog>(() => props.input, ["add", "show"]);
</script>

<template>
    <AddComponentDialog data-lab-subject v-bind="subject.bindings.value" />
</template>
