<script setup lang="ts">
/**
 * 图片字段的输入：值是受控的模型。注入 canon 的翻译端口（`canon-text.ts`）与样本图；场景 id 带 `picking` 的另注入候选与上传
 * （`canon-images.ts`），带 `uploading` 的一直在传，带 `no-images` 的图片文件夹是空的。
 */
import ImageInput from "nbook/plugins/canon/web/components/editing/ImageInput.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideSampleImages, provideSamplePicking} from "./canon-images";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();
if (props.scene.includes("picking")) provideSamplePicking(props.scene.includes("uploading") ? "uploading" : props.scene.includes("no-images") ? "empty" : "ready");

const subject = useLabSubject<typeof ImageInput>(() => props.input, ["update:modelValue"]);
</script>

<template>
    <ImageInput data-lab-subject class="w-[22rem]" v-bind="subject.bindings.value" />
</template>
