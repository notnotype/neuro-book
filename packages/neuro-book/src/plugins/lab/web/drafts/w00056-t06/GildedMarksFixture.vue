<script setup lang="ts">
/**
 * `GildedMarks` 单独看（Lab）：560×320 的一块假工作台，标签、两行字、一条侧轨。场景给的是要画哪几种；
 * “重演”换一批 id，旧的收起、新的出现，看扣合、铺开与掠光。画布比台面窄时（390 宽）整块按比例缩小。
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import GildedMarks from "./GildedMarks.vue";
import type {GildedMark} from "./GildedMarks.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof GildedMarks>(() => props.input, []);
const day = computed(() => subject.bindings.value.day === true);
/** 每按一次“重演”换一批 id：同一个 id 只挪位置不重演。 */
const round = ref(0);
const marks = computed<readonly GildedMark[]>(() => (subject.bindings.value.marks ?? []).map((mark) => ({...mark, id: `${mark.id}-${round.value}`})));

const STAGE_WIDTH = 560;
const STAGE_HEIGHT = 320;
const frame = ref<HTMLElement | null>(null);
const fit = ref(1);
let observer: ResizeObserver | undefined;
onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) fit.value = Math.min(1, entry.contentRect.width / STAGE_WIDTH);
    });
    if (frame.value !== null) observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <div class="gmf" :class="{'gmf--day': day}" data-lab-subject>
        <div ref="frame" class="gmf__frame" :style="{height: `${STAGE_HEIGHT * fit}px`}">
            <div class="gmf__stage" :style="{width: `${STAGE_WIDTH}px`, height: `${STAGE_HEIGHT}px`, transform: `scale(${fit})`}">
                <span class="gmf__card" style="left: 16px; top: 16px; width: 380px; height: 288px"></span>
                <span class="gmf__tab" style="left: 32px; top: 28px; width: 112px; height: 26px">第一章 霜港的钟</span>
                <p class="gmf__line" style="left: 40px; top: 120px">她正要吹灯，门外有人敲门，</p>
                <p class="gmf__line" style="left: 40px; top: 150px">三下。她屏住气，等那第四下。</p>
                <span class="gmf__card" style="left: 412px; top: 16px; width: 92px; height: 288px"></span>
                <span class="gmf__rail" style="left: 512px; top: 16px; width: 32px; height: 288px"></span>
                <GildedMarks :marks="marks" :day="day" />
            </div>
        </div>
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="round += 1">重演</button>
    </LabFixtureControls>
</template>

<style scoped>
.gmf {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    min-height: 100%;
    padding: 24px;
    background: #1c0a0f;
}

.gmf--day {
    background: #d1b18e;
}

.gmf__frame {
    width: 100%;
    min-width: 0;
    max-width: 560px;
}

.gmf__stage {
    position: relative;
    transform-origin: 0 0;
}

.gmf__card,
.gmf__tab,
.gmf__rail,
.gmf__line {
    position: absolute;
    margin: 0;
}

.gmf__card {
    border-radius: 10px;
    background: #2b2622;
}

.gmf__tab {
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: #3a332d;
    color: #e8dfd2;
    font-size: 12px;
}

.gmf__rail {
    border-radius: 8px;
    background: #24201c;
}

.gmf__line {
    color: #e8dfd2;
    font-size: 16px;
    line-height: 22px;
    white-space: nowrap;
}

.gmf--day .gmf__card {
    background: #fffcf5;
}

.gmf--day .gmf__tab {
    background: #f0e9dd;
    color: #2a1d12;
}

.gmf--day .gmf__rail {
    background: #f4f0e8;
}

.gmf--day .gmf__line {
    color: #2a1d12;
}
</style>
