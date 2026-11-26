<script setup lang="ts">
/** 首页工作台单独看：挂在画布里铺满，拖动、分栏、换视图位置都能直接上手。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import HomepageDesk from "./HomepageDesk.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof HomepageDesk>(() => props.input, ["touch", "ready"]);
</script>

<template>
    <div class="h-full w-full" data-lab-subject>
        <HomepageDesk :key="props.scene" v-bind="subject.bindings.value" />
    </div>
</template>
