<script setup lang="ts">
/**
 * 开场动画单独看：没有真工作台，替身照场景里一份固定的卡片摆（1000×640 的桌面），演完停在替身的终态。
 * 和真工作台合起来的样子看 HomepageDraft 的场景。
 */
import {ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import HomepageOpening from "./HomepageOpening.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof HomepageOpening>(() => props.input, ["light", "reveal", "seal", "done"]);
const replay = ref(0);
</script>

<template>
    <div class="hp-opening-fixture h-full w-full">
        <div class="hp-opening-fixture__desk" :style="{width: `${subject.bindings.value.width}px`, height: `${subject.bindings.value.height}px`}" data-lab-subject>
            <HomepageOpening :key="`${props.scene}-${replay}`" v-bind="subject.bindings.value" />
        </div>
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="replay += 1">重播</button>
    </LabFixtureControls>
</template>

<style scoped>
/* 首页的舞台底色（夜），开场是在这上面演的。 */
.hp-opening-fixture {
    display: grid;
    place-items: center;
    background: #1c1418;
}

.hp-opening-fixture__desk {
    position: relative;
}
</style>
