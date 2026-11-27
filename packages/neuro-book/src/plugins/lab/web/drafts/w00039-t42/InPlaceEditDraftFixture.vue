<script setup lang="ts">
/** w00039 t42 第 2 轮静态稿的台子：注入 canon 的翻译端口与样本图，做法与状态来自场景登记的 props。 */
import InPlaceEditDraft from "./InPlaceEditDraft.vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {provideSampleImages} from "../../../../canon/web/lab/canon-images";
import {provideCanonText} from "../../../../canon/web/lab/canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();

const subject = useLabSubject<typeof InPlaceEditDraft>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full" data-lab-subject>
        <InPlaceEditDraft :key="props.scene" v-bind="subject.bindings.value" />
    </div>
</template>
