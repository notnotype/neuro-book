<script setup lang="ts">
/**
 * `DeskSpotlight` 单独看（Lab）：900×560 的一块台面，上面几张象牙色的卡片代表工作台的几块，幕盖在上面。
 * 场景给的是要留亮的几块；“换一处”在两组之间来回切，看亮处怎么挪过去、块数变了怎么先回亮再落光。
 * 画布比台面窄时（390 宽）整块台面按比例缩小：亮处与卡片都用台面坐标，一起缩，相对位置不变。
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import DeskSpotlight from "./DeskSpotlight.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DeskSpotlight>(() => props.input, []);
/** 切到另一组：同块数的一组（看挪动）与一块的一组（看先回亮再落光）轮着来。 */
const ALTERNATES = [
    {spots: [{left: 620, top: 60, width: 250, height: 460}, {left: 40, top: 24, width: 150, height: 30}], rims: [0]},
    {spots: [{left: 230, top: 300, width: 360, height: 60}], rims: [0]},
] as const;
const turn = ref(-1);
const bindings = computed(() => (turn.value < 0 ? subject.bindings.value : {...subject.bindings.value, ...ALTERNATES[turn.value % ALTERNATES.length]}));
const day = computed(() => subject.bindings.value.night === false);

/** 台面的设计尺寸：卡片与场景里的亮处都按它摆。 */
const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 560;
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
    <div class="dsf" :class="{'dsf--day': day}" data-lab-subject>
        <!-- 外框按缩后的大小占位；台面本身仍是 900×560，用 transform 缩进外框里。 -->
        <div ref="frame" class="dsf__frame" :style="{height: `${STAGE_HEIGHT * fit}px`}">
            <div class="dsf__stage" :style="{width: `${STAGE_WIDTH}px`, height: `${STAGE_HEIGHT}px`, transform: `scale(${fit})`}">
                <span class="dsf__card" style="left: 20px; top: 20px; width: 180px; height: 520px"></span>
                <span class="dsf__card dsf__card--page" style="left: 210px; top: 20px; width: 400px; height: 520px">
                    <i style="top: 80px; width: 70%"></i>
                    <i style="top: 120px; width: 86%"></i>
                    <i style="top: 160px; width: 64%"></i>
                    <i style="top: 300px; width: 80%"></i>
                    <i style="top: 340px; width: 56%"></i>
                </span>
                <span class="dsf__card" style="left: 620px; top: 20px; width: 260px; height: 520px"></span>
                <DeskSpotlight v-bind="bindings" />
            </div>
        </div>
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="turn += 1">换一处</button>
    </LabFixtureControls>
</template>

<style scoped>
.dsf {
    display: grid;
    /* 列不按台面的 900 宽撑开（缩放不改布局尺寸），由外框按画布宽度缩。 */
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    min-height: 100%;
    padding: 24px;
    background: #1c0a0f;
}

.dsf--day {
    background: #ddd0b8;
}

.dsf__frame {
    width: 100%;
    min-width: 0;
    max-width: 900px;
}

.dsf__stage {
    position: relative;
    transform-origin: 0 0;
}

.dsf__card {
    position: absolute;
    border-radius: 10px;
    background: #2b2622;
}

.dsf__card--page {
    background: #33302b;
}

.dsf__card i {
    position: absolute;
    left: 32px;
    height: 10px;
    border-radius: 5px;
    background: #7d756a;
}

.dsf--day .dsf__card {
    background: #f4f0e8;
}

.dsf--day .dsf__card--page {
    background: #fffcf5;
}

.dsf--day .dsf__card i {
    background: #cfc6b6;
}
</style>
