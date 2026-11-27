<script setup lang="ts">
/** 首页按钮几版样式的台子：样张铺满画布。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import HeroButtons from "./HeroButtons.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof HeroButtons>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full overflow-auto" data-lab-subject>
        <HeroButtons v-bind="subject.bindings.value" />
    </div>
</template>
