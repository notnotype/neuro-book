<script setup lang="ts">
/**
 * NeuroBook 文档站首页的原型（同名 .md，w00056 t06 第 8 轮）：《入殿·俯案成界》的首屏与俯冲，接着是跟着一场戏走、自己连播的第一幕。
 *
 * 先后：
 * 1. 挂上就画场景（`SanctumScene` 演开场）与一台透明的真工作台；工作台排好版发 `ready`，场景才把桌子亮出来。
 *    挂着时在根上换成夜间配色（缺省；访客可以切回昼），卸载时还原：主题有一批变量在根上从配色派生，只改工作台那一棵子树跟不上。
 * 2. 滚动只给场景一个目标进度（滚过一屏为 1），场景自己平滑地追、写变换；落地时它发 `landed`，这时工作台才接指针。
 * 3. 第一幕不靠滚动：落地、舞台过半在视口里时，导演从第一拍连播到最后（`act-one.ts`，规则写在那里）；滚走一半或镜头拉回去时停下，
 *    回来接着演（访客动过手的除外：留着访客摆的样子，等访客按“继续演示”）。工作台上面是这一拍的眉题，下面是章节条（`ChapterRail`）：
 *    每一拍按标称时长估进度，说出结论那一刻补满。
 *    演示的拖动、双击、点菜单都是合成的指针事件，走产品真的手势（`demo-pointer.ts`），拖动是实时布局；被打断时没松开的那一下撤下。
 *    跳回前面、访客动过以后接着演，按记下的终态摆回去：能就地摆就走产品的布局动画，正文对不上才重新挂一台。
 * 4. 演示的“手”（金色指针与尾迹）画在传送到 body 下的一层里，压在工作台开出的一切浮层之上（选区菜单、拖动时跟手的卡片都传送到 body，
 *    第 7 轮指针画在舞台里，被选区菜单盖住）。那一层每次摆指针时对齐到舞台的矩形，里面照旧用舞台坐标。
 * 5. 第一幕后面舞台再钉一屏是第二幕（第 13 轮）：滚动位置只决定现在是哪一幕（分界带缓冲，见 `act`），越过分界才放换幕（`switchAct`）：
 *    进第二幕落印（`ActSeal`），回第一幕只压薄暮。两幕各一份连播（`staged-act.ts`），不在台上的那一幕按“离台”停住。
 *    每次换幕都按那一幕离开时记下的样子重新挂一台工作台：第一幕的终态把作品树搬到了右栏，和第二幕起头的样子对不上，不能就地摆。
 */
import {applyColorwayVars, NB_UI_COLORWAY_HOST_CLASS} from "@notnotype/nb-ui";
import nbookTheme from "@notnotype/nb-ui/themes/nbook";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import {INITIAL_EDITOR_PANEL} from "nbook/plugins/workbench/web/state/default-tree";
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

import FILIGREE from "./assets/filigree.webp";
import LYRA_PEEK from "./assets/lyra-toukan.webp";
import ActSeal from "./ActSeal.vue";
import ChapterRail from "./ChapterRail.vue";
import {ACT_ONE, ACT_TWO, BEATS, BEATS_TWO, HANDOFF, HANDOFF_TWO, HEADLINES, KNOCK_ECHOES, KNOCK_NOTE, LEDE, TAGLINE} from "./copy";
import type {BeatCopy} from "./copy";
import type {DemoPointer} from "./demo-pointer";
import {centerOf} from "./desk";
import {createDeskBlobs} from "./desk-blobs";
import type {DeskSnapshot, DeskTarget, Point} from "./desk";
import DeskSpotlight from "./DeskSpotlight.vue";
import type {SpotMark, SpotRect} from "./DeskSpotlight.vue";
import GildedMarks from "./GildedMarks.vue";
import type {GildedMark} from "./GildedMarks.vue";
import GiltButton from "./GiltButton.vue";
import {glidePath, glideTime} from "./glide";
import HomepageDesk from "./HomepageDesk.vue";
import {CARRY, frames, Interrupted, prefersReducedMotion, timeScale, tween, wait} from "./motion";
import {engravingPng} from "./engraving";
import {ACT_TWO_SCRIPT, actTwoFiles, CHAPTER_FIVE_PATH, GRAY_TOWER_PATH, KNOCK_ASK, KNOCK_LEAD, KNOCK_READ, KNOCK_REPLY, KNOCK_REPLY_ID, KNOCK_TYPED, knockReply, PROJECT_FILES} from "./sample";
import type {OpenFile} from "./sample";
import {deskBox, EYEBROW_BAND, SANCTUM_MIN_WIDTH} from "./sanctum";
import SanctumScene from "./SanctumScene.vue";
import {useStagedAct} from "./staged-act";
import type {StagedAct, StagedBeat} from "./staged-act";
import {createTrail} from "./trail";
import type {Trail} from "./trail";

const props = withDefaults(defineProps<{
    start?: "top" | "act-one" | "act-two";
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

/** 镜头的目标进度：滚过一屏走完。从第一幕或第二幕起时一开始就是落地的。 */
const dive = ref(props.start === "top" ? 0 : 1);

/**
 * 现在是哪一幕（第 13 轮加第二幕）：只由滚动位置决定。落地以后那一段里，过了 1.55 屏是第二幕，回到 1.35 屏以下是第一幕；
 * 中间那一段两边都不换，滚轮的余势与在分界上来回滚不会反复换幕。换幕的动画由 `switchAct` 放，不跟着滚动一帧一帧走。
 */
const act = ref<1 | 2>(props.start === "act-two" ? 2 : 1);
/** 章节条与它的按钮跟哪一幕：换幕时落印收进眉题（回第一幕是薄暮揭开）的那一刻才跟上 `act`，那一刻章节条依次亮起。 */
const shownAct = ref<1 | 2>(1);
/** 眉题、窄屏字幕与交给访客那一行照哪一幕写：换幕时趁它们看不见、换上那一幕的字时跟着换（见 `putCaption`）。 */
const captionAct = ref<1 | 2>(1);
const ACT_TWO_ENTER = 1.55;
const ACT_TWO_LEAVE = 1.35;
function updateAct(screens: number): void {
    if (act.value === 1 && screens >= ACT_TWO_ENTER) act.value = 2;
    else if (act.value === 2 && screens <= ACT_TWO_LEAVE) act.value = 1;
}

let scrollFrame = 0;
function onScroll(): void {
    if (scrollFrame !== 0) return;
    scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const top = page.value?.scrollTop ?? 0;
        dive.value = Math.min(1, Math.max(0, top / size.value.height));
        updateAct(top / size.value.height);
        // 舞台钉到头以后跟着页面走，手那一层（固定定位）跟上。
        if (pointerShown.value) syncHand();
    });
}

const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const pageStyle = computed(() => ({"--hs-vh": px(size.value.height), "--hs-title": px(Math.round(Math.min(60, Math.max(32, size.value.width * 0.04))))}));
/** 章节条那一条：宽屏在工作台下面（交给访客时下面再展开一行邀请与按钮）；窄屏在首屏文字退场后空出来的上面，连同那一句字幕。 */
const captionStyle = computed(() => {
    const {left, top, width, height} = box.value;
    return wide.value ? {left: px(left), top: px(top + height + 14), width: px(width)} : {left: px(20), top: px(60), width: px(size.value.width - 40)};
});
/**
 * 眉题（宽屏）：工作台正上方、和它左边对齐，一行里是这一拍的短标题与那一句字幕（第 8 轮，开发者：字幕在正下方不显眼；
 * @designer：上叙事、下进度，视线从标题读到工作台，进度留在下面）。
 */
const eyebrowStyle = computed(() => {
    const {left, top, width} = box.value;
    return {left: px(left), top: px(top - EYEBROW_BAND), width: px(width), height: px(EYEBROW_BAND)};
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

watch(night, (dark) => {
    paintRoot(dark);
    trail?.tone(!dark);
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
type StageRect = {readonly left: number; readonly top: number; readonly width: number; readonly height: number};
function rectToStage(rect: DOMRectReadOnly): StageRect {
    const frame = stageFrame();
    return {left: (rect.left - frame.left) / frame.zoom, top: (rect.top - frame.top) / frame.zoom, width: rect.width / frame.zoom, height: rect.height / frame.zoom};
}

// ── 工作台 ──

const desk = useTemplateRef<InstanceType<typeof HomepageDesk>>("desk");
const deskKey = ref(0);
/** 贴进作品的图（第二幕“一张插图”）：存在页面这一份里，换幕、关灯重挂工作台都不丢；卸载时收回。 */
const blobs = createDeskBlobs();
const restore = shallowRef<DeskSnapshot | null>(null);
const deskReady = ref(false);
const landed = ref(false);
let firstReady = true;
/** 工作台第一次挂好时存过盘的样子：第一幕从它开演，第二幕起头的样子也从它改出来。 */
let deskInitial: DeskSnapshot | null = null;
let resolveInitial: (snapshot: DeskSnapshot) => void = () => undefined;
const whenDeskInitial = new Promise<DeskSnapshot>((resolve) => {
    resolveInitial = resolve;
});
const readyWaiters: Array<() => void> = [];
const landWaiters: Array<() => void> = [];

function onDeskReady(): void {
    deskReady.value = true;
    for (const resolve of readyWaiters.splice(0)) resolve();
    if (!firstReady) return;
    firstReady = false;
    // 首屏的样子（存过盘的）交给导演，它才开始。
    void desk.value?.snapshotSaved().then((initial) => {
        deskInitial = initial;
        resolveInitial(initial);
        actOne.director.prime(initial);
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

/** 直接落在第一幕或第二幕：滚到俯冲走完的地方，或第二幕那一段（舞台还钉着）。 */
function scrollToAct(which: 1 | 2 = 1): void {
    const scroller = page.value;
    if (scroller === null) return;
    scroller.scrollTop = size.value.height * (which === 2 ? 1.8 : 1);
    onScroll();
}

// ── 第一幕的“手”：一支金色的指针，拖着东西时身后一道短短的金色尾迹，按下处漾开一圈。按下、拖动、松开都真的发给工作台（`demo-pointer.ts`） ──

const handLayer = useTemplateRef<HTMLElement>("handLayer");
const trailCanvas = useTemplateRef<HTMLCanvasElement>("trailCanvas");
let trail: Trail | null = null;
const pointer = useTemplateRef<HTMLElement>("pointer");
const pointerShown = ref(false);
const pointerPressed = ref(false);
/** 拖着东西走：指针微微前倾（@designer 第 8 轮）。 */
const pointerCarrying = ref(false);
/**
 * 按快捷键的那一下（第 13 轮，@designer 第 12 轮：键帽提示放在编辑区右下角，避开章节条与状态栏）：几枚金边键帽在那里亮一会儿，
 * 按住的（Ctrl 点链接）一直亮到 `hideKeys`。画在手那一层里，跟指针一样压在浮层之上。
 */
const keycaps = shallowRef<{readonly id: number; readonly names: readonly string[]; readonly at: Point} | null>(null);
let keycapsTimer = 0;
let keycapsCount = 0;
let pointerAt: Point = {x: 0, y: 0};

/**
 * 手那一层（传送到 body 下、固定定位）对齐到舞台：平移到舞台左上角、按 Lab 画布的缩放一起缩放，里面就照旧用舞台坐标，
 * 也照旧只在舞台的框里看得见。舞台钉着时它不动；滚走、换大小时，下一次摆指针或滚动时跟上。
 */
function syncHand(): void {
    const layer = handLayer.value;
    const element = stage.value;
    if (layer === null || element === null) return;
    const rect = element.getBoundingClientRect();
    const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    layer.style.width = px(element.offsetWidth);
    layer.style.height = px(element.offsetHeight);
    layer.style.transform = `translate3d(${px(rect.left)}, ${px(rect.top)}, 0) scale(${zoom})`;
}

function placePointer(point: Point): void {
    pointerAt = point;
    syncHand();
    const local = toStage(point);
    if (pointer.value !== null) pointer.value.style.transform = `translate3d(${px(local.x)}, ${px(local.y)}, 0)`;
}

/** 演示指针：工作台挂上以后才有。 */
const hand = (): DemoPointer | null => desk.value?.pointer() ?? null;

/** 指针从旁边滑到目标上（没显示时先在目标左下方现身）：走一道微拱的弧，一次缓入缓出（`glide.ts`）。 */
async function reach(target: Point, signal: AbortSignal): Promise<void> {
    if (!pointerShown.value) {
        placePointer({x: target.x - 140, y: target.y + 120});
        pointerShown.value = true;
        await wait(140, signal);
    }
    const path = glidePath(pointerAt, target);
    await tween(glideTime(path.length, "reach"), CARRY, (t) => placePointer(path.at(t)), signal);
}

function hidePointer(): void {
    pointerShown.value = false;
    pointerPressed.value = false;
    pointerCarrying.value = false;
    hideKeys();
}

/** 松开但不收起：拍与拍之间指针留在原处。 */
function releasePointer(): void {
    pointerPressed.value = false;
    pointerCarrying.value = false;
}

/** 亮出几枚键帽（`["Ctrl", "V"]`）：`ms` 以后收起，`null` 时亮到 `hideKeys`。量不到编辑区（窄屏、还没挂上）时不亮。 */
function showKeys(names: readonly string[], ms: number | null = 900): void {
    window.clearTimeout(keycapsTimer);
    keycapsTimer = 0;
    const body = desk.value?.target("first-editor-body") ?? null;
    if (body === null || !wide.value) return;
    syncHand();
    keycapsCount += 1;
    keycaps.value = {id: keycapsCount, names, at: toStage({x: body.right - 20, y: body.bottom - 20})};
    if (ms !== null) keycapsTimer = window.setTimeout(hideKeys, ms * timeScale());
}

function hideKeys(): void {
    window.clearTimeout(keycapsTimer);
    keycapsTimer = 0;
    keycaps.value = null;
}

/**
 * 演示时指针一直在（第 12 轮，开发者：演示的时候让鼠标一直显示）：每一拍开演时还没显示，就在工作台下半截的空处现身；
 * 之后几次动手之间停在上一次的位置。暂停（包括访客动了工作台、舞台滚走）与交给访客时才收起，见 `onPhase`。
 * 要在落地以后量：镜头还在推时量出来的位置是斜的。
 */
function parkPointer(): void {
    if (pointerShown.value || !wide.value) return;
    const body = desk.value?.target("first-editor-body") ?? null;
    if (body === null) return;
    placePointer({x: body.left + body.width * 0.62, y: body.bottom - Math.min(120, body.height * 0.22)});
    pointerShown.value = true;
}

/** 按下处漾一圈（按、点、松开都有）。 */
function ripple(point: Point): void {
    trail?.ripple(toStage(point));
}

/**
 * 一次真的拖动：指针滑到来源上、停一下；按下；沿一条带弧度的路拖到落点（实时布局一路排），全程一次缓入缓出、路点处不停；
 * 在落点上停一下再松手，之后是产品自己的落位动画。来源或落点量不到时返回 false，由调用方直接摆（拖到原地松手什么都不会发生，
 * 还会以为演完了）。被打断时没松开的那一下由 `tidy` 撤下（拖动取消，布局回到按下前）。`before` 在按下前一刻调用（收起照亮把手的聚光）。
 *
 * 落点都在起拖前量好就不再改：产品判定落点用的是拿起前的布局（预览只给渲染），预览一排开，再量的位置就对不上判定了
 * （第 6 轮第一次试时边走边量，第一组一收窄，指针跟着退回了它的中央）。
 *
 * 路点（`via`）是为实时布局的预览挑的走廊：同一个候选连续约 150ms 不变，预览才排开（nb-layout 的 `LIVE_SETTLE_MS`），
 * 指针在别的分区里待久了，布局会先排成那一边再换过来。所以路点选在不排布局的地方（标签条里、不收这个标签的面板上），
 * 拐角换成圆弧（`glide.ts` 的圆角折线，整条路仍贴着走廊），穿过别的分区那一段正赶上全程最快的时候。
 */
async function drag(from: DeskTarget | (() => DOMRectReadOnly | null), to: () => Point | null, signal: AbortSignal, options: {readonly hold?: number; readonly via?: () => readonly Point[]; readonly before?: () => void} = {}): Promise<boolean> {
    const source = typeof from === "function" ? from() : (desk.value?.target(from) ?? null);
    const fingers = hand();
    if (source === null || fingers === null) return false;
    const destination = to();
    if (destination === null) return false;
    const grab = centerOf(source);
    const path = glidePath(grab, destination, options.via?.() ?? []);
    await reach(grab, signal);
    // 几处停顿（第 12 轮）：第 7 轮是 300、150、560、500ms，开发者嫌慢；第 8 轮砍到 140、80、340、300，第 11 轮又嫌快，取中间。
    await wait(240, signal);
    options.before?.();
    pointerPressed.value = true;
    ripple(grab);
    if (fingers.down(grab) === null) {
        pointerPressed.value = false;
        return false;
    }
    await wait(140, signal);
    pointerCarrying.value = true;
    await tween(glideTime(path.length, "drag"), CARRY, (t) => {
        const at = path.at(t);
        placePointer(at);
        fingers.move(at);
        trail?.add(toStage(at));
    }, signal);
    await wait(options.hold ?? 480, signal);
    fingers.up(destination);
    pointerCarrying.value = false;
    pointerPressed.value = false;
    ripple(destination);
    await wait(400, signal);
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
    await wait(140, signal);
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
    await wait(160, signal);
    pointerPressed.value = true;
    ripple(point);
    await wait(110, signal);
    ripple(point);
    hand()?.doubleClick(point);
    pointerPressed.value = false;
    await wait(200, signal);
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
    // 指针挪到那半句末尾的右下方停着（不压在要打出来的字上），像有人点进去接着写。
    const lead = desk.value?.textRects(KNOCK_LEAD).at(-1) ?? null;
    if (lead !== null) await reach({x: lead.right + 64, y: lead.bottom + 30}, signal);
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
    // 指针先滑到对话栏底下的输入框上点一下，再发出问题（问题是直接贴进对话的，不真的打字）。
    const lyra = desk.value?.target("lyra") ?? null;
    if (lyra !== null) {
        const input = {x: lyra.left + lyra.width * 0.42, y: lyra.bottom - 46};
        await reach(input, signal);
        await wait(200, signal);
        ripple(input);
        await wait(300, signal);
    }
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
    await wait(160, signal);
    pointerPressed.value = true;
    ripple(start);
    await tween(480 + text.length * 26, CARRY, (t) => {
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

/**
 * 案头聚光（`DeskSpotlight`，第 8 轮，开发者：高亮不显眼，一个改法是加遮罩）：只用在几处要对照着看的时候（@designer：每一拍都开就像新手引导）——
 * 拖动起手时照亮把手与落点（一按下就收）、两处高亮刚涂好、人物浮窗与正文、专心写之前的标签条。
 * 每块亮处的标记（第 9 轮，开发者：金色高亮矩形有点丑）：元素标四角，文字按行标下划线（不再框住整句的外接矩形，没高亮的字也框进去），
 * 空的落点标落点槽。
 */
const spots = shallowRef<readonly SpotRect[]>([]);
const spotMarks = shallowRef<readonly SpotMark[]>([]);
type LitItems = ReadonlyArray<{readonly rect: DOMRectReadOnly | null; readonly mark?: SpotMark}>;
function light(items: LitItems): void {
    const shown = items.flatMap((item) => (item.rect === null ? [] : [{rect: item.rect, mark: item.mark ?? "none"}]));
    spots.value = shown.map((item) => rectToStage(item.rect));
    spotMarks.value = shown.map((item) => item.mark);
}
function illuminate(items: LitItems): void {
    stopFollowing();
    light(items);
}
function darken(): void {
    stopFollowing();
    spots.value = [];
    spotMarks.value = [];
}

/**
 * 亮处跟着东西走（第 13 轮：展开、收起的卡片，长出来的图，随查询变短的菜单）：每一帧量一次，变了才换，幕自己平滑地挪过去。
 * 有一块量不到的那一帧不换（菜单刚收、提示块还没画出来的一两帧）：块数一变，幕就要淡开再落光。到下一次照亮或 `darken` 为止。
 */
let following = 0;
function follow(measure: () => LitItems): void {
    stopFollowing();
    let last = "";
    const step = (): void => {
        const items = measure();
        const rects = items.map((item) => item.rect);
        if (rects.every((rect): rect is DOMRectReadOnly => rect !== null)) {
            const key = rects.map((rect) => [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(",")).join("|");
            if (key !== last) {
                last = key;
                light(items);
            }
        }
        following = requestAnimationFrame(step);
    };
    step();
}
function stopFollowing(): void {
    if (following !== 0) cancelAnimationFrame(following);
    following = 0;
}
/** 一块的右半边：第一章拖过去以后长出新的一组的地方。 */
function rightHalf(rect: DOMRectReadOnly | null): DOMRectReadOnly | null {
    return rect === null ? null : new DOMRectReadOnly(rect.left + rect.width / 2, rect.top, rect.width / 2, rect.height);
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
/**
 * 换幕时的薄暮，同时工作台微微往后退（@designer 第 12 轮“沉幕”）。和 `veil` 分开：离台的那一幕停下时会收拾装饰（`tidy` 关掉 `veil`），
 * 那一下可能晚于换幕压上薄暮。
 */
const curtain = ref(false);

// ── 字幕：宽屏是工作台上面的眉题（这一拍的短标题与一句字幕）和下面的章节条，交给访客时章节条下面展开邀请与按钮；窄屏都在上面 ──

/** 眉题的短标题与那一句字幕。开演时是这一幕的名字。 */
const captionTitle = ref("");
const caption = ref("");
const ring = shallowRef<StageRect | null>(null);
const handoff = ref(false);
/** 眉题此刻写什么：交给访客时换成那一幕的邀请。 */
const eyebrow = computed(() => {
    if (!handoff.value) return {title: captionTitle.value, line: caption.value};
    const copy = captionAct.value === 2 ? HANDOFF_TWO : HANDOFF;
    return {title: copy.title, line: copy.line};
});
/** 窄屏只有一行字幕（短标题已经在章节条上）；开演时那一行是这一幕的名字。 */
const narrowLine = computed(() => (captionTitle.value === ACT_ONE.number || captionTitle.value === ACT_TWO.number ? `${captionTitle.value}\u3000${caption.value}` : caption.value));

function say(copy: BeatCopy, line: "opening" | "middle" | "closing"): void {
    captionTitle.value = copy.title;
    caption.value = copy[line] ?? copy.opening;
}

/** 这一拍说出结论：字幕换成收尾那句，章节条上这一段补满（之后还留着看一会儿，才换下一拍）。 */
function conclude(copy: BeatCopy): void {
    say(copy, "closing");
    stagedAct.value.concluded();
}

/**
 * 遮罩以外几处自己点题的鎏金标记（第 9 轮，`GildedMarks`；第 8 轮是金线框、金底与金环，开发者嫌“金色高亮矩形有点丑”）：
 * 星璃开口时她那一栏标四角，第一拍收尾两声敲门按行标下划线（同一批出现，一起掠光），交给访客时第一章的标签标小四角，漾两圈、隔一会儿往右挪。
 */
/** 第二幕各拍自己的标记（第 13 轮）：新标签与存下的文件上的小四角、连起图与文件的细线、原文里依次描金的几行。 */
const actMarks = shallowRef<readonly GildedMark[]>([]);
const pageMarks = computed<readonly GildedMark[]>(() => [
    ...actMarks.value,
    ...(glow.value === null ? [] : [{id: "lyra", kind: "corners" as const, rect: glow.value}]),
    ...marks.value.map((rect, index) => ({id: `echo-${index}`, kind: "underline" as const, rect})),
    ...(ring.value === null ? [] : [{id: "handoff", kind: "corners" as const, rect: ring.value, small: true, ripple: true, nudge: true}]),
]);

function markRing(name: DeskTarget): void {
    const rect = desk.value?.target(name) ?? null;
    ring.value = rect === null ? null : rectToStage(rect);
}

// ── 第一幕的六拍与交给访客 ──

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
/** 作品的入口拖到右轨上入口那一段的末尾（w00043 t19 起右栏的入口在右轨上），排在星璃后面。 */
const railDrop = (): Point | null => {
    const slot = desk.value?.target("auxiliary-rail") ?? null;
    return slot === null ? null : centerOf(slot);
};
/**
 * 路的后半段在右轨里由下往上走：右轨上入口带以外是拒收区，不排布局，缓入缓出末尾放慢的那一段就落在轨上；横穿星璃那一栏时正赶上全程最快。
 * 不走这条走廊时，往上拱的弧在终点前放慢，正好压在星璃那一栏的顶边上，停过约 150ms，预览先排成“在星璃上面拆一组”再换成搬到右栏
 * （第 9 轮并进 master 后整幕重演三遍里两遍；负载高、帧率低时指针一步跨过去，看不出来）。
 */
const railVia = (): readonly Point[] => {
    const slot = desk.value?.target("auxiliary-rail") ?? null;
    const region = desk.value?.target("auxiliarybar") ?? null;
    return slot === null || region === null ? [] : [{x: slot.left + slot.width / 2, y: region.bottom - 40}];
};

/** 艾莉丝的窗开在状态栏上方：拉右上角的手柄，收到作品树下面那一块。 */
async function shrinkAlice(signal: AbortSignal): Promise<void> {
    const landing = desk.value?.target("float-landing") ?? null;
    if (landing === null) return;
    const goal = {x: landing.right - 3, y: landing.top + 3};
    await drag(() => desk.value?.target("alice-float-corner") ?? null, () => goal, signal, {hold: 360});
}

async function whenReadyToPlay(signal: AbortSignal): Promise<void> {
    await whenLanded(signal);
    parkPointer();
}

/**
 * 第一幕的六拍与交给访客。标称时长量自第 7 轮在开发服务上连播的一遍（负载约 6，探针记下每一拍开演与补满的时刻），
 * 第 9 轮加长聚光的停留、第 12 轮放慢拖动并让指针先挪到打字处与对话输入框后，按加的时长补上。
 */
const BEAT_STEPS: readonly StagedBeat[] = [
    {
        copy: BEATS.knock,
        nominal: 22600,
        async play(signal) {
            await whenReadyToPlay(signal);
            captionTitle.value = ACT_ONE.number;
            caption.value = ACT_ONE.title;
            await wait(1600, signal);
            say(BEATS.knock, "opening");
            await wait(1000, signal);
            await typeKnock(signal);
            await wait(900, signal);
            await askLyra(signal);
            await wait(600, signal);
            say(BEATS.knock, "middle");
            await wait(900, signal);
            // 起手：照亮第一章的标签（把手）和它要去的右半边（落点），一按下就收。
            illuminate([{rect: desk.value?.target("chapter-one-tab") ?? null, mark: "corners"}, {rect: rightHalf(desk.value?.target("first-editor-body") ?? null)}]);
            // 聚光淡入要 0.42 秒，动手前再让它完整亮一秒上下：第 8 轮只留 0.6 秒，一闪而过，开发者看着像没有遮罩（第 9 轮）。
            await wait(1300, signal);
            if (!(await drag("chapter-one-tab", chapterOneDrop, signal, {via: chapterOneVia, before: darken}))) desk.value?.splitRight("chapterOne");
            darken();
            await wait(500, signal);
            await revealChapterOneEnd(signal);
            await wait(600, signal);
            markEchoes();
            conclude(BEATS.knock);
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
        nominal: 21900,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.mark, "opening");
            await wait(1200, signal);
            await highlight("chapterFive", KNOCK_ECHOES[0], signal);
            await wait(450, signal);
            await highlight("chapterOne", KNOCK_ECHOES[1], signal);
            await wait(300, signal);
            // 两处高亮刚涂好：照亮这两句，对照着看（@designer 第 8 轮）。按行留亮、按行标下划线，一句折成两行就是两块。
            illuminate(KNOCK_ECHOES.flatMap((text) => (desk.value?.textRects(text) ?? []).map((rect) => ({rect, mark: "underline" as const}))));
            await wait(1500, signal);
            darken();
            await wait(350, signal);
            say(BEATS.mark, "middle");
            await wait(1000, signal);
            await annotate("chapterFive", KNOCK_NOTE.on, KNOCK_NOTE.body, signal);
            await wait(500, signal);
            conclude(BEATS.mark);
            await wait(2600, signal);
        },
        settle: markNow,
    },
    {
        copy: BEATS.alice,
        nominal: 11400,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.alice, "opening");
            await wait(1100, signal);
            if (!(await drag("alice-tab", floatDrop, signal, {hold: 420, via: floatVia}))) desk.value?.floatAlice();
            await wait(500, signal);
            say(BEATS.alice, "middle");
            await wait(1000, signal);
            await shrinkAlice(signal);
            await wait(400, signal);
            conclude(BEATS.alice);
            // 人物浮窗与正文：两块都亮着，窗描一道细金线。
            illuminate([{rect: desk.value?.target("alice-float") ?? null, mark: "corners"}, {rect: desk.value?.target("first-editor-body") ?? null}]);
            await wait(1700, signal);
            darken();
            await wait(500, signal);
        },
        settle: async () => void desk.value?.floatAlice(),
    },
    {
        copy: BEATS.move,
        nominal: 7700,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.move, "opening");
            await wait(900, signal);
            illuminate([{rect: desk.value?.target("explorer-entry") ?? null, mark: "corners"}, {rect: desk.value?.target("auxiliary-rail") ?? null, mark: "slot"}]);
            await wait(1400, signal);
            if (!(await drag("explorer-entry", railDrop, signal, {before: darken, via: railVia}))) desk.value?.moveExplorer("auxiliarybar");
            darken();
            await wait(900, signal);
            conclude(BEATS.move);
            await wait(2000, signal);
        },
        settle: async () => void desk.value?.moveExplorer("auxiliarybar"),
    },
    {
        copy: BEATS.focus,
        nominal: 8000,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS.focus, "opening");
            await wait(900, signal);
            illuminate([{rect: desk.value?.target("first-editor-head") ?? null, mark: "corners"}]);
            await wait(1500, signal);
            darken();
            await doubleTap("editor-head-blank", signal);
            if (desk.value?.isMaximized() !== true) desk.value?.setMaximized(INITIAL_EDITOR_PANEL);
            await wait(400, signal);
            await wait(1900, signal);
            await doubleTap("editor-head-blank", signal);
            if (desk.value?.isMaximized() === true) desk.value.setMaximized(null);
            await wait(500, signal);
            conclude(BEATS.focus);
            await wait(1800, signal);
        },
        settle: async () => desk.value?.setMaximized(null),
    },
    {
        copy: BEATS.memory,
        nominal: 4000,
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
            conclude(BEATS.memory);
            await wait(2200, signal);
        },
        settle: async () => undefined,
    },
    {
        copy: null,
        nominal: 0,
        async play(signal) {
            await wait(300, signal);
        },
        settle: async () => undefined,
    },
];

/** 窄屏不演示，只换字幕：每一拍先说开头一句，隔这么久说结论。 */
const NARROW_MS = 2600;

/** 交给访客停住的样子：第一章的标签上一圈金环（隔一会儿往右挪一下，示意能拖），字幕那一行是邀请与按钮。 */
function settleHandoff(): void {
    if (wide.value) markRing("chapter-one-tab");
    handoff.value = true;
}

/** 一段被打断或走完后收拾演示的装饰；停住时该有的（交给访客的金环）由 `rest` 摆。 */
function tidy(): void {
    hand()?.cancel();
    trail?.clear();
    // 指针不在这里收：拍与拍之间它留着（`parkPointer`），收起由 `idle` 在暂停与交给访客时做。
    releasePointer();
    hideKeys();
    darken();
    marks.value = [];
    actMarks.value = [];
    glow.value = null;
    veil.value = false;
    lightsOut.value = false;
}

/** 窄屏的一拍：工作台只有一栏宽，分栏、浮窗摆上去挤成一字一行，所以不演示，只换字幕（先说开头一句，再说结论）。 */
async function narrowPlay(beats: readonly StagedBeat[], beat: number, signal: AbortSignal): Promise<void> {
    const copy = beats[beat]?.copy ?? null;
    if (copy === null) {
        await wait(300, signal);
        return;
    }
    say(copy, "opening");
    await wait(NARROW_MS, signal);
    conclude(copy);
    await wait(2200, signal);
}

/**
 * 摆回记下的样子。能就地摆就就地摆：布局走产品的布局动画，从此刻（访客摆的、演到一半的）样子走回去。
 * 正文或标签对不上（访客打过字、演示打到一半）时压一层薄暮，按记下的重新挂一台，再揭开。
 */
async function restoreDesk(state: DeskSnapshot, signal: AbortSignal): Promise<void> {
    tidy();
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

async function captureDesk(): Promise<DeskSnapshot> {
    const saved = await desk.value?.snapshotSaved();
    if (saved === undefined) throw new Error("工作台不在，记不下样子");
    return saved;
}

/** 舞台过半在视口里（滚走一半就算离开）。 */
const inView = ref(true);
/**
 * 哪一幕在台上、能演：0 是正在换幕（落印或回退走完之前两幕都停着）。滚动越过分界时，换幕的监听（`queueSwitch`）在同一次刷新里先置 0，
 * 换完才置成新的一幕。两幕的“在不在台上”只看它，不直接看 `act`：直接看的话，滚回去的那一下这一幕的监听可能先于换幕的监听跑，
 * 看到“幕对上了、还没开始换”，就在另一幕的工作台上抢先接着演了一下（第 13 轮探针看到的）。
 */
const live = ref<0 | 1 | 2>(props.start === "act-two" ? 0 : 1);
const switching = computed(() => live.value === 0);
/** 眉题与章节条显不显：换幕时先收起，落印收进眉题的那一刻换上新的一幕再显出来。 */
const captionsReady = ref(props.start !== "act-two");

const actOne = useStagedAct<DeskSnapshot>({
    name: "第一幕",
    beats: BEAT_STEPS,
    wide,
    reduced,
    narrowMs: NARROW_MS,
    // 第一幕在台上：宽屏要落地；窄屏不俯冲，首屏的字退开（滚过三成屏）就算。
    onStage: () => live.value === 1 && inView.value && (wide.value ? landed.value : dive.value >= 0.3),
    hooks: {
        prepare: () => {
            handoff.value = false;
            ring.value = null;
        },
        rest: (beat, how, last) => {
            if (last) {
                settleHandoff();
                return;
            }
            const copy = BEAT_STEPS[beat]?.copy ?? null;
            if (copy !== null && how !== "played") say(copy, "closing");
        },
        capture: captureDesk,
        restore: restoreDesk,
        tidy,
        idle: hidePointer,
        narrow: (beat, signal) => narrowPlay(BEAT_STEPS, beat, signal),
    },
});
// ── 第二幕：为中文长篇做的编辑器（第 13 轮，开发者在 v12 上定照脚本做原型；五拍按 plan.md 的片 3 逐拍换成真演） ──

/** 换幕的落印此刻的样子（`ActSeal`）。 */
const seal = ref<"off" | "drawing" | "docked">("off");

/** 灰塔的剖面版画画成的 PNG：第一次粘贴时才画，之后用同一份。 */
let engraving: Promise<Blob> | null = null;
const engravingImage = (): Promise<Blob> => (engraving ??= engravingPng());

/** 一个字一个字地打（正文或输入框里），标点处停得久一些。焦点跑了、打不进去就停，返回 false。 */
async function typeSlowly(text: string, where: "editor" | "field", signal: AbortSignal): Promise<boolean> {
    for (const char of text) {
        if (desk.value?.type(char, where) !== true) return false;
        await wait("，。：“”".includes(char) ? 320 : 80 + Math.round(Math.random() * 60), signal);
    }
    return true;
}

/** 光标放到这一句所在那一段的末尾（选中再收到末尾；编辑器在选中时就读过了选区）。这句不在桌上时返回 false。 */
function caretAfter(text: string): boolean {
    if (desk.value?.selectText(text) === null) return false;
    desk.value?.collapseSelection();
    return true;
}

/** 指针挪到这一句末尾的右下方停着（不压在要打的字上），像有人点进去接着写。 */
async function reachAfter(text: string, signal: AbortSignal): Promise<void> {
    const line = desk.value?.textRects(text).at(-1) ?? null;
    if (line !== null) await reach({x: line.right + 56, y: line.bottom + 26}, signal);
}

/** 第一个编辑组的正文那一块（第二幕只有一组）：键帽摆在它的右下角，亮处不出它。 */
const editorBody = (): DOMRectReadOnly | null => desk.value?.target("first-editor-body") ?? null;

/** 亮处不出编辑区：图比正文的视口高、还在往里滚时，只照看得见的那一截。完全在外面时为 null。 */
function within(rect: DOMRectReadOnly | null | undefined, bounds: DOMRectReadOnly | null): DOMRectReadOnly | null {
    if (rect === null || rect === undefined) return null;
    if (bounds === null) return rect;
    const left = Math.max(rect.left, bounds.left);
    const top = Math.max(rect.top, bounds.top);
    const right = Math.min(rect.right, bounds.right);
    const bottom = Math.min(rect.bottom, bounds.bottom);
    return right - left < 2 || bottom - top < 2 ? null : new DOMRectReadOnly(left, top, right - left, bottom - top);
}

/** 两块合成一块（新标签连同它下面那一页的正文）。 */
function union(a: DOMRectReadOnly | null, b: DOMRectReadOnly | null): DOMRectReadOnly | null {
    if (a === null) return b;
    if (b === null) return a;
    const left = Math.min(a.left, b.left);
    const top = Math.min(a.top, b.top);
    return new DOMRectReadOnly(left, top, Math.max(a.right, b.right) - left, Math.max(a.bottom, b.bottom) - top);
}

/** Ctrl 点一下（链接）：指针滑过去，编辑区右下角亮出按住的 Ctrl，再按下松开，松开后键帽收起。量不到了返回 false。 */
async function ctrlTap(measure: () => DOMRectReadOnly | null, signal: AbortSignal): Promise<boolean> {
    const first = measure();
    if (first === null) return false;
    await reach(centerOf(first), signal);
    showKeys(["Ctrl"], null);
    await wait(460, signal);
    const rect = measure();
    if (rect === null) {
        hideKeys();
        return false;
    }
    const point = centerOf(rect);
    placePointer(point);
    pointerPressed.value = true;
    ripple(point);
    hand()?.click(point, {ctrl: true});
    await wait(160, signal);
    pointerPressed.value = false;
    await wait(320, signal);
    hideKeys();
    return true;
}

/**
 * 提示块里那一句：三段依次打，进出中间那段各按一次 Ctrl+B（键帽亮一下）。`slowly` 为假时一段一段打（快进），也不亮键帽；
 * 快进时每一步之间也让编辑器过两帧：同步地连着按键、打字，粗体没落上（第 13 轮少动效连播实测）。
 */
async function typeCallout(slowly: boolean, signal: AbortSignal): Promise<void> {
    for (const [index, piece] of ACT_TWO_SCRIPT.callout.entries()) {
        if (index > 0) {
            if (slowly) showKeys(["Ctrl", "B"], 700);
            desk.value?.press("b", {ctrl: true});
            await (slowly ? wait(240, signal) : frames(2));
        }
        if (slowly) await typeSlowly(piece, "editor", signal);
        else {
            desk.value?.type(piece);
            await frames(2);
        }
    }
}

/** 不演：章名下面另起一段、直接插提示块、打那一句。 */
async function calloutNow(signal: AbortSignal): Promise<void> {
    if (desk.value?.shows(ACT_TWO_SCRIPT.callout[0]) === true) return;
    if (!caretAfter(ACT_TWO_SCRIPT.heading)) return;
    desk.value?.press("Enter");
    desk.value?.editNow("callout");
    await typeCallout(false, signal);
}

/**
 * 中文规矩的上半拍：章名下面另起一段，行首打顿号叫出斜杠菜单，按拼音首字母筛出“提示块”，回车插进去，在里面打一句。拼音库在第一次
 * 打开菜单时才加载：先停一会儿再打查询；筛不出（库还没好）就删掉查询改打中文名。菜单没出来时删掉顿号，直接插（同一个编辑动作）。
 * 菜单开着时照亮正在写的这一段与菜单，插进来以后两块亮处一起收紧到提示块上、标四角（@designer 第 12 轮）。
 */
async function calloutBySlash(signal: AbortSignal): Promise<void> {
    if (desk.value?.shows(ACT_TWO_SCRIPT.callout[0]) === true) return;
    await reachAfter(ACT_TWO_SCRIPT.heading, signal);
    if (!caretAfter(ACT_TWO_SCRIPT.heading)) return;
    await wait(300, signal);
    desk.value?.press("Enter");
    await wait(450, signal);
    desk.value?.type("、");
    if ((await until(() => desk.value?.slashActive() ?? null, 1200, signal)) === null) {
        desk.value?.press("Backspace");
        desk.value?.editNow("callout");
        await typeCallout(true, signal);
        return;
    }
    follow(() => [{rect: desk.value?.caretBlock() ?? null}, {rect: desk.value?.slashMenuRect() ?? null}]);
    await wait(1000, signal);
    await typeSlowly(ACT_TWO_SCRIPT.slashQuery, "editor", signal);
    const item = (): true | null => (desk.value?.slashActive() === ACT_TWO_SCRIPT.slashItem ? true : null);
    if ((await until(item, 1400, signal)) === null) {
        for (let index = 0; index < ACT_TWO_SCRIPT.slashQuery.length; index += 1) desk.value?.press("Backspace");
        await typeSlowly(ACT_TWO_SCRIPT.slashItem, "editor", signal);
        await until(item, 1000, signal);
    }
    await wait(500, signal);
    desk.value?.press("Enter");
    // 两块亮处一起挪到提示块上：块数不变，幕是收紧过去的，不是淡开再换一处落光。
    const callout = (): DOMRectReadOnly | null => desk.value?.calloutRect() ?? null;
    follow(() => [{rect: callout(), mark: "corners"}, {rect: callout()}]);
    await wait(600, signal);
    await typeCallout(true, signal);
}

/** 不演：选中“霜港”、直接注音。 */
function rubyNow(): void {
    const {base, text} = ACT_TWO_SCRIPT.ruby;
    if (desk.value?.rubied(base) === true || desk.value?.selectText(base) === null) return;
    desk.value?.editNow("ruby", {text});
    desk.value?.collapseSelection();
}

/**
 * 中文规矩的下半拍：拖选“霜港”，点选区菜单上的“注音”，在卡片里打读音、回车。菜单或卡片没出来时直接执行同一个编辑动作。
 * 菜单出来以后，亮处从提示块挪到这一段与菜单（之后是卡片）上。
 */
async function rubyBySelection(signal: AbortSignal): Promise<void> {
    const {base, text} = ACT_TWO_SCRIPT.ruby;
    if (desk.value?.rubied(base) === true) return;
    if (!(await sweepSelect(base, signal))) return;
    follow(() => [{rect: desk.value?.blockRect(base) ?? null}, {rect: desk.value?.promptRect() ?? desk.value?.selectionMenuRect() ?? null}]);
    await until(() => desk.value?.menuButton("ruby") ?? null, 1400, signal);
    await wait(300, signal);
    const opened = (await tap(() => desk.value?.menuButton("ruby") ?? null, signal)) && (await until(() => (desk.value?.promptOpen() === true ? true : null), 1400, signal)) !== null;
    if (opened) {
        await wait(380, signal);
        await typeSlowly(text, "field", signal);
        await wait(420, signal);
        desk.value?.press("Enter");
        await wait(300, signal);
    }
    desk.value?.collapseSelection();
    rubyNow();
}

/**
 * 插图：剖面图贴在“摊在桌上”那一段后面，另起一段贴（图自己占一段）。`animate` 为假时不挪指针（快进）。演的时候先照亮图要落的
 * 那一段，按 Ctrl+V；上传的那一会儿正文里是“正在上传 1 张图片”，之后长成整张图，亮处跟着它；图出来以后整张滚进视口。
 */
async function pasteEngraving(animate: boolean, signal: AbortSignal): Promise<void> {
    if (desk.value?.imageRect() != null) return;
    const image = await engravingImage();
    if (animate) await reachAfter(ACT_TWO_SCRIPT.imageAfter, signal);
    if (!caretAfter(ACT_TWO_SCRIPT.imageAfter)) return;
    if (animate) await wait(300, signal);
    desk.value?.press("Enter");
    if (animate) {
        await wait(160, signal);
        follow(() => [{rect: desk.value?.caretBlock() ?? null}]);
        await wait(700, signal);
        showKeys(["Ctrl", "V"]);
        pointerPressed.value = true;
        ripple(pointerAt);
    }
    desk.value?.pasteImage(image);
    if (animate) {
        await wait(160, signal);
        pointerPressed.value = false;
        follow(() => [{rect: within(desk.value?.uploadingRect() ?? desk.value?.imageRect(), editorBody())}]);
    }
    if ((await until(() => desk.value?.imageRect() ?? null, 4000, signal)) !== null && animate) desk.value?.revealImage();
}

/** 作品树里存下的那张图那一行（“插图”展开以后才有）。 */
function imageFileRow(): DOMRectReadOnly | null {
    const name = desk.value?.lastImageName() ?? null;
    return name === null ? null : (desk.value?.explorerRow(name) ?? null);
}

/** 图与作品树里存下的那个文件同时亮着，文件名上标小四角，中间一道细虚金线连着（@designer 第 12 轮）。 */
function lightImageAndFile(): void {
    const image = within(desk.value?.imageRect(), editorBody());
    const file = imageFileRow();
    illuminate([{rect: image, mark: "corners"}, {rect: file}]);
    actMarks.value = image === null || file === null ? [] : [
        {id: "image-file", kind: "corners", rect: rectToStage(file), small: true},
        {id: "image-thread", kind: "thread", rect: rectToStage(file), to: rectToStage(image)},
    ];
}

/**
 * 章节属性：展开面板，状态改成修改中，出场添上守门人，收起。`animate` 为假时不经指针（快进）；快进时回车以后也让面板过两帧
 * 再改下一项：同步地接着改，出场没添上（第 13 轮少动效连播实测）。
 */
async function editProperties(animate: boolean, signal: AbortSignal): Promise<void> {
    const {status, cast} = ACT_TWO_SCRIPT;
    if (animate) {
        await tap(() => desk.value?.propertiesToggle() ?? null, signal);
        await until(() => (desk.value?.propertiesOpen() === true ? true : null), 1000, signal);
        await wait(900, signal);
        say(BEATS_TWO.props, "middle");
        await wait(900, signal);
    }
    desk.value?.setPropertiesOpen(true);
    // 展开以后属性那几行下一次更新才画出来。
    await until(() => desk.value?.propertyField(status.name) ?? null, 1000, signal);
    for (const field of [status, cast]) {
        if (animate) await tap(() => desk.value?.propertyField(field.name) ?? null, signal);
        if (desk.value?.focusProperty(field.name) !== true) continue;
        if (animate) {
            await wait(300, signal);
            await typeSlowly(field.value, "field", signal);
            await wait(380, signal);
        } else desk.value?.type(field.value, "field");
        desk.value?.press("Enter");
        await (animate ? wait(600, signal) : frames(2));
    }
    if (animate) await tap(() => desk.value?.propertiesToggle() ?? null, signal);
    desk.value?.setPropertiesOpen(false);
}

/** 不演：选中“灰塔”、直接加链接。 */
function linkNow(): void {
    const {text, href} = ACT_TWO_SCRIPT.link;
    if (desk.value?.linkRect(text) != null || desk.value?.selectText(text) === null) return;
    desk.value?.editNow("link", {href});
    desk.value?.collapseSelection();
}

/**
 * 链到设定：拖选“灰塔”，按 Ctrl+K 叫出链接卡片，把地址贴进去、回车。产品的链接卡片新建时是空的，也不按名字搜作品里的文件
 * （markdown-editing.md 的“不做”：链接卡片只填地址），所以地址是贴进去的，一次到位，不逐字敲（@designer 第 12 轮：别演手敲路径，
 * 路径留到第五拍）。卡片没出来时直接执行同一个编辑动作。卡片开着时照亮这个词与卡片。
 */
async function linkBySelection(signal: AbortSignal): Promise<void> {
    const {text, href} = ACT_TWO_SCRIPT.link;
    if (desk.value?.linkRect(text) != null) return;
    if (!(await sweepSelect(text, signal))) return;
    await wait(400, signal);
    showKeys(["Ctrl", "K"]);
    desk.value?.press("k", {ctrl: true});
    if ((await until(() => (desk.value?.promptOpen() === true ? true : null), 1400, signal)) !== null) {
        follow(() => [{rect: desk.value?.textRects(text)[0] ?? null, mark: "underline"}, {rect: desk.value?.promptRect() ?? null}]);
        await wait(800, signal);
        showKeys(["Ctrl", "V"]);
        desk.value?.type(href, "field");
        await wait(1000, signal);
        desk.value?.press("Enter");
        await wait(300, signal);
    }
    desk.value?.collapseSelection();
    linkNow();
}

/** 用源码编辑器重新打开第五章（第五章已在前面；“用其它编辑器重新打开”），等它挂上（它是异步加载的）。 */
async function openSource(signal: AbortSignal): Promise<void> {
    if (desk.value?.sourceReady() === true) return;
    desk.value?.openPath(CHAPTER_FIVE_PATH);
    desk.value?.reopen("source");
    await until(() => (desk.value?.sourceReady() === true ? true : null), 5000, signal);
}

/**
 * 原文里要描金的几行：属性、提示块（标记那一行与写着伏笔的那一行）、链接、插图、注音。按这一行里一定有的字找：图与链接的地址
 * 在原文里可能被编码，找 `![` 与链接的方括号。
 */
const SOURCE_LINES = [`${ACT_TWO_SCRIPT.status.name}: ${ACT_TWO_SCRIPT.status.value}`, "[!NOTE]", "伏笔", `[${ACT_TWO_SCRIPT.link.text}](`, "![", ACT_TWO_SCRIPT.ruby.text];

/** 那几行此刻的位置，从上到下（Monaco 只画视口里的行，滚出去的不在）。 */
function sourceLineRects(): DOMRect[] {
    return SOURCE_LINES.flatMap((text) => desk.value?.sourceRects(text) ?? []).sort((a, b) => a.top - b.top);
}

/**
 * 第二幕的五拍与交给访客（第 13 轮，脚本照 @designer 第 12 轮）：都在第五章上，演示走产品自己的入口（`desk-editing.ts`），
 * 菜单或卡片没出来时直接执行同一个编辑动作，结果一样。每一拍照亮讲的那一块（四角、下划线、细线），快捷键在编辑区右下角亮键帽。
 * 标称时长量自第 13 轮在开发服务上连播的一遍（还是原文那一拍含源码编辑器第一次加载的约 4 秒，开发服务上慢）。
 */
const BEAT_STEPS_TWO: readonly StagedBeat[] = [
    {
        copy: BEATS_TWO.chinese,
        nominal: 17500,
        async play(signal) {
            await whenReadyToPlay(signal);
            captionTitle.value = ACT_TWO.number;
            caption.value = ACT_TWO.title;
            await wait(1600, signal);
            say(BEATS_TWO.chinese, "opening");
            await wait(1000, signal);
            await calloutBySlash(signal);
            await wait(700, signal);
            say(BEATS_TWO.chinese, "middle");
            await wait(900, signal);
            await rubyBySelection(signal);
            await wait(500, signal);
            conclude(BEATS_TWO.chinese);
            // 四角收紧到提示块与注了音的“霜港”上。
            illuminate([{rect: desk.value?.calloutRect() ?? null, mark: "corners"}, {rect: desk.value?.rubyRect(ACT_TWO_SCRIPT.ruby.base) ?? null, mark: "corners"}]);
            await wait(2400, signal);
            darken();
        },
        async settle(signal) {
            await calloutNow(signal);
            rubyNow();
        },
    },
    {
        copy: BEATS_TWO.image,
        nominal: 6000,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS_TWO.image, "opening");
            await wait(1200, signal);
            await pasteEngraving(true, signal);
            await wait(700, signal);
            // 作品树里多了“插图”：点开它，存下的那张图就在里面。
            await tap(() => desk.value?.explorerRow("插图") ?? null, signal);
            await until(imageFileRow, 1200, signal);
            await wait(300, signal);
            conclude(BEATS_TWO.image);
            lightImageAndFile();
            await wait(2600, signal);
            darken();
            actMarks.value = [];
        },
        settle: (signal) => pasteEngraving(false, signal),
    },
    {
        copy: BEATS_TWO.props,
        nominal: 10400,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS_TWO.props, "opening");
            desk.value?.revealProperties();
            // 亮处跟着属性面板：展开时四角拉开，收起时缩回那一行摘要。
            follow(() => [{rect: desk.value?.propertiesRect() ?? null, mark: "corners"}]);
            await wait(1100, signal);
            await editProperties(true, signal);
            await wait(500, signal);
            conclude(BEATS_TWO.props);
            await wait(2400, signal);
            darken();
        },
        settle: (signal) => editProperties(false, signal),
    },
    {
        copy: BEATS_TWO.link,
        nominal: 7500,
        async play(signal) {
            await whenReadyToPlay(signal);
            say(BEATS_TWO.link, "opening");
            await wait(1100, signal);
            await linkBySelection(signal);
            darken();
            await wait(600, signal);
            // 按住 Ctrl 点链接，灰塔那一页在新标签里翻开：亮处扩到新标签连同那一页的正文，标签上标小四角。
            if (!(await ctrlTap(() => desk.value?.linkRect(ACT_TWO_SCRIPT.link.text) ?? null, signal))) desk.value?.openPath(GRAY_TOWER_PATH);
            const tab = await until(() => desk.value?.tabRect("灰塔.md") ?? null, 1500, signal);
            await wait(300, signal);
            conclude(BEATS_TWO.link);
            illuminate([{rect: union(tab, editorBody())}]);
            if (tab !== null) actMarks.value = [{id: "gray-tower-tab", kind: "corners", rect: rectToStage(tab), small: true}];
            await wait(2200, signal);
            darken();
            actMarks.value = [];
            // 看过一会儿切回第五章。
            await wait(300, signal);
            await tap(() => desk.value?.tabRect("第五章 第四下") ?? null, signal);
            await wait(500, signal);
        },
        async settle() {
            linkNow();
            desk.value?.openPath(GRAY_TOWER_PATH);
            desk.value?.openPath(CHAPTER_FIVE_PATH);
        },
    },
    {
        copy: BEATS_TWO.file,
        nominal: 8800,
        async play(signal) {
            await whenReadyToPlay(signal);
            // 被打断时可能停在原文里：从富文本起演。
            desk.value?.reopen("markdown");
            say(BEATS_TWO.file, "opening");
            await wait(1200, signal);
            await openSource(signal);
            await wait(600, signal);
            // 放开整片编辑区，原文里那几行自上而下依次描金，齐亮一会儿。切回富文本是交给访客那一段的事：这一拍的终态停在原文里，
            // 少动效时直接摆上这一拍，看到的也是原文。
            illuminate([{rect: editorBody()}]);
            for (const [index, rect] of sourceLineRects().entries()) {
                actMarks.value = [...actMarks.value, {id: `source-${String(index)}`, kind: "underline", rect: rectToStage(rect)}];
                await wait(340, signal);
            }
            conclude(BEATS_TWO.file);
            await wait(1600, signal);
            actMarks.value = [];
            darken();
        },
        settle: openSource,
    },
    {
        // 交给访客：切回富文本，光标放在第五章末尾。
        copy: null,
        nominal: 0,
        async play(signal) {
            desk.value?.reopen("markdown");
            await focusChapterFive(signal);
        },
        async settle(signal) {
            desk.value?.reopen("markdown");
            await focusChapterFive(signal);
        },
    },
];

const actTwo = useStagedAct<DeskSnapshot>({
    name: "第二幕",
    beats: BEAT_STEPS_TWO,
    wide,
    reduced,
    narrowMs: NARROW_MS,
    onStage: () => live.value === 2 && inView.value,
    hooks: {
        prepare: () => {
            handoff.value = false;
            ring.value = null;
        },
        rest: (beat, how, last) => {
            if (last) {
                handoff.value = true;
                return;
            }
            const copy = BEAT_STEPS_TWO[beat]?.copy ?? null;
            if (copy !== null && how !== "played") say(copy, "closing");
        },
        capture: captureDesk,
        restore: restoreDesk,
        tidy,
        idle: hidePointer,
        narrow: (beat, signal) => narrowPlay(BEAT_STEPS_TWO, beat, signal),
    },
});

/** 两幕的导演各在做什么（给探针读：台下那一幕停没停稳、有没有自己动起来）。 */
const phases = computed(() => `${actOne.phase.value} | ${actTwo.phase.value}`);

/** 显示的是哪一幕的连播：章节条、它的按钮与探针读的数据属性跟着它。 */
const stagedAct = computed(() => (shownAct.value === 2 ? actTwo : actOne));
const rail = computed(() => {
    const staged = stagedAct.value;
    return {
        chapters: staged.chapters,
        current: staged.railCurrent.value,
        done: staged.railDone.value,
        progress: staged.railProgress.value,
        status: staged.railStatus.value,
        hold: staged.hold.value,
        beat: staged.current.value,
        phase: staged.phase.value,
    };
});

/** 字幕那一条：开演以后，落地（窄屏是首屏的字退开）时显出来；换幕时收着。 */
const captionShown = computed(() => captionsReady.value && (shownAct.value === 2 || actOne.started.value) && (wide.value ? landed.value : dive.value >= 0.3));

/**
 * 访客自己动了工作台：演示让开，章节条尾换成“继续演示”；访客摆的样子留着，按了才从它走回去。
 * 已经交给访客（最后一拍）时只熄掉金环：那一段本来就是让访客动的。窄屏不演示，不用让；换幕时不算。
 */
function onVisitorTouch(): void {
    const staged = stagedAct.value;
    if (switching.value || !wide.value || !staged.started.value) return;
    if (staged.finished.value || staged.current.value === staged.last) {
        ring.value = null;
        return;
    }
    staged.touch();
}

// ── 换幕：进第二幕落印，回第一幕不落印 ──

interface CaptionState {
    readonly title: string;
    readonly line: string;
    readonly handoff: boolean;
}
interface LeftAct {
    readonly desk: DeskSnapshot;
    readonly caption: CaptionState;
}
/** 每一幕离开时桌上的样子与字幕：回来时照它重新挂一台、换回字幕，那一幕的导演接着演（离开时它停在 `away`）。 */
const left: {one: LeftAct | null; two: LeftAct | null} = {one: null, two: null};

/**
 * 一幕离台时记下桌上的样子：还在连播的（演到半截或两拍之间）记最后停稳那一拍的终态（`shelve`：回来接着演时不用再摆回一次）；
 * 演完了（交给访客以后访客可能摆过）或访客动过手的，照此刻的样子记。
 */
async function leaveAct(staged: StagedAct<DeskSnapshot>): Promise<LeftAct> {
    const words: CaptionState = {title: captionTitle.value, line: caption.value, handoff: handoff.value};
    const shelved = staged.finished.value ? null : staged.director.shelve();
    return {desk: shelved ?? (await captureDesk()), caption: words};
}

/**
 * 换上某一幕的字幕。要在眉题看不见的时候换：眉题里新旧两行是先出后进（约 0.66 秒），眉题显出来时还没换完，会先露出上一幕的那一行。
 * 交给访客时标签上的金环要量新挂的那一台，由调用方在挂好以后摆（`settleHandoff`）。
 */
function putCaption(state: CaptionState, which: 1 | 2): void {
    captionAct.value = which;
    captionTitle.value = state.title;
    caption.value = state.line;
    handoff.value = state.handoff;
}

/** 换幕时的等待不随某一拍打断（换幕本身排队，见 `switchAct`）。 */
const SWITCH_SIGNAL = new AbortController().signal;

/** 第二幕起头的样子：首屏的布局与标签，第五章换成第二幕的（带属性、又往下写了一段），设定里多一页灰塔（`actTwoFiles`）。 */
function actTwoStart(): DeskSnapshot {
    if (deskInitial === null) throw new Error("工作台还没挂好，第二幕没有起头的样子");
    return {...deskInitial, files: actTwoFiles(deskInitial.files ?? PROJECT_FILES), images: []};
}

/** 换幕开始：离台那一幕的装饰、指针与交给访客的金环都收掉，压上薄暮（工作台同时微退）。 */
function lowerCurtain(): void {
    tidy();
    hidePointer();
    ring.value = null;
    curtain.value = true;
}

/**
 * 进第二幕（@designer 第 12 轮“沉幕落印”）：眉题与章节条收起（`queueSwitch`），工作台压暗、微退 0.3 秒；薄暮压满以后眉题换上第二幕的字，
 * 工作台在薄暮下换成第二幕的样子（第一次是起头的样子，之后是第二幕离开时的样子）；挂好以后正中描出 II 与副题 0.7 秒；
 * 最后 0.65 秒印收进眉题，工作台回亮，第一次进来时右栏收起（布局动画）；印快到眉题时眉题显出来，章节条换成第二幕的五段、依次亮起；之后第二幕上台开演。
 * 描线等工作台挂好才起：重挂一台时主线程要忙一阵，描线的虚线偏移是在主线程上走的动画，同时起会一开头就跳掉一截。
 */
async function enterActTwo(): Promise<void> {
    await whenDeskInitial;
    // 等第一幕看见自己离了台（`away`）、收拾完手里的拖动。
    await nextTick();
    left.one = await leaveAct(actOne);
    lowerCurtain();
    await wait(300, SWITCH_SIGNAL);
    const back = left.two;
    putCaption(back?.caption ?? {title: ACT_TWO.number, line: ACT_TWO.title, handoff: false}, 2);
    await remount(back?.desk ?? actTwoStart());
    seal.value = "drawing";
    await wait(700, SWITCH_SIGNAL);
    measureDock();
    seal.value = "docked";
    curtain.value = false;
    // 右栏在落印收进眉题时收起（布局动画），第二幕从收起以后的样子起演；回来的那一次，记下的样子里本来就收着。
    if (back === null) desk.value?.setAuxiliaryHidden(true);
    // 印飞到一半多、快到眉题时，眉题与章节条才显出来（一开始收就显，字先到、印后到）。
    await wait(350, SWITCH_SIGNAL);
    shownAct.value = 2;
    captionsReady.value = true;
    await wait(300, SWITCH_SIGNAL);
    // 第二幕的导演要有起头的样子才开演（`prime`）；只在第一次进来时给，之后它自己记着每一拍的终态。
    if (back === null) actTwo.director.prime(await captureDesk());
    seal.value = "off";
    live.value = 2;
}

/**
 * 回第一幕：不落印。薄暮盖上 0.3 秒，眉题趁看不见换回第一幕的字，工作台按第一幕离开时的样子重新挂一台（右栏也回来），挂好再揭开；
 * 第一幕停在交给访客时，标签上的金环摆回去。第二幕停在离开时的那一拍。
 */
async function returnToActOne(): Promise<void> {
    await nextTick();
    left.two = await leaveAct(actTwo);
    lowerCurtain();
    await wait(300, SWITCH_SIGNAL);
    const back = left.one;
    putCaption(back?.caption ?? {title: "", line: "", handoff: false}, 1);
    await remount(back?.desk ?? deskInitial);
    // 眉题里换字（没有样式的过渡名，过两帧算走完）排在帧上，重挂工作台时帧被挤后；等它走完再揭开，不然先露出第二幕的那一行。
    await frames(4);
    if (back?.caption.handoff === true) settleHandoff();
    shownAct.value = 1;
    curtain.value = false;
    captionsReady.value = true;
    await wait(300, SWITCH_SIGNAL);
    live.value = 1;
}

/**
 * 按此刻的 `act` 换幕。一次换完才排下一次；排到时幕已经换回去了（滚过分界又滚回来），什么都不换，收起的字幕放出来、停下的那一幕接着演。
 */
async function switchAct(): Promise<void> {
    if (act.value === 2 && shownAct.value === 1) await enterActTwo();
    else if (act.value === 1 && shownAct.value === 2) await returnToActOne();
    else {
        captionsReady.value = true;
        live.value = act.value;
    }
}
let switchChain: Promise<void> = Promise.resolve();
function queueSwitch(): void {
    // 同一次刷新里就收起字幕、让两幕都停下：不然这一帧先照旧画一遍，章节条与眉题还没收起来，换幕要等排到它。
    live.value = 0;
    captionsReady.value = false;
    switchChain = switchChain.then(switchAct, switchAct).catch((error: unknown) => console.error("[homepage] 换幕", error));
}
watch(act, queueSwitch);

/** 落印收进眉题时往上挪多少：从工作台中间挪到眉题那一条的中间。 */
const sealStyle = computed(() => {
    const {left: x, top, width, height} = box.value;
    return {left: px(x), top: px(top), width: px(width), height: px(height)};
});
/** 印收进眉题时罗马数字落到哪里（`measureDock` 在收之前量）。 */
const sealDock = shallowRef({x: 0, y: -240, scale: 0.34});

/**
 * 印收进眉题：罗马数字落到眉题里这一幕名字的中心、缩到和它一样高。在收之前量：这时眉题已经换好这一幕的字（还收着，照样排版），
 * 罗马数字描在正中。量到的是视口坐标，除掉 Lab 画布的缩放。
 */
function measureDock(): void {
    const numeral = page.value?.querySelector<SVGElement>(".as__numeral") ?? null;
    const name = page.value?.querySelector<HTMLElement>(".hs-eyebrow__title") ?? null;
    if (numeral === null || name === null) return;
    const from = numeral.getBoundingClientRect();
    const to = name.getBoundingClientRect();
    if (from.height === 0 || to.height === 0) return;
    const {zoom} = stageFrame();
    sealDock.value = {
        x: Math.round((to.left + to.width / 2 - (from.left + from.width / 2)) / zoom),
        y: Math.round((to.top + to.height / 2 - (from.top + from.height / 2)) / zoom),
        scale: Math.min(0.5, Math.max(0.12, to.height / from.height)),
    };
}

/**
 * 交给访客那一行的第二个按钮：滚到下一幕。它是指向下一幕锚点的链接（没有脚本时照样跳）；这里拦下，在页面自己的滚动容器里滚过去，
 * 不改地址栏（Lab 的地址带着场景）。
 */
function nextAct(event: MouseEvent): void {
    const scroller = page.value;
    if (scroller === null) return;
    event.preventDefault();
    scroller.scrollTo({top: captionAct.value === 1 ? size.value.height * 1.8 : scroller.scrollHeight, behavior: reduced ? "auto" : "smooth"});
}

// ── 生命周期 ──

let resize: ResizeObserver | null = null;
let visibility: IntersectionObserver | null = null;
/** 拖动的落点与拖影画在 body 下（产品的覆盖层自己传送），继承不到页面上的变量：挂着时在根上换成金色，卸载时还原。 */
const DROP_VARS = {
    "--drop-area-fill": "rgb(225 178 133 / 0.2)",
    "--drop-area-border": "#c08a3e",
    "--nb-layout-accent-main": "#a8762f",
    "--nb-layout-accent-text": "#6f4a17",
} as const;
const previousDropVars = new Map<string, string>();

onMounted(() => {
    paintRoot(night.value);
    const root = page.value;
    if (root !== null) {
        size.value = {width: root.clientWidth, height: root.clientHeight};
        resize = new ResizeObserver(() => {
            size.value = {width: root.clientWidth, height: root.clientHeight};
            trail?.resize(size.value.width, size.value.height);
            syncHand();
        });
        resize.observe(root);
        if (stage.value !== null) {
            visibility = new IntersectionObserver(([entry]) => {
                if (entry !== undefined) inView.value = entry.intersectionRatio >= 0.5;
            }, {root, threshold: [0.5]});
            visibility.observe(stage.value);
        }
    }
    if (trailCanvas.value !== null) {
        trail = createTrail(trailCanvas.value);
        trail.resize(size.value.width, size.value.height);
        trail.tone(!night.value);
    }
    syncHand();
    const style = document.documentElement.style;
    for (const [name, value] of Object.entries(DROP_VARS)) {
        previousDropVars.set(name, style.getPropertyValue(name));
        style.setProperty(name, value);
    }
    if (props.start === "act-one") scrollToAct(1);
    if (props.start === "act-two") {
        scrollToAct(2);
        queueSwitch();
    }
});

onBeforeUnmount(() => {
    actOne.dispose();
    actTwo.dispose();
    blobs.dispose();
    tidy();
    trail?.dispose();
    resize?.disconnect();
    visibility?.disconnect();
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
    <div ref="page" class="hs" :class="{'hs--narrow': !wide, 'hs--day': !night}" :style="pageStyle" :data-hs-act="act" :data-hs-shown-act="shownAct" :data-hs-switching="switching" :data-hs-beat="rail.beat" :data-hs-phase="rail.phase" :data-hs-phases="phases" :data-hs-landed="landed" :data-hs-night="night" @scroll.passive="onScroll">
        <div class="hs-run">
            <div ref="stage" class="hs-stage">
                <SanctumScene :progress="dive" :intro="start === 'top'" :desk-ready="deskReady" :night="night" @landed="onLanded">
                    <template #desk>
                        <HomepageDesk :key="deskKey" ref="desk" class="hs-desk" :class="{'is-receded': curtain}" setup="knock" :night="night" :restore="restore" :blobs="blobs" @ready="onDeskReady" @touch="onVisitorTouch" />
                        <Transition name="hs-dusk">
                            <div v-if="lightsOut" class="hs-lights-out" aria-hidden="true">
                                <NeuroBookMark decorative class="hs-lights-out__mark" />
                            </div>
                        </Transition>
                        <Transition name="hs-fade">
                            <div v-if="veil || curtain" class="hs-veil" aria-hidden="true"></div>
                        </Transition>
                    </template>
                    <template #hero="{lit, glint}">
                        <header class="hs-nav" :class="{'is-lit': lit}">
                            <a class="hs-nav__brand" href="#">
                                <NeuroBookMark decorative class="hs-nav__mark" />
                                <span>NeuroBook</span>
                            </a>
                            <nav class="hs-nav__links" aria-label="站点">
                                <a href="#">文档</a>
                                <a href="#" class="hs-nav__extra">更新日志</a>
                                <a href="#">GitHub</a>
                                <!-- 昼夜切换：首屏在导航的最右端，落地以后在字幕那一条的左端（两处是同一个开关）。 -->
                                <button type="button" class="hs-nav__daynight" :aria-pressed="night" :aria-label="night ? '换成白天' : '换成夜间'" :title="night ? '换成白天' : '换成夜间'" @click="night = !night">
                                    <span :class="night ? 'i-lucide-moon' : 'i-lucide-sun'" aria-hidden="true"></span>
                                </button>
                            </nav>
                        </header>
                        <section class="hs-hero" :class="{'is-lit': lit, 'is-glint': glint}">
                            <p class="hs-hero__tagline" lang="en">{{ TAGLINE }}</p>
                            <h1 class="hs-hero__title"><span v-for="part in headlineParts" :key="part" class="hs-hero__phrase">{{ part }}</span></h1>
                            <span class="hs-hero__flourish" :style="{'--hs-filigree': `url(${FILIGREE})`}">
                                <img :src="FILIGREE" alt="" />
                                <span v-if="glint" class="hs-hero__gleam" aria-hidden="true"></span>
                            </span>
                            <p class="hs-hero__lede">{{ LEDE }}</p>
                            <div class="hs-hero__actions">
                                <GiltButton primary :day="!night" :size="wide ? 'regular' : 'small'" :glint="glint">下载 NeuroBook</GiltButton>
                                <GiltButton :day="!night" :size="wide ? 'regular' : 'small'" :glint="glint">在 GitHub 上看看</GiltButton>
                            </div>
                            <p class="hs-hero__note">0.17 预览版，支持 Windows 与 macOS，开源免费</p>
                        </section>
                    </template>
                </SanctumScene>

                <!-- 鎏金标记：星璃那一栏的四角、两声敲门的下划线、交给访客时标签的小四角（见上面的 `pageMarks`）。 -->
                <GildedMarks :marks="pageMarks" :day="!night" />

                <!-- 案头聚光：压在工作台上、眉题与章节条下面（DOM 顺序在它们前面）。 -->
                <DeskSpotlight :spots="spots" :marks="spotMarks" :width="size.width" :height="size.height" :night="night" />

                <!-- 换幕的落印（宽屏）：压在工作台正中，收进上面的眉题（见 `enterActTwo`）。 -->
                <div v-if="wide" class="hs-seal" :style="sealStyle">
                    <ActSeal :numeral="ACT_TWO.numeral" :title="ACT_TWO.title" :state="seal" :dock-x="sealDock.x" :dock-y="sealDock.y" :dock-scale="sealDock.scale" :day="!night" />
                </div>

                <!-- 眉题（宽屏）：工作台正上方，这一拍的短标题与一句字幕；换一句时旧的淡出、新的从下面浮上来。 -->
                <div v-if="wide" class="hs-eyebrow" :style="eyebrowStyle" :class="{'is-shown': captionShown}">
                    <!--
                        收着的时候换字用一个没有样式的过渡名（hs-cut）：换幕时工作台重挂、主线程忙，先出后进会拖到眉题显出来以后才走完，
                        先露出上一幕的那一行。没有样式时 Vue 过两帧就算走完；不能用 :css="false"：离场在同一次更新里同步走完，
                        out-in 在更新到一半时重渲染，第 13 轮实测抛错（parentNode 为 null）、整页卡住。
                    -->
                    <Transition :name="captionsReady ? 'hs-line' : 'hs-cut'" mode="out-in">
                        <p :key="`${eyebrow.title}|${eyebrow.line}`" class="hs-eyebrow__row">
                            <span class="hs-eyebrow__title">{{ eyebrow.title }}</span>
                            <span class="hs-eyebrow__line">{{ eyebrow.line }}</span>
                        </p>
                    </Transition>
                </div>

                <!-- 章节条那一条：宽屏在工作台下面，交给访客时下面展开星璃的小贴纸与两个按钮；窄屏在上面，下面一行是字幕。 -->
                <div class="hs-caption" :style="captionStyle" :class="{'is-shown': captionShown}" :data-hs-rail-done="rail.done" :data-hs-hold="rail.hold ?? 'none'">
                    <ChapterRail class="hs-rail" :label="`${shownAct === 2 ? ACT_TWO.number : ACT_ONE.number}的章节`" :chapters="rail.chapters" :current="rail.current" :done="rail.done" :progress="rail.progress" :status="rail.status" @jump="(beat: number) => stagedAct.jumpTo(beat)" @pause="stagedAct.pause()" @resume="stagedAct.resume()" @replay="stagedAct.replay()" />
                    <Transition :name="captionsReady ? 'hs-line' : 'hs-cut'" mode="out-in">
                        <div v-if="handoff" key="handoff" class="hs-caption__row">
                            <img class="hs-caption__peek" :src="LYRA_PEEK" alt="" />
                            <p v-if="!wide" class="hs-caption__line">{{ eyebrow.title }}：{{ eyebrow.line }}</p>
                            <GiltButton primary size="small" :day="!night">下载 NeuroBook</GiltButton>
                            <GiltButton size="small" :day="!night" :href="captionAct === 1 ? '#act-two' : '#act-three'" @click="nextAct">{{ captionAct === 1 ? "接着看编辑器" : "接着看世界引擎" }}</GiltButton>
                        </div>
                        <div v-else-if="!wide" :key="narrowLine" class="hs-caption__row">
                            <p class="hs-caption__line">{{ narrowLine }}</p>
                        </div>
                    </Transition>
                </div>

                <!-- 昼夜切换：落地以后出现，在章节条那一行的左端。右端是章节条的条尾，让开以后换成更宽的“继续演示”，放在右端会撞上。 -->
                <Transition name="hs-fade">
                    <button v-if="landed && wide" type="button" class="hs-daynight" :style="{left: px(box.left), top: px(box.top + box.height + 16)}" :aria-pressed="night" @click="night = !night">
                        <span :class="night ? 'i-lucide-moon' : 'i-lucide-sun'" class="hs-daynight__icon" aria-hidden="true"></span>
                        {{ night ? "夜" : "昼" }}
                    </button>
                </Transition>

                <!-- 演示的手：传送到 body 下，压在工作台开出的一切浮层之上（见文件头第 4 条）；箭头的尖在指针元素的原点上。 -->
                <Teleport to="body">
                    <div ref="handLayer" class="hs-hand" :class="{'hs-hand--day': !night}" aria-hidden="true">
                        <canvas ref="trailCanvas" class="hs-trail"></canvas>
                        <div ref="pointer" class="hs-pointer" :class="{'is-shown': pointerShown, 'is-pressed': pointerPressed, 'is-carrying': pointerCarrying}">
                            <svg viewBox="0 0 24 30" width="28" height="35">
                                <defs>
                                    <linearGradient id="hs-pointer-gold" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0" stop-color="#fff6da" />
                                        <stop offset="0.42" stop-color="#ecc77e" />
                                        <stop offset="1" stop-color="#a8762f" />
                                    </linearGradient>
                                </defs>
                                <path d="M1.5,1.5 L1.5,24 L7.2,18.6 L11.2,27.6 L15,26 L11.1,17.2 L19,17.2 Z" fill="url(#hs-pointer-gold)" stroke="#24130a" stroke-width="1.5" stroke-linejoin="round" />
                                <path d="M3.4,5.6 L3.4,19.2" stroke="#fffaf0" stroke-opacity="0.7" stroke-width="1" stroke-linecap="round" />
                            </svg>
                        </div>
                        <!-- 快捷键的键帽：编辑区右下角（见 `showKeys`）。 -->
                        <Transition name="hs-keys">
                            <div v-if="keycaps !== null" :key="keycaps.id" class="hs-keys" :style="{left: px(keycaps.at.x), top: px(keycaps.at.y)}">
                                <template v-for="(name, index) in keycaps.names" :key="name">
                                    <span v-if="index > 0" class="hs-keys__plus">+</span>
                                    <kbd class="hs-keys__cap">{{ name }}</kbd>
                                </template>
                            </div>
                        </Transition>
                    </div>
                </Teleport>
            </div>

            <!-- 滚动轨道：俯冲一屏，落地后舞台再钉一段（滚轮的余势不至于一下滚过第一幕），再钉一屏是第二幕；两幕都连播，不靠滚动。这里的字给读屏与搜索。 -->
            <div class="hs-track">
                <div class="hs-track__dive" aria-hidden="true"></div>
                <section class="hs-track__act" aria-label="第一幕">
                    <ol class="hs-sr">
                        <li v-for="(beat, index) in BEAT_STEPS" :key="index">{{ beat.copy === null ? `${HANDOFF.title}：${HANDOFF.line}` : `${beat.copy.title}：${beat.copy.opening}${beat.copy.closing}` }}</li>
                    </ol>
                </section>
                <section id="act-two" class="hs-track__act2" aria-label="第二幕">
                    <ol class="hs-sr">
                        <li v-for="(beat, index) in BEAT_STEPS_TWO" :key="index">{{ beat.copy === null ? `${HANDOFF_TWO.title}：${HANDOFF_TWO.line}` : `${beat.copy.title}：${beat.copy.opening}${beat.copy.closing}` }}</li>
                    </ol>
                </section>
            </div>
        </div>

        <section id="act-three" class="hs-next">
            <img class="hs-next__flourish" :src="FILIGREE" alt="" />
            <p class="hs-next__act">第三幕</p>
            <h2 class="hs-next__title">世界记得每一章</h2>
            <p class="hs-next__note">这一幕之后出稿。</p>
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
    position: relative;
    display: block;
    width: min(360px, 70%);
    margin: 14px 0 0;
    clip-path: inset(0 50% 0 50%);
    transition:
        opacity 900ms var(--hs-ease) var(--rise-delay),
        clip-path 1300ms var(--hs-ease) var(--rise-delay);
}

.hs-hero__flourish img {
    display: block;
    width: 100%;
    height: auto;
}

.hs-hero.is-lit > .hs-hero__flourish {
    clip-path: inset(0 0 0 0);
}

/*
 * 鎏金反光（场景开着 `glint` 时，第 7 轮）：花饰与按钮金边上一团柔和的亮，跟着指针走（场景在插槽外面写 `--sx-glint-x`、`--sx-glint-y`）。
 * 花饰的那一团用同一张图做遮罩，只亮在金线上；不扫白光（@designer：扫光像页游）。
 */
.hs-hero__gleam {
    position: absolute;
    inset: 0;
    background: radial-gradient(26% 160% at calc(50% + var(--sx-glint-x, 0) * 48%) 50%, rgb(255 248 224 / 0.95), rgb(255 230 170 / 0.3) 45%, transparent 75%);
    opacity: 0.6;
    mix-blend-mode: screen;
    pointer-events: none;
    mask: var(--hs-filigree) center / 100% 100% no-repeat;
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

/* ── 第一幕：手（指针与尾迹）、描金、星璃那一栏的光、金环 ── */

/*
 * 手那一层传送到 body 下、固定定位，脚本把它平移、缩放到舞台的矩形上（`syncHand`）。层级写字面量：它代表访客的鼠标，
 * 要压在演示会开出的一切之上（选区菜单、拖动的卡片、浮窗、右键菜单都从 nb-ui 的层级登记表取，最高到命令面板的 9200），
 * 只让给 Lab 的检查框（9900）。
 */
.hs-hand {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9800;
    overflow: hidden;
    transform-origin: 0 0;
    pointer-events: none;
}

.hs-trail {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

/* 指针比系统鼠标大一号、金身深边，加一圈淡金的光：在密的界面里一眼找得到（@designer 第 8 轮：截图里要找两秒）。 */
.hs-pointer {
    position: absolute;
    top: 0;
    left: 0;
    opacity: 0;
    filter: drop-shadow(0 3px 5px rgb(0 0 0 / 0.6)) drop-shadow(0 0 10px rgb(240 201 135 / 0.55));
    transition: opacity 220ms ease;
}

.hs-pointer.is-shown {
    opacity: 1;
}

/* 按下：缩一点、往下沉一点；拖着走：微微前倾；松开：带一点回弹地复原（@designer 第 8 轮）。 */
.hs-pointer svg {
    display: block;
    transform-origin: 2px 2px;
    transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.hs-pointer.is-pressed svg {
    transform: translate3d(0, 1.5px, 0) scale(0.88);
    transition-duration: 110ms;
    transition-timing-function: ease-out;
}

.hs-pointer.is-pressed.is-carrying svg {
    transform: translate3d(0, 1.5px, 0) rotate(-6deg) scale(0.88);
    transition-duration: 180ms;
}

/*
 * 快捷键的键帽（第 13 轮）：编辑区右下角（右下角对在给的那一点上），金边深底、底下一道深色的键身，像按在一块小铜牌上；
 * 白天的工作台是浅的，深底照样浮得出来。出现时从下面浮上来，收起时淡掉。
 */
.hs-keys {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    transform: translate(-100%, -100%);
}

.hs-keys__cap {
    min-width: 30px;
    padding: 3px 9px 4px;
    border: 1px solid #c08a3e;
    border-radius: 6px;
    background: linear-gradient(#2e1a0e, #1d1009);
    box-shadow:
        0 2px 0 #0b0604,
        0 0 14px rgb(240 201 135 / 0.35);
    color: #f6dca6;
    font: 600 13px/18px var(--hs-latin);
    letter-spacing: 0.03em;
    text-align: center;
}

.hs-keys__plus {
    color: #f0c987;
    font: 500 12px/1 var(--hs-latin);
    opacity: 0.8;
}

.hs-keys-enter-active {
    transition:
        opacity 160ms ease-out,
        translate 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.hs-keys-leave-active {
    transition: opacity 200ms ease-in;
}

.hs-keys-enter-from {
    opacity: 0;
    translate: 0 6px;
}

.hs-keys-leave-to {
    opacity: 0;
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

/* ── 字幕：宽屏是上面的眉题与下面的章节条；窄屏都在上面 ── */

/*
 * 眉题：短标题大一号、金色衬线，隔一道细竖线是那一句字幕；和工作台左边对齐，底边离工作台约 14px（第 8 轮）。
 * 藏起来时连同里面的字一起不接指针（visibility 在淡出走完以后才切），下面章节条那一条同理。
 */
.hs-eyebrow {
    position: absolute;
    display: flex;
    align-items: flex-end;
    padding-bottom: 14px;
    visibility: hidden;
    opacity: 0;
    transition:
        opacity 500ms var(--hs-ease),
        visibility 0s linear 500ms;
    pointer-events: none;
}

.hs-eyebrow.is-shown {
    visibility: visible;
    opacity: 1;
    transition:
        opacity 500ms var(--hs-ease),
        visibility 0s;
}

.hs-eyebrow__row {
    display: flex;
    align-items: baseline;
    gap: 16px;
    min-width: 0;
    margin: 0;
}

.hs-eyebrow__title {
    flex: none;
    color: var(--hs-gold-light);
    font-family: var(--hs-serif);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-shadow: 0 0 18px rgb(240 201 135 / 0.35);
}

.hs-eyebrow__line {
    position: relative;
    min-width: 0;
    padding-left: 17px;
    color: #f1e9da;
    font-family: var(--hs-serif);
    font-size: 18px;
    letter-spacing: 0.05em;
    white-space: nowrap;
}

/* 标题与字幕之间一道细竖线：两头淡，像书页上的界栏。 */
.hs-eyebrow__line::before {
    position: absolute;
    top: 50%;
    left: 0;
    width: 1px;
    height: 20px;
    content: "";
    background: linear-gradient(transparent, var(--hs-gold), transparent);
    transform: translateY(-50%);
}

/* 章节条那一条：藏起来时连同章节条的按钮一起不接指针（visibility 在淡出走完以后才切）。 */
.hs-caption {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    visibility: hidden;
    opacity: 0;
    transition:
        opacity 500ms var(--hs-ease),
        visibility 0s linear 500ms;
}

.hs-caption.is-shown {
    visibility: visible;
    opacity: 1;
    transition:
        opacity 500ms var(--hs-ease),
        visibility 0s;
}

/*
 * 条尾挂在章节条右边、不占条的宽：两边各留出它（`--cr-tail`），字幕那一条窄时条跟着收窄；
 * 收到 360 以下时条尾自己挪到下一行（窄屏）。不这样留，舞台 900 到 1000 上下时让开以后的“继续演示”会伸出舞台。
 */
.hs-rail {
    width: max(min(660px, 100% - 2 * var(--cr-tail)), min(100%, 360px));
    pointer-events: auto;
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

/* ── 滚动轨道：俯冲一屏，落地后再钉 0.8 屏（字幕在舞台上，这里的字给读屏与搜索） ── */

.hs-track__dive {
    height: var(--hs-vh);
}

.hs-track__act {
    position: relative;
    height: calc(var(--hs-vh) * 0.8);
}

/* 第二幕那一段（第 13 轮）：滚过 1.55 屏换到第二幕，舞台再钉一屏。 */
.hs-track__act2 {
    position: relative;
    height: var(--hs-vh);
}

/* 换幕的落印盖在工作台的矩形上，不接指针。 */
.hs-seal {
    position: absolute;
    pointer-events: none;
}

.hs-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
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

/* 换幕时工作台微微往后退，换好以后回来（新挂的一台一出来就是退着的，揭开时往前回到原处）。 */
.hs-desk {
    transition: transform 300ms var(--hs-ease);
}

.hs-desk.is-receded {
    transform: scale(0.985);
}

@media (prefers-reduced-motion: reduce) {
    .hs-desk {
        transition: none;
    }

    .hs-desk.is-receded {
        transform: none;
    }
}

/*
 * ── 昼 ──
 * 第 6 轮起白天的墙是亮的，字换成深墨。第 12 轮（开发者：首屏的上半部分还是米黄色）墙换成午后斜阳照着的虚焦胡桃木
 * （`SanctumScene.vue`，@designer 第 12 轮方案 A），首屏的字与导航、窄屏的字幕与章节条跟着回到夜里那套浅色，只是金更暖。
 * 按钮与昼夜开关照旧。
 */
.hs--day {
    --hs-gold: #dcae66;
    --hs-gold-light: #efc97f;
    background: #2e1a10;
}

/* 导航压在窗光最亮的左上角：顶上一道深暖的渐变托住浅色字。 */
.hs--day .hs-nav {
    background: linear-gradient(rgb(30 15 8 / 0.55), rgb(30 15 8 / 0.18) 70%, transparent);
}

.hs--day .hs-nav__links a {
    color: rgb(245 231 208 / 0.74);
}

.hs--day .hs-nav__brand,
.hs--day .hs-nav__links a:hover {
    color: #f5e7d0;
}

.hs--day .hs-nav__daynight,
.hs--day .hs-daynight {
    background:
        linear-gradient(rgb(250 244 232 / 0.86), rgb(250 244 232 / 0.86)) padding-box,
        var(--hs-gilt) border-box;
    color: #6f4a17;
}

.hs--day .hs-hero__title {
    background: linear-gradient(180deg, #fffaf0 0%, #fbf2e1 55%, #ecc68e 100%);
    background-clip: text;
}

.hs--day .hs-hero.is-lit > .hs-hero__title {
    filter: drop-shadow(0 2px 16px rgb(24 11 5 / 0.6));
}

.hs--day .hs-hero__lede {
    color: #e8d5b8;
}

.hs--day .hs-hero__note {
    color: rgb(232 213 184 / 0.62);
}

.hs-hand--day .hs-pointer {
    filter: drop-shadow(0 3px 6px rgb(64 38 18 / 0.5)) drop-shadow(0 0 8px rgb(255 244 214 / 0.9));
}

.hs--day .hs-veil {
    background: rgb(236 230 218 / 0.8);
}

/*
 * 白天的眉题与章节条压在胡桃木上（宽屏落地以后四周是案面，第 10 轮起；窄屏第 12 轮起压在虚焦的胡桃木墙上）：
 * 浅色的字与亮金，和夜里一个路数，只是更暖。
 */
.hs--day .hs-eyebrow__line {
    color: rgb(250 240 222 / 0.92);
}

.hs--day .hs-eyebrow__title {
    color: #f0d79a;
    text-shadow: 0 1px 12px rgb(40 20 8 / 0.6);
}

.hs--day .hs-eyebrow__line::before {
    background: linear-gradient(transparent, #d8b06a, transparent);
}

.hs--day .hs-rail {
    --cr-gold: #d8b06a;
    --cr-gold-light: #f0d79a;
    --cr-dim: rgb(240 214 160 / 0.42);
    --cr-ink: rgb(250 238 214 / 0.72);
    --cr-glow: rgb(240 200 120 / 0.3);
    --cr-plate: rgb(44 24 12 / 0.55);
    --cr-tip-core: #fff3cf;
}

.hs--day .hs-next {
    background: #2e1a10;
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

    .hs-pointer svg,
    .hs-keys-enter-active,
    .hs-keys-leave-active {
        transition: none;
    }
}
</style>
