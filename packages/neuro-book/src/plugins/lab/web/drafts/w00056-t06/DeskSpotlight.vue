<script setup lang="ts">
/**
 * 第一幕的案头聚光（同名 .md，w00056 t06 第 8 轮）：一张铺满舞台的 SVG，幕是一块矩形，挂一张遮罩；遮罩是白底上几块羽化过的黑（留亮的地方）。
 *
 * 先后：`spots` 变了，按变化的种类走（规则在 .md）——
 * - 从无到有：亮处直接放在落点上，幕淡入（样式里的过渡）；挂载时就带着亮处的，第一帧就是落好的样子，不淡入；
 * - 块数不变：幕留着，亮处由一个补间从此刻画着的位置挪到新位置；
 * - 块数变了：幕先淡出（`SWAP_MS`），淡完再把亮处换到新位置、淡入；
 * - 变成空：幕淡出，亮处留在原地直到淡完（不然淡出的那一段幕上没有洞，整块突然一暗）。
 * 中途又变了：未走完的补间与换位都撤掉，从此刻画着的样子按新的变化重新走。
 */
import {computed, onBeforeUnmount, ref, shallowRef, useId, watch} from "vue";

import {prefersReducedMotion, SETTLE, timeScale} from "./motion";

export interface SpotRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

const props = withDefaults(defineProps<{
    spots: readonly SpotRect[];
    rims?: readonly number[];
    width: number;
    height: number;
    night?: boolean;
}>(), {rims: () => [], night: true});

const uid = useId();
const maskId = `ds-${uid}-mask`;
const featherId = `ds-${uid}-feather`;
const reduced = prefersReducedMotion();

/** 亮处比要看的东西大这么一圈（px），再加羽化：要看的东西整个落在全亮的地方。 */
const PAD = 14;
/** 同一件事里挪亮处、换一件事时先淡开的时长（ms）。 */
const MOVE_MS = 420;
const SWAP_MS = 240;

/** 此刻画着的几块（舞台坐标，未加外扩）与它们的细金线。 */
const drawn = shallowRef<readonly SpotRect[]>([]);
const drawnRims = shallowRef<readonly number[]>([]);
const on = ref(false);

let frame = 0;
let swapTimer = 0;

function stop(): void {
    if (frame !== 0) cancelAnimationFrame(frame);
    if (swapTimer !== 0) clearTimeout(swapTimer);
    frame = 0;
    swapTimer = 0;
}

function place(spots: readonly SpotRect[], rims: readonly number[]): void {
    drawn.value = spots;
    drawnRims.value = rims;
}

/** 从此刻画着的位置挪到 `to`（块数相同）。 */
function morph(to: readonly SpotRect[], rims: readonly number[]): void {
    const from = drawn.value;
    drawnRims.value = rims;
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

watch(() => [props.spots, props.rims] as const, ([spots, rims]) => {
    stop();
    if (spots.length === 0) {
        on.value = false;
        return;
    }
    if (reduced || !on.value) {
        place(spots, rims);
        on.value = true;
        return;
    }
    if (spots.length === drawn.value.length) {
        morph(spots, rims);
        return;
    }
    on.value = false;
    swapTimer = window.setTimeout(() => {
        swapTimer = 0;
        place(spots, rims);
        on.value = true;
    }, SWAP_MS * timeScale());
}, {immediate: true});

const padded = computed(() => drawn.value.map((spot) => ({x: spot.left - PAD, y: spot.top - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2})));
const rimmed = computed(() => drawnRims.value.flatMap((index) => {
    const spot = drawn.value[index];
    return spot === undefined ? [] : [{x: spot.left - 3, y: spot.top - 3, width: spot.width + 6, height: spot.height + 6}];
}));

onBeforeUnmount(stop);
</script>

<template>
    <svg class="ds" :class="{'is-on': on, 'ds--day': !night}" :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" :data-ds-on="on" :data-ds-count="on ? drawn.length : 0" aria-hidden="true">
        <defs>
            <!-- 羽化：亮处的边缘糊开约 28px（标准差的两倍半），像灯光的边，不是挖出来的框。 -->
            <filter :id="featherId" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="11" />
            </filter>
            <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" :width="width" :height="height">
                <rect x="0" y="0" :width="width" :height="height" fill="white" />
                <g :filter="`url(#${featherId})`">
                    <rect v-for="(spot, index) in padded" :key="index" :x="spot.x" :y="spot.y" :width="spot.width" :height="spot.height" rx="18" fill="black" />
                </g>
            </mask>
        </defs>
        <rect class="ds__veil" x="0" y="0" :width="width" :height="height" :mask="`url(#${maskId})`" />
        <rect v-for="(rim, index) in rimmed" :key="`rim-${index}`" class="ds__rim" :x="rim.x" :y="rim.y" :width="rim.width" :height="rim.height" rx="8" />
    </svg>
</template>

<style scoped>
.ds {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
    opacity: 0;
    transition: opacity 320ms cubic-bezier(0.45, 0, 0.55, 1);
    pointer-events: none;
}

.ds.is-on {
    opacity: 1;
    transition-duration: 420ms;
}

/* 夜里压到约四成；白天是一层暖褐，约两成（@designer 第 8 轮）。 */
.ds__veil {
    fill: rgb(10 5 8);
    fill-opacity: 0.4;
}

.ds--day .ds__veil {
    fill: rgb(72 46 22);
    fill-opacity: 0.2;
}

/* 核心对象的内沿：一道 1px 的暖金细线，带一点光。 */
.ds__rim {
    fill: none;
    stroke: rgb(240 201 135 / 0.82);
    stroke-width: 1;
    filter: drop-shadow(0 0 6px rgb(240 201 135 / 0.55));
}

.ds--day .ds__rim {
    stroke: rgb(150 102 36 / 0.85);
    filter: drop-shadow(0 0 5px rgb(255 236 196 / 0.9));
}

@media (prefers-reduced-motion: reduce) {
    .ds,
    .ds.is-on {
        transition: none;
    }
}
</style>
