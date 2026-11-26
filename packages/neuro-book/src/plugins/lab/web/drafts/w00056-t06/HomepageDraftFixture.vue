<script setup lang="ts">
/** w00056 t06 首页原型的台子：画布当一屏，“重播开场”把整页重新挂一遍。 */
import {ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import HomepageDraft from "./HomepageDraft.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof HomepageDraft>(() => props.input, []);
const replay = ref(0);
</script>

<template>
    <div class="h-full w-full" data-lab-subject>
        <HomepageDraft :key="`${props.scene}-${replay}`" v-bind="subject.bindings.value" />
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-hp-replay @click="replay += 1">重播开场</button>
    </LabFixtureControls>
</template>
