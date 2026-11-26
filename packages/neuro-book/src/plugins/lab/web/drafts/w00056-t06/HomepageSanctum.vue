<script setup lang="ts">
/**
 * NeuroBook 文档站首页的原型（同名 .md，w00056 t06 第 6 轮）：《入殿·俯案成界》的首屏与俯冲，接着是跟着一场戏走的第一幕。
 *
 * 先后：
 * 1. 挂上就画场景（`SanctumScene` 演开场）与一台透明的真工作台；工作台排好版发 `ready`，场景才把桌子亮出来。
 *    挂着时在根上换成夜间配色（缺省；访客可以切回昼），卸载时还原：主题有一批变量在根上从配色派生，只改工作台那一棵子树跟不上。
 * 2. 滚动只给场景一个目标进度（滚过一屏为 1），场景自己平滑地追、写变换；落地时它发 `landed`，这时工作台才接指针。
 * 3. 第一幕：滚动只决定停在哪一拍，动画只负责从上一拍的终态走到这一拍的终态（导演在 `act-one.ts`，规则写在那里）。
 *    舞台中线压着哪一段由 IntersectionObserver 定，交给导演；演之前先等落地（镜头还在推的时候量出来的位置是斜的）。
 *    演示的拖动、双击、点菜单都是合成的指针事件，走产品真的手势（`demo-pointer.ts`），拖动是实时布局；被打断时没松开的那一下撤下。
 *    往回滚、访客动过以后换拍，按记下的终态摆回去：能就地摆就走产品的布局动画，正文对不上才重新挂一台。
 */
import {applyColorwayVars, NB_UI_COLORWAY_HOST_CLASS} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import {INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import {createActOne} from "./act-one";
import FILIGREE from "./assets/filigree.webp";
import LYRA_PEEK from "./assets/lyra-toukan.webp";
import {BEATS, HANDOFF, HEADLINES, KNOCK_ECHOES, KNOCK_NOTE, LEDE, SANCTUM_ACT, TAGLINE} from "./copy";
import type {BeatCopy} from "./copy";
import type {DemoPointer} from "./demo-pointer";
import {centerOf} from "./desk";
import type {DeskSnapshot, DeskTarget, Point} from "./desk";
import HomepageDesk from "./HomepageDesk.vue";
import {CARRY, Interrupted, prefersReducedMotion, SETTLE, tween, wait} from "./motion";
import type {Ease} from "./motion";
import {KNOCK_ASK, KNOCK_READ, KNOCK_REPLY, KNOCK_REPLY_ID, KNOCK_TYPED, knockReply} from "./sample";
import type {OpenFile} from "./sample";
import {deskBox, SANCTUM_MIN_WIDTH} from "./sanctum";
import SanctumScene from "./SanctumScene.vue";
import {createTrail} from "./trail";
import type {Trail} from "./trail";

const props = withDefaults(defineProps<{
    start?: "top" | "act-one";
    headline?: string;
    /** 一开始是夜还是昼（访客之后可以切换）；缺省夜（开发者第 4 轮定）。 */
    appearance?: "night" | "day";
}>(), {start: "top", headline: "e3", appearance: "night"});

const headlineParts = computed(() => (HEADLINES[props.headline] ?? HEADLINES.e3 ?? "").split(/(?<=，)/u));

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
const pageStyle = computed(() => ({"--hs-vh": px(size.value.height), "--hs-title": px(Math.round(Math.min(60, Math.max(32, size.value.width * 0.04))))}));
/** 字幕那一条：宽屏在工作台下面；窄屏在首屏文字退场后空出来的上面。 */
const captionStyle = computed(() => {
    const {left, top, width, height} = box.value;
    return wide.value ? {left: px(left), top: px(top + height + 10), width: px(width)} : {left: px(20), top: px(60), width: px(size.value.width - 40)};
});

// ── 夜间配色：缺省夜，写在根上；卸载时把原来的值放回去 ──

const night = ref(props.appearance === "night");
/**
 * 配色写在哪几层：根，加上页面往上每一个带配色宿主 class 的元素（Lab 的宿主在 html 与 body 上各套了一份，
 * 只改根的话 body 上那份昼的变量会盖住）。每一层记下原来的内联值与明暗，卸载时逐个放回。
 */
let savedHosts: Array<{readonly host: HTMLElement; readonly appearance: string | undefined; readonly vars: ReadonlyMap<string, string>}> = [];

function colorwayHosts(): HTMLElement[] {
    const hosts = new Set<HTMLElement>([document.documentElement]);
    for (let node = page.value?.parentElement ?? null; node !== null; node = node.parentElement) if (node.classList.contains(NB_UI_COLORWAY_HOST_CLASS)) hosts.add(node);
    return [...hosts];
}

function paintRoot(dark: boolean): void {
    const vars = nbookTheme.colorways?.[dark ? "nbook-dark" : "nbook-light"];
    if (vars === undefined) return;
    if (savedHosts.length === 0) savedHosts = colorwayHosts().map((host) => ({host, appearance: host.dataset.nbAppearance, vars: new Map(Object.keys(vars).map((key) => [key, host.style.getPropertyValue(key)]))}));
    for (const {host} of savedHosts) {
        if (host === document.documentElement || host.dataset.nbAppearance !== undefined) host.dataset.nbAppearance = dark ? "dark" : "light";
        applyColorwayVars(host, vars);
    }
}

function restoreRoot(): void {
    for (const {host, appearance, vars} of savedHosts) {
        for (const [key, value] of vars) {
            if (value === "") host.style.removeProperty(key);
            else host.style.setProperty(key, value);
        }
        if (appearance === undefined) delete host.dataset.nbAppearance;
        else host.dataset.nbAppearance = appearance;
    }
    savedHosts = [];
}

watch(night, (dark) => paintRoot(dark));

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
type StageRect = {readonly left: number; readonly top: number; readonly width: number; readonly height: number};
function rectToStage(rect: DOMRectReadOnly): StageRect {
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
    // 首屏的样子（存过盘的）交给导演，它才开始；从第一幕开头起时再滚到第一拍。
    void desk.value?.snapshotSaved().then((initial) => {
        director.prime(initial);
        if (props.start === "act-one") void nextTick(() => scrollToBeat(0));
    });
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

// ── 第一幕的“手”：一支金色的指针，身后金色尾迹，按下处漾开一圈。按下、拖动、松开都真的发给工作台（`demo-pointer.ts`） ──

const trailCanvas = useTemplateRef<HTMLCanvasElement>("trailCanvas");
let trail: Trail | null = null;
const pointer = useTemplateRef<HTMLElement>("pointer");
const pointerShown = ref(false);
const pointerPressed = ref(false);
let pointerAt: Point = {x: 0, y: 0};

function placePointer(point: Point): void {
    pointerAt = point;
    const local = toStage(point);
    if (pointer.value !== null) pointer.value.style.transform = `translate3d(${px(local.x)}, ${px(local.y)}, 0)`;
}

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

/** 演示指针：工作台挂上以后才有。 */
const hand = (): DemoPointer | null => desk.value?.pointer() ?? null;

/** 指针从旁边滑到目标上（没显示时先在目标左下方现身）。 */
async function reach(target: Point, signal: AbortSignal): Promise<void> {
    if (!pointerShown.value) {
        placePointer({x: target.x - 140, y: target.y + 120});
        pointerShown.value = true;
        await wait(180, signal);
    }
    const path = arc(pointerAt, target);
    await tween(700, SETTLE, (t) => placePointer(path(t)), signal);
}

function hidePointer(): void {
    pointerShown.value = false;
    pointerPressed.value = false;
}

/** 按下处漾一圈（按、点、松开都有）。 */
function ripple(point: Point): void {
    trail?.ripple(toStage(point));
}

/**
 * 拖着走一段：指针沿直线移过去，一路把移动发给工作台（实时布局跟着排），身后一道金色尾迹。
 * 落点都在起拖前量好就不再改：产品判定落点用的是拿起前的布局（预览只给渲染），预览一排开，再量的位置就对不上判定了
 * （第 6 轮第一次试时边走边量，第一组一收窄，指针跟着退回了它的中央）。
 */
async function carry(from: Point, to: Point, ease: Ease, signal: AbortSignal): Promise<Point> {
    const ms = Math.min(900, Math.max(320, Math.hypot(to.x - from.x, to.y - from.y) * 1.1));
    await tween(ms, ease, (t) => {
        const at = {x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t};
        placePointer(at);
        hand()?.move(at);
        trail?.add(toStage(at));
    }, signal);
    return to;
}

/**
 * 一次真的拖动，放慢讲清楚：指针滑到来源上、停一下；按下；经过几个路点拖到落点（实时布局一路排）；在落点上停一下再松手，
 * 之后是产品自己的落位动画。来源量不到时返回 false，由调用方直接摆。被打断时没松开的那一下由 `tidy` 撤下（拖动取消，布局回到按下前）。
 *
 * 路点（`via`）是为实时布局的预览挑的路：落点停稳约 150ms 预览才排开（nb-layout 的 `LIVE_SETTLE_MS`），指针在别的分区里停久了，
 * 布局会先排成那一边再换过来。所以路点都选在不排布局的地方（标签条里、不收这个标签的面板上），穿过别的分区那一段走得快（先快后慢）。
 */
async function drag(from: DeskTarget | (() => DOMRectReadOnly | null), to: () => Point | null, signal: AbortSignal, options: {readonly hold?: number; readonly via?: () => readonly Point[]} = {}): Promise<boolean> {
    const source = typeof from === "function" ? from() : (desk.value?.target(from) ?? null);
    const fingers = hand();
    if (source === null || fingers === null) return false;
    const grab = centerOf(source);
    await reach(grab, signal);
    await wait(300, signal);
    const stops = [...(options.via?.() ?? []), to() ?? grab];
    pointerPressed.value = true;
    ripple(grab);
    if (fingers.down(grab) === null) {
        pointerPressed.value = false;
        return false;
    }
    await wait(150, signal);
    let end = grab;
    for (const [index, stop] of stops.entries()) end = await carry(end, stop, index === 0 ? CARRY : SETTLE, signal);
    await wait(options.hold ?? 560, signal);
    fingers.up(end);
    pointerPressed.value = false;
    ripple(end);
    await wait(500, signal);
    return true;
}

/**
 * 点一下（菜单上的按钮、批注的小符号）：指针滑过去，停一下，按下松开。滑过去的这段时间里浮层可能换了位置（选区菜单跟着选区重新贴），
 * 所以到了以后再量一次，按新的位置点；量不到了返回 false。
 */
async function tap(measure: () => DOMRectReadOnly | null, signal: AbortSignal): Promise<boolean> {
    const first = measure();
    if (first === null) return false;
    await reach(centerOf(first), signal);
    await wait(260, signal);
    const rect = measure();
    if (rect === null) return false;
    const point = centerOf(rect);
    placePointer(point);
    pointerPressed.value = true;
    ripple(point);
    hand()?.click(point);
    await wait(140, signal);
    pointerPressed.value = false;
    return true;
}

/** 双击某处：真的发两下与 `dblclick`，每下漾一圈。 */
async function doubleTap(name: DeskTarget, signal: AbortSignal): Promise<void> {
    const rect = desk.value?.target(name) ?? null;
    if (rect === null) return;
    const point = centerOf(rect);
    await reach(point, signal);
    await wait(300, signal);
    pointerPressed.value = true;
    ripple(point);
    await wait(110, signal);
    ripple(point);
    hand()?.doubleClick(point);
    pointerPressed.value = false;
    await wait(220, signal);
}

/** 等某样东西出现（菜单、卡片）：每 60ms 看一次，等不到返回 null。 */
async function until<T>(probe: () => T | null, ms: number, signal: AbortSignal): Promise<T | null> {
    for (let spent = 0; spent <= ms; spent += 60) {
        const found = probe();
        if (found !== null) return found;
        await wait(60, signal);
    }
    return null;
}

// ── 正文：打字、星璃、高亮与批注 ──

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

/** 第五章接着打那半句：一个字一个字，标点处停得久一些。 */
async function typeKnock(signal: AbortSignal): Promise<void> {
    if (desk.value?.shows(KNOCK_TYPED) === true) return;
    if (!(await focusChapterFive(signal))) return;
    await wait(300, signal);
    for (const char of KNOCK_TYPED) {
        if (desk.value?.type(char) !== true) return;
        await wait("，。".includes(char) ? 380 : 80 + Math.round(Math.random() * 70), signal);
    }
}

async function typeKnockNow(signal: AbortSignal): Promise<void> {
    if (desk.value?.shows(KNOCK_TYPED) === true) return;
    if (await focusChapterFive(signal)) desk.value?.type(KNOCK_TYPED);
}

/** 第一章翻到末尾（那段同样的敲门在最后）。分组刚换过，控件可能还没挂上，等一下再试。 */
async function revealChapterOneEnd(signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 20 && desk.value?.revealEnd("chapterOne") !== true; attempt += 1) await wait(100, signal);
}

/** 星璃那一栏亮一圈金：她开口时把视线引过去。 */
const glow = shallowRef<StageRect | null>(null);
function glowLyra(on: boolean): void {
    const rect = on ? (desk.value?.target("lyra") ?? null) : null;
    glow.value = rect === null ? null : rectToStage(rect);
}

/** 作者在对话栏里问，星璃先读第一章（一条工具调用），再边打边答。 */
async function askLyra(signal: AbortSignal): Promise<void> {
    if (desk.value?.lyraHas(KNOCK_REPLY_ID) === true) return;
    desk.value?.lyraPost(KNOCK_ASK);
    await wait(1100, signal);
    glowLyra(true);
    desk.value?.lyraPost(KNOCK_READ);
    await wait(900, signal);
    for (let shown = 0; shown < KNOCK_REPLY.length; shown += 2) {
        desk.value?.lyraPost(knockReply(KNOCK_REPLY.slice(0, shown), true));
        await wait(55, signal);
    }
    desk.value?.lyraPost(knockReply(KNOCK_REPLY, false));
    await wait(900, signal);
    glowLyra(false);
}

function askLyraNow(): void {
    if (desk.value?.lyraHas(KNOCK_REPLY_ID) === true) return;
    desk.value?.lyraPost(KNOCK_ASK);
    desk.value?.lyraPost(KNOCK_READ);
    desk.value?.lyraPost(knockReply(KNOCK_REPLY, false));
}

/** 拖选一句：指针停在句首，扫到句尾（选区跟着一帧一帧加长），松开。这句不在桌上时返回 false。 */
async function sweepSelect(text: string, signal: AbortSignal): Promise<boolean> {
    const first = desk.value?.textRects(text)[0];
    if (first === undefined) return false;
    const start = {x: first.left + 1, y: first.top + first.height / 2};
    await reach(start, signal);
    await wait(280, signal);
    pointerPressed.value = true;
    ripple(start);
    await tween(600 + text.length * 30, SETTLE, (t) => {
        const end = desk.value?.selectText(text, t) ?? null;
        if (end !== null) placePointer({x: end.right, y: end.top + end.height / 2});
    }, signal);
    pointerPressed.value = false;
    desk.value?.finishSelection();
    return true;
}

/** 涂高亮：拖选、点选区菜单上的高亮（颜色用菜单记着的上一次）；菜单没出来、没点上时直接执行同一个编辑动作。 */
async function highlight(file: OpenFile, text: string, signal: AbortSignal): Promise<void> {
    if (!(await sweepSelect(text, signal))) return;
    await until(() => desk.value?.menuButton("highlight") ?? null, 1400, signal);
    await wait(300, signal);
    await tap(() => desk.value?.menuButton("highlight") ?? null, signal);
    await wait(200, signal);
    if (desk.value?.marked(text, "highlight") !== true) desk.value?.markNow(file, text, {kind: "highlight", color: HIGHLIGHT_COLOR});
    await wait(120, signal);
    desk.value?.collapseSelection();
}

/**
 * 加批注：拖选、点选区菜单上的“批注”，在卡片里一个字一个字打，点保存；再点批注末尾的小符号，把卡片打开给人看。
 * 菜单或卡片没出来时直接执行同一个编辑动作（`comment`）。
 */
async function annotate(file: OpenFile, text: string, body: string, signal: AbortSignal): Promise<void> {
    if (!(await sweepSelect(text, signal))) return;
    await until(() => desk.value?.menuButton("comment") ?? null, 1400, signal);
    await wait(300, signal);
    if (!(await tap(() => desk.value?.menuButton("comment") ?? null, signal))) {
        desk.value?.markNow(file, text, {kind: "comment", body});
        return;
    }
    const opened = await until(() => (desk.value?.focusCommentField() === true ? true : null), 1400, signal);
    if (opened === null) {
        desk.value?.markNow(file, text, {kind: "comment", body});
        return;
    }
    await wait(420, signal);
    for (const char of body) {
        if (desk.value?.type(char, "field") !== true) break;
        await wait("，。：".includes(char) ? 320 : 75 + Math.round(Math.random() * 60), signal);
    }
    await wait(480, signal);
    await tap(() => desk.value?.commentSave() ?? null, signal);
    await wait(400, signal);
    // 保存后焦点回正文、选区还在，选区菜单会再出来：收起选区，只留批注的小符号。
    desk.value?.collapseSelection();
    if (desk.value?.marked(text, "comment") !== true) desk.value?.markNow(file, text, {kind: "comment", body});
    await wait(300, signal);
    await tap(() => desk.value?.commentMarker() ?? null, signal);
}

/** 不演：两处高亮、一条批注直接加上（正文的控件可能刚挂上，找不到那句就等一下再试）。 */
async function markNow(signal: AbortSignal): Promise<void> {
    const marks = [
        ["chapterFive", KNOCK_ECHOES[0], {kind: "highlight", color: HIGHLIGHT_COLOR}],
        ["chapterOne", KNOCK_ECHOES[1], {kind: "highlight", color: HIGHLIGHT_COLOR}],
        ["chapterFive", KNOCK_NOTE.on, {kind: "comment", body: KNOCK_NOTE.body}],
    ] as const;
    for (const [file, text, mark] of marks) {
        for (let attempt = 0; attempt < 15 && desk.value?.markNow(file, text, mark) !== true; attempt += 1) await wait(100, signal);
    }
    desk.value?.collapseSelection();
}

/** 局部聚光：被点名的那一处亮一圈金，其余地方压暗一点（@designer 第 4 轮：整台放大会糊字、裁掉两栏）。 */
const spot = shallowRef<StageRect | null>(null);
async function spotlight(name: DeskTarget, signal: AbortSignal, hold: number): Promise<void> {
    const rect = desk.value?.target(name) ?? null;
    if (rect === null) return;
    spot.value = rectToStage(rect);
    await wait(hold, signal);
    spot.value = null;
}

/** 两章里那两声敲门同时描一道金：给读者一个对照的落点（只在第一拍的收尾亮一会儿，下一拍再真的涂上高亮）。 */
const marks = shallowRef<readonly StageRect[]>([]);
function markEchoes(): void {
    marks.value = KNOCK_ECHOES.flatMap((text) => desk.value?.textRects(text) ?? []).map(rectToStage);
}

/** 关灯：工作台上压一层夜色，中间一枚小猫标。 */
const lightsOut = ref(false);
/** 换一台工作台时的薄暮：压上、换、揭开（恢复时正文对不上，不能就地摆回去）。 */
const veil = ref(false);

// ── 字幕：上一行是这一拍的短标题（金色）与进度，下一行是一句字幕；交给访客时整行换成邀请与按钮 ──

const beatTitle = ref("");
const caption = ref("");
const ring = shallowRef<StageRect | null>(null);
const handoff = ref(false);

function say(copy: BeatCopy, line: "opening" | "middle" | "closing"): void {
    beatTitle.value = copy.title;
    caption.value = copy[line] ?? copy.opening;
}

function markRing(name: DeskTarget): void {
    const rect = desk.value?.target(name) ?? null;
    ring.value = rect === null ? null : rectToStage(rect);
}

// ── 第一幕的六拍与交给访客 ──

interface Beat {
    readonly copy: BeatCopy | null;
    /** 从上一拍的终态演到这一拍的终态。 */
    play(signal: AbortSignal): Promise<void>;
    /** 不演，直接摆上这一拍的结果（快速滚过与少动效时）。 */
    settle(signal: AbortSignal): Promise<void>;
}

/** 高亮的颜色：菜单没出来、直接执行时用（产品色板里的黄）。 */
const HIGHLIGHT_COLOR = "#fef9c3";

/** 第一章拖到第一组正文的右缘：实时布局在这里拆出右边一组。 */
const chapterOneDrop = (): Point | null => {
    const body = desk.value?.target("first-editor-body") ?? null;
    return body === null ? null : {x: body.right - Math.min(60, body.width * 0.12), y: body.top + body.height * 0.5};
};
/** 先沿标签条走到右端（条里只是换个次序），再从那里直着落进右缘：穿过上缘的那一小段走得快，布局不会先往上下拆。 */
const chapterOneVia = (): readonly Point[] => {
    const drop = chapterOneDrop();
    const tab = desk.value?.target("chapter-one-tab") ?? null;
    return drop === null || tab === null ? [] : [{x: drop.x, y: tab.top + tab.height / 2}];
};
/** 艾莉丝的标签拖到状态栏上松手：那里不在任何一块面板上，标签就浮出来，窗的左上角对着侧栏。 */
const floatDrop = (): Point | null => {
    const status = desk.value?.target("statusbar") ?? null;
    const landing = desk.value?.target("float-landing") ?? null;
    return status === null || landing === null ? null : {x: landing.left + 40, y: status.top + status.height / 2};
};
/** 先沿标签条往左，再越过缝进作品树（编辑器的标签放不进工具视图，那里不排布局），再落到状态栏上。 */
const floatVia = (): readonly Point[] => {
    const tab = desk.value?.target("alice-tab") ?? null;
    const editor = desk.value?.target("first-editor") ?? null;
    const landing = desk.value?.target("float-landing") ?? null;
    if (tab === null || editor === null || landing === null) return [];
    const strip = tab.top + tab.height / 2;
    return [{x: editor.left + 24, y: strip}, {x: landing.left + 40, y: strip + 140}];
};
/** 作品的入口拖到右栏的入口条上，放在已有入口的后面。 */
const stripDrop = (): Point | null => {
    const strip = desk.value?.target("auxiliary-strip") ?? null;
    return strip === null ? null : {x: strip.left + strip.width * 0.72, y: strip.top + strip.height / 2};
};

/** 艾莉丝的窗开在状态栏上方：拉右上角的手柄，收到作品树下面那一块。 */
async function shrinkAlice(signal: AbortSignal): Promise<void> {
    const landing = desk.value?.target("float-landing") ?? null;
    if (landing === null) return;
    const goal = {x: landing.right - 3, y: landing.top + 3};
    await drag(() => desk.value?.target("alice-float-corner") ?? null, () => goal, signal, {hold: 260});
}

async function whenReadyToPlay(signal: AbortSignal): Promise<void> {
    await whenLanded(signal);
}

const BEAT_STEPS: readonly Beat[] = [
    {
        copy: BEATS.knock,
        async play(signal) {
            await whenReadyToPlay(signal);
            beatTitle.value = "第一幕";
            caption.value = SANCTUM_ACT.replace(/^第一幕\s+/u, "");
            await wait(1600, signal);
            say(BEATS.knock, "opening");
            await wait(1000, signal);
            await typeKnock(signal);
            await wait(900, signal);
            await askLyra(signal);
            await wait(600, signal);
            say(BEATS.knock, "middle");
            await wait(1100, signal);
            await spotlight("chapter-one-tab", signal, 900);
            if (!(await drag("chapter-one-tab", chapterOneDrop, signal, {via: chapterOneVia}))) desk.value?.splitRight("chapterOne");
            hidePointer();
            await wait(500, signal);
            await revealChapterOneEnd(signal);
            await wait(600, signal);
            markEchoes();
            say(BEATS.knock, "closing");
            await wait(2800, signal);
            marks.value = [];
        },
        async settle(signal) {
            await typeKnockNow(signal);
            askLyraNow();
            desk.value?.splitRight("chapterOne");
            await revealChapterOneEnd(signal);
        },
    },
    {
        copy: BEATS.mark,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.mark, "opening");
            await wait(1200, signal);
            await highlight("chapterFive", KNOCK_ECHOES[0], signal);
            await wait(450, signal);
            await highlight("chapterOne", KNOCK_ECHOES[1], signal);
            await wait(700, signal);
            say(BEATS.mark, "middle");
            await wait(1000, signal);
            await annotate("chapterFive", KNOCK_NOTE.on, KNOCK_NOTE.body, signal);
            await wait(500, signal);
            hidePointer();
            say(BEATS.mark, "closing");
            await wait(2600, signal);
        },
        settle: markNow,
    },
    {
        copy: BEATS.alice,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.alice, "opening");
            await wait(1300, signal);
            if (!(await drag("alice-tab", floatDrop, signal, {hold: 420, via: floatVia}))) desk.value?.floatAlice();
            await wait(500, signal);
            say(BEATS.alice, "middle");
            await wait(1000, signal);
            await shrinkAlice(signal);
            hidePointer();
            await wait(600, signal);
            say(BEATS.alice, "closing");
            await wait(2000, signal);
        },
        settle: async () => void desk.value?.floatAlice(),
    },
    {
        copy: BEATS.move,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.move, "opening");
            await wait(1300, signal);
            if (!(await drag("explorer-entry", stripDrop, signal))) desk.value?.moveExplorer("auxiliarybar");
            hidePointer();
            await wait(900, signal);
            say(BEATS.move, "closing");
            await wait(2000, signal);
        },
        settle: async () => void desk.value?.moveExplorer("auxiliarybar"),
    },
    {
        copy: BEATS.focus,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.focus, "opening");
            await wait(1300, signal);
            await doubleTap("editor-head-blank", signal);
            if (desk.value?.isMaximized() !== true) desk.value?.setMaximized(INITIAL_EDITOR_PANEL);
            await wait(400, signal);
            hidePointer();
            await wait(1900, signal);
            await doubleTap("editor-head-blank", signal);
            if (desk.value?.isMaximized() === true) desk.value.setMaximized(null);
            hidePointer();
            await wait(500, signal);
            say(BEATS.focus, "closing");
            await wait(1800, signal);
        },
        settle: async () => desk.value?.setMaximized(null),
    },
    {
        copy: BEATS.memory,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.memory, "opening");
            await wait(1300, signal);
            lightsOut.value = true;
            await wait(900, signal);
            // 真的关掉再打开：存盘、记下此刻的样子，按它重新挂一台工作台（布局、标签、浮窗、打到一半的那句、批注、对话都从记下的来）。
            const saved = (await desk.value?.snapshotSaved()) ?? null;
            await remount(saved);
            await wait(700, signal);
            lightsOut.value = false;
            await wait(700, signal);
            say(BEATS.memory, "closing");
            await wait(2200, signal);
        },
        settle: async () => undefined,
    },
    {
        copy: null,
        async play(signal) {
            await wait(300, signal);
        },
        settle: async () => undefined,
    },
];

/** 六拍的进度（交给访客那一段不算一拍）：已走过的实心，当前这一拍亮着。 */
const BEAT_COUNT = BEAT_STEPS.filter((beat) => beat.copy !== null).length;
const LAST_STEP = BEAT_STEPS.length - 1;

/** 交给访客停住的样子：第一章的标签上一圈金环（隔一会儿往右挪一下，示意能拖），字幕那一行是邀请与按钮。 */
function settleHandoff(): void {
    markRing("chapter-one-tab");
    handoff.value = true;
}

/** 字幕上显示的是哪一拍：-1 是首屏与俯冲。 */
const current = ref(-1);
const yielded = ref(false);
const phase = ref("idle");
/** 演不演：宽屏且访客没要求少动效。窄屏只换字幕；少动效时导演只摆不演。 */
const demoEnabled = computed(() => wide.value && !reduced);

/** 一段被打断或走完后收拾演示的装饰；停住时该有的（交给访客的金环）由 `rest` 摆。 */
function tidy(): void {
    hand()?.cancel();
    trail?.clear();
    hidePointer();
    spot.value = null;
    marks.value = [];
    glow.value = null;
    veil.value = false;
    lightsOut.value = false;
}

/** 停在某一拍：字幕换成这一拍的收尾（演完的已经是了）。 */
function rest(beat: number, how: "played" | "settled" | "restored"): void {
    current.value = beat;
    if (beat < 0) {
        beatTitle.value = "";
        caption.value = "";
        handoff.value = false;
        ring.value = null;
        return;
    }
    if (beat === LAST_STEP) {
        settleHandoff();
        return;
    }
    handoff.value = false;
    ring.value = null;
    const copy = BEAT_STEPS[beat]?.copy ?? null;
    if (copy !== null && how !== "played") say(copy, "closing");
}

/**
 * 摆回记下的样子。能就地摆就就地摆：布局走产品的布局动画，从此刻（访客摆的、演到一半的）样子走回去。
 * 正文或标签对不上（访客打过字、演示打到一半）时压一层薄暮，按记下的重新挂一台，再揭开。
 */
async function restoreDesk(state: DeskSnapshot, signal: AbortSignal): Promise<void> {
    tidy();
    yielded.value = false;
    handoff.value = false;
    ring.value = null;
    const live = desk.value;
    if (live !== null && (await live.restoreTo(state))) {
        await wait(480, signal);
        return;
    }
    veil.value = true;
    await wait(240, signal);
    await remount(state);
    veil.value = false;
    await wait(260, signal);
}

const director = createActOne<DeskSnapshot>({
    async play(beat, signal) {
        current.value = beat;
        yielded.value = false;
        handoff.value = false;
        ring.value = null;
        await BEAT_STEPS[beat]?.play(signal);
    },
    async settle(beat, signal) {
        await BEAT_STEPS[beat]?.settle(signal);
    },
    capture: async () => {
        const saved = await desk.value?.snapshotSaved();
        if (saved === undefined) throw new Error("工作台不在，记不下样子");
        return saved;
    },
    restore: restoreDesk,
    tidy,
    rest,
}, {
    animate: () => !reduced,
    onPhase: (text) => {
        phase.value = text;
    },
    report: (error) => console.error("[homepage] 第一幕", error),
});

/** 舞台中线压着哪一段：宽屏交给导演；窄屏只换字幕（工作台只有一栏宽，分栏、浮窗摆上去挤成一字一行）。 */
function onBeat(beat: number): void {
    if (wide.value) {
        director.follow(beat);
        return;
    }
    current.value = beat;
    if (beat < 0) {
        beatTitle.value = "";
        caption.value = "";
        handoff.value = false;
    } else if (beat === LAST_STEP) handoff.value = true;
    else {
        handoff.value = false;
        const copy = BEAT_STEPS[beat]?.copy ?? null;
        if (copy !== null) say(copy, "closing");
    }
}

/** 访客自己动了工作台：演示让开，字幕后面出现“接着看”“摆回去”；交给访客那一段只熄掉金环（已经交到访客手里了）。 */
function onVisitorTouch(): void {
    if (!wide.value) return;
    director.touch();
    const beat = director.target();
    if (beat < 0) return;
    if (beat === LAST_STEP) {
        ring.value = null;
        return;
    }
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
        for (const entry of entries) if (entry.isIntersecting) onBeat(Number((entry.target as HTMLElement).dataset.hsStep ?? "-1"));
    }, {root, rootMargin: "-49.5% 0px -49.5% 0px", threshold: 0});
    for (const element of root.querySelectorAll<HTMLElement>("[data-hs-step]")) beats.observe(element);
}

onMounted(() => {
    paintRoot(night.value);
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
    director.dispose();
    tidy();
    trail?.dispose();
    resize?.disconnect();
    beats?.disconnect();
    if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
    const style = document.documentElement.style;
    for (const [name, value] of previousDropVars) {
        if (value === "") style.removeProperty(name);
        else style.setProperty(name, value);
    }
    restoreRoot();
});
</script>

<template>
    <div ref="page" class="hs" :class="{'hs--narrow': !wide, 'hs--day': !night}" :style="pageStyle" :data-hs-beat="current" :data-hs-phase="phase" :data-hs-landed="landed" :data-hs-night="night" @scroll.passive="onScroll">
        <div class="hs-run">
            <div ref="stage" class="hs-stage">
                <SanctumScene :progress="dive" :intro="start === 'top'" :desk-ready="deskReady" :night="night" @landed="onLanded">
                    <template #desk>
                        <HomepageDesk :key="deskKey" ref="desk" setup="knock" :night="night" :restore="restore" @ready="onDeskReady" @touch="onVisitorTouch" />
                        <Transition name="hs-dusk">
                            <div v-if="lightsOut" class="hs-lights-out" aria-hidden="true">
                                <NeuroBookMark decorative class="hs-lights-out__mark" />
                            </div>
                        </Transition>
                        <Transition name="hs-fade">
                            <div v-if="veil" class="hs-veil" aria-hidden="true"></div>
                        </Transition>
                    </template>
                    <template #hero="{lit}">
                        <header class="hs-nav" :class="{'is-lit': lit}">
                            <a class="hs-nav__brand" href="#">
                                <NeuroBookMark decorative class="hs-nav__mark" />
                                <span>NeuroBook</span>
                            </a>
                            <nav class="hs-nav__links" aria-label="站点">
                                <a href="#">文档</a>
                                <a href="#" class="hs-nav__extra">更新日志</a>
                                <a href="#">GitHub</a>
                                <!-- 昼夜切换：首屏在导航的最右端，落地以后在字幕那一条的右端（两处是同一个开关）。 -->
                                <button type="button" class="hs-nav__daynight" :aria-pressed="night" :aria-label="night ? '换成白天' : '换成夜间'" :title="night ? '换成白天' : '换成夜间'" @click="night = !night">
                                    <span :class="night ? 'i-lucide-moon' : 'i-lucide-sun'" aria-hidden="true"></span>
                                </button>
                            </nav>
                        </header>
                        <section class="hs-hero" :class="{'is-lit': lit}">
                            <p class="hs-hero__tagline" lang="en">{{ TAGLINE }}</p>
                            <h1 class="hs-hero__title"><span v-for="part in headlineParts" :key="part" class="hs-hero__phrase">{{ part }}</span></h1>
                            <img class="hs-hero__flourish" :src="FILIGREE" alt="" />
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

                <Transition name="hs-fade">
                    <div v-if="glow !== null" class="hs-glow" :style="{left: px(glow.left - 3), top: px(glow.top - 3), width: px(glow.width + 6), height: px(glow.height + 6)}" aria-hidden="true"></div>
                </Transition>

                <Transition name="hs-fade">
                    <div v-if="spot !== null" class="hs-spot" :style="{left: px(spot.left - 5), top: px(spot.top - 4), width: px(spot.width + 10), height: px(spot.height + 8)}" aria-hidden="true"></div>
                </Transition>

                <Transition name="hs-fade">
                    <div v-if="marks.length > 0" class="hs-marks" aria-hidden="true">
                        <span v-for="(mark, index) in marks" :key="index" class="hs-mark" :style="{left: px(mark.left - 3), top: px(mark.top - 1), width: px(mark.width + 6), height: px(mark.height + 2)}"></span>
                    </div>
                </Transition>

                <div v-if="ring !== null" class="hs-ring" :style="{left: px(ring.left - 6), top: px(ring.top - 5), width: px(ring.width + 12), height: px(ring.height + 10)}" aria-hidden="true"></div>

                <!-- 金色指针：箭头的尖在元素原点上。 -->
                <div ref="pointer" class="hs-pointer" :class="{'is-shown': pointerShown, 'is-pressed': pointerPressed}" aria-hidden="true">
                    <svg viewBox="0 0 24 30" width="24" height="30">
                        <defs>
                            <linearGradient id="hs-pointer-gold" x1="0" y1="0" x2="1" y2="1">
                                <stop offset="0" stop-color="#fff3cf" />
                                <stop offset="0.45" stop-color="#e9c47c" />
                                <stop offset="1" stop-color="#a8762f" />
                            </linearGradient>
                        </defs>
                        <path d="M1.5,1.5 L1.5,24 L7.2,18.6 L11.2,27.6 L15,26 L11.1,17.2 L19,17.2 Z" fill="url(#hs-pointer-gold)" stroke="#2a1608" stroke-width="1.4" stroke-linejoin="round" />
                    </svg>
                </div>

                <!-- 字幕一条：上一行是进度与这一拍的短标题，下一行是一句字幕；交给访客时下一行换成邀请与按钮。 -->
                <div class="hs-caption" :style="captionStyle" :class="{'is-shown': current >= 0}">
                    <div class="hs-caption__head">
                        <span class="hs-caption__beats" aria-hidden="true">
                            <i v-for="index in BEAT_COUNT" :key="index" :class="{'is-done': index - 1 < current, 'is-current': index - 1 === current}"></i>
                        </span>
                        <Transition name="hs-line" mode="out-in">
                            <p :key="handoff ? 'handoff' : beatTitle" class="hs-caption__title">{{ handoff ? "换你来" : beatTitle }}</p>
                        </Transition>
                    </div>
                    <Transition name="hs-line" mode="out-in">
                        <div v-if="handoff" key="handoff" class="hs-caption__row">
                            <img class="hs-caption__peek" :src="LYRA_PEEK" alt="" />
                            <p class="hs-caption__line">{{ HANDOFF }}</p>
                            <a class="hs-cta hs-cta--primary hs-cta--compact" href="#">下载 NeuroBook</a>
                            <a class="hs-cta hs-cta--compact" href="#">接着看世界引擎</a>
                        </div>
                        <div v-else :key="caption" class="hs-caption__row">
                            <p class="hs-caption__line">{{ caption }}</p>
                            <template v-if="yielded">
                                <button type="button" class="hs-cta hs-cta--compact" @click="director.replay()">接着看</button>
                                <button type="button" class="hs-cta hs-cta--compact" @click="director.settleHere()">摆回去</button>
                            </template>
                        </div>
                    </Transition>
                </div>

                <!-- 昼夜切换：落地以后出现，在字幕那一条的右端。 -->
                <Transition name="hs-fade">
                    <button v-if="landed && wide" type="button" class="hs-daynight" :style="{right: px(box.left), top: px(box.top + box.height + 22)}" :aria-pressed="night" @click="night = !night">
                        <span :class="night ? 'i-lucide-moon' : 'i-lucide-sun'" class="hs-daynight__icon" aria-hidden="true"></span>
                        {{ night ? "夜" : "昼" }}
                    </button>
                </Transition>
            </div>

            <div class="hs-track">
                <div class="hs-track__dive" data-hs-step="-1" aria-hidden="true"></div>
                <section v-for="(beat, index) in BEAT_STEPS" :key="index" class="hs-beat" :class="{'hs-beat--last': beat.copy === null}" :data-hs-step="index">
                    <p v-if="beat.copy !== null" class="hs-sr">{{ beat.copy.title }}：{{ beat.copy.opening }}{{ beat.copy.closing }}</p>
                    <p v-else class="hs-sr">{{ HANDOFF }}</p>
                </section>
            </div>
        </div>

        <section class="hs-next">
            <img class="hs-next__flourish" :src="FILIGREE" alt="" />
            <p class="hs-next__act">第二幕</p>
            <h2 class="hs-next__title">为中文长篇做的编辑器</h2>
            <p class="hs-next__note">这一幕下一轮出稿。</p>
        </section>
    </div>
</template>

<style scoped>
/*
 * 页面自己的颜色：夜 #1c1418 做底，象牙 #f7f2ec 写字，金 #e1b285 与深金 #a8762f 做线、光与按钮的边，赤红 #871222 只给主按钮。
 * 按钮与字幕往“皇室”的方向走（开发者第 4 轮的意见）：双线金边、两端各一粒菱形、衬线字。场景里的材质在 `SanctumScene.vue`。
 */
.hs {
    --hs-ivory: #f7f2ec;
    --hs-gold: #e1b285;
    --hs-gold-light: #f0c987;
    --hs-gold-deep: #a8762f;
    --hs-crimson: #871222;
    --hs-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --hs-serif: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    --hs-latin: "Fraunces", "Source Han Serif SC", "Noto Serif CJK SC", serif;
    --hs-gilt: linear-gradient(135deg, #fff1c8 0%, #e2b866 22%, #8a5c1c 48%, #f2d491 70%, #a8762f 100%);
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
    /* clip：不让拿焦点的元素把舞台滚开（见 `SanctumScene.vue` 的 `.sx`）。 */
    overflow: clip;
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
    transition: opacity 900ms var(--hs-ease) 1700ms;
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
    font-family: var(--hs-latin);
    font-size: 19px;
    font-weight: 560;
    letter-spacing: 0.01em;
    text-decoration: none;
}

.hs-nav__mark {
    width: 26px;
    height: 26px;
    color: var(--hs-gold);
}

.hs-nav__links {
    display: flex;
    align-items: center;
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
    top: calc(var(--hs-vh) * 0.1);
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(880px, 86%);
    text-align: center;
    transform: translateX(-50%);
}

.hs-hero > * {
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

/* 和首句呼应的那句英文：Fraunces 带着它的软角与古怪的笔形，像书名页上的题辞。 */
.hs-hero__tagline {
    --rise-delay: 820ms;
    margin: 0 0 10px;
    color: var(--hs-gold-light);
    font-family: var(--hs-latin);
    font-size: 21px;
    font-variation-settings: "SOFT" 100, "WONK" 1, "opsz" 72;
    font-weight: 380;
    letter-spacing: 0.04em;
}

.hs-hero__title {
    --rise-delay: 950ms;
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

/* 标题下一道金色花饰：从中间往两边展开。 */
.hs-hero__flourish {
    --rise-delay: 1200ms;
    width: min(360px, 70%);
    height: auto;
    margin: 14px 0 0;
    clip-path: inset(0 50% 0 50%);
    transition:
        opacity 900ms var(--hs-ease) var(--rise-delay),
        clip-path 1300ms var(--hs-ease) var(--rise-delay);
}

.hs-hero.is-lit > .hs-hero__flourish {
    clip-path: inset(0 0 0 0);
}

.hs-hero__lede {
    --rise-delay: 1320ms;
    max-width: 34em;
    margin: 14px 0 0;
    color: rgb(247 242 236 / 0.76);
    font-size: 16.5px;
    line-height: 1.8;
}

.hs-hero__actions {
    --rise-delay: 1560ms;
    display: flex;
    gap: 18px;
    margin-top: 26px;
    pointer-events: auto;
}

.hs-hero__note {
    --rise-delay: 1700ms;
    margin: 14px 0 0;
    color: rgb(247 242 236 / 0.46);
    font-size: 13px;
}

/*
 * 按钮：一道鎏金外边（渐变画在边框盒上），里面再一圈细金线（内阴影），两端各一粒金菱形。
 * 主按钮底是赤红丝绒的暗面，次按钮是半透明的夜色。
 */
.hs-cta {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 46px;
    padding-inline: 30px;
    border: 1.5px solid transparent;
    border-radius: 5px;
    background:
        linear-gradient(rgb(24 15 19 / 0.78), rgb(24 15 19 / 0.78)) padding-box,
        var(--hs-gilt) border-box;
    box-shadow:
        inset 0 0 0 3px rgb(14 8 10 / 0.55),
        inset 0 0 0 4px rgb(240 201 135 / 0.3),
        0 10px 28px rgb(0 0 0 / 0.38);
    color: #f3e6cc;
    font: inherit;
    font-family: var(--hs-serif);
    font-size: 15px;
    letter-spacing: 0.1em;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition:
        box-shadow 200ms ease,
        filter 200ms ease;
}

.hs-cta::before,
.hs-cta::after {
    position: absolute;
    top: 50%;
    width: 7px;
    height: 7px;
    content: "";
    background: var(--hs-gilt);
    box-shadow: 0 0 6px rgb(240 201 135 / 0.5);
    transform: translate(-50%, -50%) rotate(45deg);
}

.hs-cta::before {
    left: 0;
}

.hs-cta::after {
    left: 100%;
}

.hs-cta:hover {
    filter: brightness(1.12);
    box-shadow:
        inset 0 0 0 3px rgb(14 8 10 / 0.55),
        inset 0 0 0 4px rgb(240 201 135 / 0.45),
        0 0 22px rgb(240 201 135 / 0.28),
        0 10px 28px rgb(0 0 0 / 0.38);
}

.hs-cta:focus-visible {
    outline: 2px solid var(--hs-gold-light);
    outline-offset: 4px;
}

.hs-cta--primary {
    background:
        linear-gradient(180deg, #a01d31, #6c0e1c) padding-box,
        var(--hs-gilt) border-box;
    color: #fff3dc;
}

.hs-cta--compact {
    height: 38px;
    padding-inline: 20px;
    font-size: 13.5px;
}

/* ── 第一幕：尾迹、指针、聚光、描金、星璃那一栏的光、金环 ── */

.hs-trail {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.hs-pointer {
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.55)) drop-shadow(0 0 8px rgb(240 201 135 / 0.45));
    transition: opacity 220ms ease;
    pointer-events: none;
}

.hs-pointer.is-shown {
    opacity: 1;
}

.hs-pointer svg {
    display: block;
    transform-origin: 2px 2px;
    transition: transform 120ms ease;
}

.hs-pointer.is-pressed svg {
    transform: scale(0.84);
}

.hs-glow {
    position: absolute;
    border: 1.5px solid rgb(240 201 135 / 0.85);
    border-radius: 12px;
    box-shadow:
        inset 0 0 30px rgb(240 201 135 / 0.16),
        0 0 28px rgb(240 201 135 / 0.35);
    pointer-events: none;
}

/* 局部聚光：被点名的那一处亮一圈金，其余地方压暗一点（巨大的外阴影铺满舞台，舞台自己裁掉）。 */
.hs-spot {
    position: absolute;
    border: 2px solid var(--hs-gold-light);
    border-radius: 9px;
    box-shadow:
        0 0 0 9999px rgb(10 5 7 / 0.28),
        0 0 22px rgb(240 201 135 / 0.7);
    animation: hs-charge 700ms var(--hs-ease) both;
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
    background: rgb(240 201 135 / 0.34);
    box-shadow: 0 0 14px rgb(240 201 135 / 0.45);
    animation: hs-mark 600ms var(--hs-ease) both;
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
    border: 2px solid var(--hs-gold-light);
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

/* 关灯：工作台上压一层夜色，中间一枚小猫标。 */
.hs-lights-out {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: radial-gradient(60% 60% at 50% 50%, #1c1418, #0b0709);
}

.hs-lights-out__mark {
    width: 64px;
    height: 64px;
    color: var(--hs-gold);
    opacity: 0.55;
}

.hs-dusk-enter-active {
    transition: opacity 800ms var(--hs-ease);
}

.hs-dusk-leave-active {
    transition: opacity 900ms var(--hs-ease);
}

.hs-dusk-enter-from,
.hs-dusk-leave-to {
    opacity: 0;
}

/* ── 字幕 ── */

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

.hs-caption__head {
    display: flex;
    align-items: center;
    gap: 14px;
}

.hs-caption__beats {
    display: inline-flex;
    gap: 7px;
}

.hs-caption__beats i {
    width: 7px;
    height: 7px;
    border: 1px solid rgb(240 201 135 / 0.6);
    transform: rotate(45deg);
    transition:
        background-color 300ms ease,
        box-shadow 300ms ease;
}

.hs-caption__beats i.is-done {
    background: rgb(240 201 135 / 0.55);
}

.hs-caption__beats i.is-current {
    background: var(--hs-gold-light);
    box-shadow: 0 0 8px rgb(240 201 135 / 0.8);
}

.hs-caption__title {
    margin: 0;
    color: var(--hs-gold-light);
    font-family: var(--hs-serif);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0.22em;
}

.hs-caption__row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    min-height: 40px;
    pointer-events: auto;
}

.hs-caption__line {
    margin: 0;
    color: #ece4d4;
    font-family: var(--hs-serif);
    font-size: 17px;
    letter-spacing: 0.05em;
    line-height: 1.5;
}

.hs-caption__peek {
    width: 44px;
    height: 44px;
    margin-right: -6px;
}

.hs-line-enter-active,
.hs-line-leave-active {
    transition:
        opacity 300ms var(--hs-ease),
        filter 300ms var(--hs-ease),
        transform 360ms var(--hs-ease);
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
    transition: opacity 260ms ease;
}

.hs-fade-enter-from,
.hs-fade-leave-to {
    opacity: 0;
}

.hs-daynight {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding-inline: 14px;
    border: 1px solid transparent;
    border-radius: 999px;
    background:
        linear-gradient(rgb(24 15 19 / 0.82), rgb(24 15 19 / 0.82)) padding-box,
        var(--hs-gilt) border-box;
    color: #f3e6cc;
    font-family: var(--hs-serif);
    font-size: 13px;
    letter-spacing: 0.12em;
    cursor: pointer;
    pointer-events: auto;
}

.hs-daynight:focus-visible {
    outline: 2px solid var(--hs-gold-light);
    outline-offset: 3px;
}

.hs-daynight__icon {
    width: 14px;
    height: 14px;
    color: var(--hs-gold-light);
}

/* ── 滚动轨道：俯冲一段、五拍各一段、交给访客一段（字幕在舞台上，这里的字给读屏与搜索） ── */

.hs-track__dive {
    height: calc(var(--hs-vh) * 0.65);
}

.hs-beat {
    position: relative;
    height: calc(var(--hs-vh) * 1.6);
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
    padding: 110px 24px 160px;
    background: #120c10;
    text-align: center;
}

.hs-next__flourish {
    width: 260px;
    height: auto;
    margin-bottom: 22px;
    opacity: 0.85;
}

.hs-next__act {
    margin: 0;
    color: rgb(240 201 135 / 0.85);
    font-family: var(--hs-serif);
    font-size: 13px;
    letter-spacing: 0.22em;
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

.hs-nav__daynight {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 999px;
    background:
        linear-gradient(rgb(24 15 19 / 0.7), rgb(24 15 19 / 0.7)) padding-box,
        var(--hs-gilt) border-box;
    color: var(--hs-gold-light);
    cursor: pointer;
    transition: box-shadow 200ms ease;
}

.hs-nav__daynight:hover {
    box-shadow: 0 0 14px rgb(240 201 135 / 0.35);
}

.hs-nav__daynight:focus-visible {
    outline: 2px solid var(--hs-gold-light);
    outline-offset: 3px;
}

.hs-nav__daynight span {
    width: 15px;
    height: 15px;
}

/* 换一台工作台时压上的薄暮（恢复时正文对不上，不能就地摆回去）。 */
.hs-veil {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: rgb(18 12 16 / 0.72);
    pointer-events: none;
}

/*
 * ── 昼（第 6 轮）：字换成深墨，金换成更深的铜金（只给线与小字，正文守深墨），赤红照旧给主按钮。场景的日光与石墙在 `SanctumScene.vue`。
 */
.hs--day {
    --hs-gold: #8a5c1c;
    --hs-gold-light: #8a5c1c;
    background: #b9ab93;
    color: #2a1d12;
    scrollbar-color: rgb(42 29 18 / 0.25) transparent;
}

.hs--day .hs-nav__brand {
    color: #2a1d12;
}

.hs--day .hs-nav__links a {
    color: rgb(42 29 18 / 0.66);
}

.hs--day .hs-nav__links a:hover {
    color: #2a1d12;
}

.hs--day .hs-nav__daynight,
.hs--day .hs-daynight {
    background:
        linear-gradient(rgb(250 244 232 / 0.86), rgb(250 244 232 / 0.86)) padding-box,
        var(--hs-gilt) border-box;
    color: #6f4a17;
}

.hs--day .hs-hero__tagline {
    color: #7a1424;
}

.hs--day .hs-hero__title {
    background: linear-gradient(180deg, #24170d 0%, #3b2614 58%, #6f4a17 100%);
    background-clip: text;
}

.hs--day .hs-hero.is-lit > .hs-hero__title {
    filter: drop-shadow(0 1px 14px rgb(255 248 230 / 0.55));
}

.hs--day .hs-hero__flourish {
    filter: brightness(0.82) saturate(1.15);
}

.hs--day .hs-hero__lede {
    color: rgb(36 24 14 / 0.82);
}

.hs--day .hs-hero__note {
    color: rgb(36 24 14 / 0.58);
}

.hs--day .hs-cta {
    background:
        linear-gradient(rgb(250 244 232 / 0.9), rgb(250 244 232 / 0.9)) padding-box,
        var(--hs-gilt) border-box;
    box-shadow:
        inset 0 0 0 3px rgb(255 251 242 / 0.7),
        inset 0 0 0 4px rgb(168 118 47 / 0.4),
        0 8px 20px rgb(64 38 18 / 0.18);
    color: #3b2614;
}

.hs--day .hs-cta:hover {
    box-shadow:
        inset 0 0 0 3px rgb(255 251 242 / 0.7),
        inset 0 0 0 4px rgb(168 118 47 / 0.6),
        0 0 18px rgb(255 236 196 / 0.6),
        0 8px 20px rgb(64 38 18 / 0.18);
}

.hs--day .hs-cta--primary {
    background:
        linear-gradient(180deg, #a01d31, #6c0e1c) padding-box,
        var(--hs-gilt) border-box;
    color: #fff3dc;
}

.hs--day .hs-pointer {
    filter: drop-shadow(0 3px 6px rgb(64 38 18 / 0.45)) drop-shadow(0 0 6px rgb(255 240 200 / 0.6));
}

.hs--day .hs-spot {
    box-shadow:
        0 0 0 9999px rgb(40 28 16 / 0.16),
        0 0 22px rgb(168 118 47 / 0.6);
}

.hs--day .hs-veil {
    background: rgb(236 230 218 / 0.8);
}

/* 金圈与描金在象牙色的桌上要深一档才看得见。 */
.hs--day .hs-glow,
.hs--day .hs-ring {
    border-color: rgb(168 118 47 / 0.95);
    box-shadow:
        0 0 0 4px rgb(168 118 47 / 0.16),
        0 0 22px rgb(168 118 47 / 0.4);
}

.hs--day .hs-mark {
    background: rgb(168 118 47 / 0.22);
    box-shadow: 0 0 12px rgb(168 118 47 / 0.35);
}

/*
 * 宽屏的字幕压在桌布（深色丝绒）上，昼夜都用浅色的字与亮金：把夜里的两个金色变量放回来。
 * 窄屏的字幕在首屏文字退场后的上方，白天那里是亮的石墙，换成深墨与铜金。
 */
.hs--day:not(.hs--narrow) .hs-caption {
    --hs-gold: #e1b285;
    --hs-gold-light: #f0c987;
}

.hs--day.hs--narrow .hs-caption__beats i {
    border-color: rgb(138 92 28 / 0.7);
}

.hs--day.hs--narrow .hs-caption__beats i.is-done {
    background: rgb(138 92 28 / 0.6);
}

.hs--day.hs--narrow .hs-caption__beats i.is-current {
    background: #a8762f;
    box-shadow: 0 0 8px rgb(168 118 47 / 0.6);
}

.hs--day.hs--narrow .hs-caption__line {
    color: #24170d;
}

.hs--day .hs-next {
    background: #b9ab93;
}

.hs--day .hs-next__act {
    color: #7a5420;
}

.hs--day .hs-next__note {
    color: rgb(36 24 14 / 0.55);
}

/* ── 窄屏：首屏文字在上，工作台平放在下面；字幕在首屏文字退场后的上方 ── */

.hs--narrow .hs-nav {
    height: 52px;
    padding-inline: 18px;
}

.hs--narrow .hs-nav__links {
    gap: 16px;
}

/* 390 宽放不下品牌、三个链接与昼夜开关：更新日志先收起来。 */
.hs--narrow .hs-nav__extra {
    display: none;
}

.hs--narrow .hs-hero {
    top: 62px;
    width: calc(100% - 36px);
}

.hs--narrow .hs-hero__tagline {
    margin-bottom: 6px;
    font-size: 17px;
}

.hs--narrow .hs-hero__flourish {
    width: 220px;
    margin-top: 8px;
}

.hs--narrow .hs-hero__lede {
    margin-top: 10px;
    font-size: 14.5px;
    line-height: 1.7;
}

.hs--narrow .hs-hero__actions {
    gap: 14px;
    margin-top: 16px;
}

.hs--narrow .hs-hero__actions {
    flex-wrap: wrap;
    justify-content: center;
}

.hs--narrow .hs-cta {
    height: 42px;
    padding-inline: 16px;
    font-size: 13.5px;
    letter-spacing: 0.04em;
}

.hs--narrow .hs-hero__note {
    display: none;
}

.hs--narrow .hs-caption__line {
    font-size: 15px;
}

.hs--narrow .hs-caption__row {
    flex-wrap: wrap;
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
