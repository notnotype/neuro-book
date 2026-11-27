<script setup lang="ts">
/** `GiltButton` 单独看（Lab）：放在它会出现的底上，夜是暗夜圣殿，昼是午后藏书阁窗光照着的暖象牙墙（第 10 轮的白天）。 */
import {computed} from "vue";

import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import GiltButton from "./GiltButton.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof GiltButton>(() => props.input, []);
const day = computed(() => subject.bindings.value.day === true);
</script>

<template>
    <div class="gbf" :class="{'gbf--day': day}" data-lab-subject @click.prevent>
        <GiltButton v-bind="subject.bindings.value">{{ subject.bindings.value.primary === true ? "下载 NeuroBook" : "在 GitHub 上看看" }}</GiltButton>
    </div>
</template>

<style scoped>
.gbf {
    display: grid;
    place-items: center;
    min-height: 100%;
    padding: 40px;
    background:
        radial-gradient(70% 90% at 50% 0%, rgb(74 38 58 / 0.55), transparent 70%),
        #160e12;
}

.gbf--day {
    background:
        radial-gradient(70% 90% at 20% 0%, rgb(255 246 222 / 0.6), transparent 70%),
        radial-gradient(90% 110% at 50% 18%, #f6ecd8, #efdfc0 58%, #d9b68c);
}
</style>
