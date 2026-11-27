<script setup lang="ts">
/** `GiltButton` 单独看（Lab）：放在它会出现的底上，夜是暗夜圣殿，昼是午后抄经室的旧橡木桌面。 */
import {computed} from "vue";

import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import OAK from "./assets/oak.webp";
import GiltButton from "./GiltButton.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof GiltButton>(() => props.input, []);
const day = computed(() => subject.bindings.value.day === true);
</script>

<template>
    <div class="gbf" :class="{'gbf--day': day}" :style="day ? {'--gbf-oak': `url(${OAK})`} : undefined" data-lab-subject @click.prevent>
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
        radial-gradient(70% 90% at 20% 0%, rgb(255 250 236 / 0.55), transparent 70%),
        var(--gbf-oak) center / cover,
        #d1b18e;
}
</style>
