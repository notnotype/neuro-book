<script setup lang="ts">
/**
 * 第一幕的案头聚光（同名 .md，w00056 t06 第 8 轮）：一张铺满舞台的 SVG，幕是一块矩形，挂一张遮罩；遮罩是白底上几块羽化过的黑（留亮的地方）。
 * 每块亮处可以再标一处鎏金标记（第 9 轮，`GildedMarks`），和幕在同一层里一起淡入淡出。
 *
 * 先后：`spots` 变了，按变化的种类走（规则在 .md）——
 * - 从无到有：亮处直接放在落点上，幕淡入（样式里的过渡）；挂载时就带着亮处的，第一帧就是落好的样子，不淡入；
 * - 块数不变：幕留着，亮处由一个补间从此刻画着的位置挪到新位置；
 * - 块数变了：幕先淡出（`SWAP_MS`），淡完再把亮处换到新位置、淡入；
 * - 变成空：幕淡出，亮处留在原地直到淡完（不然淡出的那一段幕上没有洞，整块突然一暗）。
 * 中途又变了：未走完的补间与换位都撤掉，从此刻画着的样子按新的变化重新走。
 */
import {computed, onBeforeUnmount, ref, shallowRef, useId, watch} from "vue";

import GildedMarks from "./GildedMarks.vue";
import type {GildedMark} from "./GildedMarks.vue";
import {prefersReducedMotion, SETTLE, timeScale} from "./motion";

export interface SpotRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

/** 一块亮处上的标记：元素标四角，文字按行标下划线，空的落点标落点槽。 */
export type SpotMark = "none" | "corners" | "underline" | "slot";

const props = withDefaults(defineProps<{
    spots: readonly SpotRect[];
    marks?: readonly SpotMark[];
    width: number;
    height: number;
    night?: boolean;
}>(), {marks: () => [], night: true});

const uid = useId();
const maskId = `ds-${uid}-mask`;
const featherId = `ds-${uid}-feather`;
const reduced = prefersReducedMotion();

/**
 * 亮处比要看的东西大这么一圈（px），再加羽化（标准差 6.5，糊开约 16px）：要看的东西整个落在全亮的地方。
 * 第 8 轮外扩 14、羽化约 28，太糊，两块挨着的亮处连成一片（@designer 第 9 轮）。
 */
const PAD = 10;
/** 同一件事里挪亮处、换一件事时先淡开的时长（ms）。 */
const MOVE_MS = 420;
const SWAP_MS = 240;

/** 此刻画着的几块（舞台坐标，未加外扩）与它们的标记。 */
const drawn = shallowRef<readonly SpotRect[]>([]);
const drawnMarks = shallowRef<readonly SpotMark[]>([]);
const on = ref(false);
/** 每换一次落点（不是同一件事里的挪动）加一：标记换一批 id，旧的收起、新的出现。 */
const generation = ref(0);

let frame = 0;
let swapTimer = 0;

function stop(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    if (swapTimer !== 0) clearTimeout(swapTimer);
    frame = 0;
    swapTimer = 0;
}

function place(spots: readonly SpotRect[], marks: readonly SpotMark[]): void {
    drawn.value = spots;
    drawnMarks.value = marks;
    generation.value += 1;
}

/** 从此刻画着的位置挪到 `to`（块数相同）：标记跟着挪，不重演出现。 */
function morph(to: readonly SpotRect[], marks: readonly SpotMark[]): void {
    const from = drawn.value;
    drawnMarks.value = marks;
    const start = performance.now();
    const span = MOVE_MS * timeScale();
    const step = (): void => {
        const t = SETTLE.at(Math.min(1, (performance.now() - start) / span));
        drawn.value = to.map((goal, index) => {
            const origin = from[index] ?? goal;
            return {
                left: origin.left + (goal.left - origin.left) * t,
                top: origin.top + (goal.top - origin.top) * t,
                width: origin.width + (goal.width - origin.width) * t,
                height: origin.height + (goal.height - origin.height) * t,
            };
        });
        frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
}

watch(() => [props.spots, props.marks] as const, ([spots, marks]) => {
    stop();
    if (spots.length === 0) {
        on.value = false;
        return;
    }
    if (reduced || !on.value) {
        place(spots, marks);
        on.value = true;
        return;
    }
    if (spots.length === drawn.value.length) {
        morph(spots, marks);
        return;
    }
    on.value = false;
    swapTimer = window.setTimeout(() => {
        swapTimer = 0;
        place(spots, marks);
        on.value = true;
    }, SWAP_MS * timeScale());
}, {immediate: true});

const padded = computed(() => drawn.value.map((spot) => ({x: spot.left - PAD, y: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2})));
const gilded = computed<readonly GildedMark[]>(() => drawn.value.flatMap((rect, index) => {
    const kind = drawnMarks.value[index] ?? "none";
    return kind === "none" ? [] : [{id: `${generation.value}-${index}`, kind, rect}];
}));

onBeforeUnmount(stop);
</script>

<template>
    <div class="ds" :class="{'is-on': on, 'ds--day': !night}" :style="{width: `${width}px`, height: `${height}px`}" :data-ds-on="on" :data-ds-count="on ? drawn.length : 0" aria-hidden="true">
        <svg class="ds__veil-layer" :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height">
            <defs>
                <!-- 羽化：亮处的边缘糊开约 16px（标准差的两倍半），像灯光的边，不是挖出来的框。 -->
                <filter :id="featherId" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="6.5" />
                </filter>
                <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" :width="width" :height="height">
                    <rect x="0" y="0" :width="width" :height="height" fill="white" />
                    <g :filter="`url(#${featherId})`">
                        <rect v-for="(spot, index) in padded" :key="index" :x="spot.x" :y="spot.y" :width="spot.width" :height="spot.height" rx="12" fill="black" />
                    </g>
                </mask>
            </defs>
            <rect class="ds__veil" x="0" y="0" :width="width" :height="height" :mask="`url(#${maskId})`" />
        </svg>
        <GildedMarks :marks="gilded" :day="!night" />
    </div>
</template>

<style scoped>
.ds {
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    transition: opacity 320ms cubic-bezier(0.45, 0, 0.55, 1);
    pointer-events: none;
}

.ds.is-on {
    opacity: 1;
    transition-duration: 420ms;
}

.ds__veil-layer {
    position: absolute;
    inset: 0;
    overflow: visible;
}

/*
 * 夜里压到约六成：第 8 轮的四成压在本来就暗的界面上，亮暗只差一点，开发者看着像没压（@designer 第 9 轮给 0.64，再往上才成死黑）。
 * 白天是一层深暖褐，约三成半（第 10 轮四周换成胡桃木，原来那层浅暖褐显脏，@designer 第 10 轮给 #26160c、36%）。
 */
.ds__veil {
    fill: rgb(8 4 6);
    fill-opacity: 0.62;
}

.ds--day .ds__veil {
    fill: rgb(38 22 12);
    fill-opacity: 0.36;
}

@media (prefers-reduced-motion: reduce) {
    .ds,
    .ds.is-on {
        transition: none;
    }
}
</style>
