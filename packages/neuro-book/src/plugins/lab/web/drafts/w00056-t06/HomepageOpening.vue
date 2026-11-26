<script setup lang="ts">
/**
 * 首页原型的开场动画（同名 .md）。这一层画在真工作台的下面：真工作台先透明着排好版，这里照它的卡片摆替身；
 * 发出 `reveal` 后页面把真工作台淡入，盖在替身上，替身与真卡片同色同形，看到的只是内容出现。所以这里不用管谁盖住谁，
 * 只有要画在真工作台上面的东西（小猫印）交给页面画，经 `seal` 通知。
 *
 * 时间线都写在各自的函数里，用 WAAPI，`finish()` 一次把子树里的动画都推到终点。
 */
import {computed, onBeforeUnmount, onMounted, useTemplateRef} from "vue";

import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import type {DeskPlate} from "./desk";
import {DRAW, FLATTEN, Interrupted, SETTLE, SNAP, wait} from "./motion";

const props = defineProps<{
    variant: "unfold" | "gild" | "assemble";
    plates: readonly DeskPlate[];
    ground: string;
    width: number;
    height: number;
}>();

const emit = defineEmits<{
    (event: "light"): void;
    (event: "reveal"): void;
    (event: "seal"): void;
    (event: "done"): void;
}>();

const root = useTemplateRef<HTMLElement>("root");
const groundEl = useTemplateRef<HTMLElement>("groundEl");
const sheetEl = useTemplateRef<HTMLElement>("sheetEl");
const bookEl = useTemplateRef<HTMLElement>("bookEl");
const lidEl = useTemplateRef<HTMLElement>("lidEl");
const claspEl = useTemplateRef<HTMLElement>("claspEl");
const linesEl = useTemplateRef<SVGSVGElement>("linesEl");

/** 每个事件只发一次：演完与 `finish()` 都走这里。 */
const sent = new Set<string>();
function once(name: string, send: () => void): void {
    if (sent.has(name)) return;
    sent.add(name);
    send();
}
const fire = {
    light: () => once("light", () => emit("light")),
    reveal: () => once("reveal", () => emit("reveal")),
    seal: () => once("seal", () => emit("seal")),
    done: () => once("done", () => emit("done")),
};

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const radiusOf = (plate: DeskPlate): number => Number.parseFloat(plate.paint.radius) || 0;

/** 编辑组在前，其余按离编辑区左上角的远近：金线从编辑区起笔，书页先落正文。 */
const ordered = computed(() => {
    const editor = props.plates.find((plate) => plate.kind === "editor");
    const anchor = editor === undefined ? {x: 0, y: 0} : {x: editor.rect.left, y: editor.rect.top};
    const distance = (plate: DeskPlate): number => Math.hypot(plate.rect.left - anchor.x, plate.rect.top - anchor.y);
    return [...props.plates].sort((a, b) => (a.kind === "editor" ? 0 : 1) - (b.kind === "editor" ? 0 : 1) || distance(a) - distance(b));
});

/** 排在前面的盖在上面：书页摞在一起时，先飞走的那张在最上面。 */
function plateStyle(plate: DeskPlate, index: number): Record<string, string> {
    return {left: px(plate.rect.left), top: px(plate.rect.top), width: px(plate.rect.width), height: px(plate.rect.height), background: plate.paint.background, borderRadius: plate.paint.radius, boxShadow: plate.paint.shadow, zIndex: String(ordered.value.length - index)};
}

/** 圆角矩形的路径：从左上角起笔、顺时针，`pathLength` 归一，描边用 0 到 1 的虚线偏移。 */
function framePath(left: number, top: number, width: number, height: number, radius: number): string {
    const r = Math.min(radius, width / 2, height / 2);
    const right = left + width;
    const bottom = top + height;
    return `M${left + r},${top} H${right - r} A${r},${r} 0 0 1 ${right},${top + r} V${bottom - r} A${r},${r} 0 0 1 ${right - r},${bottom} H${left + r} A${r},${r} 0 0 1 ${left},${bottom - r} V${top + r} A${r},${r} 0 0 1 ${left + r},${top} Z`;
}

const goldPaths = computed(() => [
    ...ordered.value.filter((plate) => plate.kind !== "status").map((plate) => ({id: plate.id, d: framePath(plate.rect.left + 0.5, plate.rect.top + 0.5, plate.rect.width - 1, plate.rect.height - 1, radiusOf(plate))})),
    {id: "frame", d: framePath(0.5, 0.5, props.width - 1, props.height - 1, 16)},
]);

/** 合着的书：竖放在工作台正中偏上，宽高比近似一本精装书。展开后以书脊为原点放大到 `scale`。 */
const book = computed(() => {
    const height = Math.round(Math.min(props.height * 0.6, 380));
    const width = Math.round(height * 0.72);
    return {width, height, left: (props.width - width) / 2, top: (props.height - height) / 2 - 8, scale: Math.min(1.3, (props.height * 0.78) / height)};
});

const plateElements = (): Array<{readonly plate: DeskPlate; readonly element: HTMLElement}> =>
    ordered.value.flatMap((plate) => {
        const element = root.value?.querySelector<HTMLElement>(`[data-op-plate="${CSS.escape(plate.id)}"]`);
        return element === null || element === undefined ? [] : [{plate, element}];
    });

/** 面板从哪一边贴进来：左半边的从左，右半边的从右，底部横条从下。 */
function entryOffset(plate: DeskPlate): string {
    if (plate.kind === "status") return "translate3d(0, 36px, 0)";
    if (plate.kind === "bar") return "translate3d(-48px, 0, 0)";
    const wide = plate.rect.width > plate.rect.height * 1.6;
    if (wide && plate.rect.top > props.height * 0.55) return "translate3d(0, 40px, 0)";
    return plate.rect.left + plate.rect.width / 2 < props.width / 2 ? "translate3d(-40px, 0, 0)" : "translate3d(44px, 0, 0)";
}

const GLOW = "0 0 0 1px rgb(225 178 133 / 0.7), 0 0 24px rgb(225 178 133 / 0.3)";
const PAGE_EDGE = "0 0 0 1px rgb(46 33 27 / 0.14), 0 18px 40px -16px rgb(0 0 0 / 0.55)";

async function assemble(signal: AbortSignal): Promise<void> {
    fire.light();
    const all = plateElements();
    const editors = all.filter(({plate}) => plate.kind === "editor");
    // 正文先在暗处单独浮上来；桌面随两侧面板从正文那块向外长出来，一直是实色（半透明淡入时叠在暗底上发冷灰，象牙色的面板贴上来也看不出来）。
    const core = editors[0]?.plate.rect;
    if (core !== undefined) {
        const from = `inset(${px(core.top)} ${px(props.width - core.left - core.width)} ${px(props.height - core.top - core.height)} ${px(core.left)} round 12px)`;
        groundEl.value?.animate([{opacity: 1, clipPath: from}, {opacity: 1, clipPath: "inset(0px 0px 0px 0px round 16px)"}], {duration: 560, delay: 380, easing: SNAP.css, fill: "both"});
    }
    const others = all.filter(({plate}) => plate.kind !== "editor");
    for (const {element} of editors) element.animate([{opacity: 0, transform: "translate3d(0, 18px, 0) scale(0.985)"}, {opacity: 1, transform: "none"}], {duration: 420, easing: SETTLE.css, fill: "both"});
    others.forEach(({plate, element}, index) => {
        const delay = 450 + index * 110;
        element.animate([{opacity: 0, transform: entryOffset(plate)}, {opacity: 1, transform: "none"}], {duration: 560, delay, easing: SNAP.css, fill: "both"});
        // 落位的那一下，接缝亮一下金光就退。
        element.animate([{boxShadow: `${plate.paint.shadow === "none" ? "" : `${plate.paint.shadow}, `}${GLOW}`}, {boxShadow: plate.paint.shadow}], {duration: 520, delay: delay + 360, easing: "ease-out", fill: "backwards"});
    });
    await wait(450 + others.length * 110 + 420, signal);
    fire.reveal();
    await wait(260, signal);
    fire.seal();
    await wait(420, signal);
}

async function gild(signal: AbortSignal): Promise<void> {
    fire.light();
    const lines = [...(linesEl.value?.querySelectorAll<SVGPathElement>("path") ?? [])];
    lines.forEach((line, index) => {
        line.animate([{strokeDashoffset: 1}, {strokeDashoffset: 0}], {duration: index === 0 ? 560 : 460, delay: index === 0 ? 0 : 140 + index * 55, easing: DRAW.css, fill: "both"});
    });
    await wait(750, signal);
    // 象牙色从中间晕开：桌面与各块面板是同一张纸，一起铺（遮罩的半径是注册过的自定义属性，见样式里的 @property）。
    // 内容紧跟着纸晕开（真工作台的遮罩同形，晚 150ms），不先铺出一整块空白的纸。
    sheetEl.value?.animate([{"--op-spread": "0%"}, {"--op-spread": "170%"}], {duration: 900, easing: DRAW.css, fill: "both"});
    // 线退成面板的边：纸铺到哪，金线就淡到哪，留下的是卡片自己的边。
    linesEl.value?.animate([{opacity: 1}, {opacity: 0}], {duration: 520, delay: 220, easing: "ease-out", fill: "forwards"});
    await wait(150, signal);
    fire.reveal();
    await wait(600, signal);
    fire.seal();
    await wait(500, signal);
}

async function unfold(signal: AbortSignal): Promise<void> {
    const {width, height, scale} = book.value;
    fire.light();
    bookEl.value?.animate([{opacity: 0, transform: "translate3d(0, 18px, 0) rotateX(16deg) scale(1)"}, {opacity: 1, transform: "translate3d(0, 0, 0) rotateX(7deg) scale(1)"}], {duration: 450, easing: SETTLE.css, fill: "both"});
    await wait(700, signal);
    claspEl.value?.animate([{opacity: 1, transform: "translate3d(0, -50%, 0)"}, {opacity: 0, transform: "translate3d(10px, -50%, 0)"}], {duration: 180, easing: SETTLE.css, fill: "both"});
    // 封面绕书脊翻开；整本书同时右移半个书宽（书脊落到正中）、放平、放大。
    lidEl.value?.animate([{transform: "rotateY(0deg)"}, {transform: "rotateY(-180deg)"}], {duration: 760, delay: 80, easing: FLATTEN.css, fill: "both"});
    bookEl.value?.animate([{transform: "translate3d(0, 0, 0) rotateX(7deg) scale(1)"}, {transform: `translate3d(${px(width / 2)}, 0, 0) rotateX(0deg) scale(${scale})`}], {duration: 850, delay: 60, easing: FLATTEN.css, fill: "both"});
    await wait(850, signal);
    // 书页飞向各块面板：从展开后右页的位置出发，正文那页先走，其余每页晚 80ms。
    const page = {left: props.width / 2, top: book.value.top + height / 2 - (height * scale) / 2, width: width * scale, height: height * scale};
    // 桌面从右页那块长出来、一直是实色（半透明淡入时叠在暗底上发冷灰）；书同时淡去，封面的里子不和桌面抢颜色。
    const from = `inset(${px(page.top)} ${px(props.width - page.left - page.width)} ${px(props.height - page.top - page.height)} ${px(page.left)} round 3px)`;
    groundEl.value?.animate([{opacity: 1, clipPath: from}, {opacity: 1, clipPath: "inset(0px 0px 0px 0px round 16px)"}], {duration: 620, easing: SETTLE.css, fill: "both"});
    plateElements().forEach(({plate, element}, index) => {
        // 飞着的时候每张纸带一圈细边和一层投影，分得清是几张；落位时换成真卡片的投影。
        element.animate([
            {opacity: 1, left: px(page.left), top: px(page.top), width: px(page.width), height: px(page.height), borderRadius: "3px", boxShadow: PAGE_EDGE},
            {opacity: 1, boxShadow: PAGE_EDGE, offset: 0.7},
            {opacity: 1, left: px(plate.rect.left), top: px(plate.rect.top), width: px(plate.rect.width), height: px(plate.rect.height), borderRadius: plate.paint.radius, boxShadow: plate.paint.shadow},
        ], {duration: 660, delay: index * 80, easing: SETTLE.css, fill: "both"});
    });
    bookEl.value?.animate([{opacity: 1}, {opacity: 0}], {duration: 300, easing: "ease-out", fill: "forwards"});
    await wait(560, signal);
    fire.reveal();
    await wait(420, signal);
}

const controller = new AbortController();

/** 直接到终态：动画推到终点，没发的事件按顺序补发。 */
function finish(): void {
    controller.abort();
    for (const animation of root.value?.getAnimations({subtree: true}) ?? []) animation.finish();
    fire.light();
    fire.reveal();
    if (props.variant !== "unfold") fire.seal();
    fire.done();
}

onMounted(() => {
    const run = props.variant === "unfold" ? unfold : props.variant === "gild" ? gild : assemble;
    run(controller.signal).then(() => fire.done(), (error: unknown) => {
        if (!(error instanceof Interrupted)) throw error;
    });
});

onBeforeUnmount(() => controller.abort());

defineExpose({finish});
</script>

<template>
    <div ref="root" class="op" :class="`op--${props.variant}`" :style="{width: px(props.width), height: px(props.height)}" aria-hidden="true">
        <div ref="sheetEl" class="op__sheet">
            <div ref="groundEl" class="op__ground" :style="{background: props.ground}"></div>
            <div v-for="(plate, index) in ordered" :key="plate.id" class="op__plate" :data-op-plate="plate.id" :style="plateStyle(plate, index)"></div>
        </div>
        <div v-if="props.variant === 'unfold'" class="op__book-stage">
            <div ref="bookEl" class="op__book" :style="{left: px(book.left), top: px(book.top), width: px(book.width), height: px(book.height)}">
                <div class="op__page"></div>
                <div ref="lidEl" class="op__lid">
                    <div class="op__cover">
                        <span class="op__cover-frame"></span>
                        <NeuroBookMark decorative class="op__cover-mark" />
                        <span class="op__cover-title">NeuroBook</span>
                        <span class="op__cover-rule"></span>
                    </div>
                    <div class="op__endpaper"></div>
                </div>
                <span ref="claspEl" class="op__clasp"></span>
            </div>
        </div>
        <svg v-if="props.variant === 'gild'" ref="linesEl" class="op__lines" :viewBox="`0 0 ${props.width} ${props.height}`" :width="props.width" :height="props.height">
            <path v-for="line in goldPaths" :key="line.id" :d="line.d" pathLength="1" />
        </svg>
    </div>
</template>

<style scoped>
.op {
    position: absolute;
    inset: 0 auto auto 0;
    pointer-events: none;
}

/* 替身的桌面：和真工作台的外框同色、同圆角、同一圈金色细边与投影（见 HomepageDraft 的 .hp-frame）。 */
.op__ground {
    position: absolute;
    inset: 0;
    border-radius: 16px;
    box-shadow: 0 0 0 1px rgb(225 178 133 / 0.34), 0 40px 90px -30px rgb(0 0 0 / 0.75);
    opacity: 0;
}

.op__plate {
    position: absolute;
    opacity: 0;
    z-index: 2;
}

.op__sheet {
    position: absolute;
    inset: 0;
    z-index: 2;
}

/*
 * 金线勾边：桌面与面板先摆好，被一张从中间晕开的遮罩挡着；描完边以后遮罩的半径从 0 放到 170%。
 * 半径用注册过的自定义属性，WAAPI 才能在关键帧之间插值。
 */
@property --op-spread {
    syntax: "<percentage>";
    inherits: false;
    initial-value: 170%;
}

.op--gild .op__sheet {
    --op-spread: 0%;
    mask-image: radial-gradient(circle at 50% 46%, #000 calc(var(--op-spread) - 12%), transparent var(--op-spread));
}

.op--gild .op__plate,
.op--gild .op__ground {
    opacity: 1;
}

.op__lines {
    position: absolute;
    inset: 0;
    z-index: 3;
    overflow: visible;
    fill: none;
    stroke: #e1b285;
    stroke-width: 1;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    filter: drop-shadow(0 0 3px rgb(225 178 133 / 0.45));
}

.op__book-stage {
    position: absolute;
    inset: 0;
    z-index: 1;
    perspective: 1600px;
}

.op__book {
    position: absolute;
    transform-origin: 0% 50%;
    transform-style: preserve-3d;
    opacity: 0;
}

/* 右页：封面翻开后露出来的那页，书页飞走时它被同样位置的替身接过去。 */
.op__page {
    position: absolute;
    inset: 0;
    border-radius: 2px 4px 4px 2px;
    background: linear-gradient(90deg, #efe6d6 0, #fbf6ec 6%, #fffcf5 40%);
    box-shadow: 0 30px 60px -28px rgb(0 0 0 / 0.7), inset -3px 0 0 #e6dccb, inset -6px 0 0 #f3ecdf;
}

.op__lid {
    position: absolute;
    inset: 0;
    transform-origin: 0% 50%;
    transform-style: preserve-3d;
}

.op__cover,
.op__endpaper {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    border-radius: 3px 6px 6px 3px;
}

/* 封面：赤红的布面，顶上那束光在布面上留一片亮，金色只用在细框、猫与书名上。 */
.op__cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background:
        radial-gradient(120% 70% at 50% 0%, rgb(255 214 170 / 0.16), transparent 60%),
        linear-gradient(90deg, #5e0b17 0, #7a101f 5%, #871222 12%, #831121 100%);
    box-shadow: 0 34px 70px -26px rgb(0 0 0 / 0.8), inset 0 0 0 1px rgb(0 0 0 / 0.25);
    color: #e1b285;
}

.op__cover-frame {
    position: absolute;
    inset: 16px 16px 16px 22px;
    border: 1px solid rgb(225 178 133 / 0.55);
    border-radius: 2px;
    box-shadow: inset 0 0 0 4px transparent, inset 0 0 0 5px rgb(225 178 133 / 0.28);
}

.op__cover-mark {
    width: 64px;
    height: 64px;
    filter: drop-shadow(0 1px 0 rgb(0 0 0 / 0.35));
}

.op__cover-title {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-shadow: 0 1px 0 rgb(0 0 0 / 0.35);
}

.op__cover-rule {
    width: 54px;
    height: 1px;
    background: rgb(225 178 133 / 0.6);
}

/* 封面的里子：翻过去以后在书脊左边。 */
.op__endpaper {
    transform: rotateY(180deg);
    background: linear-gradient(270deg, #4f0912 0, #6a0d1a 8%, #741020 100%);
    box-shadow: inset 0 0 0 10px #741020, inset 0 0 0 11px rgb(225 178 133 / 0.35);
}

/* 书扣：右缘正中一枚金扣，翻开前先弹开。 */
.op__clasp {
    position: absolute;
    top: 50%;
    right: -6px;
    width: 14px;
    height: 38px;
    border-radius: 3px;
    background: linear-gradient(180deg, #f0cfa4, #b98a4c);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.45);
    transform: translate3d(0, -50%, 0);
}

@media (prefers-reduced-motion: reduce) {
    .op {
        display: none;
    }
}
</style>
