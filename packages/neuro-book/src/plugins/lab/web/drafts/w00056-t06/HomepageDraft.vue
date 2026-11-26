<script setup lang="ts">
/**
 * NeuroBook 文档站首页的原型（同名 .md，w00056 t06 第 3 轮）。
 *
 * 先后：
 * 1. 挂上就画首屏的文字（0.3 秒内出现）和透明的工作台；工作台第一次排好版发 `ready`，这里量它的卡片，开场照着演。
 *    开场发 `reveal` 时工作台淡入、盖住替身；发 `done` 后拿掉开场那层。开场中途一滚动就 `finish()` 到终态。
 * 2. 滚动只改几个样式值（工作台的位移、首屏文字的淡出、光的视差），不改布局：工作台在首屏和第一幕一样大，挪动用 transform，
 *    所以滚动时工作台里面不重排，拖动的落点照常（落点按视口坐标算）。
 * 3. 第一幕的当前步由 IntersectionObserver 定：舞台中线压着哪一块。换步就打断正在演的，按 `goTo` 的规则走到那一步。
 *    每走完一步记下工作台的样子（`ends`），往回滚时换回那一份；访客动过工作台以后状态对不上记下的，先按记下的重新挂一台再接着演。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import {INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import {ACT_ONE, HEADLINES, LEDE, STEP_COPY, STEP_NUMERALS} from "./copy";
import {centerOf} from "./desk";
import type {DeskPlate, DeskSnapshot, DeskTarget, Point} from "./desk";
import HomepageDesk from "./HomepageDesk.vue";
import HomepageOpening from "./HomepageOpening.vue";
import {CARRY, DRAW, Interrupted, lerp, prefersReducedMotion, SETTLE, tween, wait} from "./motion";
import type {Ease} from "./motion";

type Opening = "unfold" | "gild" | "assemble";

const props = withDefaults(defineProps<{
    opening?: Opening;
    start?: "top" | "act-one";
    headline?: string;
}>(), {opening: "gild", start: "top", headline: "e3"});

const headline = computed(() => HEADLINES[props.headline] ?? HEADLINES.e3);
/** 首句按逗号分成几段，每段不在中间折行：窄屏上只在逗号处换行（否则会折成“都 / 从一行字开始”）。 */
const headlineParts = computed(() => (headline.value ?? "").split(/(?<=，)/u));

// ── 尺寸：自己是滚动容器，一屏的大小就是自己的大小 ──

const page = useTemplateRef<HTMLElement>("page");
const stage = useTemplateRef<HTMLElement>("stage");
const size = shallowRef({width: 1440, height: 900});
const wide = computed(() => size.value.width >= 900);
const reduced = prefersReducedMotion();

/** 工作台在首屏与第一幕的位置；两处一样大，只挪位置。窄屏时工作台钉在上面。 */
const geometry = computed(() => {
    const {width, height} = size.value;
    if (!wide.value) {
        const deskW = width - 24;
        const deskH = Math.round(height * 0.5);
        return {deskW, deskH, hero: {x: 12, y: Math.max(340, Math.round(height * 0.52))}, act: {x: 12, y: 60}, column: {x: 20, width: width - 40}, title: 30};
    }
    // 第一幕：工作台约占七成宽，左边一列约两成多，留得下 32 号的两行标题（@designer 第 3 轮看原型后的建议）。
    const deskW = Math.min(1020, Math.round(width * 0.71));
    const deskH = Math.min(640, Math.round(height * 0.71));
    const margin = 40;
    const actX = width - deskW - margin;
    return {deskW, deskH, hero: {x: Math.round((width - deskW) / 2), y: Math.round(height * 0.38)}, act: {x: actX, y: Math.round((height - deskH) / 2) + 8}, column: {x: 48, width: Math.max(220, actX - 48 - 36)}, title: Math.round(Math.min(58, Math.max(34, width * 0.04)))};
});

/** 从首屏到第一幕的进度：滚过 0.7 屏走完。 */
const progress = ref(0);
let frame = 0;
function onScroll(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const top = page.value?.scrollTop ?? 0;
        progress.value = Math.min(1, Math.max(0, top / (size.value.height * 0.7)));
        if (top > 4) openingLayer.value?.finish();
    });
}

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const pageStyle = computed(() => ({"--hp-vh": px(size.value.height), "--hp-col-x": px(geometry.value.column.x), "--hp-col-w": px(geometry.value.column.width), "--hp-title": px(geometry.value.title), "--hp-desk-x": px(geometry.value.hero.x), "--hp-desk-w": px(geometry.value.deskW)}));
const deskStyle = computed(() => {
    const {deskW, deskH, hero, act} = geometry.value;
    const eased = DRAW.at(progress.value);
    return {width: px(deskW), height: px(deskH), transform: `translate3d(${px(lerp(hero.x, act.x, eased))}, ${px(lerp(hero.y, act.y, eased))}, 0)`};
});
/** 首屏文字随滚动淡出、上移；淡没以后不再接点击（它在工作台底下）。 */
const heroStyle = computed(() => ({opacity: String(1 - Math.min(1, progress.value / 0.45)), transform: `translate3d(0, ${px(-56 * progress.value)}, 0)`, visibility: progress.value >= 0.45 ? ("hidden" as const) : ("visible" as const)}));
const lightStyle = computed(() => ({transform: `translate3d(0, ${px(-70 * progress.value)}, 0)`}));
const heroFade = computed(() => String(Math.max(0, 1 - progress.value * 3)));
const yieldStyle = computed(() => {
    const {deskW, deskH, act} = geometry.value;
    return {left: px(act.x + deskW / 2), top: px(act.y + deskH + 18)};
});

// ── 工作台与开场 ──

const desk = useTemplateRef<InstanceType<typeof HomepageDesk>>("desk");
const openingLayer = useTemplateRef<InstanceType<typeof HomepageOpening>>("openingLayer");
const deskKey = ref(0);
const restore = shallowRef<DeskSnapshot | null>(null);
const live = ref(false);
const lit = ref(false);
const sealed = ref(false);
const dimmed = ref(false);
const opening = ref<Opening | null>(null);
const plates = shallowRef<readonly DeskPlate[]>([]);
const ground = ref("transparent");

let firstReady = true;
const readyWaiters: Array<() => void> = [];

function onDeskReady(): void {
    for (const resolve of readyWaiters.splice(0)) resolve();
    if (!firstReady) return;
    firstReady = false;
    ends[0] = desk.value?.snapshot();
    if (props.start === "act-one" || reduced) {
        lit.value = true;
        live.value = true;
        if (props.start === "act-one") void nextTick(scrollToAct);
        return;
    }
    plates.value = desk.value?.plates() ?? [];
    ground.value = desk.value?.ground() ?? "transparent";
    opening.value = props.opening;
}

/** 换一台工作台（按记下的样子重新挂）：等它排好版再往下走。 */
function remount(snapshot: DeskSnapshot | null): Promise<void> {
    restore.value = snapshot;
    deskKey.value += 1;
    return new Promise((resolve) => readyWaiters.push(resolve));
}

const actHeader = useTemplateRef<HTMLElement>("actHeader");
function scrollToAct(): void {
    const header = actHeader.value;
    const scroller = page.value;
    if (header === null || scroller === null) return;
    scroller.scrollTop = header.offsetTop + header.offsetHeight / 2 - size.value.height / 2;
    onScroll();
}

// ── 金色笔尖：一支四角的小星，拿起东西时收成一粒金点；坐标是视口坐标，画的时候换成舞台里的 ──

const nib = useTemplateRef<HTMLElement>("nib");
const nibTail = useTemplateRef<HTMLElement>("nibTail");
const nibShown = ref(false);
const nibPressed = ref(false);
let nibAt: Point = {x: 0, y: 0};
let heading: Point = {x: 1, y: 0};

function toStage(point: Point): Point {
    const origin = stage.value?.getBoundingClientRect();
    return origin === undefined ? point : {x: point.x - origin.left, y: point.y - origin.top};
}

/** 画笔尖与它身后那道淡淡的尾迹（从片刻之前的位置拉到现在的位置）。 */
function drawNib(point: Point, trail: Point | null): void {
    nibAt = point;
    const local = toStage(point);
    if (nib.value !== null) nib.value.style.transform = `translate3d(${px(local.x)}, ${px(local.y)}, 0)`;
    const tail = nibTail.value;
    if (tail === null) return;
    if (trail === null) {
        tail.style.opacity = "0";
        return;
    }
    const from = toStage(trail);
    const dx = local.x - from.x;
    const dy = local.y - from.y;
    const length = Math.hypot(dx, dy);
    tail.style.opacity = length < 2 ? "0" : String(Math.min(0.75, length / 70));
    tail.style.width = px(length);
    tail.style.transform = `translate3d(${px(from.x)}, ${px(from.y)}, 0) rotate(${Math.atan2(dy, dx)}rad)`;
}

/** 一段浅弧：控制点在两端中点的法线上，往上拱，拱高取距离的一成多。 */
function arc(from: Point, to: Point): (t: number) => Point {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;
    if (ny > 0) {
        nx = -nx;
        ny = -ny;
    }
    const lift = Math.min(70, length * 0.12);
    const control = {x: (from.x + to.x) / 2 + nx * lift, y: (from.y + to.y) / 2 + ny * lift};
    return (t) => ({x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y});
}

async function glide(to: Point, duration: number, ease: Ease, signal: AbortSignal, onFrame?: (point: Point, progress: number) => void): Promise<void> {
    const from = nibAt;
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    heading = {x: (to.x - from.x) / length, y: (to.y - from.y) / length};
    const path = arc(from, to);
    await tween(duration, ease, (progressed) => {
        const point = path(progressed);
        drawNib(point, path(Math.max(0, progressed - 0.08)));
        onFrame?.(point, progressed);
    }, signal);
    drawNib(to, null);
}

async function enterNib(at: Point, signal: AbortSignal): Promise<void> {
    drawNib(at, null);
    nibShown.value = true;
    await wait(200, signal);
}

/** 按下与松开各 80ms：星收成金点、金点放回星。 */
async function press(signal: AbortSignal): Promise<void> {
    nibPressed.value = true;
    await wait(80, signal);
}
async function release(signal: AbortSignal): Promise<void> {
    nibPressed.value = false;
    await wait(80, signal);
}

/** 松手以后顺着来的方向再滑 30px，同时淡出。 */
async function leave(signal: AbortSignal): Promise<void> {
    nibShown.value = false;
    await glide({x: nibAt.x + heading.x * 30, y: nibAt.y + heading.y * 30}, 260, SETTLE, signal);
}

function hideNib(): void {
    nibShown.value = false;
    nibPressed.value = false;
    drawNib(nibAt, null);
}

// ── 第一幕的五步 ──

interface DragPlan {
    readonly from: DeskTarget;
    readonly ghost: {readonly label: string; readonly icon: string};
    readonly to: () => Point | null;
    readonly area: () => DOMRectReadOnly | null;
    readonly commit: () => void;
}

/** 四拍：瞄准（停 180ms）、按下、拖着走（近落点放慢，落点亮着停一会儿）、松手。落下后的变化是工作台自己的布局动画。 */
async function dragDemo(signal: AbortSignal, plan: DragPlan): Promise<void> {
    const source = desk.value?.target(plan.from) ?? null;
    if (source === null) {
        plan.commit();
        return;
    }
    const grab = centerOf(source);
    await enterNib({x: grab.x - 150, y: grab.y + 110}, signal);
    await glide(grab, 620, SETTLE, signal);
    await wait(180, signal);
    await press(signal);
    // 拿起来的那个变淡（同产品拖动中的来源），放下或被打断时还原。
    const lifted = desk.value?.sourceElement(plan.from) ?? null;
    if (lifted !== null) {
        lifted.style.transition = "opacity 120ms ease";
        lifted.style.opacity = "0.4";
    }
    try {
        desk.value?.showDrag({ghost: plan.ghost, at: grab, area: null});
        const destination = plan.to() ?? grab;
        let armed = false;
        await glide(destination, 940, CARRY, signal, (point, progressed) => {
            desk.value?.moveGhost(point);
            if (!armed && progressed > 0.5) {
                armed = true;
                desk.value?.showDrag({ghost: plan.ghost, at: point, area: plan.area()});
            }
        });
        await wait(360, signal);
    } finally {
        desk.value?.showDrag(null);
        if (lifted !== null) lifted.style.opacity = "";
    }
    plan.commit();
    await release(signal);
    await leave(signal);
}

function rightHalf(rect: DOMRectReadOnly | null): DOMRectReadOnly | null {
    return rect === null ? null : new DOMRectReadOnly(rect.left + rect.width / 2, rect.top, rect.width / 2, rect.height);
}

async function maximizeDemo(signal: AbortSignal): Promise<void> {
    const doubleTap = async (): Promise<void> => {
        await press(signal);
        await release(signal);
        await wait(70, signal);
        await press(signal);
        await release(signal);
    };
    const head = desk.value?.target("editor-head-blank") ?? null;
    if (head === null) return;
    const point = centerOf(head);
    await enterNib({x: point.x - 160, y: point.y + 140}, signal);
    await glide(point, 620, SETTLE, signal);
    await wait(180, signal);
    await doubleTap();
    desk.value?.setMaximized(INITIAL_EDITOR_PANEL);
    await wait(1500, signal);
    const again = desk.value?.target("editor-head-blank") ?? null;
    if (again !== null) await glide(centerOf(again), 420, SETTLE, signal);
    await wait(140, signal);
    await doubleTap();
    desk.value?.setMaximized(null);
    await wait(380, signal);
    await leave(signal);
}

/** 第五步：熄灯，按此刻的样子重新挂一台工作台（布局、标签、浮窗都从记下的那份来），再点亮。 */
async function reopenDemo(signal: AbortSignal): Promise<void> {
    dimmed.value = true;
    await wait(520, signal);
    await remount(desk.value?.snapshot() ?? null);
    await wait(260, signal);
    dimmed.value = false;
    await wait(420, signal);
}

interface Step {
    play(signal: AbortSignal): Promise<void>;
    /** 不演、直接到这一步的终态（快进与被打断时）；重复调用没有副作用。 */
    apply(): void;
}

const STEPS: readonly Step[] = [
    {
        play: (signal) => dragDemo(signal, {
            from: "chapter-two-tab",
            ghost: {label: "第二章 银钥匙", icon: "i-lucide-file-text"},
            to: () => {
                const editor = desk.value?.target("first-editor") ?? null;
                return editor === null ? null : {x: editor.left + editor.width * 0.82, y: editor.top + editor.height * 0.52};
            },
            area: () => rightHalf(desk.value?.target("first-editor-body") ?? null),
            commit: () => void desk.value?.splitRight(),
        }),
        apply: () => void desk.value?.splitRight(),
    },
    {
        play: (signal) => dragDemo(signal, {
            from: "explorer-entry",
            ghost: {label: "作品", icon: "i-lucide-files"},
            to: () => {
                const right = desk.value?.target("auxiliarybar") ?? null;
                return right === null ? null : {x: right.left + right.width / 2, y: right.top + right.height * 0.42};
            },
            area: () => desk.value?.target("auxiliarybar") ?? null,
            commit: () => void desk.value?.moveExplorer("auxiliarybar"),
        }),
        apply: () => void desk.value?.moveExplorer("auxiliarybar"),
    },
    {play: maximizeDemo, apply: () => desk.value?.setMaximized(null)},
    {
        play: (signal) => dragDemo(signal, {
            from: "alice-tab",
            ghost: {label: "艾莉丝", icon: "i-lucide-file-text"},
            to: () => {
                const landing = desk.value?.target("float-landing") ?? null;
                return landing === null ? null : {x: landing.left + 72, y: landing.top + 18};
            },
            area: () => desk.value?.target("float-landing") ?? null,
            commit: () => void desk.value?.floatAlice(),
        }),
        apply: () => void desk.value?.floatAlice(),
    },
    {play: reopenDemo, apply: () => undefined},
];

/** 当前步：-1 是首屏与这一幕的开头（工作台是首屏的样子）。 */
const current = ref(-1);
/** `ends[i]`：走完前 i 步时工作台的样子；`ends[0]` 是首屏的样子。 */
const ends: Array<DeskSnapshot | undefined> = [];
/** 工作台现在是走完了几步的样子（没被打断、访客没动过时）。 */
let completed = 0;
/** 某一步演到一半被滚动打断：工作台可能停在半路，下次先换回 `ends[completed]`。 */
let partial = false;
/** 访客动过工作台：状态和记下的对不上，下次先按记下的重新挂一台。 */
let dirty = false;
let run: AbortController | null = null;
const yielded = ref(false);
/** 第一幕此刻在做什么（只给探针读）。 */
const phase = ref("idle");
const demoEnabled = computed(() => wide.value && !reduced);

function stopRun(): void {
    run?.abort();
    run = null;
    hideNib();
    desk.value?.showDrag(null);
    dimmed.value = false;
}

/**
 * 走到第 `step` 步。先让工作台回到某一份记下的样子（访客动过就重新挂一台，演到一半就换回上一份），再分三种情况：
 * 目标是首屏时换回首屏的样子；已经走过这一步（往回滚）时换回这一步的终态，不重演；还没走到时把中间几步快进，再演这一步。
 * `replay` 是“接着看”：从这一步的开头重演；`restore` 是“摆回去”：回到记下的样子，不演。
 */
async function goTo(step: number, mode: "scroll" | "replay" | "restore" = "scroll"): Promise<void> {
    stopRun();
    yielded.value = false;
    const controller = new AbortController();
    run = controller;
    const {signal} = controller;
    const initial = ends[0];
    if (initial === undefined) return;
    try {
        if (dirty) {
            dirty = false;
            partial = false;
            completed = Math.min(completed, mode === "restore" ? step + 1 : Math.max(0, step));
            await remount(ends[completed] ?? initial);
            if (signal.aborted || mode === "restore") return;
        } else if (partial) {
            partial = false;
            desk.value?.applyDoc(ends[completed] ?? initial);
        }
        if (step < 0) {
            if (completed > 0) desk.value?.applyDoc(initial);
            completed = 0;
            return;
        }
        if (completed > step) {
            if (mode !== "replay") {
                completed = step + 1;
                desk.value?.applyDoc(ends[completed] ?? initial);
                return;
            }
            completed = step;
            desk.value?.applyDoc(ends[step] ?? initial);
            await wait(420, signal);
        }
        if (mode === "restore") return;
        while (completed < step) {
            STEPS[completed]?.apply();
            completed += 1;
            ends[completed] = desk.value?.snapshot();
            await wait(60, signal);
        }
        const target = STEPS[step];
        if (target === undefined) return;
        phase.value = `play-${step}`;
        partial = true;
        if (demoEnabled.value) await target.play(signal);
        else target.apply();
        partial = false;
        completed = step + 1;
        ends[completed] = desk.value?.snapshot();
        phase.value = `done-${step}`;
    } catch (error) {
        phase.value = error instanceof Interrupted ? "interrupted" : `error: ${String(error)}`;
        if (!(error instanceof Interrupted)) throw error;
    } finally {
        if (run === controller) run = null;
    }
}

watch(current, (step) => {
    if (!wide.value) return;
    void goTo(step);
});

/** 访客自己动了工作台：笔尖让开；在第一幕里时下面出现“接着看”“摆回去”。 */
function onVisitorTouch(): void {
    dirty = true;
    if (current.value < 0 || !demoEnabled.value) return;
    stopRun();
    yielded.value = true;
}

// ── 生命周期 ──

let resize: ResizeObserver | null = null;
let steps: IntersectionObserver | null = null;
/**
 * 拖动的落点高亮与拖影标签画在 body 下（产品的覆盖层自己传送），继承不到工作台上的变量：挂着时在根上换成金色，卸载时还原。
 * 根上的派生变量（nb-layout 的桥接变量）在根上求值，所以写在根上它们会跟着变。
 */
const DROP_VARS = {
    "--drop-area-fill": "rgb(168 118 47 / 0.18)",
    "--drop-area-border": "#a8762f",
    "--nb-layout-accent-main": "#a8762f",
    "--nb-layout-accent-text": "#6f4a17",
} as const;
const previousDropVars = new Map<string, string>();

function observeSteps(): void {
    steps?.disconnect();
    const root = page.value;
    if (root === null) return;
    steps = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) current.value = Number((entry.target as HTMLElement).dataset.hpStep ?? "-1");
    }, {root, rootMargin: wide.value ? "-49.5% 0px -49.5% 0px" : "-71% 0px -28% 0px", threshold: 0});
    for (const element of root.querySelectorAll<HTMLElement>("[data-hp-step]")) steps.observe(element);
}

onMounted(() => {
    const root = page.value;
    if (root !== null) {
        size.value = {width: root.clientWidth, height: root.clientHeight};
        resize = new ResizeObserver(() => {
            size.value = {width: root.clientWidth, height: root.clientHeight};
        });
        resize.observe(root);
    }
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(DROP_VARS)) {
        previousDropVars.set(name, style.getPropertyValue(name));
        style.setProperty(name, value);
    }
    void nextTick(observeSteps);
});
watch(wide, () => void nextTick(observeSteps));

onBeforeUnmount(() => {
    stopRun();
    resize?.disconnect();
    steps?.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    const style = document.documentElement.style;
    for (const [name, value] of previousDropVars) {
        if (value === "") style.removeProperty(name);
        else style.setProperty(name, value);
    }
});
</script>

<template>
    <!-- data-hp-current、data-hp-phase 给探针读：当前步与第一幕在做什么。 -->
    <div ref="page" class="hp" :class="{'hp--narrow': !wide}" :style="pageStyle" :data-hp-current="current" :data-hp-phase="phase" @scroll.passive="onScroll">
        <div class="hp-run">
            <div ref="stage" class="hp-stage">
                <div class="hp-light" :class="{'is-lit': lit}" :style="lightStyle" aria-hidden="true"></div>
                <div class="hp-seep" :style="{opacity: heroFade}" aria-hidden="true"></div>

                <header class="hp-nav">
                    <a class="hp-nav__brand" href="#">
                        <NeuroBookMark decorative class="hp-nav__mark" />
                        <span>NeuroBook</span>
                    </a>
                    <nav class="hp-nav__links" aria-label="站点">
                        <a href="#">文档</a>
                        <a href="#">更新日志</a>
                        <a href="#">GitHub</a>
                    </nav>
                </header>

                <!-- 首屏文字与工作台左右对齐：左边是书名页一样的两行标题和说明，右边是下载与版本（不用居中的落地页骨架）。 -->
                <section class="hp-hero" :style="heroStyle">
                    <div class="hp-hero__words">
                        <h1 class="hp-hero__title"><span v-for="part in headlineParts" :key="part" class="hp-hero__phrase">{{ part }}</span></h1>
                        <p class="hp-hero__lede">{{ LEDE }}</p>
                    </div>
                    <div class="hp-hero__side">
                        <div class="hp-hero__actions">
                            <a class="hp-cta hp-cta--primary" href="#">下载 NeuroBook</a>
                            <a class="hp-cta" href="#">在 GitHub 上看看</a>
                        </div>
                        <p class="hp-hero__note">0.17 预览版，支持 Windows 与 macOS，开源免费</p>
                    </div>
                </section>

                <div class="hp-desk" :style="deskStyle">
                    <HomepageOpening
                        v-if="opening !== null"
                        ref="openingLayer"
                        :variant="opening"
                        :plates="plates"
                        :ground="ground"
                        :width="geometry.deskW"
                        :height="geometry.deskH"
                        @light="lit = true"
                        @reveal="live = true"
                        @seal="sealed = true"
                        @done="opening = null"
                    />
                    <div class="hp-frame" :class="{'is-live': live, 'is-dimmed': dimmed, 'hp-frame--radial': opening === 'gild'}">
                        <HomepageDesk :key="deskKey" ref="desk" :restore="restore" @ready="onDeskReady" @touch="onVisitorTouch" />
                    </div>
                    <div class="hp-seal-slot" :style="{opacity: heroFade}" aria-hidden="true">
                        <span class="hp-seal" :class="{'is-stamped': sealed}">
                            <NeuroBookMark decorative class="hp-seal__mark" />
                        </span>
                    </div>
                </div>

                <div class="hp-hem" :style="{opacity: heroFade}" aria-hidden="true"></div>

                <Transition name="hp-yield">
                    <div v-if="yielded" class="hp-yield" :style="yieldStyle">
                        <button type="button" class="hp-yield__button" @click="goTo(current, 'replay')">接着看</button>
                        <button type="button" class="hp-yield__button" @click="goTo(current, 'restore')">摆回去</button>
                    </div>
                </Transition>

                <div ref="nibTail" class="hp-nib-tail" aria-hidden="true"></div>
                <div ref="nib" class="hp-nib" :class="{'is-shown': nibShown, 'is-pressed': nibPressed}" aria-hidden="true">
                    <svg class="hp-nib__star" viewBox="-12 -12 24 24">
                        <path d="M0,-11 C1.3,-2.6 2.6,-1.3 11,0 C2.6,1.3 1.3,2.6 0,11 C-1.3,2.6 -2.6,1.3 -11,0 C-2.6,-1.3 -1.3,-2.6 0,-11 Z" />
                    </svg>
                    <span class="hp-nib__dot"></span>
                </div>
            </div>

            <div class="hp-track">
                <div class="hp-track__hero" data-hp-step="-1" aria-hidden="true"></div>
                <header ref="actHeader" class="hp-act" data-hp-step="-1">
                    <p class="hp-act__number">{{ ACT_ONE.number }}</p>
                    <h2 class="hp-act__title">{{ ACT_ONE.title }}</h2>
                    <p class="hp-act__lede">{{ ACT_ONE.lede }}</p>
                </header>
                <article v-for="(step, index) in STEP_COPY" :key="step.title" class="hp-step" :class="{'is-current': index === current}" :data-hp-step="index">
                    <div class="hp-step__text">
                        <span class="hp-step__numeral">{{ STEP_NUMERALS[index] }}</span>
                        <h3 class="hp-step__title"><span v-for="part in step.title.split(/(?<=，)/u)" :key="part" class="hp-hero__phrase">{{ part }}</span></h3>
                        <p class="hp-step__body">{{ step.body }}</p>
                    </div>
                </article>
                <div class="hp-track__tail" aria-hidden="true"></div>
            </div>
        </div>

        <section class="hp-next">
            <p class="hp-act__number">第二幕</p>
            <h2 class="hp-act__title">为中文长篇做的编辑器</h2>
            <p class="hp-next__note">这一幕下一轮出稿。</p>
        </section>
    </div>
</template>

<style scoped>
/*
 * 舞台的几种颜色只在这里用（品牌标准色）：夜 #1c1418 做底，象牙 #f7f2ec 写字，金 #e1b285 与深金 #a8762f 做线和光，
 * 赤红 #871222 只给主按钮和小猫印。整页只有工作台那一块是亮的。
 */
.hp {
    --hp-ivory: #f7f2ec;
    --hp-ink: #2e211b;
    --hp-night: #1c1418;
    --hp-gold: #e1b285;
    --hp-gold-deep: #a8762f;
    --hp-crimson: #871222;
    --hp-ease: cubic-bezier(0.22, 1, 0.36, 1);
    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--hp-night);
    color: var(--hp-ivory);
    font-family: var(--font-ui);
    scrollbar-color: rgb(247 242 236 / 0.2) transparent;
}

.hp-run {
    position: relative;
}

/* 舞台钉在一屏里；它在文字列的上面（工作台要盖住窄屏时滚过的字），所以自己不接指针，只有里面能点的东西接。 */
.hp-stage {
    position: sticky;
    top: 0;
    z-index: 1;
    height: var(--hp-vh);
    overflow: hidden;
    pointer-events: none;
}

.hp-light {
    position: absolute;
    inset: -12% -10% 0;
    background:
        radial-gradient(46% 52% at 50% 0%, rgb(225 178 133 / 0.2), transparent 72%),
        radial-gradient(34% 30% at 50% 62%, rgb(255 236 210 / 0.07), transparent 70%),
        radial-gradient(80% 46% at 50% 112%, rgb(135 18 34 / 0.32), transparent 70%);
    opacity: 0.18;
    transition: opacity 600ms var(--hp-ease);
}

.hp-light.is-lit {
    opacity: 1;
}

/* 往下还有：屏幕底边透上来一线暖光，慢慢呼吸。 */
.hp-seep {
    position: absolute;
    inset: auto 0 0;
    height: 120px;
    background: linear-gradient(to top, rgb(225 178 133 / 0.12), transparent);
    animation: hp-breathe 3.6s ease-in-out infinite;
}

@keyframes hp-breathe {
    0%,
    100% {
        filter: brightness(0.7);
    }
    50% {
        filter: brightness(1.25);
    }
}

.hp-nav {
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
    padding-inline: 40px;
    pointer-events: auto;
}

.hp-nav__brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--hp-ivory);
    font-family: var(--font-display);
    font-size: 19px;
    font-weight: 500;
    text-decoration: none;
}

.hp-nav__mark {
    width: 26px;
    height: 26px;
    color: var(--hp-gold);
}

.hp-nav__links {
    display: flex;
    gap: 28px;
}

.hp-nav__links a {
    color: rgb(247 242 236 / 0.66);
    font-size: 14px;
    text-decoration: none;
    transition: color 140ms ease;
}

.hp-nav__links a:hover {
    color: var(--hp-ivory);
}

.hp-hero {
    position: absolute;
    top: calc(var(--hp-vh) * 0.1);
    left: var(--hp-desk-x);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 40px;
    width: var(--hp-desk-w);
    animation: hp-arrive 240ms ease-out both;
}

.hp-hero__words {
    min-width: 0;
}

.hp-hero__side {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: flex-end;
    padding-bottom: 4px;
}

@keyframes hp-arrive {
    from {
        opacity: 0;
    }
}

/* 一个短语一行：书名页的排法，逗号处换行。 */
.hp-hero__title {
    display: flex;
    flex-direction: column;
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--hp-title);
    font-weight: 600;
    line-height: 1.18;
    letter-spacing: 0.04em;
}

.hp-hero__phrase {
    display: inline-block;
}

.hp-hero__lede {
    max-width: 30em;
    margin: 18px 0 0;
    color: rgb(247 242 236 / 0.72);
    font-size: 17px;
    line-height: 1.75;
    text-wrap: pretty;
}

.hp-hero__actions {
    display: flex;
    gap: 12px;
    pointer-events: auto;
}

.hp-cta {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding-inline: 22px;
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px rgb(247 242 236 / 0.22);
    color: var(--hp-ivory);
    font-size: 15px;
    text-decoration: none;
    transition: box-shadow 160ms ease, background-color 160ms ease;
}

.hp-cta:hover {
    box-shadow: inset 0 0 0 1px rgb(247 242 236 / 0.42);
}

.hp-cta--primary {
    background: var(--hp-crimson);
    box-shadow: inset 0 0 0 1px rgb(225 178 133 / 0.42), 0 10px 30px -12px rgb(135 18 34 / 0.8);
}

.hp-cta--primary:hover {
    background: #9a1828;
    box-shadow: inset 0 0 0 1px rgb(225 178 133 / 0.7), 0 10px 30px -12px rgb(135 18 34 / 0.9);
}

.hp-cta:focus-visible,
.hp-nav a:focus-visible,
.hp-yield__button:focus-visible {
    outline: 2px solid var(--hp-gold);
    outline-offset: 3px;
}

.hp-hero__note {
    margin-top: 12px;
    color: rgb(247 242 236 / 0.46);
    font-size: 13px;
}

/* 工作台：首屏与第一幕一样大，只挪位置（见文件头）。 */
.hp-desk {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: auto;
    will-change: transform;
}

/* 真工作台的外框：一圈哑光金细边、一层远投影，和开场替身的桌面一模一样（HomepageOpening 的 .op__ground）。 */
.hp-frame {
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: hidden;
    border-radius: 16px;
    box-shadow: 0 0 0 1px rgb(225 178 133 / 0.34), 0 40px 90px -30px rgb(0 0 0 / 0.75);
    opacity: 0;
    transition: opacity 420ms var(--hp-ease), filter 350ms var(--hp-ease);
}

.hp-frame.is-live {
    opacity: 1;
}

.hp-frame.is-dimmed {
    opacity: 0.12;
    filter: saturate(0.6);
}

/* 金线那种开场：内容从中间向四周显出来（只在开场期间挂这条遮罩）。 */
@property --hp-reveal {
    syntax: "<percentage>";
    inherits: false;
    initial-value: 160%;
}

.hp-frame--radial.is-live {
    mask-image: radial-gradient(circle at 50% 46%, #000 calc(var(--hp-reveal) - 12%), transparent var(--hp-reveal));
    animation: hp-reveal 860ms cubic-bezier(0.65, 0, 0.35, 1) both;
}

@keyframes hp-reveal {
    from {
        --hp-reveal: 0%;
    }
    to {
        --hp-reveal: 160%;
    }
}

/* 首屏底边的收口：工作台伸出屏幕的那截渐渐没进夜色里，不在正文半行处硬切。 */
.hp-hem {
    position: absolute;
    inset: auto 0 0;
    z-index: 2;
    height: 96px;
    background: linear-gradient(to top, var(--hp-night), rgb(28 20 24 / 0));
    pointer-events: none;
}

.hp-seal-slot {
    position: absolute;
    top: -24px;
    right: -22px;
    z-index: 3;
    pointer-events: none;
}

/* 小猫印：一方赤红的印，里面一圈象牙细框和象牙色的猫（圆的像未读红点）；落下时从 1.12 压到 1，180ms。 */
.hp-seal {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border-radius: 5px;
    background: radial-gradient(circle at 40% 32%, #9c1b2b, #871222 58%, #6b0c19);
    box-shadow: inset 0 0 0 4px #871222, inset 0 0 0 5px rgb(247 242 236 / 0.7), 0 8px 18px -6px rgb(0 0 0 / 0.65);
    color: var(--hp-ivory);
    opacity: 0;
    transform: rotate(-8deg) scale(1.12);
}

.hp-seal.is-stamped {
    animation: hp-stamp 180ms cubic-bezier(0.2, 0, 0, 1) both;
}

@keyframes hp-stamp {
    from {
        opacity: 0;
        transform: rotate(-8deg) scale(1.12);
    }
    to {
        opacity: 1;
        transform: rotate(-8deg) scale(1);
    }
}

.hp-seal__mark {
    width: 32px;
    height: 32px;
}

.hp-yield {
    position: absolute;
    z-index: 3;
    display: flex;
    gap: 10px;
    transform: translateX(-50%);
    pointer-events: auto;
}

.hp-yield__button {
    height: 34px;
    padding-inline: 16px;
    border: 0;
    border-radius: 999px;
    background: rgb(247 242 236 / 0.08);
    box-shadow: inset 0 0 0 1px rgb(225 178 133 / 0.4);
    color: var(--hp-ivory);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 160ms ease;
}

.hp-yield__button:hover {
    background: rgb(247 242 236 / 0.14);
}

.hp-yield-enter-active,
.hp-yield-leave-active {
    transition: opacity 220ms var(--hp-ease), translate 220ms var(--hp-ease);
}

.hp-yield-enter-from,
.hp-yield-leave-to {
    opacity: 0;
    translate: 0 6px;
}

/* 金色笔尖：四角小星，带一点光；按下时星淡去、收成一粒暖金点。 */
.hp-nib {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 4;
    width: 0;
    height: 0;
    opacity: 0;
    transition: opacity 220ms var(--hp-ease);
}

.hp-nib.is-shown {
    opacity: 1;
}

/* 在象牙色的纸上也要看得清：一圈墨色的细影托住金色。 */
.hp-nib__star {
    position: absolute;
    left: -13px;
    top: -13px;
    width: 26px;
    height: 26px;
    fill: var(--hp-gold);
    filter: drop-shadow(0 0 0.75px rgb(46 33 27 / 0.95)) drop-shadow(0 0 7px rgb(225 178 133 / 0.7)) drop-shadow(0 1px 2px rgb(0 0 0 / 0.45));
    transition: opacity 80ms ease, transform 80ms ease;
}

.hp-nib__dot {
    position: absolute;
    left: -7px;
    top: -7px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: radial-gradient(circle, #ffe2bd 0, var(--hp-gold) 45%, var(--hp-gold-deep));
    box-shadow: 0 0 0 1.5px rgb(46 33 27 / 0.5), 0 0 14px rgb(225 178 133 / 0.9);
    opacity: 0;
    transform: scale(0.6);
    transition: opacity 80ms ease, transform 80ms ease;
}

.hp-nib.is-pressed .hp-nib__star {
    opacity: 0;
    transform: scale(0.5) rotate(45deg);
}

.hp-nib.is-pressed .hp-nib__dot {
    opacity: 1;
    transform: scale(1);
}

.hp-nib-tail {
    position: absolute;
    top: -1px;
    left: 0;
    z-index: 4;
    height: 2px;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, rgb(168 118 47 / 0.8));
    opacity: 0;
    transform-origin: 0 50%;
}

/* 文字列：首屏那一屏留空，接着是这一幕的开头与五步；当前这一步亮，别的淡。 */
.hp-track {
    position: relative;
    z-index: 0;
    margin-top: calc(var(--hp-vh) * -1);
}

.hp-track__hero {
    height: var(--hp-vh);
}

.hp-act,
.hp-step {
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-sizing: content-box;
    width: var(--hp-col-w);
    margin-inline-start: var(--hp-col-x);
    padding-inline-start: 20px;
}

.hp-act {
    min-height: calc(var(--hp-vh) * 0.8);
}

.hp-act__number {
    margin: 0;
    color: var(--hp-gold);
    font-family: var(--font-display);
    font-size: 15px;
    letter-spacing: 0.08em;
}

.hp-act__title {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: 34px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: 0.03em;
}

.hp-act__lede {
    margin: 16px 0 0;
    color: rgb(247 242 236 / 0.68);
    font-size: 16px;
    line-height: 1.85;
}

.hp-step {
    min-height: calc(var(--hp-vh) * 0.78);
    opacity: 0.32;
    transition: opacity 420ms var(--hp-ease);
}

.hp-step.is-current {
    opacity: 1;
}

.hp-step__numeral {
    color: var(--hp-gold);
    font-family: var(--font-display);
    font-size: 14px;
    letter-spacing: 0.06em;
}

/* 标题压过工作台里的正文标题：32 号衬线、逗号处换行。 */
.hp-step__title {
    display: flex;
    flex-direction: column;
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 600;
    line-height: 1.3;
}

.hp-step__body {
    margin: 16px 0 0;
    color: rgb(247 242 236 / 0.7);
    font-size: 16px;
    line-height: 1.75;
}

/* 当前这一步的文字左边一道金色细线，像夹在书里的书签带；只陪着文字，不贯穿整块。 */
.hp-step__text {
    display: flex;
    flex-direction: column;
    margin-inline-start: -20px;
    padding-inline-start: 19px;
    border-inline-start: 1px solid transparent;
    transition: border-color 420ms var(--hp-ease);
}

.hp-step.is-current .hp-step__text {
    border-inline-start-color: rgb(225 178 133 / 0.6);
}

.hp-track__tail {
    height: calc(var(--hp-vh) * 0.5);
}

.hp-next {
    position: relative;
    min-height: calc(var(--hp-vh) * 0.7);
    padding: 120px var(--hp-col-x) 0;
}

.hp-next__note {
    margin-top: 14px;
    color: rgb(247 242 236 / 0.42);
    font-size: 15px;
}

/* 窄屏：工作台钉在上面，字在下半屏滚过，滚到工作台底下就被盖住。 */
.hp--narrow .hp-nav {
    padding-inline: 20px;
}

.hp--narrow .hp-nav__links {
    gap: 16px;
}

.hp--narrow .hp-hero {
    top: 84px;
    left: 20px;
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
    width: calc(100% - 40px);
}

.hp--narrow .hp-hero__side {
    align-items: flex-start;
}

.hp--narrow .hp-hero__lede {
    font-size: 15px;
}

.hp--narrow .hp-act,
.hp--narrow .hp-step {
    min-height: calc(var(--hp-vh) * 0.62);
    justify-content: flex-end;
    padding-bottom: calc(var(--hp-vh) * 0.08);
}

.hp--narrow .hp-seal-slot {
    right: 8px;
}

@media (prefers-reduced-motion: reduce) {
    .hp-seep {
        animation: none;
    }

    .hp-frame,
    .hp-step,
    .hp-light {
        transition-duration: 1ms;
    }
}
</style>
