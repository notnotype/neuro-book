<script setup lang="ts">
/**
 * 图片字段的输入：值是受控的模型。注入 canon 的翻译端口（`canon-text.ts`）。
 */
import ImageInput from "nbook/plugins/canon/web/components/ImageInput.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ImageInput>(() => props.input, ["update:modelValue"]);
</script>

<template>
    <ImageInput data-lab-subject v-bind="subject.bindings.value" />
</template>
