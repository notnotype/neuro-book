<script setup lang="ts">
/**
 * `ActSeal` 单独看（Lab）：一块压暗的台面，上面一张象牙色的卡片代表工作台，印在正中。
 * 场景给的是停在哪个状态；“重演”从不画起，描出来、停一会儿、收进上面的眉题（台面顶上那一条），再回到场景给的状态。
 */
import {computed, onBeforeUnmount, ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import ActSeal from "./ActSeal.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ActSeal>(() => props.input, []);
/** 重演时的状态：null 是照场景。 */
const override = ref<"off" | "drawing" | "docked" | null>(null);
const bindings = computed(() => (override.value === null ? subject.bindings.value : {...subject.bindings.value, state: override.value}));
const day = computed(() => subject.bindings.value.day === true);

let timers: Array<ReturnType<typeof setTimeout>> = [];
function clearTimers(): void {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
}

/** 不画 → 描出来（停 1.4 秒）→ 收进眉题（0.9 秒后）→ 回到场景给的状态。 */
function replay(): void {
    clearTimers();
    override.value = "off";
    timers.push(setTimeout(() => (override.value = "drawing"), 60));
    timers.push(setTimeout(() => (override.value = "docked"), 1460));
    timers.push(setTimeout(() => (override.value = null), 2360));
}

onBeforeUnmount(clearTimers);
</script>

<template>
    <div class="asf" :class="{'asf--day': day}" data-lab-subject>
        <div class="asf__eyebrow"></div>
        <div class="asf__desk"></div>
        <div class="asf__veil"></div>
        <ActSeal v-bind="bindings" />
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="replay">重演</button>
    </LabFixtureControls>
</template>

<style scoped>
.asf {
    position: relative;
    width: min(900px, 100%);
    height: 560px;
    overflow: hidden;
    border-radius: 10px;
    background: radial-gradient(80% 70% at 50% 40%, #3a1a1f, #140b0e);
}

.asf--day {
    background: radial-gradient(80% 70% at 50% 40%, #6b4630, #2e1a10);
}

/* 眉题那一条：印收进去的地方。 */
.asf__eyebrow {
    position: absolute;
    top: 18px;
    left: 6%;
    right: 6%;
    height: 24px;
    border-bottom: 1px solid rgb(225 178 133 / 0.35);
}

.asf__desk {
    position: absolute;
    inset: 60px 6% 40px;
    border-radius: 10px;
    background: #f3ecdf;
}

/* 页面在落印时压暗工作台的那一层。 */
.asf__veil {
    position: absolute;
    inset: 60px 6% 40px;
    border-radius: 10px;
    background: rgb(18 12 16 / 0.62);
}
</style>
