<script setup lang="ts">
/**
 * “添加模块”对话框的夹具：注入 canon 的翻译端口（`canon-text.ts`）。开关是受控的模型；加了什么、切到哪个模块记成事件。
 */
import AddComponentDialog from "nbook/plugins/canon/web/components/entry-page/AddComponentDialog.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof AddComponentDialog>(() => props.input, ["add", "show"]);
</script>

<template>
    <AddComponentDialog data-lab-subject v-bind="subject.bindings.value" />
</template>
