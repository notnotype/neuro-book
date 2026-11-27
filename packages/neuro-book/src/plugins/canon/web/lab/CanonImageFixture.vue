<script setup lang="ts">
/**
 * 设定里的图片：注入样本图（`canon-images.ts`）与 canon 的翻译端口；外面给一个固定大小、竖长的方框（立绘的比例）。
 */
import CanonImage from "nbook/plugins/canon/web/components/groups/CanonImage.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideSampleImages} from "./canon-images";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();

const subject = useLabSubject<typeof CanonImage>(() => props.input, []);
</script>

<template>
    <div class="h-64 w-48 overflow-hidden rounded-[var(--radius-panel)]">
        <CanonImage data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
