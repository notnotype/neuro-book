<script setup lang="ts">
/**
 * 换幕时的“落印”（同名 .md，w00056 t06 第 13 轮）：正中用金线依次描出这一幕的罗马数字，副题与花饰展开；收进眉题时副题与花饰先散掉，
 * 罗马数字飞到眉题里这一幕的名字上。描线用每一笔自己的 `pathLength="1"` 加虚线偏移，按笔的先后错开；什么时候描、什么时候收、
 * 收到哪里由页面给（`state`、`dockX`、`dockY`、`dockScale`）。
 */
import {computed, useId} from "vue";

import FILIGREE from "./assets/filigree.webp";

const props = withDefaults(defineProps<{
    numeral: string;
    title: string;
    state?: "off" | "drawing" | "docked";
    /** 收进眉题时罗马数字的中心挪多少（px）、缩到多大。 */
    dockX?: number;
    dockY?: number;
    dockScale?: number;
    day?: boolean;
}>(), {state: "off", dockX: 0, dockY: -240, dockScale: 0.34, day: false});

/** 一个字形的笔画（视框高 100，宽 `width`）与它在整枚里的横向位置。 */
interface Glyph {
    readonly width: number;
    readonly strokes: readonly string[];
}

/** I：上下两道衬线夹一对细竖（先上衬线、左竖、右竖、下衬线）；V：上沿两道衬线，两道斜笔各成一对细线。 */
const GLYPHS: Readonly<Record<string, Glyph>> = {
    I: {width: 30, strokes: ["M1 4 H29", "M11 4 V96", "M19 4 V96", "M1 96 H29"]},
    V: {width: 64, strokes: ["M2 4 H24", "M40 4 H62", "M11 4 L32 96", "M53 4 L32 96", "M18 4 L32 70"]},
};
const GAP = 14;

/** 每一笔挪到它那个字形的位置，并按先后编号（描线的延迟按它错开）。 */
const strokes = computed(() => {
    let x = 0;
    let order = 0;
    const result: Array<{readonly d: string; readonly x: number; readonly order: number}> = [];
    for (const char of props.numeral.toUpperCase()) {
        const glyph = GLYPHS[char];
        if (glyph === undefined) continue;
        for (const d of glyph.strokes) result.push({d, x, order: order++});
        x += glyph.width + GAP;
    }
    return {list: result, width: Math.max(1, x - GAP)};
});

const gradient = `as-gold-${useId()}`;
/**
 * 金线从上到下的三档颜色。白天的薄暮是浅色的：夜里那套上亮下暗的金，上半截在浅底上发白，换成深一些的古金（第 13 轮之后，白天的落印
 * 第一次截图时 I 的上半截与副题都快看不见）。
 */
const gold = computed(() => (props.day ? ["#d6a043", "#a06a22", "#5e3a10"] : ["#fbe7b0", "#d9ab5c", "#9a6a26"]));
</script>

<template>
    <div class="as" :class="[`as--${state}`, {'as--day': day}]" :style="{'--as-dock-x': `${dockX}px`, '--as-dock-y': `${dockY}px`, '--as-dock-scale': String(dockScale)}" aria-hidden="true">
        <div class="as__mark">
            <svg class="as__numeral" :viewBox="`-4 -4 ${strokes.width + 8} 108`" :width="(strokes.width + 8) * 1.3" height="140">
                <defs>
                    <!--
                        渐变按用户坐标（整枚从上到下）：I 的笔画是纯横、纯竖的线，外框没有宽或没有高，按外框比例算的渐变（缺省）
                        在这样的形状上整笔不画（第 13 轮第一次截图时 II 一笔都没出来）。
                    -->
                    <linearGradient :id="gradient" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                        <stop offset="0" :stop-color="gold[0]" />
                        <stop offset="0.5" :stop-color="gold[1]" />
                        <stop offset="1" :stop-color="gold[2]" />
                    </linearGradient>
                </defs>
                <path
                    v-for="stroke in strokes.list"
                    :key="stroke.order"
                    class="as__stroke"
                    :d="stroke.d"
                    :transform="`translate(${stroke.x} 0)`"
                    :stroke="`url(#${gradient})`"
                    pathLength="1"
                    :style="{'--as-order': stroke.order}"
                />
            </svg>
            <div class="as__caption">
                <p class="as__title">{{ title }}</p>
                <img class="as__flourish" :src="FILIGREE" alt="" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.as {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
}

/* 缩放绕着罗马数字的中心（它在最上面，高 140）：收进眉题时页面量的是它的中心。 */
.as__mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    transform: none;
    transform-origin: 50% 70px;
    filter: drop-shadow(0 0 14px rgb(240 200 120 / 0.38));
}

.as__caption {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    transition: opacity 220ms ease;
}

.as__stroke {
    fill: none;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
}

.as__title {
    margin: 0;
    color: #fbf2e1;
    font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif;
    font-size: 30px;
    font-weight: 600;
    letter-spacing: 0.5em;
    text-indent: 0.5em;
    text-shadow: 0 2px 18px rgb(24 11 5 / 0.7);
    opacity: 0;
}

.as__flourish {
    width: 260px;
    height: auto;
    clip-path: inset(0 50% 0 50%);
}

/* 不画：直接消失，不放动画（往回滚时页面不落印）。印身上的过渡也关掉：刚收走又描时，不从收到半路的样子起。 */
.as--off {
    visibility: hidden;
}

.as--off .as__mark,
.as--off .as__caption {
    transition: none;
}

/* 描出来：一笔 0.36 秒，按笔的先后每笔晚 50 毫秒；副题在描到一半时从放宽的字距收拢淡入，花饰从中间展开。 */
.as--drawing .as__stroke,
.as--docked .as__stroke {
    animation: as-draw 360ms cubic-bezier(0.45, 0, 0.2, 1) calc(var(--as-order) * 50ms) both;
}

.as--drawing .as__title,
.as--docked .as__title {
    animation: as-title 560ms cubic-bezier(0.22, 1, 0.36, 1) 260ms both;
}

.as--drawing .as__flourish,
.as--docked .as__flourish {
    animation: as-flourish 620ms cubic-bezier(0.22, 1, 0.36, 1) 320ms both;
}

/* 收进眉题：副题与花饰先散掉（不然缩小以后压在工作台的标签条上），罗马数字飞到眉题里这一幕的名字上、缩到它的高、淡掉。 */
.as__mark {
    transition:
        transform 650ms cubic-bezier(0.32, 0.72, 0, 1),
        opacity 520ms ease 130ms;
}

.as--docked .as__mark {
    opacity: 0;
    transform: translate3d(var(--as-dock-x), var(--as-dock-y), 0) scale(var(--as-dock-scale));
}

.as--docked .as__caption {
    opacity: 0;
}

.as--day .as__mark {
    filter: drop-shadow(0 0 14px rgb(255 226 170 / 0.32));
}

/* 白天的副题：浅色薄暮上用深墨色，衬一圈亮光托住字形。 */
.as--day .as__title {
    color: #3a2817;
    text-shadow: 0 1px 14px rgb(255 249 238 / 0.9);
}

@keyframes as-draw {
    to {
        stroke-dashoffset: 0;
    }
}

@keyframes as-title {
    from {
        letter-spacing: 0.9em;
        text-indent: 0.9em;
        opacity: 0;
    }
    to {
        letter-spacing: 0.5em;
        text-indent: 0.5em;
        opacity: 1;
    }
}

@keyframes as-flourish {
    to {
        clip-path: inset(0 0 0 0);
    }
}

/* 少动效：不描线、不挪，整枚淡入淡出。 */
@media (prefers-reduced-motion: reduce) {
    .as--drawing .as__stroke,
    .as--docked .as__stroke {
        animation: none;
        stroke-dashoffset: 0;
    }

    .as--drawing .as__title,
    .as--docked .as__title {
        animation: none;
        opacity: 1;
    }

    .as--drawing .as__flourish,
    .as--docked .as__flourish {
        animation: none;
        clip-path: inset(0 0 0 0);
    }

    .as__mark {
        transition: opacity 400ms ease;
    }

    .as--docked .as__mark {
        transform: none;
    }

    .as--drawing .as__mark {
        animation: as-fade 400ms ease both;
    }
}

@keyframes as-fade {
    from {
        opacity: 0;
    }
}
</style>
