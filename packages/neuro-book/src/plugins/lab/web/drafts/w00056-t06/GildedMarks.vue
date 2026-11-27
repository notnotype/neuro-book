<script setup lang="ts">
/**
 * 第一幕的鎏金标记（同名 .md，w00056 t06 第 9 轮）：四角、下划线、落点槽三种，取代第 8 轮贴着目标描的一圈金线框；第 13 轮
 * 第二幕添了第四种细线，把两处连起来。
 *
 * 出现与收起都写在样式里：出现是挂上时跑一遍的关键帧（`backwards`，跑完不留住变换，收起时的过渡才接得上）；
 * 收起靠 `TransitionGroup` 的离场类。离场时把元素自己的无限动画（`nudge`）停掉：Vue 按离场那一刻元素上的过渡与动画时长判断何时结束，
 * 留着 2.6 秒一圈的动画，收起就要等一整圈。外面只管给哪几处、在哪；同一个 `id` 保持挂着、只挪位置。
 */
export interface GildedRect {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface GildedMark {
    readonly id: string;
    readonly kind: "corners" | "underline" | "slot" | "thread";
    /** 标在哪；细线（`thread`）是它的一头。 */
    readonly rect: GildedRect;
    /** 细线的另一头：从 `rect` 连到 `to`，连在两块相对的两边的中点之间。别的种类不看它。 */
    readonly to?: GildedRect;
    /** 四角的臂短一些（标签这类小东西）。 */
    readonly small?: boolean;
    /** 四角出现时漾开两圈涟漪。 */
    readonly ripple?: boolean;
    /** 四角隔一会儿往右挪一下，示意能拖。 */
    readonly nudge?: boolean;
}

withDefaults(defineProps<{
    marks: readonly GildedMark[];
    day?: boolean;
}>(), {day: false});

/** 四角落在目标外面这么多（px），不压字。 */
const OUTSET = 5;
/** 下划线离字的下沿多远（px）。 */
const UNDERLINE_GAP = 2;
/** 细线的两头离两块的边多远（px），不戳进四角里。 */
const THREAD_GAP = 10;

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;

/**
 * 细线的起点、长度与角度：两块左右错开时连左右相对的两边的中点，否则连上下相对的两边。元素是一条横线，从起点按角度转过去
 * （转动的原点在左端），出现时从起点那头往另一头描出来。
 */
function thread(from: GildedRect, to: GildedRect): Record<string, string> {
    const fromCenter = {x: from.left + from.width / 2, y: from.top + from.height / 2};
    const toCenter = {x: to.left + to.width / 2, y: to.top + to.height / 2};
    const apart = to.left >= from.left + from.width || from.left >= to.left + to.width;
    const rightward = toCenter.x >= fromCenter.x;
    const downward = toCenter.y >= fromCenter.y;
    const start = apart
        ? {x: (rightward ? from.left + from.width : from.left) + (rightward ? THREAD_GAP : -THREAD_GAP), y: fromCenter.y}
        : {x: fromCenter.x, y: (downward ? from.top + from.height : from.top) + (downward ? THREAD_GAP : -THREAD_GAP)};
    const end = apart
        ? {x: (rightward ? to.left : to.left + to.width) + (rightward ? -THREAD_GAP : THREAD_GAP), y: toCenter.y}
        : {x: toCenter.x, y: (downward ? to.top : to.top + to.height) + (downward ? -THREAD_GAP : THREAD_GAP)};
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    return {left: px(start.x), top: px(start.y), width: px(length), transform: `rotate(${Math.atan2(end.y - start.y, end.x - start.x)}rad)`};
}

function box(mark: GildedMark): Record<string, string> {
    if (mark.kind === "thread") return mark.to === undefined ? {display: "none"} : thread(mark.rect, mark.to);
    const {left, top, width, height} = mark.rect;
    if (mark.kind === "corners") return {left: px(left - OUTSET), top: px(top - OUTSET), width: px(width + OUTSET * 2), height: px(height + OUTSET * 2)};
    if (mark.kind === "underline") return {left: px(left), top: px(top + height + UNDERLINE_GAP), width: px(width), "--gm-width": px(width)};
    return {left: px(left), top: px(top), width: px(width), height: px(height)};
}
</script>

<template>
    <div class="gm" :class="{'gm--day': day}" aria-hidden="true">
        <TransitionGroup name="gm">
            <div v-for="mark in marks" :key="mark.id" class="gm-mark" :class="[`gm-mark--${mark.kind}`, {'is-small': mark.small, 'is-nudging': mark.nudge}]" :style="box(mark)">
                <template v-if="mark.kind === 'corners'">
                    <i class="gm-corner gm-corner--tl"></i>
                    <i class="gm-corner gm-corner--tr"></i>
                    <i class="gm-corner gm-corner--bl"></i>
                    <i class="gm-corner gm-corner--br"></i>
                    <span v-if="mark.ripple" class="gm-ripple"></span>
                </template>
                <span v-else-if="mark.kind === 'slot'" class="gm-star"></span>
            </div>
        </TransitionGroup>
    </div>
</template>

<style scoped>
.gm {
    /* 角尖、臂端、晕：夜里是亮金（@designer 第 9 轮的数），白天换深古铜金，晕是暖白，才浮得出浅木面。 */
    --gm-tip: rgb(244 212 152 / 0.92);
    --gm-end: rgb(244 212 152 / 0.35);
    --gm-glow: rgb(226 178 98 / 0.22);
    --gm-line: rgb(240 201 135 / 0.85);
    --gm-sweep: rgb(255 240 205 / 0.95);
    --gm-ease: cubic-bezier(0.22, 1, 0.36, 1);
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.gm--day {
    --gm-tip: rgb(158 119 58 / 0.95);
    --gm-end: rgb(158 119 58 / 0.4);
    --gm-glow: rgb(255 244 220 / 0.7);
    --gm-line: rgb(150 108 46 / 0.9);
    --gm-sweep: rgb(255 248 228 / 0.95);
}

.gm-mark {
    position: absolute;
}

/* ── 四角 ── */

.gm-mark--corners {
    --gm-arm: 12px;
    border-radius: 10px;
    /* 一团暖金的晕：只是光，没有边。 */
    box-shadow: 0 0 18px 2px var(--gm-glow);
}

.gm-mark--corners.is-small {
    --gm-arm: 8px;
}

.gm-corner {
    position: absolute;
    width: var(--gm-arm);
    height: var(--gm-arm);
    border-radius: 2px;
    filter: drop-shadow(0 0 3px var(--gm-glow));
    animation:
        gm-corner-in 280ms var(--gm-ease) backwards,
        gm-breathe 2.4s ease-in-out 280ms infinite alternate;
}

/* 每只角往自己那个对角方向扣进来、散出去：方向写成 ±1，关键帧与离场共用。 */
.gm-corner--tl {
    --dx: -1;
    --dy: -1;
    top: 0;
    left: 0;
    background:
        linear-gradient(90deg, var(--gm-tip), var(--gm-end)) left top / 100% 1.5px no-repeat,
        linear-gradient(180deg, var(--gm-tip), var(--gm-end)) left top / 1.5px 100% no-repeat;
}

.gm-corner--tr {
    --dx: 1;
    --dy: -1;
    top: 0;
    right: 0;
    background:
        linear-gradient(270deg, var(--gm-tip), var(--gm-end)) right top / 100% 1.5px no-repeat,
        linear-gradient(180deg, var(--gm-tip), var(--gm-end)) right top / 1.5px 100% no-repeat;
}

.gm-corner--bl {
    --dx: -1;
    --dy: 1;
    bottom: 0;
    left: 0;
    background:
        linear-gradient(90deg, var(--gm-tip), var(--gm-end)) left bottom / 100% 1.5px no-repeat,
        linear-gradient(0deg, var(--gm-tip), var(--gm-end)) left bottom / 1.5px 100% no-repeat;
}

.gm-corner--br {
    --dx: 1;
    --dy: 1;
    right: 0;
    bottom: 0;
    background:
        linear-gradient(270deg, var(--gm-tip), var(--gm-end)) right bottom / 100% 1.5px no-repeat,
        linear-gradient(0deg, var(--gm-tip), var(--gm-end)) right bottom / 1.5px 100% no-repeat;
}

@keyframes gm-corner-in {
    from {
        opacity: 0;
        transform: translate(calc(var(--dx) * 8px), calc(var(--dy) * 8px));
    }
}

@keyframes gm-breathe {
    to {
        opacity: 0.78;
    }
}

.gm-ripple {
    position: absolute;
    inset: 0;
    border: 1px solid var(--gm-tip);
    border-radius: 9px;
    opacity: 0;
    animation: gm-ripple 1.6s var(--gm-ease) 280ms 2;
}

@keyframes gm-ripple {
    from {
        opacity: 0.7;
        transform: scale(1);
    }

    to {
        opacity: 0;
        transform: scale(1.3, 1.7);
    }
}

/* 隔一会儿往右挪一下再回来，像有人把它往右推了推（交给访客时第一章的标签）。 */
.gm-mark--corners.is-nudging {
    animation: gm-nudge 2.6s cubic-bezier(0.45, 0, 0.55, 1) 1.2s infinite;
}

@keyframes gm-nudge {
    0%,
    62%,
    100% {
        transform: translateX(0);
    }

    74% {
        transform: translateX(14px);
    }

    86% {
        transform: translateX(-2px);
    }
}

/* ── 下划线 ── */

.gm-mark--underline {
    height: 1.5px;
    background: linear-gradient(90deg, transparent, var(--gm-line) 6%, var(--gm-line) 94%, transparent);
    box-shadow: 0 0 6px var(--gm-glow);
    transform-origin: 0 50%;
    animation: gm-underline-in 320ms var(--gm-ease) backwards;
}

@keyframes gm-underline-in {
    from {
        transform: scaleX(0);
    }
}

/* 铺满以后一道亮光从左掠到右，只一次；同一批的几道同时掠过。 */
.gm-mark--underline::after {
    position: absolute;
    top: -4px;
    left: -24px;
    width: 48px;
    height: 9px;
    background: radial-gradient(closest-side, var(--gm-sweep), transparent);
    content: "";
    opacity: 0;
    animation: gm-sweep 500ms ease-in-out 320ms;
}

@keyframes gm-sweep {
    from {
        opacity: 0;
        transform: translateX(0);
    }

    20%,
    80% {
        opacity: 1;
    }

    to {
        opacity: 0;
        transform: translateX(var(--gm-width));
    }
}

/* ── 细线：一道细虚金线，从起点那头描到另一头（420ms），两头淡出 ── */

.gm-mark--thread {
    height: 0;
    border-top: 1px dashed var(--gm-line);
    filter: drop-shadow(0 0 3px var(--gm-glow));
    transform-origin: 0 50%;
    mask-image: linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent);
    animation: gm-thread-in 420ms var(--gm-ease) backwards;
}

@keyframes gm-thread-in {
    from {
        clip-path: inset(-3px 100% -3px 0);
    }

    to {
        clip-path: inset(-3px 0 -3px 0);
    }
}

/* ── 落点槽 ── */

.gm-mark--slot {
    border: 1px dashed var(--gm-tip);
    border-radius: 6px;
    background: color-mix(in srgb, var(--gm-tip) 9%, transparent);
    animation: gm-fade-in 220ms ease-out backwards;
}

.gm-star {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    background: var(--gm-tip);
    box-shadow: 0 0 6px var(--gm-glow);
    transform: translate(-50%, -50%) rotate(45deg);
}

@keyframes gm-fade-in {
    from {
        opacity: 0;
    }
}

/* ── 收起：四角往外散、别的淡掉（180ms）。写在 nudge 之后，同样的特指度下靠后的赢，离场时停掉它。 ── */

.gm-mark.gm-leave-active {
    animation: none;
    transition: opacity 180ms ease-in;
}

.gm-mark.gm-leave-to {
    opacity: 0;
}

.gm-leave-active .gm-corner {
    animation: none;
    transition:
        transform 180ms ease-in,
        opacity 180ms ease-in;
}

.gm-leave-to .gm-corner {
    opacity: 0;
    transform: translate(calc(var(--dx) * 6px), calc(var(--dy) * 6px));
}

/* 少动效：直接出现、直接消失。带上外层类，特指度压过上面的 `is-nudging` 与离场规则。 */
@media (prefers-reduced-motion: reduce) {
    .gm .gm-mark,
    .gm .gm-mark::after,
    .gm .gm-corner,
    .gm .gm-ripple {
        animation: none;
        transition: none;
    }

    .gm .gm-ripple {
        display: none;
    }
}
</style>
