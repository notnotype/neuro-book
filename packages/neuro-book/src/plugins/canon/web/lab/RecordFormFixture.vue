<script setup lang="ts">
/**
 * 记一笔的夹具：注入 canon 的翻译端口（`canon-text.ts`），填的内容是场景的双向绑定，由 Lab 管；`submit` 记成事件。
 */
import RecordForm from "nbook/plugins/canon/web/components/editing/RecordForm.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof RecordForm>(() => props.input, ["submit"]);
</script>

<template>
    <RecordForm data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
