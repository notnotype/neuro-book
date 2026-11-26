<script setup lang="ts">
/**
 * NeuroBook 文档站首页的第 4 轮原型（同名 .md，w00056 t06）：《入殿·俯案成界》的首屏与俯冲，接着是跟着一场戏走的第一幕。
 *
 * 先后：
 * 1. 挂上就画场景（`SanctumScene` 演开场）与一台透明的真工作台；工作台排好版发 `ready`，场景才把桌子亮出来。
 * 2. 滚动只给场景一个目标进度（滚过一屏为 1），场景自己平滑地追、写变换；落地时它发 `landed`，这时工作台才接指针。
 * 3. 第一幕的当前拍由 IntersectionObserver 定（舞台中线压着哪一段）。换拍就打断正在演的，按 `goTo` 的规则走到那一拍；
 *    演之前先等落地（镜头还在推的时候量出来的位置是斜的）。每走完一拍记下工作台的样子，往回滚时换回那一份；
 *    访客动过工作台以后状态对不上记下的，先按记下的重新挂一台再接着演。规则同第 3 轮的 `HomepageDraft.vue`。
 */
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import LYRA_PEEK from "nbook/plugins/stickers/builtin/lyra/toukan.webp";
import {INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import {BEATS, HEADLINES, KNOCK_ECHOES, LEDE, SANCTUM_ACT} from "./copy";
import {centerOf} from "./desk";
import type {DeskSnapshot, DeskTarget, Point} from "./desk";
import HomepageDesk from "./HomepageDesk.vue";
import {CARRY, Interrupted, prefersReducedMotion, tween, wait} from "./motion";
import {KNOCK_ASK, KNOCK_READ, KNOCK_REPLY, KNOCK_REPLY_ID, KNOCK_TYPED, knockReply} from "./sample";
import {deskBox, SANCTUM_MIN_WIDTH} from "./sanctum";
import SanctumScene from "./SanctumScene.vue";
import {createTrail} from "./trail";
import type {Trail} from "./trail";

const props = withDefaults(defineProps<{
    start?: "top" | "act-one";
    headline?: string;
}>(), {start: "top", headline: "m2"});

const headlineParts = computed(() => (HEADLINES[props.headline] ?? HEADLINES.m2 ?? "").split(/(?<=，)/u));

// ── 尺寸与滚动：自己是滚动容器 ──

const page = useTemplateRef<HTMLElement>("page");
const stage = useTemplateRef<HTMLElement>("stage");
const size = shallowRef({width: 1440, height: 900});
const wide = computed(() => size.value.width >= SANCTUM_MIN_WIDTH);
const reduced = prefersReducedMotion();
const box = computed(() => deskBox(size.value));

/** 镜头的目标进度：滚过一屏走完。从第一幕开头起时一开始就是落地的。 */
const dive = ref(props.start === "act-one" ? 1 : 0);
let scrollFrame = 0;
function onScroll(): void {
    if (scrollFrame !== 0) return;
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const top = page.value?.scrollTop ?? 0;
        dive.value = Math.min(1, Math.max(0, top / size.value.height));
    });
}

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const pageStyle = computed(() => ({"--hs-vh": px(size.value.height), "--hs-title": px(Math.round(Math.min(62, Math.max(32, size.value.width * 0.041))))}));
/** 字幕那一条：宽屏在工作台下面；窄屏在首屏文字退场后空出来的上面。 */
const captionStyle = computed(() => {
    const {left, top, width, height} = box.value;
    return wide.value ? {left: px(left), top: px(top + height + 12), width: px(width)} : {left: px(20), top: px(64), width: px(size.value.width - 40)};
});

// ── 舞台坐标：演示量到的是视口坐标；Lab 的画布可能有 CSS zoom，换算时除掉 ──

function stageFrame(): {readonly left: number; readonly top: number; readonly zoom: number} {
    const element = stage.value;
    if (element === null) return {left: 0, top: 0, zoom: 1};
    const rect = element.getBoundingClientRect();
    return {left: rect.left, top: rect.top, zoom: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1};
}
function toStage(point: Point): Point {
    const frame = stageFrame();
    return {x: (point.x - frame.left) / frame.zoom, y: (point.y - frame.top) / frame.zoom};
}
function rectToStage(rect: DOMRectReadOnly): {left: number; top: number; width: number; height: number} {
    const frame = stageFrame();
    return {left: (rect.left - frame.left) / frame.zoom, top: (rect.top - frame.top) / frame.zoom, width: rect.width / frame.zoom, height: rect.height / frame.zoom};
}

// ── 工作台 ──

const desk = useTemplateRef<InstanceType<typeof HomepageDesk>>("desk");
const deskKey = ref(0);
const restore = shallowRef<DeskSnapshot | null>(null);
const deskReady = ref(false);
const landed = ref(false);
let firstReady = true;
const readyWaiters: Array<() => void> = [];
const landWaiters: Array<() => void> = [];

function onDeskReady(): void {
    deskReady.value = true;
    for (const resolve of readyWaiters.splice(0)) resolve();
    if (!firstReady) return;
    firstReady = false;
    ends[0] = desk.value?.snapshot();
    if (props.start === "act-one") void nextTick(() => scrollToBeat(0));
}

function onLanded(next: boolean): void {
    landed.value = next;
    if (next) for (const resolve of landWaiters.splice(0)) resolve();
}

/** 镜头还在推时量出来的位置是斜的：演示先等落地。 */
function whenLanded(signal: AbortSignal): Promise<void> {
    if (landed.value) return Promise.resolve();
    return new Promise((resolve, reject) => {
        landWaiters.push(resolve);
        signal.addEventListener("abort", () => reject(new Interrupted()), {once: true});
    });
}

/** 换一台工作台（按记下的样子重新挂）：等它排好版再往下走。 */
function remount(snapshot: DeskSnapshot | null): Promise<void> {
    restore.value = snapshot;
    deskKey.value += 1;
    return new Promise((resolve) => readyWaiters.push(resolve));
}

function scrollToBeat(beat: number): void {
    const section = page.value?.querySelector<HTMLElement>(`[data-hs-step="${beat}"]`);
    const scroller = page.value;
    if (section === null || section === undefined || scroller === null) return;
    scroller.scrollTop = section.offsetTop - size.value.height * 0.5 + 24;
    onScroll();
}

// ── 局部聚光：桌上其余地方压暗一点，被点名的那一处亮一圈金（@designer 第 4 轮：整台放大会糊字、裁掉两栏）──

const spot = shallowRef<{readonly left: number; readonly top: number; readonly width: number; readonly height: number} | null>(null);

async function spotlight(name: DeskTarget, signal: AbortSignal, hold: number): Promise<void> {
    const rect = desk.value?.target(name) ?? null;
    if (rect === null) return;
    spot.value = rectToStage(rect);
    await wait(hold, signal);
}

// ── 第一幕的“手”：金色尾迹与涟漪（取代第 3 轮的四角小星） ──

const trailCanvas = useTemplateRef<HTMLCanvasElement>("trailCanvas");
let trail: Trail | null = null;

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
    const lift = Math.min(80, length * 0.16);
    const control = {x: (from.x + to.x) / 2 + nx * lift, y: (from.y + to.y) / 2 + ny * lift};
    return (t) => ({x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y});
}

interface DragPlan {
    readonly from: DeskTarget;
    readonly ghost: {readonly label: string; readonly icon: string};
    readonly to: () => Point | null;
    readonly area: () => DOMRectReadOnly | null;
    readonly commit: () => void;
}

/** 按下（漾开一圈）、拿起（来源变淡）、拖着走（身后金色尾迹，过半时落点亮起金色）、松手（再漾一圈），之后是工作台自己的布局动画。 */
async function dragDemo(signal: AbortSignal, plan: DragPlan): Promise<void> {
    const source = desk.value?.target(plan.from) ?? null;
    if (source === null) {
        plan.commit();
        return;
    }
    const grab = centerOf(source);
    trail?.ripple(toStage(grab));
    await wait(200, signal);
    const lifted = desk.value?.sourceElement(plan.from) ?? null;
    if (lifted !== null) {
        lifted.style.transition = "opacity 120ms ease";
        lifted.style.opacity = "0.4";
    }
    const destination = plan.to() ?? grab;
    try {
        desk.value?.showDrag({ghost: plan.ghost, at: grab, area: null});
        const path = arc(grab, destination);
        let armed = false;
        // 落点一起步就亮（@designer 第 4 轮：拖到一半才亮，看着像瞬间切过去的）。
        await tween(880, CARRY, (progressed) => {
            const point = path(progressed);
            desk.value?.moveGhost(point);
            trail?.add(toStage(point));
            if (!armed && progressed > 0.08) {
                armed = true;
                desk.value?.showDrag({ghost: plan.ghost, at: point, area: plan.area()});
            }
        }, signal);
        await wait(320, signal);
    } finally {
        desk.value?.showDrag(null);
        if (lifted !== null) lifted.style.opacity = "";
    }
    plan.commit();
    trail?.ripple(toStage(destination));
    await wait(320, signal);
}

/** 双击某处：两圈涟漪，中间隔一小下。 */
async function doubleTap(name: DeskTarget, signal: AbortSignal): Promise<void> {
    const rect = desk.value?.target(name) ?? null;
    if (rect === null) return;
    const point = toStage(centerOf(rect));
    trail?.ripple(point);
    await wait(150, signal);
    trail?.ripple(point);
    await wait(160, signal);
}

/**
 * 把光标放到第五章末尾并确认焦点落下了。编辑器是异步挂上的：句柄出来以后，正文可能还在读，这时聚焦是空的，
 * 所以每次放完都看一眼焦点在不在编辑器里，不在就再放。
 */
async function focusChapterFive(signal: AbortSignal): Promise<boolean> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const placed = desk.value?.revealEnd("chapterFive") === true;
        await wait(placed ? 160 : 100, signal);
        if (placed && desk.value?.typing() === true) return true;
    }
    return false;
}

/** 第五章接着打那半句：一个字一个字，标点处停得久一些。打过了（往回滚又往下）就不重打。 */
async function typeKnock(signal: AbortSignal): Promise<void> {
    if (desk.value?.shows(KNOCK_TYPED) === true) return;
    if (!(await focusChapterFive(signal))) return;
    await wait(260, signal);
    for (const char of KNOCK_TYPED) {
        if (desk.value?.type(char) !== true) return;
        await wait("，。".includes(char) ? 340 : 62 + Math.round(Math.random() * 70), signal);
    }
}

function typeKnockNow(): void {
    if (desk.value?.shows(KNOCK_TYPED) === true) return;
    if (desk.value?.revealEnd("chapterFive") === true) desk.value.type(KNOCK_TYPED);
}

/** 第一章翻到末尾（那段同样的敲门在最后）。分组刚换过，控件可能还没挂上，等一下再试。 */
async function revealChapterOneEnd(signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 20 && desk.value?.revealEnd("chapterOne") !== true; attempt += 1) await wait(100, signal);
}

/** 作者在对话栏里问，星璃先读第一章（一条工具调用），再边打边答。 */
async function askLyra(signal: AbortSignal): Promise<void> {
    if (desk.value?.lyraHas(KNOCK_REPLY_ID) === true) return;
    desk.value?.lyraPost(KNOCK_ASK);
    await wait(900, signal);
    desk.value?.lyraPost(KNOCK_READ);
    await wait(700, signal);
    for (let shown = 0; shown < KNOCK_REPLY.length; shown += 3) {
        desk.value?.lyraPost(knockReply(KNOCK_REPLY.slice(0, shown), true));
        await wait(45, signal);
    }
    desk.value?.lyraPost(knockReply(KNOCK_REPLY, false));
}

function askLyraNow(): void {
    if (desk.value?.lyraHas(KNOCK_REPLY_ID) === true) return;
    desk.value?.lyraPost(KNOCK_ASK);
    desk.value?.lyraPost(KNOCK_READ);
    desk.value?.lyraPost(knockReply(KNOCK_REPLY, false));
}

/** 两章里那两声敲门同时描一道金：给读者一个对照的落点。 */
const marks = shallowRef<ReadonlyArray<{readonly left: number; readonly top: number; readonly width: number; readonly height: number}>>([]);

function markEchoes(): void {
    marks.value = KNOCK_ECHOES.flatMap((text) => desk.value?.textRects(text) ?? []).map(rectToStage);
}

// ── 字幕与交给访客的金环 ──

const caption = ref("");
const ring = shallowRef<{readonly left: number; readonly top: number; readonly width: number; readonly height: number} | null>(null);
const handoff = ref(false);

function markRing(name: DeskTarget): void {
    const rect = desk.value?.target(name) ?? null;
    ring.value = rect === null ? null : rectToStage(rect);
}

// ── 第一幕的三拍 ──

interface Beat {
    play(signal: AbortSignal): Promise<void>;
    /** 不演、直接到这一拍的终态（快进与被打断时）；重复调用没有副作用。 */
    apply(): void;
    /** 停在这一拍时的字幕。 */
    readonly rest: string;
}

const chapterOneDrop = (): Point | null => {
    const editor = desk.value?.target("first-editor") ?? null;
    return editor === null ? null : {x: editor.left + editor.width * 0.8, y: editor.top + editor.height * 0.5};
};
const rightHalf = (rect: DOMRectReadOnly | null): DOMRectReadOnly | null => (rect === null ? null : new DOMRectReadOnly(rect.left + rect.width / 2, rect.top, rect.width / 2, rect.height));

const BEAT_STEPS: readonly Beat[] = [
    {
        rest: BEATS.knock.closing,
        async play(signal) {
            caption.value = BEATS.knock.opening;
            await wait(700, signal);
            await typeKnock(signal);
            await wait(600, signal);
            await askLyra(signal);
            await wait(900, signal);
            caption.value = BEATS.knock.compare;
            // 第一章的标签先亮一圈金（蓄力），再被拿起来。
            await spotlight("chapter-one-tab", signal, 650);
            spot.value = null;
            await dragDemo(signal, {
                from: "chapter-one-tab",
                ghost: {label: "第一章 霜港的钟", icon: "i-lucide-file-text"},
                to: chapterOneDrop,
                area: () => rightHalf(desk.value?.target("first-editor-body") ?? null),
                commit: () => void desk.value?.splitRight("chapterOne"),
            });
            await wait(600, signal);
            await revealChapterOneEnd(signal);
            await wait(500, signal);
            markEchoes();
            caption.value = BEATS.knock.closing;
            await wait(2400, signal);
            marks.value = [];
        },
        apply() {
            typeKnockNow();
            askLyraNow();
            desk.value?.splitRight("chapterOne");
        },
    },
    {
        rest: BEATS.focus.closing,
        async play(signal) {
            caption.value = BEATS.focus.opening;
            await wait(900, signal);
            await doubleTap("editor-head-blank", signal);
            desk.value?.setMaximized(INITIAL_EDITOR_PANEL);
            await wait(1800, signal);
            await doubleTap("editor-head-blank", signal);
            desk.value?.setMaximized(null);
            caption.value = BEATS.focus.closing;
            await wait(600, signal);
        },
        apply: () => desk.value?.setMaximized(null),
    },
    {
        rest: BEATS.handoff.invite,
        async play(signal) {
            caption.value = BEATS.handoff.invite;
            await wait(300, signal);
            settleHandoff();
        },
        apply: () => settleHandoff(),
    },
];

/** 第三拍停住的样子：第一章的标签上一圈金环（轻轻往旁边挪一下，示意能拖），下面一行是邀请与下载。 */
function settleHandoff(): void {
    markRing("chapter-one-tab");
    handoff.value = true;
}

/** 当前拍：-1 是首屏与俯冲（工作台是首屏的样子）。 */
const current = ref(-1);
/** `ends[i]`：走完前 i 拍时工作台的样子；`ends[0]` 是首屏的样子。 */
const ends: Array<DeskSnapshot | undefined> = [];
let completed = 0;
let partial = false;
let dirty = false;
let run: AbortController | null = null;
const yielded = ref(false);
const phase = ref("idle");
/** 演不演：宽屏且访客没要求少动效。窄屏在 `goTo` 开头就只换字幕；少动效时直接摆到每一拍的终态。 */
const demoEnabled = computed(() => wide.value && !reduced);

function stopRun(): void {
    run?.abort();
    run = null;
    trail?.clear();
    desk.value?.showDrag(null);
    spot.value = null;
    marks.value = [];
    ring.value = null;
    handoff.value = false;
}

/** 走到第 `beat` 拍；规则同第 3 轮（见文件头）。`replay` 是“接着看”，`restore` 是“摆回去”。 */
async function goTo(beat: number, mode: "scroll" | "replay" | "restore" = "scroll"): Promise<void> {
    stopRun();
    yielded.value = false;
    // 窄屏只换字幕：工作台只有一栏宽，分栏、浮窗摆上去挤成一字一行，不如让它保持首屏的样子给访客自己上手。
    if (!wide.value) {
        caption.value = beat < 0 ? "" : (BEAT_STEPS[beat]?.rest ?? "");
        return;
    }
    const controller = new AbortController();
    run = controller;
    const {signal} = controller;
    const initial = ends[0];
    if (initial === undefined) return;
    try {
        if (dirty) {
            dirty = false;
            partial = false;
            completed = Math.min(completed, mode === "restore" ? beat + 1 : Math.max(0, beat));
            await remount(ends[completed] ?? initial);
            if (signal.aborted) return;
            if (mode === "restore") {
                caption.value = BEAT_STEPS[beat]?.rest ?? "";
                return;
            }
        } else if (partial) {
            partial = false;
            desk.value?.applyDoc(ends[completed] ?? initial);
        }
        if (beat < 0) {
            if (completed > 0) desk.value?.applyDoc(initial);
            completed = 0;
            caption.value = "";
            return;
        }
        if (completed > beat) {
            if (mode !== "replay") {
                completed = beat + 1;
                desk.value?.applyDoc(ends[completed] ?? initial);
                caption.value = BEAT_STEPS[beat]?.rest ?? "";
                if (beat === BEAT_STEPS.length - 1) settleHandoff();
                return;
            }
            completed = beat;
            desk.value?.applyDoc(ends[beat] ?? initial);
            await wait(420, signal);
        }
        if (mode === "restore") return;
        while (completed < beat) {
            BEAT_STEPS[completed]?.apply();
            completed += 1;
            ends[completed] = desk.value?.snapshot();
            await wait(60, signal);
        }
        const target = BEAT_STEPS[beat];
        if (target === undefined) return;
        if (reduced) {
            target.apply();
            caption.value = target.rest;
            completed = beat + 1;
            ends[completed] = desk.value?.snapshot();
            return;
        }
        phase.value = `land-${beat}`;
        await whenLanded(signal);
        phase.value = `play-${beat}`;
        partial = true;
        await target.play(signal);
        partial = false;
        completed = beat + 1;
        ends[completed] = desk.value?.snapshot();
        phase.value = `done-${beat}`;
    } catch (error) {
        phase.value = error instanceof Interrupted ? "interrupted" : `error: ${String(error)}`;
        if (!(error instanceof Interrupted)) throw error;
    } finally {
        if (run === controller) run = null;
    }
}

watch(current, (beat) => void goTo(beat));

/** 访客自己动了工作台：演示让开，下面出现“接着看”“摆回去”；在第三拍里只熄掉金环（已经交到访客手里了）。 */
function onVisitorTouch(): void {
    dirty = true;
    if (current.value < 0 || !demoEnabled.value) return;
    if (current.value === BEAT_STEPS.length - 1) {
        ring.value = null;
        return;
    }
    stopRun();
    caption.value = BEAT_STEPS[current.value]?.rest ?? caption.value;
    yielded.value = true;
}

// ── 生命周期 ──

let resize: ResizeObserver | null = null;
let beats: IntersectionObserver | null = null;
/** 拖动的落点与拖影画在 body 下（产品的覆盖层自己传送），继承不到页面上的变量：挂着时在根上换成金色，卸载时还原。 */
const DROP_VARS = {
    "--drop-area-fill": "rgb(225 178 133 / 0.2)",
    "--drop-area-border": "#c08a3e",
    "--nb-layout-accent-main": "#a8762f",
    "--nb-layout-accent-text": "#6f4a17",
} as const;
const previousDropVars = new Map<string, string>();

function observeBeats(): void {
    beats?.disconnect();
    const root = page.value;
    if (root === null) return;
    beats = new IntersectionObserver((entries) => {
        for (const entry of entries) if (entry.isIntersecting) current.value = Number((entry.target as HTMLElement).dataset.hsStep ?? "-1");
    }, {root, rootMargin: "-49.5% 0px -49.5% 0px", threshold: 0});
    for (const element of root.querySelectorAll<HTMLElement>("[data-hs-step]")) beats.observe(element);
}

onMounted(() => {
    const root = page.value;
    if (root !== null) {
        size.value = {width: root.clientWidth, height: root.clientHeight};
        resize = new ResizeObserver(() => {
            size.value = {width: root.clientWidth, height: root.clientHeight};
            trail?.resize(size.value.width, size.value.height);
        });
        resize.observe(root);
    }
    if (trailCanvas.value !== null) {
        trail = createTrail(trailCanvas.value);
        trail.resize(size.value.width, size.value.height);
    }
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(DROP_VARS)) {
        previousDropVars.set(name, style.getPropertyValue(name));
        style.setProperty(name, value);
    }
    void nextTick(observeBeats);
});

onBeforeUnmount(() => {
    stopRun();
    trail?.dispose();
    resize?.disconnect();
    beats?.disconnect();
    if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
    const style = document.documentElement.style;
    for (const [name, value] of previousDropVars) {
        if (value === "") style.removeProperty(name);
        else style.setProperty(name, value);
    }
});
</script>

<template>
    <div ref="page" class="hs" :class="{'hs--narrow': !wide}" :style="pageStyle" :data-hs-beat="current" :data-hs-phase="phase" :data-hs-landed="landed" @scroll.passive="onScroll">
        <div class="hs-run">
            <div ref="stage" class="hs-stage">
                <SanctumScene :progress="dive" :intro="start === 'top'" :desk-ready="deskReady" @landed="onLanded">
                    <template #desk>
                        <HomepageDesk :key="deskKey" ref="desk" setup="knock" :restore="restore" @ready="onDeskReady" @touch="onVisitorTouch" />
                    </template>
                    <template #hero="{lit}">
                        <header class="hs-nav" :class="{'is-lit': lit}">
                            <a class="hs-nav__brand" href="#">
                                <NeuroBookMark decorative class="hs-nav__mark" />
                                <span>NeuroBook</span>
                            </a>
                            <nav class="hs-nav__links" aria-label="站点">
                                <a href="#">文档</a>
                                <a href="#">更新日志</a>
                                <a href="#">GitHub</a>
                            </nav>
                        </header>
                        <section class="hs-hero" :class="{'is-lit': lit}">
                            <h1 class="hs-hero__title"><span v-for="part in headlineParts" :key="part" class="hs-hero__phrase">{{ part }}</span></h1>
                            <p class="hs-hero__lede">{{ LEDE }}</p>
                            <div class="hs-hero__actions">
                                <a class="hs-cta hs-cta--primary" href="#">下载 NeuroBook</a>
                                <a class="hs-cta" href="#">在 GitHub 上看看</a>
                            </div>
                            <p class="hs-hero__note">0.17 预览版，支持 Windows 与 macOS，开源免费</p>
                        </section>
                    </template>
                </SanctumScene>

                <canvas ref="trailCanvas" class="hs-trail" aria-hidden="true"></canvas>

                <div v-if="ring !== null" class="hs-ring" :style="{left: px(ring.left - 6), top: px(ring.top - 5), width: px(ring.width + 12), height: px(ring.height + 10)}" aria-hidden="true"></div>

                <Transition name="hs-fade">
                    <div v-if="spot !== null" class="hs-spot" :style="{left: px(spot.left - 5), top: px(spot.top - 4), width: px(spot.width + 10), height: px(spot.height + 8)}" aria-hidden="true"></div>
                </Transition>

                <Transition name="hs-fade">
                    <div v-if="marks.length > 0" class="hs-marks" aria-hidden="true">
                        <span v-for="(mark, index) in marks" :key="index" class="hs-mark" :style="{left: px(mark.left - 3), top: px(mark.top - 1), width: px(mark.width + 6), height: px(mark.height + 2)}"></span>
                    </div>
                </Transition>

                <!-- 字幕一条：上面一行是幕名，下面一行是字幕；被访客打断时按钮跟在字幕后面，交给访客时整行换成邀请与下载，始终两行。 -->
                <div class="hs-caption" :style="captionStyle" :class="{'is-shown': current >= 0}">
                    <p class="hs-caption__act">{{ SANCTUM_ACT }}</p>
                    <Transition name="hs-line" mode="out-in">
                        <div v-if="handoff" key="handoff" class="hs-caption__row">
                            <img class="hs-caption__peek" :src="LYRA_PEEK" alt="" />
                            <p class="hs-caption__line">{{ BEATS.handoff.invite }}</p>
                            <a class="hs-cta hs-cta--primary" href="#">下载 NeuroBook</a>
                            <a class="hs-cta" href="#">接着看世界引擎</a>
                        </div>
                        <div v-else :key="caption" class="hs-caption__row">
                            <p class="hs-caption__line">{{ caption }}</p>
                            <template v-if="yielded">
                                <button type="button" class="hs-cta hs-cta--small" @click="goTo(current, 'replay')">接着看</button>
                                <button type="button" class="hs-cta hs-cta--small" @click="goTo(current, 'restore')">摆回去</button>
                            </template>
                        </div>
                    </Transition>
                </div>
            </div>

            <div class="hs-track">
                <div class="hs-track__dive" data-hs-step="-1" aria-hidden="true"></div>
                <section class="hs-beat" data-hs-step="0">
                    <p class="hs-sr">{{ BEATS.knock.opening }}{{ BEATS.knock.compare }}{{ BEATS.knock.closing }}</p>
                </section>
                <section class="hs-beat" data-hs-step="1">
                    <p class="hs-sr">{{ BEATS.focus.opening }}{{ BEATS.focus.closing }}</p>
                </section>
                <section class="hs-beat hs-beat--last" data-hs-step="2">
                    <p class="hs-sr">{{ BEATS.handoff.invite }}</p>
                </section>
            </div>
        </div>

        <section class="hs-next">
            <p class="hs-next__act">第二幕</p>
            <h2 class="hs-next__title">为中文长篇做的编辑器</h2>
            <p class="hs-next__note">这一幕下一轮出稿。</p>
        </section>
    </div>
</template>

<style scoped>
/*
 * 页面自己的颜色只有几种：夜 #1c1418 做底，象牙 #f7f2ec 写字，金 #e1b285 与深金 #a8762f 做线和光，赤红 #871222 只给主按钮。
 * 场景里的材质在 `SanctumScene.vue`。
 */
.hs {
    --hs-ivory: #f7f2ec;
    --hs-gold: #e1b285;
    --hs-gold-deep: #a8762f;
    --hs-crimson: #871222;
    --hs-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --hs-serif: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    position: relative;
    width: 100%;
    height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    background: #120c10;
    color: var(--hs-ivory);
    font-family: var(--font-ui);
    scrollbar-color: rgb(247 242 236 / 0.2) transparent;
}

.hs-run {
    position: relative;
}

/* 舞台钉在一屏里，自己不接指针；能点的东西各自打开。 */
.hs-stage {
    position: sticky;
    top: 0;
    z-index: 1;
    height: var(--hs-vh);
    overflow: hidden;
    pointer-events: none;
}


/* ── 导航与首屏的字：随光依次显出 ── */

.hs-nav {
    position: absolute;
    inset: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 64px;
    padding-inline: 40px;
    opacity: 0;
    transition: opacity 900ms var(--hs-ease) 1600ms;
    pointer-events: auto;
}

.hs-nav.is-lit {
    opacity: 1;
}

.hs-nav__brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--hs-ivory);
    font-family: var(--hs-serif);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-decoration: none;
}

.hs-nav__mark {
    width: 26px;
    height: 26px;
    color: var(--hs-gold);
}

.hs-nav__links {
    display: flex;
    gap: 28px;
}

.hs-nav__links a {
    color: rgb(247 242 236 / 0.62);
    font-size: 14px;
    text-decoration: none;
    transition: color 140ms ease;
}

.hs-nav__links a:hover {
    color: var(--hs-ivory);
}

.hs-hero {
    position: absolute;
    top: calc(var(--hs-vh) * 0.13);
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(880px, 86%);
    text-align: center;
    transform: translateX(-50%);
}

.hs-hero__title,
.hs-hero__lede,
.hs-hero__actions,
.hs-hero__note {
    opacity: 0;
    filter: blur(8px);
    transform: translate3d(0, 14px, 0);
    transition:
        opacity 1000ms var(--hs-ease) var(--rise-delay),
        filter 1000ms var(--hs-ease) var(--rise-delay),
        transform 1200ms var(--hs-ease) var(--rise-delay);
}

.hs-hero.is-lit > * {
    opacity: 1;
    filter: none;
    transform: none;
}

.hs-hero__title {
    --rise-delay: 900ms;
    margin: 0;
    background: linear-gradient(180deg, #fffaf0 0%, #f6e3bf 55%, #e1b285 100%);
    background-clip: text;
    color: transparent;
    font-family: var(--hs-serif);
    font-size: var(--hs-title);
    font-weight: 600;
    letter-spacing: 0.08em;
    line-height: 1.32;
}

.hs-hero.is-lit > .hs-hero__title {
    filter: drop-shadow(0 2px 18px rgb(225 178 133 / 0.22));
}

.hs-hero__phrase {
    display: inline-block;
    white-space: nowrap;
}

.hs-hero__lede {
    --rise-delay: 1150ms;
    max-width: 34em;
    margin: 18px 0 0;
    color: rgb(247 242 236 / 0.74);
    font-size: 16.5px;
    line-height: 1.8;
}

.hs-hero__actions {
    --rise-delay: 1500ms;
    display: flex;
    gap: 14px;
    margin-top: 26px;
    pointer-events: auto;
}

.hs-hero__note {
    --rise-delay: 1650ms;
    margin: 14px 0 0;
    color: rgb(247 242 236 / 0.46);
    font-size: 13px;
}

.hs-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 42px;
    padding-inline: 22px;
    border: 1px solid rgb(225 178 133 / 0.5);
    border-radius: 999px;
    background: rgb(28 20 24 / 0.4);
    color: var(--hs-ivory);
    font: inherit;
    font-size: 14.5px;
    text-decoration: none;
    cursor: pointer;
    transition:
        background-color 160ms ease,
        border-color 160ms ease;
}

.hs-cta:hover {
    border-color: var(--hs-gold);
    background: rgb(225 178 133 / 0.12);
}

.hs-cta:focus-visible {
    outline: 2px solid var(--hs-gold);
    outline-offset: 3px;
}

.hs-cta--primary {
    border-color: rgb(225 178 133 / 0.75);
    background: linear-gradient(180deg, #9a1a2c, var(--hs-crimson));
    box-shadow:
        inset 0 1px 0 rgb(255 220 200 / 0.25),
        0 8px 24px rgb(135 18 34 / 0.35);
}

.hs-cta--primary:hover {
    background: linear-gradient(180deg, #ab2236, #92172a);
}

.hs-cta--small {
    height: 34px;
    padding-inline: 16px;
    font-size: 13.5px;
}

.hs-caption__row .hs-cta:not(.hs-cta--small) {
    height: 40px;
}

/* ── 第一幕：字幕、尾迹、星璃的气泡、金环 ── */

.hs-trail {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.hs-caption {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
    opacity: 0;
    transition: opacity 500ms var(--hs-ease);
}

.hs-caption.is-shown {
    opacity: 1;
}

.hs-caption__act {
    margin: 0;
    color: rgb(240 201 135 / 0.85);
    font-family: var(--hs-serif);
    font-size: 12px;
    letter-spacing: 0.2em;
}

.hs-caption__row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    min-height: 40px;
    pointer-events: auto;
}

.hs-caption__line {
    margin: 0;
    color: #ece4d4;
    font-family: var(--hs-serif);
    font-size: 17px;
    letter-spacing: 0.06em;
    line-height: 1.5;
}

.hs-caption__peek {
    width: 44px;
    height: 44px;
    margin-right: -4px;
}

.hs-line-enter-active,
.hs-line-leave-active {
    transition:
        opacity 260ms var(--hs-ease),
        filter 260ms var(--hs-ease),
        transform 320ms var(--hs-ease);
}

.hs-line-enter-from {
    opacity: 0;
    filter: blur(4px);
    transform: translate3d(0, 6px, 0);
}

.hs-line-leave-to {
    opacity: 0;
    filter: blur(4px);
    transform: translate3d(0, -4px, 0);
}

.hs-fade-enter-active,
.hs-fade-leave-active {
    transition: opacity 240ms ease;
}

.hs-fade-enter-from,
.hs-fade-leave-to {
    opacity: 0;
}

/* 局部聚光：被点名的那一处亮一圈金，其余地方压暗一点（巨大的外阴影铺满舞台，舞台自己裁掉）。 */
.hs-spot {
    position: absolute;
    border: 2px solid #f0c987;
    border-radius: 9px;
    box-shadow:
        0 0 0 9999px rgb(20 10 12 / 0.16),
        0 0 22px rgb(240 201 135 / 0.7);
    animation: hs-charge 650ms var(--hs-ease) both;
    pointer-events: none;
}

@keyframes hs-charge {
    0% {
        transform: scale(0.94);
        opacity: 0;
    }
    55% {
        transform: scale(1.05);
        opacity: 1;
    }
    100% {
        transform: scale(1);
    }
}

/* 两声敲门同时描金：像拿荧光笔各划一道。 */
.hs-mark {
    position: absolute;
    border-radius: 3px;
    background: rgb(240 201 135 / 0.42);
    box-shadow: 0 0 12px rgb(240 201 135 / 0.5);
    mix-blend-mode: multiply;
    animation: hs-mark 520ms var(--hs-ease) both;
    transform-origin: 0 50%;
    pointer-events: none;
}

@keyframes hs-mark {
    from {
        transform: scaleX(0);
    }
    to {
        transform: scaleX(1);
    }
}

/* 交给访客的金环：亮一些，隔一会儿往右轻轻挪一下，示意这个标签能拖走。 */
.hs-ring {
    position: absolute;
    border: 2px solid #f0c987;
    border-radius: 10px;
    box-shadow:
        0 0 0 4px rgb(240 201 135 / 0.22),
        0 0 26px rgb(240 201 135 / 0.75);
    animation: hs-nudge 2.6s var(--hs-ease) infinite;
    pointer-events: none;
}

@keyframes hs-nudge {
    0%,
    55%,
    100% {
        opacity: 0.75;
        transform: translate3d(0, 0, 0);
    }
    70% {
        opacity: 1;
        transform: translate3d(7px, 0, 0);
    }
    85% {
        opacity: 1;
        transform: translate3d(0, 0, 0);
    }
}

/* ── 滚动轨道：俯冲一段、三拍各一段（字幕在舞台上，这里的字给读屏与搜索） ── */

.hs-track__dive {
    height: calc(var(--hs-vh) * 0.65);
}

.hs-beat {
    position: relative;
    height: calc(var(--hs-vh) * 1.5);
}

.hs-beat--last {
    height: calc(var(--hs-vh) * 1.3);
}

.hs-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.hs-next {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 120px 24px 160px;
    background: #120c10;
    text-align: center;
}

.hs-next__act {
    margin: 0;
    color: rgb(225 178 133 / 0.8);
    font-family: var(--hs-serif);
    font-size: 13px;
    letter-spacing: 0.18em;
}

.hs-next__title {
    margin: 12px 0 0;
    font-family: var(--hs-serif);
    font-size: 34px;
    font-weight: 600;
    letter-spacing: 0.06em;
}

.hs-next__note {
    margin: 14px 0 0;
    color: rgb(247 242 236 / 0.5);
}

/* ── 窄屏：首屏文字在上，工作台平放在下面；字幕在首屏文字退场后的上方 ── */

.hs--narrow .hs-nav {
    height: 52px;
    padding-inline: 18px;
}

.hs--narrow .hs-nav__links {
    gap: 16px;
}

.hs--narrow .hs-hero {
    top: 68px;
    width: calc(100% - 36px);
}

.hs--narrow .hs-hero__lede {
    margin-top: 12px;
    font-size: 14.5px;
    line-height: 1.7;
}

.hs--narrow .hs-hero__actions {
    margin-top: 16px;
}

.hs--narrow .hs-hero__note {
    display: none;
}

.hs--narrow .hs-caption__line {
    font-size: 16px;
}

@media (prefers-reduced-motion: reduce) {
    .hs-hero > *,
    .hs-nav {
        transition: none;
    }

    .hs-ring,
    .hs-spot,
    .hs-mark {
        animation: none;
    }
}
</style>
