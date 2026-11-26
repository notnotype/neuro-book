<script setup lang="ts">
/**
 * 第 4 轮首屏《入殿·俯案成界》的场景（同名 .md，w00056 t06）。
 *
 * 先后：
 * 1. 挂上就画出各层（在首屏的位置，透明），隔一帧加 `is-lit`，各层按样式里写的延迟依次显出来，这就是开场。
 *    每层分两级：外层的变换由镜头写（每帧），里层的显出与漂浮由样式管，两者不抢同一个 `transform`。
 * 2. 一个帧循环追 `progress`：按时间常数平滑，再把每层此刻的变换直接写到元素上（不经 Vue 的渲染，每帧只改几个样式值）。
 *    追上了、浮尘也看不见了就停；`progress` 变了再起。
 * 3. 平滑后的进度到 1 时桌子的变换换成 `none`，发 `landed`；往回滚离开 1 时再发一次。
 * 4. 首屏停着时三张纸轮流“演进”（第 6 轮）：每隔一会儿轮到一张，换到另一面再换回来，一次只动一张；镜头推走了、页面在后台时不动。
 */
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch} from "vue";

import LEATHER_CORNER from "./assets/leather-corner.webp";
import LYRA_AVATAR from "./assets/lyra-avatar.webp";
import PARCHMENT from "./assets/parchment.webp";
import VELVET from "./assets/velvet.webp";

import {prefersReducedMotion, timeScale} from "./motion";
import {deskBox, deskShot, floaterShot, heroShot, landingBox, lightShot, SANCTUM_MIN_WIDTH, smooth} from "./sanctum";
import type {Floater, StageSize} from "./sanctum";

const props = withDefaults(defineProps<{
    progress?: number;
    intro?: boolean;
    deskReady?: boolean;
    /** 夜：暗夜圣殿（工作台是夜间配色，首屏不用再压那么多）。昼：午后的抄经室，高窗斜进来一道日光（第 6 轮）。 */
    night?: boolean;
}>(), {progress: 0, intro: true, deskReady: true, night: true});

const emit = defineEmits<{
    (event: "landed", landed: boolean): void;
}>();

const uid = useId();
const id = (name: string): string => `sx-${uid}-${name}`;
const url = (name: string): string => `url(#${id(name)})`;

const root = useTemplateRef<HTMLElement>("root");
const size = shallowRef<StageSize>({width: 1440, height: 900});
const wide = computed(() => size.value.width >= SANCTUM_MIN_WIDTH);
const reduced = prefersReducedMotion();

/** 工作台的位置：宽屏是落地的位置；窄屏不俯冲，平放在首屏文字下面，整屏可上手。 */
const box = computed(() => deskBox(size.value));
const px = (value: number): string => `${Math.round(value * 10) / 10}px`;
const carrierBox = computed(() => ({left: px(box.value.left), top: px(box.value.top), width: px(box.value.width), height: px(box.value.height)}));

// ── 悬在空中的几层：首屏时的位置、深度与姿态（见 `sanctum.ts` 的 `Floater`） ──

interface Layer {
    readonly floater: Floater;
    readonly width: number;
    readonly height: number;
}
const LAYERS = {
    manuscript: {floater: {at: {x: 0.15, y: 0.44}, depth: -620, pose: "perspective(900px) rotateY(24deg) rotateZ(-7deg) rotateX(4deg)", fade: [160, 520]}, width: 250, height: 330},
    character: {floater: {at: {x: 0.858, y: 0.38}, depth: -470, pose: "perspective(900px) rotateY(-26deg) rotateZ(6deg)", fade: [160, 520]}, width: 230, height: 300},
    map: {floater: {at: {x: 0.2, y: 0.84}, depth: -240, pose: "perspective(900px) rotateX(40deg) rotateZ(9deg)", fade: [160, 520]}, width: 330, height: 236},
    book: {floater: {at: {x: 0.9, y: 1.02}, depth: 170, pose: "rotateZ(-6deg)", fade: [300, 560]}, width: 560, height: 560},
    ribbon: {floater: {at: {x: 0.05, y: 0.22}, depth: 130, pose: "rotateZ(13deg)", fade: [280, 540]}, width: 64, height: 620},
} as const satisfies Readonly<Record<string, Layer>>;
type LayerId = keyof typeof LAYERS;
const LAYER_IDS = Object.keys(LAYERS) as LayerId[];

const layerEls: Partial<Record<LayerId, HTMLElement>> = {};
const setLayer = (name: LayerId) => (element: unknown): void => {
    if (element instanceof HTMLElement) layerEls[name] = element;
    else delete layerEls[name];
};
const layerSize = (name: LayerId): {width: string; height: string} => ({width: `${LAYERS[name].width}px`, height: `${LAYERS[name].height}px`});

/** 纸边：沿四条边取点，各抖一两像素，像手裁的羊皮纸。种子固定，每次画出来一样。 */
function ragged(width: number, height: number, seed: number): string {
    let state = seed;
    const jitter = (): number => {
        state = (state * 16807) % 2147483647;
        return ((state / 2147483647) - 0.5) * 3.2;
    };
    const points: string[] = [];
    const edge = (fromX: number, fromY: number, toX: number, toY: number, steps: number): void => {
        for (let step = 0; step < steps; step += 1) {
            const t = step / steps;
            points.push(`${(fromX + (toX - fromX) * t + jitter()).toFixed(1)},${(fromY + (toY - fromY) * t + jitter()).toFixed(1)}`);
        }
    };
    edge(4, 4, width - 4, 4, 14);
    edge(width - 4, 4, width - 4, height - 4, 16);
    edge(width - 4, height - 4, 4, height - 4, 14);
    edge(4, height - 4, 4, 4, 16);
    return `M${points.join(" L")} Z`;
}
const PAPER = {
    manuscript: ragged(250, 330, 7),
    character: ragged(230, 300, 19),
    note: ragged(230, 300, 23),
    map: ragged(330, 236, 31),
    plot: ragged(330, 236, 37),
} as const;

/** 手稿上的几行：第一章的开头与最后那段敲门（第一幕要对照的伏笔）。 */
const MANUSCRIPT_LINES = [
    "霜港的钟敲到第七下时，艾莉丝把那把没",
    "有齿的银钥匙藏进了袖口。",
    "",
    "钟声是从灰塔传下来的。三百年来，灰塔",
    "只在国王驾崩时敲钟，可今夜城里没有人",
    "披黑纱，码头上的灯一盏一盏还亮着。",
    "",
    "楼下有人敲门，三下，停一停，再一下。",
    "这是师傅的敲法，可师傅失踪已经四十天",
    "了。",
] as const;
const KNOCK_LINE = MANUSCRIPT_LINES.indexOf("楼下有人敲门，三下，停一停，再一下。");

/** 第二面的时间线：几章里的几件事，第一章与第五章那两声敲门用一道红线连起来。 */
const TIMELINE = [
    {x: 44, chapter: "一", event: "银钥匙"},
    {x: 120, chapter: "三", event: "灰塔"},
    {x: 196, chapter: "五", event: "第四下"},
    {x: 282, chapter: "十", event: "第八层"},
] as const;

// ── 三张纸的轮播：静中有动（第 6 轮，开发者：纸条这种元素可以轮播；@designer：不翻牌，改成纸上的东西自己演进、叠着的纸换上来） ──

/** 每张纸此刻是哪一面（手稿、人物卡、地图）；`moved` 记它动过没有（动过才放换回来的动画，挂上时不演）。 */
const faces = ref<readonly [number, number, number]>([0, 0, 0]);
const moved = ref<readonly [boolean, boolean, boolean]>([false, false, false]);
/** 每隔多久轮到下一张：@designer 第 6 轮说 4 秒太急、抢标题与按钮。 */
const SLIP_EVERY = 6500;
let turn = -1;
let slipTimer = 0;

function advanceSlips(): void {
    // 镜头推走了（纸已经掠过去）、页面在后台、开场还没亮：这一次不动，下一次再看。
    if (rendered > 0.08 || document.hidden || !lit.value) return;
    turn = (turn + 1) % 3;
    faces.value = faces.value.map((face, index) => (index === turn ? 1 - face : face)) as unknown as readonly [number, number, number];
    moved.value = moved.value.map((value, index) => value || index === turn) as unknown as readonly [boolean, boolean, boolean];
}

// ── 开场 ──

const lit = ref(false);
const instant = ref(!props.intro || reduced);

// ── 镜头：平滑地追目标进度，每帧把变换写到各层上 ──

const carrier = useTemplateRef<HTMLElement>("carrier");
const hero = useTemplateRef<HTMLElement>("hero");
const light = useTemplateRef<HTMLElement>("light");
const vignette = useTemplateRef<HTMLElement>("vignette");
const dustCanvas = useTemplateRef<HTMLCanvasElement>("dust");

let rendered = props.intro ? 0 : props.progress;
let landed = false;
/** 只在落地与否变化时改（很少），模板据此让桌子接不接指针。 */
const isLanded = ref(false);
let loop = 0;
let lastTime = 0;

function render(dt: number, speed: number): void {
    const stage = size.value;
    const p = rendered;
    const desk = carrier.value;
    if (!wide.value) {
        if (desk !== null) desk.style.transform = "none";
        for (const name of LAYER_IDS) {
            const element = layerEls[name];
            if (element !== undefined) element.style.visibility = "hidden";
        }
        applyHero(p);
        setLanded(true);
        drawDust(dt, 0, 1);
        return;
    }
    if (reduced) {
        // 少动效：首屏的样子静着；滚到一半时换成落地的工作台，只有淡入淡出。
        const far = p < 0.5;
        const shot = deskShot(stage, far ? 0 : 1);
        if (desk !== null) {
            desk.style.transform = shot.transform;
            desk.style.opacity = String(far ? 1 - smooth(0, 0.5, p) : smooth(0.5, 1, p));
            applyDeskPaint(desk, shot);
        }
        for (const name of LAYER_IDS) {
            const element = layerEls[name];
            if (element === undefined) continue;
            const layer = floaterShot(stage, LAYERS[name].floater, LAYERS[name], 0);
            element.style.transform = layer.transform;
            element.style.opacity = String(1 - smooth(0, 0.4, p));
            element.style.visibility = p < 0.4 ? "visible" : "hidden";
        }
        applyHero(p);
        setLanded(p >= 0.999);
        drawDust(dt, 0, 1 - smooth(0, 0.5, p));
        return;
    }
    const shot = deskShot(stage, p);
    if (desk !== null) {
        desk.style.transform = shot.transform;
        desk.style.opacity = "";
        applyDeskPaint(desk, shot);
    }
    for (const name of LAYER_IDS) {
        const element = layerEls[name];
        if (element === undefined) continue;
        const layer = floaterShot(stage, LAYERS[name].floater, LAYERS[name], p);
        element.style.visibility = layer.visible ? "visible" : "hidden";
        if (!layer.visible) continue;
        element.style.transform = layer.transform;
        element.style.opacity = String(layer.opacity);
    }
    applyHero(p);
    const beam = lightShot(stage, p);
    if (light.value !== null) {
        light.value.style.transform = beam.transform;
        light.value.style.opacity = String(beam.opacity);
    }
    if (vignette.value !== null) vignette.value.style.opacity = String(1 - 0.45 * smooth(0.5, 1, p));
    setLanded(shot.landed);
    drawDust(dt, speed, 1 - smooth(0.55, 0.95, p));
}

function applyDeskPaint(desk: HTMLElement, shot: ReturnType<typeof deskShot>): void {
    desk.style.setProperty("--sx-shade", String(props.night ? shot.shade * 0.55 : shot.shade));
    desk.style.setProperty("--sx-sheen", String(shot.sheen));
    desk.style.setProperty("--sx-sheen-opacity", String(shot.sheenOpacity));
    desk.style.setProperty("--sx-halo", String(shot.halo));
}

function applyHero(p: number): void {
    const element = hero.value;
    if (element === null) return;
    const shot = heroShot(p);
    element.style.opacity = String(shot.opacity);
    element.style.transform = shot.transform;
    element.style.visibility = shot.visible ? "visible" : "hidden";
}

function setLanded(next: boolean): void {
    if (next === landed) return;
    landed = next;
    isLanded.value = next;
    emit("landed", next);
}

/** 平滑的时间常数（ms）：滚轮一格一格跳时，镜头在这么长里追上去。 */
const SMOOTHING = 150;

function frame(): void {
    loop = 0;
    const now = performance.now();
    const elapsed = Math.min(64, now - lastTime) / timeScale();
    lastTime = now;
    const target = Math.min(1, Math.max(0, props.progress));
    const before = rendered;
    rendered = reduced ? target : rendered + (target - rendered) * (1 - Math.exp(-elapsed / SMOOTHING));
    if (Math.abs(target - rendered) < 0.0004) rendered = target;
    const speed = elapsed > 0 ? (rendered - before) / (elapsed / 1000) : 0;
    render(elapsed / 1000, speed);
    // 浮尘看得见时一直转；看不见且追上了就停。
    if (rendered !== target || dustVisible()) loop = requestAnimationFrame(frame);
}

function wake(): void {
    if (loop !== 0) return;
    lastTime = performance.now();
    loop = requestAnimationFrame(frame);
}

watch(() => props.progress, wake);

// ── 浮尘：暖金色的小点，在光束里亮、在暗处淡；镜头前冲时向四周拉成短线 ──

interface Mote {
    x: number;
    y: number;
    /** 0 远、1 近：近的大、亮、动得快。 */
    z: number;
    phase: number;
}
let motes: Mote[] = [];
let dustOpacity = 1;
let clock = 0;

function spawn(stage: StageSize, anywhere: boolean): Mote {
    // 多数落在光束里（舞台中间往下张开的锥形），少数散在暗处。
    const inBeam = Math.random() < 0.7;
    const y = anywhere ? Math.random() * stage.height : stage.height * (0.85 + Math.random() * 0.2);
    const spread = stage.width * (0.1 + 0.28 * (y / stage.height));
    const x = inBeam ? stage.width / 2 + (Math.random() * 2 - 1) * spread : Math.random() * stage.width;
    return {x, y, z: Math.random(), phase: Math.random() * Math.PI * 2};
}

function dustVisible(): boolean {
    return dustOpacity > 0.01 && !reduced;
}

function drawDust(dt: number, speed: number, opacity: number): void {
    const canvas = dustCanvas.value;
    dustOpacity = opacity;
    if (canvas === null) return;
    canvas.style.opacity = String(opacity);
    if (opacity <= 0.01 || reduced) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const stage = size.value;
    const ratio = canvas.width / Math.max(1, stage.width);
    if (motes.length === 0) motes = Array.from({length: wide.value ? 120 : 60}, () => spawn(stage, true));
    clock += dt;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, stage.width, stage.height);
    // 夜里浮尘是光里的金点（叠亮）；白天底是亮的，叠亮看不见，换成极淡的暖白反光点（@designer 第 6 轮：深色的尘像污渍）。
    context.globalCompositeOperation = props.night ? "lighter" : "source-over";
    const tint = props.night ? 1 : 0.55;
    const center = {x: stage.width / 2, y: landingBox(stage).top + landingBox(stage).height / 2};
    // 前冲时的径向速度：进度每秒变化量乘一个系数，近的尘飞得更快。
    const rush = Math.max(0, speed) * 1.6;
    for (const mote of motes) {
        const lift = (5 + 12 * mote.z) * dt;
        const sway = Math.sin(clock * 0.35 + mote.phase) * (3 + 4 * mote.z) * dt;
        const dx = mote.x - center.x;
        const dy = mote.y - center.y;
        const outward = rush * (0.4 + mote.z) * dt;
        const fromX = mote.x;
        const fromY = mote.y;
        mote.x += sway + dx * outward;
        mote.y += -lift + dy * outward;
        if (mote.y < -10 || mote.x < -20 || mote.x > stage.width + 20 || mote.y > stage.height + 20) {
            Object.assign(mote, spawn(stage, rush > 0.05));
            continue;
        }
        const spread = stage.width * (0.1 + 0.28 * (mote.y / stage.height));
        const inBeam = 1 - smooth(spread * 0.55, spread, Math.abs(mote.x - stage.width / 2));
        const twinkle = 0.65 + 0.35 * Math.sin(clock * (0.8 + mote.z) + mote.phase * 3);
        const alpha = (0.08 + 0.5 * inBeam) * twinkle * (0.45 + 0.55 * mote.z) * tint;
        const radius = 0.5 + 1.5 * mote.z;
        const streak = Math.hypot(mote.x - fromX, mote.y - fromY);
        if (streak > 2.5) {
            context.strokeStyle = props.night ? `rgba(255, 226, 176, ${alpha.toFixed(3)})` : `rgba(255, 250, 236, ${alpha.toFixed(3)})`;
            context.lineWidth = radius;
            context.beginPath();
            context.moveTo(fromX, fromY);
            context.lineTo(mote.x, mote.y);
            context.stroke();
        } else {
            context.fillStyle = props.night ? `rgba(255, 228, 182, ${alpha.toFixed(3)})` : `rgba(255, 250, 236, ${alpha.toFixed(3)})`;
            context.beginPath();
            context.arc(mote.x, mote.y, radius, 0, Math.PI * 2);
            context.fill();
        }
    }
}

function sizeCanvas(): void {
    const canvas = dustCanvas.value;
    if (canvas === null) return;
    const ratio = Math.min(1.5, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(size.value.width * ratio);
    canvas.height = Math.round(size.value.height * ratio);
}

// ── 生命周期 ──

let resize: ResizeObserver | null = null;
let litTimer = 0;

onMounted(() => {
    const element = root.value;
    if (element !== null) {
        size.value = {width: element.clientWidth, height: element.clientHeight};
        resize = new ResizeObserver(() => {
            size.value = {width: element.clientWidth, height: element.clientHeight};
            sizeCanvas();
            motes = [];
            wake();
        });
        resize.observe(element);
    }
    sizeCanvas();
    // 先按首屏的位置画一帧，再开灯：开场的过渡从这一帧起。
    render(0, 0);
    if (instant.value) {
        lit.value = true;
        litTimer = requestAnimationFrame(() => {
            instant.value = false;
        });
    } else {
        litTimer = requestAnimationFrame(() => {
            litTimer = requestAnimationFrame(() => {
                lit.value = true;
            });
        });
    }
    wake();
    if (!reduced) slipTimer = window.setInterval(advanceSlips, SLIP_EVERY * timeScale());
});

onBeforeUnmount(() => {
    window.clearInterval(slipTimer);
    resize?.disconnect();
    if (loop !== 0) cancelAnimationFrame(loop);
    if (litTimer !== 0) cancelAnimationFrame(litTimer);
});
</script>

<template>
    <div ref="root" class="sx" :class="{'is-lit': lit, 'is-instant': instant, 'is-desk-ready': deskReady, 'sx--narrow': !wide, 'sx--day': !night}">
        <div class="sx-back" aria-hidden="true"></div>

        <!-- 顶光：一锥暖光从穹顶落下，几道细光在里面慢慢明暗。 -->
        <div ref="light" class="sx-light" aria-hidden="true">
            <div class="sx-enter sx-light__enter">
                <div class="sx-light__cone"></div>
                <div class="sx-light__ray" style="--ray: -17deg; --ray-delay: 0s"></div>
                <div class="sx-light__ray" style="--ray: -7deg; --ray-delay: -2.4s"></div>
                <div class="sx-light__ray" style="--ray: 4deg; --ray-delay: -4.1s"></div>
                <div class="sx-light__ray" style="--ray: 13deg; --ray-delay: -1.3s"></div>
            </div>
        </div>

        <!-- 桌子：真工作台放在一块暗红桌布上，背后一圈暖光。外层的变换由镜头写。 -->
        <div ref="carrier" class="sx-carrier" :class="{'is-landed': isLanded}" :style="carrierBox" data-sx-carrier>
            <div class="sx-enter sx-carrier__enter">
                <div class="sx-halo" aria-hidden="true"></div>
                <!-- 桌布：比桌子大一圈、往外淡进暗里；落地后围着工作台的那一圈都是它。顶光在桌面上落一滩光。 -->
                <div class="sx-cloth" :style="{'--sx-velvet': `url(${VELVET})`}" aria-hidden="true"></div>
                <div class="sx-pool" aria-hidden="true"></div>
                <div class="sx-desk">
                    <slot name="desk" />
                </div>
                <div class="sx-shade" aria-hidden="true"></div>
                <div class="sx-sheen" aria-hidden="true"></div>
                <div class="sx-dark" aria-hidden="true"></div>
            </div>
        </div>

        <!-- 三张羊皮页：手稿、人物卡、地图。远的那张更暗、更虚。 -->
        <div :ref="setLayer('manuscript')" class="sx-layer" :style="layerSize('manuscript')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 500ms">
                <div class="sx-bob" style="--bob: 7.5s; --bob-y: -7px">
                    <svg class="sx-sheet sx-sheet--far" viewBox="0 0 250 330" width="250" height="330">
                        <clipPath :id="id('clip-manuscript')"><path :d="PAPER.manuscript" /></clipPath>
                        <image :href="PARCHMENT" x="0" y="0" width="250" height="330" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-manuscript')" />
                        <path :d="PAPER.manuscript" :fill="url('foxing')" />
                        <text x="24" y="40" class="sx-ink sx-ink--title">第一章 霜港的钟</text>
                        <line x1="24" y1="52" x2="128" y2="52" stroke="#8a6a3c" stroke-width="0.8" />
                        <!-- 第二面：敲门那一行涂上一道高亮，红笔圈出来、牵一条线写批注（和第一幕“划出来，记一笔”同一件事）。 -->
                        <rect x="22" :y="66 + KNOCK_LINE * 20" width="204" height="19" rx="2" class="sx-mark" :class="{'is-on': faces[0] === 1}" />
                        <text v-for="(line, index) in MANUSCRIPT_LINES" :key="index" x="24" :y="80 + index * 20" class="sx-ink">{{ line }}</text>
                        <g class="sx-note" :class="{'is-on': faces[0] === 1}">
                            <ellipse cx="115" :cy="76 + KNOCK_LINE * 20" rx="17" ry="10.5" fill="none" stroke="#9b2232" stroke-width="1.3" pathLength="1" class="sx-note__ring" transform="rotate(-4 115 76)" />
                            <path :d="`M118,${88 + KNOCK_LINE * 20} q10,26 34,38`" fill="none" stroke="#9b2232" stroke-width="1" pathLength="1" class="sx-note__thread" />
                            <text x="150" :y="134 + KNOCK_LINE * 20" class="sx-ink sx-ink--red sx-note__text">伏笔：第五章再响</text>
                        </g>
                        <path :d="PAPER.manuscript" :fill="url('toplight')" />
                    </svg>
                </div>
            </div>
        </div>

        <div :ref="setLayer('character')" class="sx-layer" :style="layerSize('character')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 620ms">
                <div class="sx-bob sx-stack" style="--bob: 8.6s; --bob-y: 6px" :data-face="faces[1]" :data-moved="moved[1] ? '' : undefined">
                    <!-- 第二面：星璃的便笺，压在人物卡下面露出一角；轮到它时斜着抽出来换到上面。 -->
                    <svg class="sx-sheet sx-sheet--mid sx-card sx-card--b" viewBox="0 0 230 300" width="230" height="300">
                        <clipPath :id="id('clip-note')"><path :d="PAPER.note" /></clipPath>
                        <clipPath :id="id('clip-avatar')"><circle cx="115" cy="104" r="44" /></clipPath>
                        <image :href="PARCHMENT" x="0" y="0" width="230" height="300" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-note')" />
                        <path :d="PAPER.note" :fill="url('foxing')" />
                        <text x="24" y="42" class="sx-ink sx-ink--name">星璃</text>
                        <circle cx="115" cy="104" r="48" fill="none" :stroke="url('gold')" stroke-width="2.2" />
                        <image :href="LYRA_AVATAR" x="71" y="60" width="88" height="88" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-avatar')" />
                        <text x="24" y="200" class="sx-ink">第一章的敲门声，</text>
                        <text x="24" y="222" class="sx-ink">第五章又响了一次。</text>
                        <text x="24" y="252" class="sx-ink sx-ink--red">读者会和她一起等第四下。</text>
                        <path :d="PAPER.note" :fill="url('toplight')" />
                    </svg>
                    <svg class="sx-sheet sx-sheet--mid sx-card sx-card--a" viewBox="0 0 230 300" width="230" height="300">
                        <clipPath :id="id('clip-character')"><path :d="PAPER.character" /></clipPath>
                        <image :href="PARCHMENT" x="0" y="0" width="230" height="300" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-character')" />
                        <path :d="PAPER.character" :fill="url('foxing')" />
                        <text x="24" y="44" class="sx-ink sx-ink--name">艾莉丝</text>
                        <rect x="176" y="22" width="30" height="30" rx="3" fill="none" stroke="#9b2232" stroke-width="1.4" />
                        <text x="191" y="43" text-anchor="middle" class="sx-ink sx-ink--seal">人</text>
                        <ellipse cx="115" cy="122" rx="48" ry="58" fill="none" :stroke="url('gold')" stroke-width="2.2" />
                        <ellipse cx="115" cy="122" rx="42" ry="52" fill="#d9c49d" stroke="#a8762f" stroke-width="0.8" />
                        <path d="M115,92 a17,19 0 1,1 -0.1,0 Z M80,170 q4,-30 35,-34 q31,4 35,34 Z" fill="#6b5644" fill-opacity="0.42" />
                        <text x="24" y="210" class="sx-ink">霜港制图坊的学徒，十九岁</text>
                        <text x="24" y="232" class="sx-ink">左手执笔，右手拿尺</text>
                        <text x="24" y="254" class="sx-ink">收到一把没有齿的银钥匙</text>
                        <g transform="translate(168 266) rotate(-28)" fill="none" stroke="#7d7a74" stroke-width="1.6">
                            <circle cx="0" cy="0" r="7" />
                            <path d="M7,0 H38" />
                        </g>
                        <path :d="PAPER.character" :fill="url('toplight')" />
                    </svg>
                </div>
            </div>
        </div>

        <div :ref="setLayer('map')" class="sx-layer" :style="layerSize('map')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 740ms">
                <div class="sx-bob sx-stack" style="--bob: 9.4s; --bob-y: -5px" :data-face="faces[2]" :data-moved="moved[2] ? '' : undefined">
                    <!-- 第二面：剧情的时间线，几章里的几件事；第一章与第五章那两声敲门连着一道红线。 -->
                    <svg class="sx-sheet sx-sheet--near sx-card sx-card--b" viewBox="0 0 330 236" width="330" height="236">
                        <clipPath :id="id('clip-plot')"><path :d="PAPER.plot" /></clipPath>
                        <image :href="PARCHMENT" x="0" y="0" width="330" height="236" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-plot')" />
                        <path :d="PAPER.plot" :fill="url('foxing')" />
                        <text x="24" y="40" class="sx-ink sx-ink--title">剧情</text>
                        <line x1="24" y1="52" x2="96" y2="52" stroke="#8a6a3c" stroke-width="0.8" />
                        <path d="M24,150 H306" stroke="#4a3626" stroke-width="1.3" />
                        <path :d="`M${TIMELINE[0].x},140 C${TIMELINE[0].x + 30},84 ${TIMELINE[2].x - 30},84 ${TIMELINE[2].x},140`" fill="none" stroke="#9b2232" stroke-width="1.2" stroke-dasharray="3 4" />
                        <text :x="(TIMELINE[0].x + TIMELINE[2].x) / 2" y="92" text-anchor="middle" class="sx-ink sx-ink--red">同一种敲法</text>
                        <g v-for="node in TIMELINE" :key="node.chapter">
                            <circle :cx="node.x" cy="150" r="5" :fill="url('gold')" stroke="#6f4a17" stroke-width="0.8" />
                            <text :x="node.x" y="176" text-anchor="middle" class="sx-ink">第{{ node.chapter }}章</text>
                            <text :x="node.x" y="196" text-anchor="middle" class="sx-ink sx-ink--small">{{ node.event }}</text>
                        </g>
                        <path :d="PAPER.plot" :fill="url('toplight')" />
                    </svg>
                    <svg class="sx-sheet sx-sheet--near sx-card sx-card--a" viewBox="0 0 330 236" width="330" height="236">
                        <clipPath :id="id('clip-map')"><path :d="PAPER.map" /></clipPath>
                        <image :href="PARCHMENT" x="0" y="0" width="330" height="236" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-map')" />
                        <path :d="PAPER.map" :fill="url('foxing')" />
                        <g stroke="#8a6a3c" stroke-width="0.5" stroke-opacity="0.35">
                            <path v-for="column in 6" :key="`c${column}`" :d="`M${column * 50},10 V226`" />
                            <path v-for="row in 4" :key="`r${row}`" :d="`M10,${row * 48} H320`" />
                        </g>
                        <path d="M10,150 C40,138 58,162 88,150 S138,116 168,130 S214,172 246,150 S292,112 320,124 L320,226 L10,226 Z" fill="#dcc8a2" fill-opacity="0.7" />
                        <path d="M10,150 C40,138 58,162 88,150 S138,116 168,130 S214,172 246,150 S292,112 320,124" fill="none" stroke="#4a3626" stroke-width="1.4" />
                        <path d="M10,141 C40,129 58,153 88,141 S138,107 168,121 S214,163 246,141 S292,103 320,115" fill="none" stroke="#4a3626" stroke-width="0.6" stroke-opacity="0.5" stroke-dasharray="1 4" />
                        <path d="M94,162 C140,104 200,96 246,140" fill="none" stroke="#9b2232" stroke-width="1.1" stroke-dasharray="3 4" />
                        <circle cx="92" cy="163" r="3" fill="#4a3626" />
                        <text x="70" y="186" class="sx-ink">霜港</text>
                        <g transform="translate(250 112)" stroke="#4a3626" stroke-width="1.1" fill="#cbb38a">
                            <path d="M-6,30 L-4,0 L4,0 L6,30 Z" />
                            <path d="M-6,0 L0,-9 L6,0 Z" />
                        </g>
                        <text x="262" y="138" class="sx-ink">灰塔</text>
                        <g transform="translate(62 62)">
                            <circle r="26" fill="none" stroke="#8a6a3c" stroke-width="0.8" />
                            <path d="M0,-30 L5,-5 L30,0 L5,5 L0,30 L-5,5 L-30,0 L-5,-5 Z" :fill="url('gold')" stroke="#6f4a17" stroke-width="0.6" />
                            <path d="M0,-16 L3,-3 L16,0 L3,3 L0,16 L-3,3 L-16,0 L-3,-3 Z" fill="#f3e3bf" stroke="#6f4a17" stroke-width="0.5" transform="rotate(45)" />
                        </g>
                        <g :stroke="url('gold')" stroke-width="0.9" fill="#e9c47c">
                            <path d="M196,34 L232,52 L268,40 L296,64" fill="none" />
                            <circle cx="196" cy="34" r="2.2" />
                            <circle cx="232" cy="52" r="1.8" />
                            <circle cx="268" cy="40" r="2.6" />
                            <circle cx="296" cy="64" r="1.6" />
                        </g>
                        <text x="140" y="44" class="sx-ink sx-ink--faint">北海</text>
                        <path :d="PAPER.map" :fill="url('toplight')" />
                    </svg>
                </div>
            </div>
        </div>

        <!-- 前景：赤红精装书的书角（鎏金包角）与一条丝带书签，离镜头最近，虚着。 -->
        <div :ref="setLayer('book')" class="sx-layer" :style="layerSize('book')" aria-hidden="true">
            <div class="sx-enter sx-enter--rise" style="--enter-delay: 120ms">
                <img class="sx-book" :src="LEATHER_CORNER" width="560" height="560" alt="" />
            </div>
        </div>

        <div :ref="setLayer('ribbon')" class="sx-layer" :style="layerSize('ribbon')" aria-hidden="true">
            <div class="sx-enter sx-enter--drop" style="--enter-delay: 200ms">
                <div class="sx-sway">
                    <svg class="sx-ribbon" viewBox="0 0 64 620" width="64" height="620">
                        <path d="M14,0 H50 V570 L32,544 L14,570 Z" :fill="url('silk')" />
                        <path d="M16.5,0 V566" :stroke="url('gold')" stroke-width="1.4" />
                        <path d="M47.5,0 V566" :stroke="url('gold')" stroke-width="1.4" />
                        <path d="M14,0 H50 V570 L32,544 L14,570 Z" :fill="url('silk-sheen')" />
                    </svg>
                </div>
            </div>
        </div>

        <canvas ref="dust" class="sx-dust" aria-hidden="true"></canvas>
        <div ref="vignette" class="sx-vignette" aria-hidden="true"></div>

        <div ref="hero" class="sx-hero">
            <slot name="hero" :lit="lit" />
        </div>

        <!-- 各层共用的渐变与滤镜：鎏金、皮面、丝绸、纸纹。 -->
        <svg class="sx-defs" width="0" height="0" aria-hidden="true">
            <defs>
                <linearGradient :id="id('gold')" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#fff3cf" />
                    <stop offset="0.14" stop-color="#e8c27a" />
                    <stop offset="0.34" stop-color="#9a6a28" />
                    <stop offset="0.5" stop-color="#f0d28c" />
                    <stop offset="0.7" stop-color="#6e4614" />
                    <stop offset="0.86" stop-color="#b8883e" />
                    <stop offset="1" stop-color="#5a3a12" />
                </linearGradient>
                <radialGradient :id="id('leather')" cx="0.28" cy="0.22" r="0.95">
                    <stop offset="0" stop-color="#b0253a" />
                    <stop offset="0.42" stop-color="#7e1121" />
                    <stop offset="1" stop-color="#3a0610" />
                </radialGradient>
                <linearGradient :id="id('leather-sheen')" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0.12" stop-color="#ffe6dc" stop-opacity="0" />
                    <stop offset="0.3" stop-color="#ffe6dc" stop-opacity="0.16" />
                    <stop offset="0.46" stop-color="#ffe6dc" stop-opacity="0" />
                    <stop offset="1" stop-color="#000" stop-opacity="0.3" />
                </linearGradient>
                <radialGradient :id="id('gem')" cx="0.35" cy="0.35" r="0.75">
                    <stop offset="0" stop-color="#ff8a96" />
                    <stop offset="0.45" stop-color="#b3132c" />
                    <stop offset="1" stop-color="#4a0510" />
                </radialGradient>
                <linearGradient :id="id('silk')" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#3e0510" />
                    <stop offset="0.3" stop-color="#8c1626" />
                    <stop offset="0.52" stop-color="#c63a4f" />
                    <stop offset="0.7" stop-color="#8a1425" />
                    <stop offset="1" stop-color="#36040d" />
                </linearGradient>
                <linearGradient :id="id('silk-sheen')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#fff0d8" stop-opacity="0.22" />
                    <stop offset="0.35" stop-color="#fff0d8" stop-opacity="0" />
                    <stop offset="0.6" stop-color="#fff0d8" stop-opacity="0.08" />
                    <stop offset="1" stop-color="#000" stop-opacity="0.35" />
                </linearGradient>
                <radialGradient :id="id('foxing')" cx="0.5" cy="0.45" r="0.72">
                    <stop offset="0.55" stop-color="#7a4f24" stop-opacity="0" />
                    <stop offset="1" stop-color="#6b4320" stop-opacity="0.42" />
                </radialGradient>
                <linearGradient :id="id('toplight')" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#fff2d6" stop-opacity="0.22" />
                    <stop offset="0.5" stop-color="#fff2d6" stop-opacity="0" />
                    <stop offset="1" stop-color="#1c0e08" stop-opacity="0.3" />
                </linearGradient>
                <filter :id="id('grain')" x="0" y="0" width="100%" height="100%">
                    <feTurbulence type="turbulence" baseFrequency="0.42" numOctaves="2" seed="11" result="noise" />
                    <feDiffuseLighting in="noise" lighting-color="#ffffff" surfaceScale="2.6" result="lit">
                        <feDistantLight azimuth="225" elevation="52" />
                    </feDiffuseLighting>
                    <feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1="1.4" k2="0" k3="0" k4="0" result="grained" />
                    <feComposite in="grained" in2="SourceAlpha" operator="in" />
                </filter>
                <filter :id="id('shadow')" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="16" />
                </filter>
            </defs>
        </svg>
    </div>
</template>

<style scoped>
/*
 * 颜色只在这里用：夜 #1c1418 往紫里偏一点做穹顶，金 #e1b285 与深金 #a8762f 做光与线，赤红 #871222 做皮面与丝带。
 * 开场的延迟写在各层的 `--enter-delay` 上；开场只动里层（`.sx-enter`），外层的变换归镜头。
 */
.sx {
    --sx-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --sx-serif: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    position: absolute;
    inset: 0;
    /* clip 而不是 hidden：hidden 的盒子能被程序滚动，工作台里有东西拿焦点（批注的输入框）时浏览器会把它滚开一截。 */
    overflow: clip;
    background: #120c10;
    contain: strict;
}

.sx-back {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(70% 55% at 50% 8%, rgb(74 38 58 / 0.55), transparent 70%),
        radial-gradient(90% 60% at 50% 100%, rgb(90 12 26 / 0.38), transparent 72%),
        linear-gradient(#1a1119, #140d12 60%, #0e090c);
}

.sx-vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 100% at 50% 42%, transparent 52%, rgb(6 3 5 / 0.62) 100%);
    pointer-events: none;
}

/* ── 开场：里层从透明、略低、略小显到原位 ── */

.sx-enter {
    opacity: 0;
    transform: translate3d(0, 18px, 0) scale(0.97);
    transition:
        opacity 1100ms var(--sx-ease) var(--enter-delay, 0ms),
        transform 1500ms var(--sx-ease) var(--enter-delay, 0ms);
}

.sx-enter--rise {
    transform: translate3d(36px, 46px, 0);
}

.sx-enter--drop {
    transform: translate3d(0, -60px, 0);
}

.sx.is-lit .sx-enter {
    opacity: 1;
    transform: none;
}

.sx.is-instant .sx-enter,
.sx.is-instant .sx-dark {
    transition: none !important;
}

/* ── 顶光 ── */

.sx-light {
    position: absolute;
    inset: -10% 0 0;
    transform-origin: 50% 0;
    pointer-events: none;
}

.sx-light__enter {
    position: absolute;
    inset: 0;
    transform: translate3d(0, -40px, 0);
    transition-duration: 1100ms, 1600ms;
}

/* 顶光三层：宽而柔的光锥、窄一些的暖光芯，再加几道细光；都是从穹顶正中往下张开的椭圆渐变，没有硬边。 */
.sx-light__cone {
    position: absolute;
    top: 0;
    left: 50%;
    width: 96%;
    height: 100%;
    background: radial-gradient(48% 100% at 50% 0%, rgb(255 226 176 / 0.2), rgb(255 214 160 / 0.07) 55%, transparent 80%);
    transform: translateX(-50%);
}

.sx-light__cone::after {
    position: absolute;
    inset: 0 22% 8%;
    content: "";
    background: radial-gradient(40% 100% at 50% 0%, rgb(243 213 155 / 0.26), transparent 75%);
}

.sx-light__ray {
    position: absolute;
    top: -4%;
    left: 50%;
    width: 46px;
    height: 104%;
    background: linear-gradient(rgb(255 236 200 / 0.3), rgb(255 226 180 / 0.08) 55%, transparent 90%);
    filter: blur(10px);
    transform: translateX(-50%) rotate(var(--ray));
    transform-origin: 50% 0;
    animation: sx-ray 7s ease-in-out var(--ray-delay) infinite;
}

@keyframes sx-ray {
    0%,
    100% {
        opacity: 0.25;
    }
    50% {
        opacity: 0.85;
    }
}

/* ── 桌子 ── */

.sx-carrier {
    position: absolute;
    transform-origin: 50% 50%;
    will-change: transform;
    pointer-events: none;
}

.sx-carrier__enter {
    position: absolute;
    inset: 0;
    transform: translate3d(0, 30px, 0);
    --enter-delay: 420ms;
}

.sx-halo {
    position: absolute;
    inset: -18% -12%;
    background: radial-gradient(50% 50% at 50% 50%, rgb(225 178 133 / 0.34), rgb(135 18 34 / 0.16) 55%, transparent 75%);
    opacity: var(--sx-halo, 0.55);
    filter: blur(20px);
}

.sx-cloth {
    position: absolute;
    inset: -34% -24%;
    border-radius: 48px;
    background:
        radial-gradient(60% 55% at 50% 42%, rgb(104 16 32 / 0.42), transparent 78%),
        linear-gradient(rgb(16 3 7 / 0.28), rgb(16 3 7 / 0.5)),
        var(--sx-velvet) center / cover,
        #22040a;
    mask-image: radial-gradient(closest-side, #000 72%, transparent);
}

/* 顶光落在桌面上的一滩：在桌子上半截，暖的。 */
.sx-pool {
    position: absolute;
    inset: -22% -14% 30%;
    background: radial-gradient(50% 50% at 50% 50%, rgb(243 213 155 / 0.22), transparent 72%);
    pointer-events: none;
}

.sx-desk {
    position: absolute;
    inset: 0;
    overflow: clip;
    border-radius: 10px;
    background: var(--bg-main);
    box-shadow:
        0 0 0 1px rgb(225 178 133 / 0.38),
        0 22px 54px rgb(0 0 0 / 0.65);
}

.sx-shade,
.sx-sheen,
.sx-dark {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    pointer-events: none;
}

/* 首屏压暗远处的桌子：四周最暗，上半截中间留一块顶光照着的亮斑。 */
.sx-shade {
    background: radial-gradient(70% 62% at 50% 30%, rgb(64 36 22 / 0.42), rgb(18 9 11 / 0.9) 100%);
    opacity: var(--sx-shade, 0);
}

/* 推近时扫过纸面的一道暖光：一条斜的亮带，从左上走到右下。 */
.sx-sheen {
    background: linear-gradient(115deg, transparent 0%, transparent 38%, rgb(255 232 190 / 0.55) 50%, transparent 62%, transparent 100%);
    background-size: 260% 100%;
    background-position: calc(100% - var(--sx-sheen, 0) * 100%) 0;
    opacity: var(--sx-sheen-opacity, 0);
    mix-blend-mode: soft-light;
}

/* 开场时压在桌子上的暗：光落到桌上，它才淡开。 */
.sx-dark {
    background: #120c10;
    opacity: 1;
    transition: opacity 1300ms var(--sx-ease) 700ms;
}

.sx.is-lit.is-desk-ready .sx-dark {
    opacity: 0;
}

.sx-carrier.is-landed {
    pointer-events: auto;
}

/* ── 悬在空中的几层 ── */

.sx-layer {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 50% 50%;
    will-change: transform, opacity;
    pointer-events: none;
}

.sx-bob {
    animation: sx-bob var(--bob, 8s) ease-in-out infinite alternate;
}

@keyframes sx-bob {
    from {
        transform: translate3d(0, 0, 0) rotate(0deg);
    }
    to {
        transform: translate3d(0, var(--bob-y, 6px), 0) rotate(0.6deg);
    }
}

.sx-sheet {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 22px 26px rgb(0 0 0 / 0.55));
}

/* 离光轴越远越暗：两侧的纸压到七八成亮，远的那张再虚一点。 */
.sx-sheet--far {
    filter: drop-shadow(0 22px 26px rgb(0 0 0 / 0.55)) brightness(0.72) blur(0.7px);
}

.sx-sheet--mid {
    filter: drop-shadow(0 22px 26px rgb(0 0 0 / 0.55)) brightness(0.78);
}

/* 地图离镜头近，落在焦外：略虚、略暗，不和远处的桌子抢。 */
.sx-sheet--near {
    filter: drop-shadow(0 22px 26px rgb(0 0 0 / 0.55)) brightness(0.8) blur(0.9px);
}

.sx-ink {
    fill: #3b2a1d;
    font-family: var(--sx-serif);
    font-size: 11.5px;
    letter-spacing: 0.02em;
}

.sx-ink--title {
    font-size: 15px;
    font-weight: 600;
}

.sx-ink--name {
    font-size: 21px;
    font-weight: 600;
    letter-spacing: 0.12em;
}

.sx-ink--seal {
    fill: #9b2232;
    font-size: 16px;
    font-weight: 600;
}

.sx-ink--red {
    fill: #9b2232;
    font-size: 12px;
}

.sx-ink--faint {
    fill-opacity: 0.5;
    letter-spacing: 0.6em;
}

/* 书角是生成的照片（皮面、鎏金包角、刷金的书口），黑底已经抠成透明；离镜头最近，略虚。 */
.sx-book {
    display: block;
    filter: blur(1.4px) drop-shadow(0 30px 40px rgb(0 0 0 / 0.6));
}

.sx-sway {
    transform-origin: 50% 0;
    animation: sx-sway 6.5s ease-in-out infinite alternate;
}

@keyframes sx-sway {
    from {
        transform: rotate(-1.4deg);
    }
    to {
        transform: rotate(1.6deg);
    }
}

.sx-ribbon {
    display: block;
    overflow: visible;
    filter: blur(2.2px) drop-shadow(0 18px 22px rgb(0 0 0 / 0.5));
}

.sx-dust {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.sx-hero {
    position: absolute;
    inset: 0;
    pointer-events: none;
}

.sx-defs {
    position: absolute;
    width: 0;
    height: 0;
}

.sx-ink--small {
    font-size: 10px;
    fill-opacity: 0.8;
}

/* ── 纸的第二面（轮播） ── */

/* 手稿：高亮从左往右涂过去，红圈与牵线一笔画出来，批注的字最后淡出；换回去时一起淡掉。 */
.sx-mark {
    fill: #e9c47c;
    fill-opacity: 0.55;
    transform: scaleX(0);
    transform-box: fill-box;
    transform-origin: 0 50%;
    transition: transform 900ms var(--sx-ease), fill-opacity 600ms ease;
}

.sx-mark.is-on {
    transform: none;
}

.sx-mark:not(.is-on) {
    fill-opacity: 0;
    transition: transform 0s 600ms, fill-opacity 600ms ease;
}

.sx-note__ring,
.sx-note__thread {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    transition: stroke-dashoffset 700ms var(--sx-ease) 700ms;
}

.sx-note__thread {
    transition-delay: 1250ms;
}

.sx-note__text {
    opacity: 0;
    transition: opacity 600ms ease 1700ms;
}

.sx-note.is-on .sx-note__ring,
.sx-note.is-on .sx-note__thread {
    stroke-dashoffset: 0;
}

.sx-note.is-on .sx-note__text {
    opacity: 1;
}

.sx-note:not(.is-on) {
    opacity: 0;
    transition: opacity 600ms ease;
}

.sx-note:not(.is-on) * {
    transition: none;
}

/*
 * 叠着的两张纸（人物卡与星璃的便笺、地图与时间线）：下面那张错开一点露出一角；轮到它时斜着抽出来、换到上面，上面那张往另一边让开、落到下面。
 * 层级在关键帧里换（整数插值，在一半处跳）：两张纸错开到最远时换，看不出谁穿过了谁。
 */
.sx-stack {
    position: relative;
}

.sx-card {
    position: absolute;
    top: 0;
    left: 0;
}

.sx-card--a {
    position: relative;
    z-index: 1;
}

.sx-card--b {
    z-index: 0;
    transform: translate3d(16px, 12px, 0) rotate(4deg) scale(0.95);
}

.sx-stack[data-face="1"] .sx-card--a,
.sx-stack[data-face="0"][data-moved] .sx-card--b {
    animation: sx-to-back 1300ms var(--sx-ease) forwards;
}

.sx-stack[data-face="1"] .sx-card--b,
.sx-stack[data-face="0"][data-moved] .sx-card--a {
    animation: sx-to-front 1300ms var(--sx-ease) forwards;
}

@keyframes sx-to-back {
    0% {
        z-index: 1;
        transform: none;
    }
    48% {
        z-index: 1;
        transform: translate3d(-64px, 8px, 0) rotate(-9deg);
    }
    52% {
        z-index: 0;
    }
    100% {
        z-index: 0;
        transform: translate3d(16px, 12px, 0) rotate(4deg) scale(0.95);
    }
}

@keyframes sx-to-front {
    0% {
        z-index: 0;
        transform: translate3d(16px, 12px, 0) rotate(4deg) scale(0.95);
    }
    48% {
        z-index: 0;
        transform: translate3d(58px, -10px, 0) rotate(7deg) scale(0.98);
    }
    52% {
        z-index: 1;
    }
    100% {
        z-index: 1;
        transform: none;
    }
}

/*
 * ── 昼：午后的抄经室 ──
 * 底是偏暖的灰石墙（比羊皮纸暗半阶，纸才不糊在底上），左上高窗斜进来一道日光；纸面提亮、投影换成柔和的棕；
 * 桌布仍是丝绒，压成枣红的暗调，不发粉；书角与丝带照旧（@designer 第 6 轮）。
 */
.sx--day {
    background: #b9ab93;
}

.sx--day .sx-back {
    background:
        radial-gradient(62% 52% at 16% 0%, rgb(255 247 226 / 0.75), transparent 70%),
        radial-gradient(90% 60% at 50% 100%, rgb(96 40 36 / 0.22), transparent 72%),
        linear-gradient(#cfc3ad, #bfb197 58%, #a99a80);
}

.sx--day .sx-vignette {
    background: radial-gradient(120% 100% at 50% 42%, transparent 55%, rgb(74 54 34 / 0.38) 100%);
}

/* 日光从左上的高窗斜着进来：光锥整个偏一个角度，颜色是白里带一点金。 */
.sx--day .sx-light {
    transform: rotate(-16deg) translateX(-14%);
}

.sx--day .sx-light__cone {
    background: radial-gradient(46% 100% at 50% 0%, rgb(255 251 238 / 0.55), rgb(255 244 214 / 0.18) 55%, transparent 82%);
}

.sx--day .sx-light__cone::after {
    background: radial-gradient(38% 100% at 50% 0%, rgb(255 252 240 / 0.5), transparent 75%);
}

.sx--day .sx-light__ray {
    background: linear-gradient(rgb(255 253 244 / 0.55), rgb(255 246 220 / 0.14) 55%, transparent 90%);
}

.sx--day .sx-halo {
    background: radial-gradient(50% 50% at 50% 50%, rgb(255 244 214 / 0.5), rgb(168 118 47 / 0.12) 55%, transparent 75%);
}

.sx--day .sx-cloth {
    background:
        radial-gradient(60% 55% at 46% 38%, rgb(255 236 210 / 0.16), transparent 78%),
        linear-gradient(rgb(48 8 14 / 0.22), rgb(40 6 12 / 0.42)),
        var(--sx-velvet) center / cover,
        #4a0c16;
}

.sx--day .sx-pool {
    background: radial-gradient(50% 50% at 50% 50%, rgb(255 250 236 / 0.3), transparent 72%);
}

.sx--day .sx-desk {
    box-shadow:
        0 0 0 1px rgb(168 118 47 / 0.45),
        0 20px 48px rgb(64 38 18 / 0.38);
}

/* 首屏压一压远处的桌子：白天的桌子是亮的象牙色，压的是暖灰，不是黑。 */
.sx--day .sx-shade {
    background: radial-gradient(70% 62% at 46% 30%, rgb(255 246 228 / 0.18), rgb(92 70 48 / 0.62) 100%);
}

.sx--day .sx-dark {
    background: #b9ab93;
}

.sx--day .sx-sheet {
    filter: drop-shadow(0 18px 22px rgb(74 48 24 / 0.34));
}

.sx--day .sx-sheet--far {
    filter: drop-shadow(0 18px 22px rgb(74 48 24 / 0.34)) brightness(0.96) blur(0.6px);
}

.sx--day .sx-sheet--mid {
    filter: drop-shadow(0 18px 22px rgb(74 48 24 / 0.34));
}

.sx--day .sx-sheet--near {
    filter: drop-shadow(0 18px 22px rgb(74 48 24 / 0.34)) blur(0.8px);
}

.sx--day .sx-book {
    filter: blur(1.4px) drop-shadow(0 26px 34px rgb(64 38 18 / 0.4));
}

.sx--day .sx-ribbon {
    filter: blur(2.2px) drop-shadow(0 16px 18px rgb(64 38 18 / 0.32));
}

/* 窄屏：不俯冲，悬着的几层不画，桌子平放。 */
.sx--narrow .sx-carrier {
    pointer-events: auto;
}

@media (prefers-reduced-motion: reduce) {
    .sx-enter,
    .sx-dark {
        transition: none;
    }

    .sx-bob,
    .sx-sway,
    .sx-light__ray,
    .sx-card {
        animation: none !important;
    }
}
</style>
