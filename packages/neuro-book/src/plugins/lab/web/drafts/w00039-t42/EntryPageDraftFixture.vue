<script setup lang="ts">
/** w00039 t42 第 1 轮静态稿的台子：注入 canon 的翻译端口与样本图，排法与状态来自场景登记的 props。 */
import EntryPageDraft from "./EntryPageDraft.vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {provideSampleImages} from "../../../../canon/web/lab/canon-images";
import {provideCanonText} from "../../../../canon/web/lab/canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();

const subject = useLabSubject<typeof EntryPageDraft>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full" data-lab-subject>
        <EntryPageDraft :key="props.scene" v-bind="subject.bindings.value" />
    </div>
</template>
