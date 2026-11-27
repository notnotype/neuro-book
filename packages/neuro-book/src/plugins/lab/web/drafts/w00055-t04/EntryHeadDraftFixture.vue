<script setup lang="ts">
/** w00055 t04 页头静态稿的台子：注入 canon 的文字与样本图，草稿铺满画布。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import {provideSampleImages} from "../../../../canon/web/lab/canon-images";
import {provideCanonText} from "../../../../canon/web/lab/canon-text";
import EntryHeadDraft from "./EntryHeadDraft.vue";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();
const subject = useLabSubject<typeof EntryHeadDraft>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full" data-lab-subject>
        <EntryHeadDraft v-bind="subject.bindings.value" />
    </div>
</template>
