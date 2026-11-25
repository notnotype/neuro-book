<script setup lang="ts">
/**
 * 形象分页的展示层：注入 canon 的翻译端口与样本图（`canon-images.ts`）；事件记在 Lab 的事件栏里。
 */
import LookCard from "nbook/plugins/canon/web/components/LookCard.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideSampleImages} from "./canon-images";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();

const subject = useLabSubject<typeof LookCard>(() => props.input, ["edit", "origins", "put-on", "outfit-edit", "outfit-remove", "outfit-add"]);
</script>

<template>
    <div class="w-full">
        <LookCard data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
