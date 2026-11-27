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
 * 4. 首屏停着时的动静（第 7 轮，`effects`，每一样写在 `sanctum.ts` 的 `SceneEffect`）都挂在同一个帧循环上：
 *    从字到世界按一条时间线走（时间只在首屏亮着、镜头没推走、没在细看哪张纸时往前走，页面在后台时帧循环自己停），每一步只拨几个开关，
 *    怎么显出来归样式；金尘画在浮尘那张画布上。指针视差、反光与丝带尾巴读同一份带惯性的指针位置，每帧写到各层的 `sx-par` 与几个变量上。
 * 5. 第 8 轮（开发者：首页旁边的东西要能点、要有跟鼠标位置与速度互动的动画）：点一张纸细看，它转正、放大、往前凑，别的压暗，
 *    再点、点别处、按 Esc 或一滚动就放回去（细看到几成由帧循环里的弹簧追，镜头投影时多挪一点、放大一点）。
 * 6. 第 9 轮（开发者：跟指针的效果“不太明显，也不太好看”）：第 8 轮的浮尘扰动、停驻唤醒、丝带被风带着摆删了，换成提灯与金丝
 *    （@designer 第 9 轮）。提灯是一团追着指针的暖光，帧循环里推一个弹簧、写它的变换；照着的纸与书角的受光由几个变量交给样式
 *    （`--sx-lit` 受光几成，`--sx-lx`、`--sx-ly` 灯在哪个方向，`--sx-focus` 细看到几成），纸的滤镜一条链算出亮边、影子与明暗，
 *    所以纸上没有滤镜过渡（每帧改值时过渡会一直重启，影子拖在后面）。金丝画在浮尘那张画布上。
 * 7. 第 10 轮（开发者：星盘与线索丝没多少动画和交互，不仔细看注意不到）：从字到世界的每一步顺带拨星盘、让牵动的那张纸的线索丝脉冲
 *    （`relayBeat`、`pulseThread` 只记开始的时刻）；星盘的角度、扫光与线索丝的亮暗、光珠、落点都由帧循环按这些时刻算出来写上去
 *    （`stepAstrolabe`、`applyThreads`），同样不给 CSS 过渡。它们的钟 `featureClock` 只在 `stepEffects` 里走，少动效时不走。
 */
import {computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useId, useTemplateRef, watch} from "vue";

import LEATHER_CORNER from "./assets/leather-corner.webp";
import LYRA_AVATAR from "./assets/lyra-avatar.webp";
import PARCHMENT from "./assets/parchment.webp";
import VELVET from "./assets/velvet.webp";
import WALNUT from "./assets/walnut.webp";

import {cubicBezier, prefersReducedMotion, SETTLE, timeScale} from "./motion";
import {deskBox, deskShot, floaterShot, heroShot, landingBox, lightShot, SANCTUM_MIN_WIDTH, SCENE_EFFECTS, smooth} from "./sanctum";
import type {Floater, FloaterLift, SceneEffect, StageSize} from "./sanctum";

const props = withDefaults(defineProps<{
    progress?: number;
    intro?: boolean;
    deskReady?: boolean;
    /** 夜：暗夜圣殿（工作台是夜间配色，首屏不用再压那么多）。昼：午后的藏书阁，高窗斜进来一道日光（第 6 轮起；第 10 轮重做，见样式里“昼”那一段）。 */
    night?: boolean;
    /** 首屏停着时的动静（第 7 轮）；缺省全开。访客要求少动效时一样都没有。 */
    effects?: readonly SceneEffect[];
}>(), {progress: 0, intro: true, deskReady: true, night: true, effects: () => SCENE_EFFECTS});

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
const fixed = (value: number): string => (Math.round(value * 1000) / 1000).toString();
const carrierBox = computed(() => ({left: px(box.value.left), top: px(box.value.top), width: px(box.value.width), height: px(box.value.height)}));

// ── 悬在空中的几层：首屏时的位置、深度与姿态（见 `sanctum.ts` 的 `Floater`） ──

interface Layer {
    readonly floater: Floater;
    readonly width: number;
    readonly height: number;
}

/** 三张纸（能点开细看的那几层）。 */
type PaperId = "manuscript" | "character" | "map";
const PAPER_IDS: readonly PaperId[] = ["manuscript", "character", "map"];
/** 三张纸悬着的倾角（度）。细看时按几成转正：留一成五的倾角，像拿在手里看，不是贴在屏幕上。 */
const TILTS: Readonly<Record<PaperId, {readonly x: number; readonly y: number; readonly z: number}>> = {
    manuscript: {x: 4, y: 24, z: -7},
    character: {x: 0, y: -26, z: 6},
    map: {x: 40, y: 0, z: 9},
};
function paperPose(name: PaperId, focus: number): string {
    const keep = 1 - 0.85 * focus;
    const {x, y, z} = TILTS[name];
    return `perspective(900px) rotateY(${fixed(y * keep)}deg) rotateZ(${fixed(z * keep)}deg) rotateX(${fixed(x * keep)}deg)`;
}
/**
 * 细看时在屏幕上多挪多少、放多大：手稿与人物卡往下让一点、不压标题两端，地图往上提、不被舞台下沿裁掉（@designer 第 8 轮：落位微偏，
 * 不盖死主标题与按钮）。
 */
const FOCUS_LIFT: Readonly<Record<PaperId, {readonly dx: number; readonly dy: number; readonly zoom: number}>> = {
    manuscript: {dx: 28, dy: 56, zoom: 1.24},
    character: {dx: -28, dy: 60, zoom: 1.24},
    map: {dx: 48, dy: -104, zoom: 1.22},
};

const LAYERS = {
    // 第 9 轮的星盘：最远，右上角一半出画（`astrolabe`）。
    astrolabe: {floater: {at: {x: 0.965, y: 0.05}, depth: -900, pose: "rotateZ(-8deg)", fade: [0, 360]}, width: 400, height: 400},
    manuscript: {floater: {at: {x: 0.15, y: 0.44}, depth: -620, pose: paperPose("manuscript", 0), fade: [160, 520]}, width: 250, height: 330},
    character: {floater: {at: {x: 0.858, y: 0.38}, depth: -470, pose: paperPose("character", 0), fade: [160, 520]}, width: 230, height: 300},
    map: {floater: {at: {x: 0.2, y: 0.84}, depth: -240, pose: paperPose("map", 0), fade: [160, 520]}, width: 330, height: 236},
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

/** 手稿上的几行：第一章的开头与最后那段敲门（第一幕要对照的伏笔）。敲门那一行单独画：从字到世界从写它起笔。 */
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
/** 红圈圈住的“三下”在那一行里的中点（x）：字号 11.5、字距 0.02em，第 8、9 个字。 */
const KNOCK_RING_X = 118;

/** 第二面的时间线：几章里的几件事，第一章与第五章那两声敲门用一道红线连起来。 */
const TIMELINE = [
    {x: 44, chapter: "一", event: "银钥匙"},
    {x: 120, chapter: "三", event: "灰塔"},
    {x: 196, chapter: "五", event: "第四下"},
    {x: 282, chapter: "十", event: "第八层"},
] as const;

// ── 首屏停着时的动静（第 7 轮） ──

const effectOn = (effect: SceneEffect): boolean => !reduced && props.effects.includes(effect);
/** 静物（星盘、线索丝）只看开没开：少动效时照样画，只是不动。 */
const featureOn = (effect: SceneEffect): boolean => props.effects.includes(effect);

/**
 * 从字到世界走到哪了：每样东西此刻显出来没有（怎么显、怎么沉回纸里写在样式里）。
 * 不演时（少动效、这一版不要它）停在都显出来的样子：敲门那一行、高亮与批注、地图上的海岸与灰塔。
 */
const still = !effectOn("relay");
const relay = reactive({written: still, mapped: still, noted: still, lyra: false, plot: false, sinking: false});
/** 时间线换到上面过一次：之后换回去才放动画（挂上时不演）。 */
const plotMoved = ref(false);
/** 写在根上给探针读：此刻显出来的几样（`written mapped noted lyra plot sinking` 里的若干）。 */
const relayState = computed(() => (Object.keys(relay) as Array<keyof typeof relay>).filter((key) => relay[key]).join(" ") || "none");

/** 一圈 30 秒，约五秒一步，演一半、停一半（@designer 第 7 轮）。时刻从开灯后 0.9 秒算起：进屏一秒内起笔。 */
const RELAY_CYCLE = 30_000;
const RELAY_LEAD = 900;
const RELAY: ReadonlyArray<{readonly at: number; readonly run: () => void}> = [
    // 一：落墨，敲门那一行从左往右写出来。每一步星盘拨一格；牵动哪张纸，那张的线索丝脉冲（第 10 轮，`relayBeat`）。
    {at: 0, run: () => {
        relay.written = true;
        relayBeat("manuscript");
    }},
    // 二：一粒金尘从那一行飞到地图上，海岸线描出来、灰塔升起、红色航线流起来。
    {at: 5000, run: () => {
        relayBeat(null);
        fly("knock", "map", () => {
            relay.mapped = true;
            pulseThread("map");
        });
    }},
    // 三：高亮涂过那一行，红笔圈出“三下”，牵一条线写批注。
    {at: 10_000, run: () => {
        relay.noted = true;
        relayBeat("manuscript");
    }},
    // 四：金尘从批注飞到人物卡上，压在下面的星璃便笺斜着抽出来一截。
    {at: 15_000, run: () => {
        relayBeat(null);
        fly("note", "card", () => {
            relay.lyra = true;
            pulseThread("character");
        });
    }},
    // 五：金尘沿着航线从霜港走到灰塔，时间线换到上面，红线连起第一章与第五章那两声敲门。
    {at: 20_000, run: () => {
        relayBeat(null);
        fly("route-start", "route-end", () => {
            relay.plot = true;
            plotMoved.value = true;
            pulseThread("map");
        });
    }},
    // 六：墨沉回纸里；便笺收回去，时间线换回下面。看不见以后把各样东西放回没写的样子，下一圈再写。
    {at: 25_000, run: () => {
        relay.sinking = true;
        relayBeat(null);
    }},
    {at: 26_500, run: () => {
        relay.lyra = false;
    }},
    {at: 27_600, run: () => {
        relay.plot = false;
    }},
    {at: 29_300, run: () => {
        Object.assign(relay, {written: false, mapped: false, noted: false});
    }},
    {at: 29_600, run: () => {
        relay.sinking = false;
    }},
];
/** 一圈里的六步（星盘每步拨一格；点星盘时跳到下一步）。后面几个时刻是第六步的收尾，不算一步。 */
const RELAY_BEATS = [0, 5000, 10_000, 15_000, 20_000, 25_000] as const;
/** 从字到世界的钟（ms）：只在首屏亮着、镜头没推走时往前走。 */
let relayTime = -RELAY_LEAD;

/** 钟往前走 `ms`：走过的时刻上的那一步依次触发（跨圈也算），飞到了的金尘落下。 */
function advanceRelay(ms: number): void {
    const from = relayTime;
    relayTime += ms;
    for (let cycle = Math.floor(from / RELAY_CYCLE) * RELAY_CYCLE; cycle <= relayTime; cycle += RELAY_CYCLE) {
        for (const step of RELAY) {
            const at = cycle + step.at;
            if (at > from && at <= relayTime) step.run();
        }
    }
    for (const comet of comets) {
        if (comet.landed || relayTime - comet.start < comet.span) continue;
        comet.landed = true;
        comet.arrive();
    }
    comets = comets.filter((comet) => relayTime - comet.start < comet.span + BURST_MS);
}

interface Point {
    readonly x: number;
    readonly y: number;
}

/** 一粒金尘：沿二次曲线从 `from` 飞到 `to`，`span` 毫秒到；落下后漾开一圈（`BURST_MS`）。 */
interface Comet {
    readonly from: Point;
    readonly to: Point;
    readonly control: Point;
    readonly start: number;
    readonly span: number;
    readonly arrive: () => void;
    landed: boolean;
}
let comets: Comet[] = [];
const BURST_MS = 650;

/** 场景坐标里某个锚点（`data-sx-anchor`）的中心。Lab 的画布可能有 CSS zoom，换算时除掉。 */
function anchorPoint(name: string): Point | null {
    const element = root.value;
    const target = element?.querySelector(`[data-sx-anchor="${name}"]`) ?? null;
    if (element === null || target === null) return null;
    const frame = element.getBoundingClientRect();
    const zoom = element.offsetWidth > 0 ? frame.width / element.offsetWidth : 1;
    const rect = target.getBoundingClientRect();
    return {x: (rect.left + rect.width / 2 - frame.left) / zoom, y: (rect.top + rect.height / 2 - frame.top) / zoom};
}

/** 放一粒金尘从 `from` 飞到 `to`（往上拱一道弧，远的飞得久一些），落下时触发 `arrive`。量不到锚点时直接触发。 */
function fly(from: string, to: string, arrive: () => void): void {
    const start = anchorPoint(from);
    const end = anchorPoint(to);
    if (start === null || end === null) {
        arrive();
        return;
    }
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const control = {x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - Math.min(220, distance * 0.28)};
    comets.push({from: start, to: end, control, start: relayTime, span: 900 + distance * 0.55, arrive, landed: false});
}

/**
 * 指针视差：每层挪多远（px，指针到舞台边上时）、纸倾多少度（@designer：不超过 2 度）。近的挪得多；
 * 第 9 轮加大到前景约 16px、中景约 7px（@designer：第 8 轮的几个像素看不出来）。
 */
const PARALLAX: Readonly<Record<LayerId, {readonly shift: number; readonly tilt: number}>> = {
    astrolabe: {shift: 4, tilt: 0},
    manuscript: {shift: 7, tilt: 1.2},
    character: {shift: 8, tilt: 1.5},
    map: {shift: 14, tilt: 1.8},
    book: {shift: 16, tilt: 0},
    ribbon: {shift: 16, tilt: 0},
};
const parEls: Partial<Record<LayerId, HTMLElement>> = {};
const setPar = (name: LayerId) => (element: unknown): void => {
    if (element instanceof HTMLElement) parEls[name] = element;
    else delete parEls[name];
};
const bookGlint = useTemplateRef<HTMLElement>("bookGlint");
const ribbonTail = useTemplateRef<HTMLElement>("ribbonTail");
const pointerEffects = computed(() => (["parallax", "lantern", "thread", "glint", "ribbon"] as const).some(effectOn));

/** 指针在哪（舞台中心为 0，四边为 ±1）；`gaze` 带惯性地追它，丝带的尾巴再慢半拍追 `gaze`。 */
const aim = {x: 0, y: 0};
const gaze = {x: 0, y: 0, vx: 0, vy: 0};
const tail = {x: 0, v: 0};

/**
 * 指针在舞台上的位置与速度（舞台坐标；px 与 px/s，平滑过约 50ms）：提灯追它的位置，金丝看它的速度（第 9 轮）。
 * 时刻取事件自带的时间戳（和 `performance.now()` 同一个钟）：主线程忙时移动事件会攒成一批才送到，按处理的时刻算速度会差得很远
 * （设计语言踩过的坑 87）。停下以后不再有移动事件，速度由帧循环衰减到零（`stepEffects`）。
 * `inside`：指针在窗口里（离开窗口时灯熄掉）；`overControl`：停在按钮或链接上（金丝不出，@designer：进交互区隐退）。
 */
const stir = {x: -1e4, y: -1e4, vx: 0, vy: 0, at: 0, inside: false, overControl: false};
const STIR_MAX_SPEED = 3500;
/** 最近一小段指针走过的点（舞台坐标与事件时间戳）：金丝沿着它画。只留最近 200ms。 */
const trail: Array<{readonly x: number; readonly y: number; readonly at: number}> = [];

/**
 * 提灯（第 9 轮）：一团暖光追着指针（临界阻尼，刚度 70：匀速移动时落后约 0.24 秒，即 2/√70，@designer 要的滞后 240ms；停下后约半秒追上），`glow` 是灯亮了几成：
 * 指针进来亮起，离开窗口熄掉，镜头推走时跟着收。照得到多远的纸看 `LAMP_REACH`。
 */
const lamp = {x: 0, y: 0, vx: 0, vy: 0, glow: 0};
const LAMP_REACH = 460;
/** 受光的几层：三张纸、书角与星盘（丝带太细，不算）。 */
const LIT_LAYERS = ["astrolabe", "manuscript", "character", "map", "book"] as const;
const lantern = useTemplateRef<HTMLElement>("lantern");
const lanternGlow = useTemplateRef<HTMLElement>("lanternGlow");

// ── 帧循环里的读与写（第 11 轮，开发者：首屏滚动变卡） ──

/**
 * 这一帧开头量好的外框：提灯、线索丝、星盘都要知道几层此刻在哪。原来各自在写过样式以后再量，每量一次就逼浏览器同步重算一遍样式，
 * 一帧多出两三次；现在 `render` 一开头、还没写任何东西时一次量完。量到的是上一帧画出来的位置，慢一帧，灯光与线索丝看不出来。
 */
const measured: {frame: DOMRect | null; zoom: number; layers: Partial<Record<LayerId, DOMRect>>; table: DOMRect | null} = {frame: null, zoom: 1, layers: {}, table: null};

function measure(): void {
    const element = root.value;
    measured.frame = element?.getBoundingClientRect() ?? null;
    measured.zoom = element !== null && measured.frame !== null && element.offsetWidth > 0 ? measured.frame.width / element.offsetWidth : 1;
    for (const name of LAYER_IDS) measured.layers[name] = layerEls[name]?.getBoundingClientRect();
    measured.table = carrier.value?.getBoundingClientRect() ?? null;
}

/** 量好的一层的中心（舞台坐标）；量不到时 null。 */
function measuredCenter(name: LayerId): Point | null {
    const rect = measured.layers[name];
    const frame = measured.frame;
    if (rect === undefined || frame === null) return null;
    return {x: (rect.left + rect.width / 2 - frame.left) / measured.zoom, y: (rect.top + rect.height / 2 - frame.top) / measured.zoom};
}

/**
 * 帧循环每帧写的样式与属性，值没变就不写：SVG 的属性改一次，里面的图形都要重新布局；样式改一次，这个元素要重算。
 * 记的是这里上一次写的值，所以只用在只由帧循环写的那几处（别处改了同一个属性时这里不知道）。
 */
const written = new WeakMap<Element, Map<string, string>>();

function changed(element: Element, key: string, value: string): boolean {
    let last = written.get(element);
    if (last === undefined) {
        last = new Map();
        written.set(element, last);
    }
    if (last.get(key) === value) return false;
    last.set(key, value);
    return true;
}

function writeStyle(element: HTMLElement | SVGElement, property: string, value: string): void {
    if (changed(element, `style:${property}`, value)) element.style.setProperty(property, value);
}

function writeAttribute(element: Element | null | undefined, name: string, value: string): void {
    if (element !== null && element !== undefined && changed(element, `attr:${name}`, value)) element.setAttribute(name, value);
}

/**
 * 受光、细看与对焦的变量写在哪几个元素上：每层里真正用它们的那几样（纸、书角、星盘）。这几个变量在样式里登记成不继承（`@property`）：
 * 继承的自定义属性写在一层的外层上，一改它下面几百个元素都要重算样式（滚动卡的主因，第 11 轮量过）。纸都一直画着（没有 `v-if`），按层缓存。
 */
const litCache = new WeakMap<HTMLElement, readonly (HTMLElement | SVGElement)[]>();

function litTargets(name: LayerId): readonly (HTMLElement | SVGElement)[] {
    const layer = layerEls[name];
    if (layer === undefined) return [];
    let targets = litCache.get(layer);
    if (targets === undefined) {
        targets = [...layer.querySelectorAll<HTMLElement | SVGElement>(".sx-sheet, .sx-book, .sx-astrolabe")];
        litCache.set(layer, targets);
    }
    return targets;
}

function onPointerMove(event: PointerEvent): void {
    // 只认真的鼠标：第一幕演示的指针是合成的事件，触屏没有悬停。
    if (!event.isTrusted || event.pointerType !== "mouse") return;
    const element = root.value;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1));
    aim.y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1));
    const zoom = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
    const x = (event.clientX - rect.left) / zoom;
    const y = (event.clientY - rect.top) / zoom;
    const now = event.timeStamp;
    const gap = (now - stir.at) / 1000;
    if (gap > 0 && gap < 0.25) {
        // 事件挤在一起时（浏览器合并移动事件、一帧里补发几个）两次之间的间隔会很短，算出来的速度虚高：封顶 3500 px/s。
        const blend = 1 - Math.exp(-gap / 0.05);
        const speed = Math.hypot(x - stir.x, y - stir.y) / gap;
        const cap = speed > STIR_MAX_SPEED ? STIR_MAX_SPEED / speed : 1;
        stir.vx += (((x - stir.x) / gap) * cap - stir.vx) * blend;
        stir.vy += (((y - stir.y) / gap) * cap - stir.vy) * blend;
    } else {
        stir.vx = 0;
        stir.vy = 0;
        trail.length = 0;
    }
    // 第一次看到指针：灯直接落在那里，不从舞台左上角飞过来。
    if (!stir.inside) {
        lamp.x = x;
        lamp.y = y;
        lamp.vx = 0;
        lamp.vy = 0;
    }
    stir.x = x;
    stir.y = y;
    stir.at = now;
    stir.inside = true;
    stir.overControl = event.target instanceof Element && event.target.closest("a, button") !== null;
    trail.push({x, y, at: now});
    while (trail.length > 0 && now - trail[0]!.at > 200) trail.shift();
    if (rendered < 0.2) wake();
}

/** 指针离开窗口：慢慢回到正中。 */
function onPointerLeave(event: PointerEvent): void {
    if (event.relatedTarget !== null) return;
    aim.x = 0;
    aim.y = 0;
    stir.inside = false;
    trail.length = 0;
    if (rendered < 0.2) wake();
}

/**
 * 阻尼弹簧：`gaze` 临界阻尼（不回弹，约半秒追上；第 8 轮约 0.8 秒，@designer 第 9 轮嫌跟手慢）；丝带尾巴软一些、略欠阻尼，
 * 追上时轻轻多摆一下（第 8 轮另加的“被风带着摆”删了，@designer 第 9 轮：失真）。
 */
function stepGaze(dt: number): void {
    const stiff = 60;
    const damp = 2 * Math.sqrt(stiff);
    gaze.vx += (stiff * (aim.x - gaze.x) - damp * gaze.vx) * dt;
    gaze.vy += (stiff * (aim.y - gaze.y) - damp * gaze.vy) * dt;
    gaze.x += gaze.vx * dt;
    gaze.y += gaze.vy * dt;
    const soft = 11;
    tail.v += (soft * (gaze.x - tail.x) - 1.7 * Math.sqrt(soft) * tail.v) * dt;
    tail.x += tail.v * dt;
}

/** 把指针的那一份写到各层：镜头推走时一起收掉（推到 0.18 收完），落地后不留痕迹。 */
function applyGaze(): void {
    const fade = 1 - smooth(0, 0.18, rendered);
    if (effectOn("parallax")) {
        for (const name of LAYER_IDS) {
            const element = parEls[name];
            if (element === undefined) continue;
            const {shift, tilt} = PARALLAX[name];
            writeStyle(element, "transform", `translate3d(${fixed(-gaze.x * shift * fade)}px, ${fixed(-gaze.y * shift * 0.6 * fade)}px, 0) perspective(900px) rotateX(${fixed(gaze.y * tilt * fade)}deg) rotateY(${fixed(-gaze.x * tilt * fade)}deg)`);
        }
    }
    if (effectOn("ribbon") && ribbonTail.value !== null) writeStyle(ribbonTail.value, "transform", `rotate(${fixed((tail.x - gaze.x) * 3.4 * fade)}deg)`);
    if (effectOn("glint")) {
        for (const element of [hero.value, bookGlint.value]) {
            element?.style.setProperty("--sx-glint-x", fixed(gaze.x));
            element?.style.setProperty("--sx-glint-y", fixed(gaze.y));
        }
    }
}

/** 提灯追指针一步（真实时间，切成不超过 16ms 的小步），亮几成往目标靠。 */
function stepLantern(seconds: number): void {
    const stiff = 70;
    const damp = 2 * Math.sqrt(stiff);
    for (let left = Math.min(seconds, 0.25); left > 0; left -= 0.016) {
        const dt = Math.min(0.016, left);
        lamp.vx += (stiff * (stir.x - lamp.x) - damp * lamp.vx) * dt;
        lamp.vy += (stiff * (stir.y - lamp.y) - damp * lamp.vy) * dt;
        lamp.x += lamp.vx * dt;
        lamp.y += lamp.vy * dt;
    }
    lamp.glow += ((stir.inside ? 1 : 0) - lamp.glow) * (1 - Math.exp(-seconds / 0.25));
}

/**
 * 把灯写上去：光斑的位置与拉长（快移时顺着方向拉长到 1.15 倍、横向收一点，停下自己回圆），
 * 照着的几样写受光几成与灯的方向。位置用这一帧开头量好的外框（`measured`），受光的变量写在纸、书角与星盘本身上。
 */
function applyLantern(fade: number): void {
    if (lantern.value === null || lanternGlow.value === null) return;
    const strength = lamp.glow * fade;
    writeStyle(lantern.value, "opacity", fixed(strength));
    if (strength > 0.001) {
        const speed = Math.hypot(lamp.vx, lamp.vy);
        const stretch = 1 + 0.15 * Math.min(1, speed / 900);
        const angle = (Math.atan2(lamp.vy, lamp.vx) * 180) / Math.PI;
        writeStyle(lanternGlow.value, "transform", `translate3d(${fixed(lamp.x)}px, ${fixed(lamp.y)}px, 0) translate(-50%, -50%) rotate(${fixed(angle)}deg) scale(${fixed(stretch)}, ${fixed(1 / Math.sqrt(stretch))})`);
    }
    for (const name of LIT_LAYERS) {
        const center = measuredCenter(name);
        if (center === null) continue;
        const dx = lamp.x - center.x;
        const dy = lamp.y - center.y;
        const distance = Math.hypot(dx, dy) || 1;
        const lit = Math.max(0, 1 - distance / LAMP_REACH) ** 1.4 * strength;
        for (const target of litTargets(name)) {
            writeStyle(target, "--sx-lit", fixed(lit));
            writeStyle(target, "--sx-lx", fixed((dx / distance) * lit));
            writeStyle(target, "--sx-ly", fixed((dy / distance) * lit));
        }
    }
}

/** 细看到几成写给纸本身（纸的影子按它加深，见文件头第 6 条）；没变就不写。 */
function applyFocusVars(): void {
    for (const name of PAPER_IDS) {
        const value = fixed(focusAmount[name].x);
        for (const target of litTargets(name)) writeStyle(target, "--sx-focus", value);
    }
}

/** 每帧：从字到世界的钟按真实时间往前走（只在首屏亮着、镜头没推走、没在细看哪张纸时），指针的那一份追一步再写上去。 */
function stepEffects(dt: number): void {
    if (effectOn("relay") && lit.value && rendered < 0.08 && focused.value === null) advanceRelay(frameMs);
    if (performance.now() - stir.at > 60) {
        const decay = Math.exp(-dt / 0.12);
        stir.vx *= decay;
        stir.vy *= decay;
    }
    stepFocus(frameMs / 1000);
    applyFocusVars();
    if (pointerEffects.value) {
        stepGaze(dt);
        applyGaze();
    }
    if (effectOn("lantern")) {
        stepLantern(frameMs / 1000);
        applyLantern(1 - smooth(0, 0.18, rendered));
    }
    featureClock += frameMs;
    if (featureOn("astrolabe")) stepAstrolabe();
    if (featureOn("threads")) applyThreads(lit.value ? 1 - smooth(0, 0.12, rendered) : 0, true);
}

// ── 点纸细看与停驻唤醒（第 8 轮） ──

/** 点了哪张纸细看；null 是都放着。 */
const focused = ref<PaperId | null>(null);
/** 每张纸细看到几成（0 到 1）：帧循环里的临界阻尼弹簧追 `focused`，约 0.6 秒到位、不回弹；少动效时直接到位。 */
const focusAmount: Record<PaperId, {x: number; v: number}> = {manuscript: {x: 0, v: 0}, character: {x: 0, v: 0}, map: {x: 0, v: 0}};
const isPaper = (name: LayerId): name is PaperId => (PAPER_IDS as readonly LayerId[]).includes(name);

/**
 * 弹簧按真实时间走（`seconds` 是这一帧真实走过的秒数）：镜头那份时间每帧封顶 64ms，掉帧时拿它推弹簧，细看就慢下来（踩过的坑 82）。
 * 一帧隔得久时切成不超过 16ms 的小步，弹簧才稳。
 */
function stepFocus(seconds: number): void {
    const stiff = 60;
    const damp = 2 * Math.sqrt(stiff);
    for (const name of PAPER_IDS) {
        const state = focusAmount[name];
        const goal = focused.value === name ? 1 : 0;
        if (reduced) {
            state.x = goal;
            state.v = 0;
            continue;
        }
        for (let left = Math.min(seconds, 0.5); left > 0; left -= 0.016) {
            const dt = Math.min(0.016, left);
            state.v += (stiff * (goal - state.x) - damp * state.v) * dt;
            state.x += state.v * dt;
        }
        if (Math.abs(goal - state.x) < 0.001 && Math.abs(state.v) < 0.01) {
            state.x = goal;
            state.v = 0;
        }
    }
}

/** 这一层此刻的投影：细看中的纸按几成转正、多挪一点、放大一点。 */
function shotOf(stage: StageSize, name: LayerId, p: number): ReturnType<typeof floaterShot> {
    const amount = isPaper(name) ? focusAmount[name].x : 0;
    if (!isPaper(name) || amount <= 0.0005) return floaterShot(stage, LAYERS[name].floater, LAYERS[name], p);
    const lift = FOCUS_LIFT[name];
    const floater: Floater = {...LAYERS[name].floater, pose: paperPose(name, amount)};
    const shift: FloaterLift = {dx: lift.dx * amount, dy: lift.dy * amount, zoom: 1 + (lift.zoom - 1) * amount};
    return floaterShot(stage, floater, LAYERS[name], p, shift);
}

/** 点一张纸：细看它；再点就放回去。镜头推起来以后不接（纸正往外飞）。 */
function toggleFocus(name: PaperId): void {
    if (diving.value) return;
    focused.value = focused.value === name ? null : name;
    if (focused.value !== null) pulseThread(focused.value);
    wake();
}

/** 细看时点在别处（纸以外）、按 Esc：放回去。 */
function onDocumentPointerDown(event: PointerEvent): void {
    if (focused.value === null) return;
    if (event.target instanceof Element && event.target.closest("[data-sx-paper]") !== null) return;
    focused.value = null;
    wake();
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || focused.value === null) return;
    focused.value = null;
    wake();
}

/**
 * 指针在纸上时，靠近指针的那一角微微抬起（`--lift-x`、`--lift-y`，样式里转成倾角）。
 * 第 8 轮另有“停驻 0.4 秒唤醒纸上细节”，第 9 轮删了（@designer：0.4 秒太慢；提灯照着的纸自己会亮）。
 * 两个变量写在用它们的 `.sx-lean` 上、登记成不继承（第 11 轮）：写在外层的热区上时，每个移动事件纸里一百多个元素都要重算样式。
 */
/** 指针停在哪张纸上（线索丝亮那一根）。 */
const hoveredPaper = ref<PaperId | null>(null);

/** 热区里那一层 `.sx-lean`（抬角的倾角写在它上面）。 */
const leanOf = (element: HTMLElement): HTMLElement | null => element.querySelector<HTMLElement>(".sx-lean");

function onPaperMove(event: PointerEvent): void {
    if (!event.isTrusted || event.pointerType !== "mouse") return;
    const element = event.currentTarget as HTMLElement;
    const name = element.dataset.sxPaper;
    if (name !== undefined && isPaperId(name)) hoveredPaper.value = name;
    const lean = leanOf(element);
    if (lean === null) return;
    const rect = element.getBoundingClientRect();
    writeStyle(lean, "--lift-x", fixed(Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1))));
    writeStyle(lean, "--lift-y", fixed(Math.max(-1, Math.min(1, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1))));
}

function onPaperLeave(event: PointerEvent): void {
    const lean = leanOf(event.currentTarget as HTMLElement);
    if (lean !== null) {
        writeStyle(lean, "--lift-x", "0");
        writeStyle(lean, "--lift-y", "0");
    }
    hoveredPaper.value = null;
}

const isPaperId = (name: string): name is PaperId => (PAPER_IDS as readonly string[]).includes(name);

// ── 第 9 轮加的两样（开发者问首屏要不要多加点元素，@designer 建议最多两样） ──

/**
 * 星盘外圈的刻度（每 5 度一道，每 15 度长一点）与网环上几颗星的指针尖，预先算好坐标（星盘的 SVG 以圆心为原点）。
 * 不画从圆心放射出去的直辐条：画了像船舵。刻度合成一条路径（第 11 轮）：外圈一直在转，72 根线时每帧 72 个图形都要重新布局。
 */
const ASTROLABE_TICKS = Array.from({length: 72}, (_, index) => {
    const angle = (index * 5 * Math.PI) / 180;
    const outer = index % 3 === 0 ? 194 : 188;
    return `M${fixed(181 * Math.cos(angle))},${fixed(181 * Math.sin(angle))}L${fixed(outer * Math.cos(angle))},${fixed(outer * Math.sin(angle))}`;
}).join("");
const ASTROLABE_STARS = [20, 72, 118, 166, 214, 262, 312].map((degrees, index) => {
    const radius = [150, 132, 156, 140, 150, 128, 152][index]!;
    const angle = (degrees * Math.PI) / 180;
    const along = {x: Math.cos(angle), y: Math.sin(angle)};
    const across = {x: -along.y, y: along.x};
    const base = radius - 20;
    const point = (r: number, side: number): string => `${fixed(along.x * r + across.x * side)},${fixed(along.y * r + across.y * side)}`;
    return {key: degrees, d: `M${point(radius, 0)} L${point(base, 4.5)} Q${point(base - 6, 0)} ${point(base, -4.5)} Z`};
});

/**
 * 线索丝：每根从一张纸靠工作台那一侧落到工作台上缘的一处（`end` 是在工作台外框里的比例）。每帧按纸与工作台此刻的外框重算一遍：
 * 纸在漂、在视差，工作台在开场里亮起来，丝要跟着。路径是一段三次曲线，从纸往下垂、再落到桌上，绕开中间的标题与按钮。
 */
const THREAD_ENDS: Readonly<Record<PaperId, {readonly from: {readonly x: number; readonly y: number}; readonly end: {readonly x: number; readonly y: number}}>> = {
    manuscript: {from: {x: 0.82, y: 0.86}, end: {x: 0.52, y: 0.1}},
    character: {from: {x: 0.2, y: 0.88}, end: {x: 0.84, y: 0.1}},
    map: {from: {x: 0.86, y: 0.36}, end: {x: 0.16, y: 0.22}},
};
const threadLayer = useTemplateRef<SVGSVGElement>("threadLayer");
/** 每根丝的几样：丝本身、悬停时一趟趟走的亮光、脉冲时走的一粒光珠、落点上的光斑。 */
interface ThreadParts {
    line: SVGPathElement | undefined;
    run: SVGPathElement | undefined;
    bead: SVGPathElement | undefined;
    land: SVGCircleElement | undefined;
}
const threadEls: Record<PaperId, ThreadParts> = {
    manuscript: {line: undefined, run: undefined, bead: undefined, land: undefined},
    character: {line: undefined, run: undefined, bead: undefined, land: undefined},
    map: {line: undefined, run: undefined, bead: undefined, land: undefined},
};
const setThread = (name: PaperId, part: keyof ThreadParts) => (element: unknown): void => {
    if (part === "land") threadEls[name].land = element instanceof SVGCircleElement ? element : undefined;
    else threadEls[name][part] = element instanceof SVGPathElement ? element : undefined;
};
/** 亮哪一根：细看着的那张优先，其次是指针停着的那张。 */
const litThread = computed<PaperId | null>(() => focused.value ?? hoveredPaper.value);

// ── 第 10 轮：星盘与线索丝的动静（开发者：这两样东西没多少动画和交互，不仔细看注意不到；做法照 @designer 第 10 轮） ──

/** 这两样的钟（ms）：按真实时间走，探针放慢时跟着慢；只在 `stepEffects` 里往前走（少动效时不走，光珠与拨动都没有）。 */
let featureClock = 0;

/**
 * 线索丝的一次脉冲：那根丝亮起来、加粗，一粒光珠 1.1 秒从纸走到工作台，到了落点漾开一圈（550ms），再过 0.4 秒丝暗回去。
 * 从字到世界每一步牵动哪张纸就脉冲哪根（落墨与红笔是手稿，金尘落到地图、走完航线是地图，抽出便笺是人物卡），点开一张纸细看时那根也来一次，
 * 点星盘时三根一起来。只记开始的时刻，样子由 `applyThreads` 每帧算。
 */
const THREAD_BEAD_MS = 1100;
const THREAD_RIPPLE_MS = 550;
const THREAD_FADE_MS = 400;
const threadPulse: Record<PaperId, number> = {manuscript: -1e9, character: -1e9, map: -1e9};
/** 悬停或细看的那根亮到几成（0 到 1，约 0.3 秒追上）：那根绷起、亮，别的压暗。 */
const threadLit: Record<PaperId, number> = {manuscript: 0, character: 0, map: 0};

function pulseThread(name: PaperId): void {
    if (!featureOn("threads")) return;
    threadPulse[name] = featureClock;
    wake();
}

/**
 * 星盘：网环跟着从字到世界的每一步拨一格（先往回带 1.5 度，再顺转 18 度、冲过一点回来，900ms），同时铜环上扫过一道金光（700ms）；
 * 外圈刻度一直慢慢转（90 秒一圈）。指针离圆心 `ASTRO_REACH` 以内时对焦、提亮，横贯盘面的照准规转向指针，最多偏 22 度；
 * 点一下拨 30 度（380ms），从字到世界直接跳到下一步，三根线索丝一起脉冲。角度每帧算出来写到 SVG 上，不用 CSS 动画：
 * 拨到一半又来一拨时，要从此刻的角度接着拨。
 */
const ASTRO_REACH = 260;
const ASTRO_RING_MS = 90_000;
/** 照准规平时的角度（度）。 */
const ASTRO_ALIDADE = 28;
const ASTRO_TICK = cubicBezier(0.22, 1.2, 0.36, 1);
const astro = {from: 0, to: 0, start: -1e9, span: 900, back: 0, alidade: 0, alidadeV: 0, near: 0, glint: -1e9};
const astroRing = useTemplateRef<SVGGElement>("astroRing");
const astroRete = useTemplateRef<SVGGElement>("astroRete");
const astroAlidade = useTemplateRef<SVGGElement>("astroAlidade");
const astroGlint = useTemplateRef<SVGGElement>("astroGlint");

/** 网环此刻拨到哪了（度）。一拨的曲线：前 15% 往回带 `back` 度，之后冲过一点回到终点。 */
function reteAngle(now: number): number {
    const t = astro.span <= 0 ? 1 : Math.min(1, Math.max(0, (now - astro.start) / astro.span));
    if (t >= 1) return astro.to;
    if (t < 0.15) return astro.from - astro.back * Math.sin(((t / 0.15) * Math.PI) / 2);
    return astro.from - astro.back + (astro.to - astro.from + astro.back) * ASTRO_TICK.at((t - 0.15) / 0.85);
}

/** 拨一格：从此刻的角度接着拨（上一拨没拨完也一样），铜环扫一道光。`span` 为 0 时一步到位（少动效）。 */
function turnAstrolabe(degrees: number, span: number, back: number): void {
    if (!featureOn("astrolabe")) return;
    const now = featureClock;
    astro.from = reteAngle(now);
    astro.to += degrees;
    astro.start = now;
    astro.span = span;
    astro.back = back;
    astro.glint = now;
    wake();
}

/** 从字到世界走到新的一步：星盘拨一格；`paper` 是这一步牵动的那张纸，它的线索丝脉冲。 */
function relayBeat(paper: PaperId | null): void {
    turnAstrolabe(18, 900, 1.5);
    if (paper !== null) pulseThread(paper);
}

/** 从字到世界直接跳到下一步（点星盘时）：把钟拨到下一步那一刻，由 `advanceRelay` 照常触发它（路过的收尾几步也依次触发）。 */
function skipRelay(): void {
    const cycle = Math.floor(relayTime / RELAY_CYCLE) * RELAY_CYCLE;
    const position = relayTime - cycle;
    const next = RELAY_BEATS.find((at) => at > position);
    advanceRelay((next === undefined ? cycle + RELAY_CYCLE : cycle + next) - relayTime);
}

/** 点星盘：拨 30 度，从字到世界跳到下一步，三根线索丝一起脉冲。少动效时只拨（一步到位），从字到世界本来就停着。 */
function onAstrolabeClick(): void {
    if (diving.value) return;
    turnAstrolabe(30, reduced ? 0 : 380, 0);
    if (effectOn("relay") && lit.value && focused.value === null) skipRelay();
    for (const name of PAPER_IDS) pulseThread(name);
}

/** 角度折到 -90 到 90 度之间：照准规是一根两头一样的尺，朝指针或背着指针都算对准。 */
const wrapHalfTurn = (degrees: number): number => ((((degrees + 90) % 180) + 180) % 180) - 90;

/** 每帧：指针离星盘多近、照准规追指针，把网环、外圈、照准规的角度与扫光写上去。 */
function stepAstrolabe(): void {
    const now = featureClock;
    const center = measuredCenter("astrolabe");
    let near = 0;
    let bearing = ASTRO_ALIDADE;
    // 停在链接或按钮上时不对焦：导航就在星盘前面，对焦变亮的盘面会垫在导航的字后面。
    if (center !== null && stir.inside && !stir.overControl) {
        const dx = stir.x - center.x;
        const dy = stir.y - center.y;
        // 离圆心不到六成半径时就全对焦，再往外渐渐虚回去。
        near = Math.min(1, Math.max(0, 1 - Math.hypot(dx, dy) / ASTRO_REACH) * 2.5);
        bearing = (Math.atan2(dy, dx) * 180) / Math.PI;
    }
    astro.near += (near - astro.near) * (1 - Math.exp(-frameMs / 250));
    // 照准规：临界阻尼弹簧追“朝着指针、最多偏 22 度”，约 0.24 秒跟上；指针走远时回到原来的角度。
    const goal = Math.max(-22, Math.min(22, wrapHalfTurn(bearing - ASTRO_ALIDADE))) * astro.near;
    const stiff = 260;
    const damp = 2 * Math.sqrt(stiff);
    for (let left = Math.min(frameMs / 1000, 0.25); left > 0; left -= 0.016) {
        const dt = Math.min(0.016, left);
        astro.alidadeV += (stiff * (goal - astro.alidade) - damp * astro.alidadeV) * dt;
        astro.alidade += astro.alidadeV * dt;
    }
    // 外圈 90 秒一圈，一帧不到 0.1 度：取到 0.1 度，没变的帧不写（改一次 transform，里面的几样都要重新布局）。
    writeAttribute(astroRing.value, "transform", `rotate(${(Math.round(((now / ASTRO_RING_MS) * 3600) % 3600) / 10).toFixed(1)})`);
    writeAttribute(astroRete.value, "transform", `rotate(${fixed(reteAngle(now))})`);
    writeAttribute(astroAlidade.value, "transform", `rotate(${fixed(ASTRO_ALIDADE + astro.alidade)})`);
    const glint = (now - astro.glint) / 700;
    const sweeping = glint >= 0 && glint < 1;
    writeAttribute(astroGlint.value, "transform", `rotate(${fixed(sweeping ? -60 + 200 * glint : -60)})`);
    if (astroGlint.value !== null) writeStyle(astroGlint.value, "opacity", fixed(sweeping ? 0.12 + 0.43 * Math.sin(Math.PI * glint) : 0.12));
    for (const target of litTargets("astrolabe")) writeStyle(target, "--sx-near", fixed(astro.near));
}

/**
 * 每帧按纸与工作台此刻的外框重算每根丝的路径（纸在漂、在视差，工作台在开场里亮起来，丝要跟着），再按脉冲与悬停算出这一帧的样子写上去。
 * `motion` 为 false 时（少动效）不走光珠、不漾、不绷：平时 0.22 的实线，亮的那根 0.78，落点一个静止的光斑。
 * 丝的透明度与粗细每帧由这里写，样式里不给它们过渡：每帧改值时过渡会一直重启，丝就拖在后面。
 */
function applyThreads(fade: number, motion: boolean): void {
    const layer = threadLayer.value;
    const frame = measured.frame;
    const table = measured.table;
    if (layer === null || frame === null || table === null) return;
    writeStyle(layer, "opacity", fixed(fade));
    if (fade <= 0.01) return;
    const zoom = measured.zoom;
    const toStage = (x: number, y: number): Point => ({x: (x - frame.left) / zoom, y: (y - frame.top) / zoom});
    const rects = PAPER_IDS.map((name) => measured.layers[name] ?? null);
    const now = featureClock;
    const follow = motion ? 1 - Math.exp(-frameMs / 120) : 1;
    for (const name of PAPER_IDS) threadLit[name] += ((litThread.value === name ? 1 : 0) - threadLit[name]) * follow;
    const rest = motion ? (props.night ? 0.2 : 0.24) : 0.22;
    const peak = motion ? 0.85 : 0.78;
    const breathe = motion ? 0.4 + 0.15 * Math.sin((now / 1400) * Math.PI * 2) : 0.5;
    PAPER_IDS.forEach((name, index) => {
        const rect = rects[index];
        const parts = threadEls[name];
        if (rect === null || rect === undefined || parts.line === undefined) return;
        const lit = threadLit[name];
        const {from, end} = THREAD_ENDS[name];
        const start = toStage(rect.left + rect.width * from.x, rect.top + rect.height * from.y);
        const stop = toStage(table.left + table.width * end.x, table.top + table.height * end.y);
        const sag = Math.max(60, Math.abs(stop.y - start.y) * 0.6);
        // 悬停时弧往上绷：两个控制点一起提 8px，弧顶约高 6px。
        const lift = motion ? 8 * lit : 0;
        const d = `M${fixed(start.x)},${fixed(start.y)} C${fixed(start.x)},${fixed(start.y + sag - lift)} ${fixed(stop.x)},${fixed(stop.y - sag * 0.5 - lift)} ${fixed(stop.x)},${fixed(stop.y)}`;
        // 脉冲走到哪了：起 150ms 亮起来，光珠到了再留 0.4 秒，之后 0.4 秒暗回去。
        const age = motion ? now - threadPulse[name] : -1;
        const hold = THREAD_BEAD_MS + THREAD_FADE_MS;
        const active = age < 0 ? 0 : age < 150 ? age / 150 : age < hold ? 1 : Math.max(0, 1 - (age - hold) / THREAD_FADE_MS);
        // 别的那根悬停着时，这一根压到 0.08。
        const others = Math.max(...PAPER_IDS.filter((other) => other !== name).map((other) => threadLit[other]));
        const base = rest + (0.08 - rest) * others;
        const opacity = Math.max(base + (0.74 - base) * active, base + (peak - base) * lit);
        // 看不见的几样（没在走的光珠、没亮的那段亮光、没漾的落点）不改路径与位置：每改一次都要重新布局、重画这一层。
        writeAttribute(parts.line, "d", d);
        writeStyle(parts.line, "stroke-opacity", fixed(opacity));
        writeStyle(parts.line, "stroke-width", fixed(1 + 0.75 * Math.max(active, lit)));
        writeStyle(parts.line, "--sx-glow", fixed(Math.max(active, lit)));
        if (lit > 0.01) writeAttribute(parts.run, "d", d);
        if (parts.bead !== undefined) {
            const travel = age >= 0 && age < THREAD_BEAD_MS ? age / THREAD_BEAD_MS : -1;
            writeStyle(parts.bead, "opacity", travel < 0 ? "0" : fixed(Math.min(1, (1 - travel) * 8)));
            if (travel >= 0) {
                writeAttribute(parts.bead, "d", d);
                writeStyle(parts.bead, "stroke-dashoffset", fixed(0.06 - travel * 1.06));
            }
        }
        if (parts.land !== undefined) {
            const ripple = age >= THREAD_BEAD_MS && age < THREAD_BEAD_MS + THREAD_RIPPLE_MS ? (age - THREAD_BEAD_MS) / THREAD_RIPPLE_MS : -1;
            const shown = Math.max(ripple < 0 ? 0 : 0.65 * (1 - ripple), lit * breathe);
            writeStyle(parts.land, "opacity", fixed(shown));
            if (shown > 0.001) {
                writeAttribute(parts.land, "cx", fixed(stop.x));
                writeAttribute(parts.land, "cy", fixed(stop.y));
                writeAttribute(parts.land, "r", fixed(ripple < 0 ? 4 : 4 + 10 * SETTLE.at(ripple)));
            }
        }
    });
}

// ── 开场 ──

const lit = ref(false);
const instant = ref(!props.intro || reduced);

// ── 镜头：平滑地追目标进度，每帧把变换写到各层上 ──

const carrier = useTemplateRef<HTMLElement>("carrier");
const deskHalo = useTemplateRef<HTMLElement>("deskHalo");
const deskShade = useTemplateRef<HTMLElement>("deskShade");
const deskSheen = useTemplateRef<HTMLElement>("deskSheen");
const deskSilk = useTemplateRef<HTMLElement>("deskSilk");
const hero = useTemplateRef<HTMLElement>("hero");
const light = useTemplateRef<HTMLElement>("light");
const vignette = useTemplateRef<HTMLElement>("vignette");
const dustCanvas = useTemplateRef<HTMLCanvasElement>("dust");

let rendered = props.intro ? 0 : props.progress;
let landed = false;
/** 只在落地与否变化时改（很少），模板据此让桌子接不接指针。 */
const isLanded = ref(false);
/** 镜头开始推了：悬停细看的热区不再接指针（纸正往外飞）。 */
const diving = ref(false);
let loop = 0;
let lastTime = 0;

function render(dt: number, speed: number): void {
    const stage = size.value;
    const p = rendered;
    const desk = carrier.value;
    if (!wide.value) {
        if (desk !== null) writeStyle(desk, "transform", "none");
        for (const name of LAYER_IDS) {
            const element = layerEls[name];
            if (element !== undefined) writeStyle(element, "visibility", "hidden");
        }
        applyHero(p);
        setLanded(true);
        drawDust(dt, 0, 1);
        return;
    }
    // 先量后写：这一帧要用的外框都在写任何样式之前量完（见 `measured`）。
    if (effectOn("lantern") || featureOn("threads") || featureOn("astrolabe")) measure();
    if (reduced) {
        // 少动效：首屏的样子静着；滚到一半时换成落地的工作台，只有淡入淡出。
        const far = p < 0.5;
        const shot = deskShot(stage, far ? 0 : 1);
        if (desk !== null) {
            writeStyle(desk, "transform", shot.transform);
            writeStyle(desk, "opacity", String(far ? 1 - smooth(0, 0.5, p) : smooth(0.5, 1, p)));
            applyDeskPaint(shot);
        }
        stepFocus(dt);
        for (const name of LAYER_IDS) {
            const element = layerEls[name];
            if (element === undefined) continue;
            const layer = shotOf(stage, name, 0);
            writeStyle(element, "transform", layer.transform);
            writeStyle(element, "opacity", String(1 - smooth(0, 0.4, p)));
            writeStyle(element, "visibility", p < 0.4 ? "visible" : "hidden");
        }
        applyHero(p);
        if (featureOn("threads")) applyThreads(1 - smooth(0, 0.4, p), false);
        // 少动效时星盘只在点了以后一步拨到位（见 `onAstrolabeClick`），这里照拨过的角度摆。
        if (featureOn("astrolabe")) astroRete.value?.setAttribute("transform", `rotate(${fixed(astro.to)})`);
        setLanded(p >= 0.999);
        drawDust(dt, 0, 1 - smooth(0, 0.5, p));
        return;
    }
    const shot = deskShot(stage, p);
    if (desk !== null) {
        writeStyle(desk, "transform", shot.transform);
        writeStyle(desk, "opacity", "");
        applyDeskPaint(shot);
    }
    if (diving.value !== p > 0.04) diving.value = p > 0.04;
    if (diving.value && focused.value !== null) focused.value = null;
    stepEffects(dt);
    for (const name of LAYER_IDS) {
        const element = layerEls[name];
        if (element === undefined) continue;
        const layer = shotOf(stage, name, p);
        writeStyle(element, "visibility", layer.visible ? "visible" : "hidden");
        if (!layer.visible) continue;
        writeStyle(element, "transform", layer.transform);
        writeStyle(element, "opacity", String(layer.opacity));
    }
    applyHero(p);
    const beam = lightShot(stage, p);
    if (light.value !== null) {
        writeStyle(light.value, "transform", beam.transform);
        writeStyle(light.value, "opacity", String(beam.opacity));
    }
    if (vignette.value !== null) writeStyle(vignette.value, "opacity", String(1 - 0.45 * smooth(0.5, 1, p)));
    setLanded(shot.landed);
    drawDust(dt, speed, 1 - smooth(0.55, 0.95, p));
}

/**
 * 桌子那几块的明暗写在它们本身上（第 11 轮）：原来写在桌子的外层上，变量继承下去，真工作台整棵树每帧都要重算样式，俯冲时最卡。
 * 这几个变量在样式里登记成不继承。
 */
function applyDeskPaint(shot: ReturnType<typeof deskShot>): void {
    if (deskShade.value !== null) writeStyle(deskShade.value, "--sx-shade", fixed(props.night ? shot.shade * 0.55 : shot.shade));
    if (deskSheen.value !== null) {
        writeStyle(deskSheen.value, "--sx-sheen", fixed(shot.sheen));
        writeStyle(deskSheen.value, "--sx-sheen-opacity", fixed(shot.sheenOpacity));
    }
    if (deskHalo.value !== null) writeStyle(deskHalo.value, "--sx-halo", fixed(shot.halo));
    // 夜里丝绸垫不画（`display: none`），照样写：切到白天时不用等下一次镜头变化。窄屏不走这里，用登记的初始值 1（落地的窄边）。
    if (deskSilk.value !== null) writeStyle(deskSilk.value, "--sx-silk", fixed(shot.silk));
}

function applyHero(p: number): void {
    const element = hero.value;
    if (element === null) return;
    const shot = heroShot(p);
    writeStyle(element, "opacity", String(shot.opacity));
    writeStyle(element, "transform", shot.transform);
    writeStyle(element, "visibility", shot.visible ? "visible" : "hidden");
}

function setLanded(next: boolean): void {
    if (next === landed) return;
    landed = next;
    isLanded.value = next;
    emit("landed", next);
}

/** 平滑的时间常数（ms）：滚轮一格一格跳时，镜头在这么长里追上去。 */
const SMOOTHING = 150;

/**
 * 上一帧到这一帧真实走了多久（ms，按放慢倍数折算）：从字到世界的钟按它走。镜头的平滑另外封顶 64ms（一帧跳太多会闪），
 * 钟不能跟着封顶：掉帧时（主线程忙、负载高）每帧都只记 64ms，叙事会整个慢下来；封顶 250ms 也不够，负载高时一帧常常更久。
 * 页面在后台时不出帧，回到前台由 `onVisible` 从当下重新计时，所以这里的 1 秒只防调试器断点、整页卡死这类一帧隔了很久的情况。
 */
let frameMs = 0;

/** 页面回到前台：从当下重新计时，免得第一帧把在后台的那段时间整个记进钟里、一下跳过几步。 */
function onVisible(): void {
    if (document.visibilityState === "visible") lastTime = performance.now();
}

function frame(): void {
    loop = 0;
    const now = performance.now();
    frameMs = Math.min(1000, now - lastTime) / timeScale();
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

/**
 * 金丝（第 9 轮，@designer）：划得快（每秒 450px 以上）时指针身后一道 1.5px 的淡金丝，长 45 到 100px，
 * 沿 `trail` 记下的最近一段画；再落几粒微屑，350ms 散掉，同时最多 12 粒。慢移与停在按钮、链接上时不出。
 */
interface Speck {
    x: number;
    y: number;
    vx: number;
    vy: number;
    born: number;
}
const THREAD_SPEED = 450;
const SPECK_LIFE = 350;
const SPECK_MAX = 12;
let specks: Speck[] = [];
let speckAt = 0;
/** 金丝画过几帧（累计），写在根上给探针读：快划时它往上涨，慢移与停在按钮上时不动。 */
let threadDrawn = 0;
let threadShown = -1;
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
    if (motes.length === 0) motes = Array.from({length: wide.value ? 160 : 60}, () => spawn(stage, true));
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
        const alpha = Math.min(1, (0.08 + 0.5 * inBeam) * twinkle * (0.45 + 0.55 * mote.z) * tint);
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
    drawComets(context);
    if (effectOn("thread") && rendered < 0.2) drawThread(context, dt);
}

/** 金丝与微屑（见上面 `Speck` 那段）。夜里叠亮成光，白天底是亮的，换成古铜色正常叠上。 */
function drawThread(context: CanvasRenderingContext2D, dt: number): void {
    const now = performance.now();
    const speed = Math.hypot(stir.vx, stir.vy);
    // 停下以后速度在一两百毫秒里衰减到门槛以下（`stepEffects`），金丝自己就断了；这里再挡一下太久没动的（掉帧时一帧就隔一两百毫秒）。
    const fast = stir.inside && !stir.overControl && speed > THREAD_SPEED && now - stir.at < 250;
    const color = props.night ? "255, 222, 160" : "150, 104, 40";
    if (fast && trail.length > 1) {
        // 从指针往回取 100px 以内的一段，越往后越淡。
        const strength = Math.min(1, (speed - THREAD_SPEED) / 600);
        let length = 0;
        context.lineCap = "round";
        context.lineWidth = 1.5;
        for (let index = trail.length - 1; index > 0 && length < 100; index -= 1) {
            const head = trail[index]!;
            const prev = trail[index - 1]!;
            const step = Math.hypot(head.x - prev.x, head.y - prev.y);
            const along = 1 - length / 100;
            length += step;
            context.strokeStyle = `rgba(${color}, ${(0.75 * strength * along).toFixed(3)})`;
            context.beginPath();
            context.moveTo(head.x, head.y);
            context.lineTo(prev.x, prev.y);
            context.stroke();
        }
        if (now - speckAt > 45 && specks.length < SPECK_MAX) {
            speckAt = now;
            const side = Math.random() < 0.5 ? -1 : 1;
            specks.push({x: stir.x, y: stir.y, vx: (-stir.vy / speed) * side * 30 - stir.vx * 0.04, vy: (stir.vx / speed) * side * 30 - stir.vy * 0.04 + 12, born: now});
        }
        threadDrawn += 1;
    }
    specks = specks.filter((speck) => now - speck.born < SPECK_LIFE);
    for (const speck of specks) {
        speck.x += speck.vx * dt;
        speck.y += speck.vy * dt;
        const age = (now - speck.born) / SPECK_LIFE;
        context.fillStyle = `rgba(${color}, ${(0.85 * (1 - age)).toFixed(3)})`;
        context.beginPath();
        context.arc(speck.x, speck.y, 1.4 * (1 - 0.5 * age), 0, Math.PI * 2);
        context.fill();
    }
    const element = root.value;
    if (element !== null && threadDrawn !== threadShown) {
        element.dataset.sxThread = String(threadDrawn);
        threadShown = threadDrawn;
    }
}

const cometEase = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function cometAt(comet: Comet, t: number): Point {
    const u = 1 - t;
    return {x: u * u * comet.from.x + 2 * u * t * comet.control.x + t * t * comet.to.x, y: u * u * comet.from.y + 2 * u * t * comet.control.y + t * t * comet.to.y};
}

function glow(context: CanvasRenderingContext2D, at: Point, radius: number, color: string, alpha: number): void {
    const gradient = context.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
    gradient.addColorStop(0, `rgba(${color}, ${alpha.toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(at.x, at.y, radius, 0, Math.PI * 2);
    context.fill();
}

/** 金尘：飞的时候一粒亮核拖一小段渐淡的尾，落下时漾开一圈。夜里叠亮；白天底是亮的，换成深一些的金、正常叠上。 */
function drawComets(context: CanvasRenderingContext2D): void {
    if (comets.length === 0) return;
    const color = props.night ? "255, 224, 164" : "168, 112, 36";
    context.globalCompositeOperation = props.night ? "lighter" : "source-over";
    for (const comet of comets) {
        const age = relayTime - comet.start;
        if (age < comet.span) {
            const t = age / comet.span;
            for (let index = 9; index >= 1; index -= 1) {
                const point = cometAt(comet, cometEase(Math.max(0, t - index * 0.018)));
                const fade = 1 - index / 10;
                context.fillStyle = `rgba(${color}, ${(0.75 * fade * fade).toFixed(3)})`;
                context.beginPath();
                context.arc(point.x, point.y, 0.5 + 1.4 * fade, 0, Math.PI * 2);
                context.fill();
            }
            const head = cometAt(comet, cometEase(t));
            glow(context, head, 15, color, 0.5);
            context.fillStyle = props.night ? "rgba(255, 246, 222, 0.95)" : "rgba(122, 78, 20, 0.9)";
            context.beginPath();
            context.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
            context.fill();
            continue;
        }
        const burst = Math.min(1, (age - comet.span) / BURST_MS);
        glow(context, comet.to, 28, color, 0.5 * (1 - burst));
        context.strokeStyle = `rgba(${color}, ${(0.6 * (1 - burst)).toFixed(3)})`;
        context.lineWidth = 1.1;
        context.beginPath();
        context.arc(comet.to.x, comet.to.y, 4 + 24 * burst, 0, Math.PI * 2);
        context.stroke();
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
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("keydown", onKeyDown);
    if (pointerEffects.value) {
        window.addEventListener("pointermove", onPointerMove, {passive: true});
        document.addEventListener("pointerout", onPointerLeave);
    }
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerout", onPointerLeave);
    resize?.disconnect();
    if (loop !== 0) cancelAnimationFrame(loop);
    if (litTimer !== 0) cancelAnimationFrame(litTimer);
});
</script>

<template>
    <div ref="root" class="sx" :class="{'is-lit': lit, 'is-instant': instant, 'is-desk-ready': deskReady, 'is-diving': diving, 'sx--narrow': !wide, 'sx--day': !night, 'sx--peek': effectOn('peek'), 'sx--still': still, 'sx--focusing': focused !== null}" :data-sx-relay="relayState" :data-sx-focus="focused ?? 'none'">
        <div class="sx-back" aria-hidden="true"></div>

        <!--
            顶光：一锥暖光从穹顶落下，几道细光在里面慢慢明暗。外层的 transform 归镜头（每帧写内联样式），
            白天的窗光方向写在里面一层（第 7 轮写在外层，被镜头的内联样式盖掉了，白天一直是竖直的顶光）。
        -->
        <div ref="light" class="sx-light" aria-hidden="true">
            <div class="sx-light__aim">
                <div class="sx-enter sx-light__enter">
                    <div class="sx-light__cone"></div>
                    <div class="sx-light__ray" style="--ray: -17deg; --ray-delay: 0s"></div>
                    <div class="sx-light__ray" style="--ray: -7deg; --ray-delay: -2.4s"></div>
                    <div class="sx-light__ray" style="--ray: 4deg; --ray-delay: -4.1s"></div>
                    <div class="sx-light__ray" style="--ray: 13deg; --ray-delay: -1.3s"></div>
                </div>
            </div>
        </div>

        <!-- 桌子：真工作台放在一块暗红桌布上，背后一圈暖光。外层的变换由镜头写。 -->
        <div ref="carrier" class="sx-carrier" :class="{'is-landed': isLanded}" :style="carrierBox" data-sx-carrier>
            <div class="sx-enter sx-carrier__enter">
                <div ref="deskHalo" class="sx-halo" aria-hidden="true"></div>
                <!--
                    桌布：比桌子大一圈、往外淡进暗里；落地后围着工作台的那一圈都是它。顶光在桌面上落一滩光。
                    白天桌布是胡桃木案面，工作台下面另垫一块丝绸（只在白天画，往里收的进度由镜头写，见 `applyDeskPaint`）。
                -->
                <div class="sx-cloth" :style="{'--sx-velvet': `url(${VELVET})`, '--sx-walnut': `url(${WALNUT})`}" aria-hidden="true"></div>
                <div class="sx-pool" aria-hidden="true"></div>
                <div ref="deskSilk" class="sx-silk" aria-hidden="true"></div>
                <div class="sx-desk">
                    <slot name="desk" />
                </div>
                <div ref="deskShade" class="sx-shade" aria-hidden="true"></div>
                <div ref="deskSheen" class="sx-sheen" aria-hidden="true"></div>
                <div class="sx-dark" aria-hidden="true"></div>
            </div>
        </div>

        <!--
            黄铜星盘（第 9 轮，`astrolabe`）：最远的一层，右上角一半出画、虚焦压暗。第 10 轮起外圈常转，网环跟着从字到世界一步拨一格，
            照准规转向靠近的指针，点一下拨到下一步（角度都由脚本每帧写，见 `stepAstrolabe`）。
        -->
        <div v-if="featureOn('astrolabe')" :ref="setLayer('astrolabe')" class="sx-layer" :style="layerSize('astrolabe')" aria-hidden="true">
            <div class="sx-enter sx-enter--rise" style="--enter-delay: 60ms">
                <div :ref="setPar('astrolabe')" class="sx-par sx-par--astrolabe">
                    <svg class="sx-astrolabe" viewBox="-200 -200 400 400" width="400" height="400">
                        <circle r="178" :fill="url('plate')" />
                        <g class="sx-astrolabe__engraving">
                            <circle r="140" />
                            <circle r="98" />
                            <circle r="60" />
                            <g :clip-path="url('plate-clip')">
                                <circle cy="52" r="44" />
                                <circle cy="52" r="82" />
                                <circle cy="52" r="120" />
                                <circle cy="52" r="158" />
                            </g>
                        </g>
                        <g ref="astroRing">
                            <circle r="186" fill="none" :stroke="url('brass')" stroke-width="16" />
                            <circle r="195" fill="none" stroke="#f0d28c" stroke-opacity="0.5" stroke-width="1" />
                            <path class="sx-astrolabe__ticks" :d="ASTROLABE_TICKS" />
                        </g>
                        <g ref="astroGlint" class="sx-astrolabe__glint">
                            <circle r="186" fill="none" :stroke="url('astro-glint')" stroke-width="16" />
                        </g>
                        <g ref="astroRete" class="sx-astrolabe__rete">
                            <circle cy="-34" r="112" fill="none" :stroke="url('brass')" stroke-width="5" />
                            <circle r="40" fill="none" :stroke="url('brass')" stroke-width="3" />
                            <path v-for="star in ASTROLABE_STARS" :key="star.key" :d="star.d" :fill="url('brass')" />
                        </g>
                        <g ref="astroAlidade" transform="rotate(28)">
                            <rect x="-5" y="-182" width="10" height="364" rx="4" :fill="url('brass')" />
                        </g>
                        <circle r="11" :fill="url('brass')" />
                        <circle r="4" fill="#3a250f" />
                    </svg>
                    <div class="sx-astro-hit" @click="onAstrolabeClick"></div>
                </div>
            </div>
        </div>

        <!-- 线索丝（第 9 轮，`threads`）：每张纸牵一根落到工作台上，压在纸底下；路径与亮暗每帧算（`applyThreads`）。 -->
        <svg v-if="featureOn('threads')" ref="threadLayer" class="sx-threads" aria-hidden="true">
            <g v-for="name in PAPER_IDS" :key="name" class="sx-thread" :class="{'is-lit': litThread === name}">
                <path :ref="setThread(name, 'line')" class="sx-thread__line" />
                <path :ref="setThread(name, 'run')" class="sx-thread__run" pathLength="1" />
                <path :ref="setThread(name, 'bead')" class="sx-thread__bead" pathLength="1" />
                <circle :ref="setThread(name, 'land')" class="sx-thread__land" r="4" />
            </g>
        </svg>

        <!--
            三张羊皮页：手稿、人物卡、地图。远的那张更暗、更虚。每层外面归镜头（每帧写），`sx-enter` 归开场，`sx-par` 归指针视差，
            `sx-peek` 是悬停细看的热区，`sx-bob` 是漂浮，`sx-lean` 是凑近时的前倾。各管各的 transform，互不覆盖。
        -->
        <div :ref="setLayer('manuscript')" class="sx-layer" :class="{'is-focused': focused === 'manuscript'}" :style="layerSize('manuscript')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 500ms">
                <div :ref="setPar('manuscript')" class="sx-par">
                    <div class="sx-peek" data-sx-paper="manuscript" @click="toggleFocus('manuscript')" @pointermove="onPaperMove" @pointerleave="onPaperLeave">
                        <div class="sx-bob" style="--bob: 7.5s; --bob-y: -7px">
                            <div class="sx-lean">
                                <svg class="sx-sheet sx-sheet--far" viewBox="0 0 250 330" width="250" height="330">
                                    <clipPath :id="id('clip-manuscript')"><path :d="PAPER.manuscript" /></clipPath>
                                    <image :href="PARCHMENT" x="0" y="0" width="250" height="330" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-manuscript')" />
                                    <path :d="PAPER.manuscript" :fill="url('foxing')" />
                                    <text x="24" y="40" class="sx-ink sx-ink--title">第一章 霜港的钟</text>
                                    <line x1="24" y1="52" x2="128" y2="52" stroke="#8a6a3c" stroke-width="0.8" />
                                    <template v-for="(line, index) in MANUSCRIPT_LINES" :key="index">
                                        <text v-if="index !== KNOCK_LINE" x="24" :y="80 + index * 20" class="sx-ink">{{ line }}</text>
                                    </template>
                                    <!-- 从字到世界的第一步与第三步：敲门那一行落墨写出来；再涂一道高亮，红笔圈出“三下”、牵一条线写批注（和第一幕“高亮批注”同一件事）。 -->
                                    <g class="sx-relay" :class="{'is-sinking': relay.sinking}">
                                        <!-- 停驻唤醒：敲门那一行底下一团暖金，伏笔的红圈外一圈金红的光。 -->
                                        <rect x="22" :y="66 + KNOCK_LINE * 20" width="204" height="19" rx="2" class="sx-mark" :class="{'is-on': relay.noted}" />
                                        <text x="24" :y="80 + KNOCK_LINE * 20" class="sx-ink sx-write" :class="{'is-on': relay.written}" data-sx-anchor="knock">{{ MANUSCRIPT_LINES[KNOCK_LINE] }}</text>
                                        <rect x="16" :y="67 + KNOCK_LINE * 20" width="12" height="17" class="sx-quill" :class="{'is-on': relay.written}" :fill="url('ink-edge')" />
                                        <g class="sx-note" :class="{'is-on': relay.noted}">
                                            <ellipse :cx="KNOCK_RING_X" :cy="76 + KNOCK_LINE * 20" rx="17" ry="10.5" fill="none" stroke="#9b2232" stroke-width="1.3" pathLength="1" class="sx-note__ring" :transform="`rotate(-4 ${KNOCK_RING_X} ${76 + KNOCK_LINE * 20})`" />
                                            <path :d="`M${KNOCK_RING_X + 3},${88 + KNOCK_LINE * 20} q10,26 34,38`" fill="none" stroke="#9b2232" stroke-width="1" pathLength="1" class="sx-note__thread" />
                                            <text :x="KNOCK_RING_X + 22" :y="134 + KNOCK_LINE * 20" class="sx-ink sx-ink--red sx-note__text" data-sx-anchor="note">伏笔：第五章再响</text>
                                        </g>
                                    </g>
                                    <path :d="PAPER.manuscript" :fill="url('toplight')" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div :ref="setLayer('character')" class="sx-layer" :class="{'is-focused': focused === 'character'}" :style="layerSize('character')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 620ms">
                <div :ref="setPar('character')" class="sx-par">
                    <div class="sx-peek" data-sx-paper="character" @click="toggleFocus('character')" @pointermove="onPaperMove" @pointerleave="onPaperLeave">
                        <div class="sx-bob" style="--bob: 8.6s; --bob-y: 6px">
                            <div class="sx-lean sx-stack">
                                <!-- 压在人物卡下面的是星璃的便笺：从字到世界的第四步，金尘飞到人物卡上，便笺斜着抽出来一截，露出她那几行字。 -->
                                <svg class="sx-sheet sx-sheet--mid sx-card sx-card--b sx-card--note" :class="{'is-out': relay.lyra}" viewBox="0 0 230 300" width="230" height="300">
                                    <clipPath :id="id('clip-note')"><path :d="PAPER.note" /></clipPath>
                                    <clipPath :id="id('clip-avatar')"><circle cx="115" cy="104" r="44" /></clipPath>
                                    <clipPath :id="id('clip-badge')"><circle cx="196" cy="272" r="14" /></clipPath>
                                    <image :href="PARCHMENT" x="0" y="0" width="230" height="300" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-note')" />
                                    <path :d="PAPER.note" :fill="url('foxing')" />
                                    <text x="24" y="42" class="sx-ink sx-ink--name">星璃</text>
                                    <circle cx="115" cy="104" r="48" fill="none" :stroke="url('gold')" stroke-width="2.2" />
                                    <image :href="LYRA_AVATAR" x="71" y="60" width="88" height="88" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-avatar')" />
                                    <text x="24" y="200" class="sx-ink">第一章的敲门声，</text>
                                    <text x="24" y="222" class="sx-ink">第五章又响了一次。</text>
                                    <text x="24" y="252" class="sx-ink sx-ink--red">读者会和她一起等第四下。</text>
                                    <!-- 抽出来时露出的是下半截：那里再放一枚小头像，看得出是谁写的。 -->
                                    <circle cx="196" cy="272" r="16" fill="none" :stroke="url('gold')" stroke-width="1.4" />
                                    <image :href="LYRA_AVATAR" x="182" y="258" width="28" height="28" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-badge')" />
                                    <path :d="PAPER.note" :fill="url('toplight')" />
                                </svg>
                                <svg class="sx-sheet sx-sheet--mid sx-card sx-card--a" viewBox="0 0 230 300" width="230" height="300">
                                    <clipPath :id="id('clip-character')"><path :d="PAPER.character" /></clipPath>
                                    <image :href="PARCHMENT" x="0" y="0" width="230" height="300" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-character')" />
                                    <path :d="PAPER.character" :fill="url('foxing')" />
                                    <text x="24" y="44" class="sx-ink sx-ink--name">艾莉丝</text>
                                    <rect x="176" y="22" width="30" height="30" rx="3" fill="none" stroke="#9b2232" stroke-width="1.4" />
                                    <text x="191" y="43" text-anchor="middle" class="sx-ink sx-ink--seal">人</text>
                                    <!-- 停驻唤醒：画像的金框与“人”字印各亮一圈。 -->
                                    <ellipse cx="115" cy="122" rx="48" ry="58" fill="none" :stroke="url('gold')" stroke-width="2.2" data-sx-anchor="card" />
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
                </div>
            </div>
        </div>

        <div :ref="setLayer('map')" class="sx-layer" :class="{'is-focused': focused === 'map'}" :style="layerSize('map')" aria-hidden="true">
            <div class="sx-enter" style="--enter-delay: 740ms">
                <div :ref="setPar('map')" class="sx-par">
                    <div class="sx-peek" data-sx-paper="map" @click="toggleFocus('map')" @pointermove="onPaperMove" @pointerleave="onPaperLeave">
                        <div class="sx-bob" style="--bob: 9.4s; --bob-y: -5px">
                            <div class="sx-lean sx-stack" :data-face="relay.plot ? 1 : 0" :data-moved="plotMoved ? '' : undefined">
                                <!-- 压在地图下面的是剧情的时间线：从字到世界的第五步，航线流进时间线，它换到上面，红线把第一章与第五章那两声敲门连起来。 -->
                                <svg class="sx-sheet sx-sheet--near sx-card sx-card--b" viewBox="0 0 330 236" width="330" height="236">
                                    <clipPath :id="id('clip-plot')"><path :d="PAPER.plot" /></clipPath>
                                    <image :href="PARCHMENT" x="0" y="0" width="330" height="236" preserveAspectRatio="xMidYMid slice" :clip-path="url('clip-plot')" />
                                    <path :d="PAPER.plot" :fill="url('foxing')" />
                                    <text x="24" y="40" class="sx-ink sx-ink--title">剧情</text>
                                    <line x1="24" y1="52" x2="96" y2="52" stroke="#8a6a3c" stroke-width="0.8" />
                                    <path d="M24,150 H306" stroke="#4a3626" stroke-width="1.3" />
                                    <g class="sx-relay sx-plot-ink" :class="{'is-on': relay.plot || still, 'is-sinking': relay.sinking}">
                                        <path :d="`M${TIMELINE[0].x},140 C${TIMELINE[0].x + 30},84 ${TIMELINE[2].x - 30},84 ${TIMELINE[2].x},140`" fill="none" stroke="#9b2232" stroke-width="1.2" stroke-dasharray="3 4" class="sx-plot-arc" />
                                        <text :x="(TIMELINE[0].x + TIMELINE[2].x) / 2" y="92" text-anchor="middle" class="sx-ink sx-ink--red sx-plot-label">同一种敲法</text>
                                    </g>
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
                                    <!-- 从字到世界的第二步：金尘落到这里，海岸线描出来、陆地染上、灰塔升起、红色航线从霜港流向灰塔。 -->
                                    <circle cx="168" cy="136" r="2" fill="none" data-sx-anchor="map" />
                                    <g class="sx-relay sx-map-ink" :class="{'is-on': relay.mapped, 'is-sinking': relay.sinking}">
                                        <path d="M10,150 C40,138 58,162 88,150 S138,116 168,130 S214,172 246,150 S292,112 320,124 L320,226 L10,226 Z" fill="#dcc8a2" fill-opacity="0.7" class="sx-land" />
                                        <path d="M10,150 C40,138 58,162 88,150 S138,116 168,130 S214,172 246,150 S292,112 320,124" fill="none" stroke="#4a3626" stroke-width="1.4" pathLength="1" class="sx-coast" />
                                        <path d="M10,141 C40,129 58,153 88,141 S138,107 168,121 S214,163 246,141 S292,103 320,115" fill="none" stroke="#4a3626" stroke-width="0.6" stroke-opacity="0.5" stroke-dasharray="1 4" class="sx-contour" />
                                        <path d="M94,162 C140,104 200,96 246,140" fill="none" stroke="#9b2232" stroke-width="1.1" stroke-dasharray="3 4" class="sx-route" />
                                        <g class="sx-port">
                                            <circle cx="92" cy="163" r="3" fill="#4a3626" data-sx-anchor="route-start" />
                                            <text x="70" y="186" class="sx-ink">霜港</text>
                                        </g>
                                        <g class="sx-tower">
                                            <g transform="translate(250 112)" stroke="#4a3626" stroke-width="1.1" fill="#cbb38a" data-sx-anchor="route-end">
                                                <path d="M-6,30 L-4,0 L4,0 L6,30 Z" />
                                                <path d="M-6,0 L0,-9 L6,0 Z" />
                                            </g>
                                            <text x="262" y="138" class="sx-ink">灰塔</text>
                                        </g>
                                    </g>
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
                </div>
            </div>
        </div>

        <!-- 前景：赤红精装书的书角（鎏金包角）与一条丝带书签，离镜头最近，虚着。书角上叠一团跟着指针走的鎏金反光。 -->
        <div :ref="setLayer('book')" class="sx-layer" :style="layerSize('book')" aria-hidden="true">
            <div class="sx-enter sx-enter--rise" style="--enter-delay: 120ms">
                <div :ref="setPar('book')" class="sx-par sx-par--book">
                    <img class="sx-book" :src="LEATHER_CORNER" width="560" height="560" alt="" />
                    <div v-if="effectOn('glint')" ref="bookGlint" class="sx-glint" :style="{'--sx-book': `url(${LEATHER_CORNER})`}"></div>
                </div>
            </div>
        </div>

        <div :ref="setLayer('ribbon')" class="sx-layer" :style="layerSize('ribbon')" aria-hidden="true">
            <div class="sx-enter sx-enter--drop" style="--enter-delay: 200ms">
                <div :ref="setPar('ribbon')" class="sx-par">
                    <div class="sx-sway">
                        <div ref="ribbonTail" class="sx-tail">
                            <svg class="sx-ribbon" viewBox="0 0 64 620" width="64" height="620">
                                <path d="M14,0 H50 V570 L32,544 L14,570 Z" :fill="url('silk')" />
                                <path d="M16.5,0 V566" :stroke="url('gold')" stroke-width="1.4" />
                                <path d="M47.5,0 V566" :stroke="url('gold')" stroke-width="1.4" />
                                <path d="M14,0 H50 V570 L32,544 L14,570 Z" :fill="url('silk-sheen')" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 提灯（第 9 轮）：一团追着指针的暖光，压在纸与书角上、浮尘与标题下面；脚本写光斑的位置（`applyLantern`）。 -->
        <div v-if="effectOn('lantern')" ref="lantern" class="sx-lantern" aria-hidden="true">
            <div ref="lanternGlow" class="sx-lantern__glow"></div>
        </div>
        <canvas ref="dust" class="sx-dust" aria-hidden="true"></canvas>
        <div ref="vignette" class="sx-vignette" aria-hidden="true"></div>

        <div ref="hero" class="sx-hero">
            <slot name="hero" :lit="lit" :glint="effectOn('glint')" />
        </div>

        <!-- 各层共用的渐变与滤镜：鎏金、皮面、丝绸、纸纹。 -->
        <svg class="sx-defs" width="0" height="0" aria-hidden="true">
            <defs>
                <!-- 星盘的黄铜（第 9 轮）：比鎏金暗、偏铜，盘面是更暗的青铜。 -->
                <linearGradient :id="id('brass')" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#f3d89a" />
                    <stop offset="0.3" stop-color="#b98a45" />
                    <stop offset="0.55" stop-color="#e6c27e" />
                    <stop offset="0.8" stop-color="#7a5222" />
                    <stop offset="1" stop-color="#c79a55" />
                </linearGradient>
                <radialGradient :id="id('plate')" cx="0.42" cy="0.38" r="0.7">
                    <stop offset="0" stop-color="#6a4a26" />
                    <stop offset="0.7" stop-color="#3b2713" />
                    <stop offset="1" stop-color="#24170b" />
                </radialGradient>
                <clipPath :id="id('plate-clip')">
                    <circle r="176" />
                </clipPath>
                <!-- 星盘铜环上扫过的一道光（第 10 轮）：一窄条亮金，两头透明；脚本转它所在的那一组，光就绕着环走。 -->
                <linearGradient :id="id('astro-glint')" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0.38" class="sx-astrolabe__glint-stop" stop-opacity="0" />
                    <stop offset="0.5" class="sx-astrolabe__glint-stop" stop-opacity="1" />
                    <stop offset="0.62" class="sx-astrolabe__glint-stop" stop-opacity="0" />
                </linearGradient>
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
                <!-- 落墨时笔尖前那一团湿墨：两头淡、靠前浓。 -->
                <linearGradient :id="id('ink-edge')" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#1c0f06" stop-opacity="0" />
                    <stop offset="0.7" stop-color="#1c0f06" stop-opacity="0.5" />
                    <stop offset="1" stop-color="#1c0f06" stop-opacity="0" />
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
 * 帧循环每帧写的几个变量登记成不继承（第 11 轮，开发者：首屏滚动变卡）：继承的自定义属性一改，它下面整棵子树都要重算样式，
 * 写在一层或桌子的外层上时，每帧要重算几百上千个元素（真工作台整棵都在桌子下面）。登记成不继承，写在真正用它的那个元素上
 * （纸、书角、星盘、桌子的光晕与压暗那几块，见脚本里的 `litTargets`、`applyDeskPaint`）。初始值与原来 `var()` 的缺省值一致。
 */
@property --sx-lit {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-lx {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-ly {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-focus {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-near {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-glow {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-shade {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-sheen {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-sheen-opacity {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --sx-halo {
    syntax: "<number>";
    inherits: false;
    initial-value: 0.55;
}

/* 丝绸垫往里收的进度：初始值是落地的窄边，窄屏不俯冲、不写它，就停在这里。 */
@property --sx-silk {
    syntax: "<number>";
    inherits: false;
    initial-value: 1;
}

/* 纸上由受光与细看算出来的两段滤镜：它们跟着上面几个变量每帧变，不登记的话照样继承下去，纸里每个元素都要重算。 */
@property --sx-rim {
    syntax: "*";
    inherits: false;
}

@property --sx-shadow {
    syntax: "*";
    inherits: false;
}

@property --lift-x {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

@property --lift-y {
    syntax: "<number>";
    inherits: false;
    initial-value: 0;
}

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

/* 光的方向：夜里从穹顶正中直落；白天整锥从左上的高窗斜进来（见文件末尾的昼）。 */
.sx-light__aim {
    position: absolute;
    inset: 0;
    transform-origin: 50% 0;
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
    animation: sx-breathe 11s ease-in-out infinite alternate;
}

/* 顶光呼吸：极慢的明暗，底噪（@designer 第 7 轮：8 到 12 秒）。 */
@keyframes sx-breathe {
    from {
        opacity: 0.8;
    }
    to {
        opacity: 1;
    }
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
    animation: sx-ray 10s ease-in-out var(--ray-delay) infinite;
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
    transition: filter 600ms ease;
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

/* 工作台下的丝绸垫只在白天画（样式在“昼”一节）。 */
.sx-silk {
    display: none;
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

/*
 * 纸的滤镜是一条链：先是迎着提灯那一侧的一道亮边（往灯的方向错开 2.5px 的一层暖光），再是影子（往灯的反方向挪，最多 10px；
 * 细看时加深、拉远），最后是明暗（离光轴远的压暗，被灯照着、被细看时提亮）。几个数都来自层上的变量，脚本每帧写
 * （`--sx-lit`、`--sx-lx`、`--sx-ly`、`--sx-focus`，见 `applyLantern`、`applyFocusVars`），没写时按 0 算，就是第 8 轮的样子。
 */
.sx-sheet {
    --sx-rim: drop-shadow(calc(var(--sx-lx, 0) * 2.5px) calc(var(--sx-ly, 0) * 2.5px) 0.5px rgb(255 226 176 / calc(var(--sx-lit, 0) * 0.85)));
    --sx-shadow: drop-shadow(calc(var(--sx-lx, 0) * -10px) calc(22px + var(--sx-focus, 0) * 14px - var(--sx-ly, 0) * 10px) calc(26px + var(--sx-focus, 0) * 14px) rgb(0 0 0 / calc(0.55 + var(--sx-focus, 0) * 0.07)));
    display: block;
    overflow: visible;
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(1 + var(--sx-lit, 0) * 0.15));
}

/* 离光轴越远越暗：两侧的纸压到七八成亮，远的那张再虚一点；细看的那张回到全亮。 */
.sx-sheet--far {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(0.72 + var(--sx-focus, 0) * 0.28 + var(--sx-lit, 0) * 0.22)) blur(0.7px);
}

.sx-sheet--mid {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(0.78 + var(--sx-focus, 0) * 0.22 + var(--sx-lit, 0) * 0.22));
}

/* 地图离镜头近，落在焦外：略虚、略暗，不和远处的桌子抢。 */
.sx-sheet--near {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(0.8 + var(--sx-focus, 0) * 0.2 + var(--sx-lit, 0) * 0.22)) blur(0.9px);
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

/* 书角是生成的照片（皮面、鎏金包角、刷金的书口），黑底已经抠成透明；离镜头最近，略虚。被提灯照着时同纸一样亮边、影子反挪、提亮。 */
.sx-book {
    display: block;
    filter:
        blur(1.4px)
        drop-shadow(calc(var(--sx-lx, 0) * 3px) calc(var(--sx-ly, 0) * 3px) 0.6px rgb(255 214 150 / calc(var(--sx-lit, 0) * 0.7)))
        drop-shadow(calc(var(--sx-lx, 0) * -10px) calc(30px - var(--sx-ly, 0) * 10px) 40px rgb(0 0 0 / 0.6))
        brightness(calc(1 + var(--sx-lit, 0) * 0.22));
}

.sx-sway {
    transform-origin: 50% 0;
    animation: sx-sway 8.5s ease-in-out infinite alternate;
}

/* 丝带尾巴：转轴在上端，脚本按指针写转角（见 `applyGaze`），末端比书角慢半拍摆过去。 */
.sx-tail {
    transform-origin: 50% 0;
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

/*
 * 提灯（第 9 轮）：外层铺满舞台，按“滤色”叠在下面的纸、书角与桌子上（夜里只提亮、不发灰）；标题那一块用遮罩压到四成，
 * 灯照到字上会把字洗白（@designer 第 9 轮）。混合与遮罩都放在外层：放在里层的话，里层只和透明的外层混，滤色就没了。
 * 里层是光斑本身，脚本只写它的变换（`applyLantern`），挪动不重画。
 */
.sx-lantern {
    position: absolute;
    inset: 0;
    overflow: hidden;
    opacity: 0;
    mix-blend-mode: screen;
    mask-image: radial-gradient(30% 16% at 50% 12%, rgb(0 0 0 / 0.4) 40%, #000 100%);
    pointer-events: none;
}

.sx-lantern__glow {
    position: absolute;
    top: 0;
    left: 0;
    width: 420px;
    height: 420px;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgb(255 222 168 / 0.42), rgb(244 198 126 / 0.18) 45%, transparent);
    will-change: transform;
}

/*
 * 星盘（第 9 轮）：虚焦、压暗，像在画外的书架上；被提灯照着时同纸一样提亮（`--sx-lit`）。盘面的刻线是一层很淡的金。
 * 第 10 轮：指针靠近时对焦、再亮三成多（`--sx-near`，0 到 1，脚本每帧写）；转动都由脚本写角度，这里没有动画。
 */
.sx-astrolabe {
    display: block;
    overflow: visible;
    filter: blur(calc(2px - var(--sx-near, 0) * 2px)) drop-shadow(0 18px 30px rgb(0 0 0 / 0.5)) brightness(calc((0.46 + var(--sx-lit, 0) * 0.4) * (1 + var(--sx-near, 0) * 0.35)));
}

.sx-par--astrolabe {
    position: relative;
}

/* 点得到的是铜环以内的盘面；镜头推起来以后不接（星盘正往外飞）。 */
.sx-astro-hit {
    position: absolute;
    inset: 10px;
    border-radius: 50%;
    cursor: pointer;
}

.sx:not(.is-diving) .sx-astro-hit {
    pointer-events: auto;
}

.sx-astrolabe__glint-stop {
    stop-color: #f5d68e;
}

.sx-astrolabe__engraving {
    fill: none;
    stroke: #d8b06a;
    stroke-opacity: 0.32;
    stroke-width: 1;
}

.sx-astrolabe__ticks {
    fill: none;
    stroke: #3a250f;
    stroke-opacity: 0.75;
    stroke-width: 1.2;
}

/*
 * 线索丝（第 9 轮）：平时两成，像光里偶尔反一下的一根丝；亮起来时加粗一点、带一圈光，一小段亮光从纸往桌上走。
 * 第 10 轮：透明度、粗细与光晕（`--sx-glow`）由脚本每帧写（脉冲、悬停、压暗别的几根），这里不给过渡；脉冲时一粒光珠走到工作台，落点漾一圈。
 */
.sx-threads {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
}

.sx-thread__line {
    fill: none;
    stroke: rgb(242 207 126);
    stroke-opacity: 0.2;
    stroke-width: 1;
    filter: drop-shadow(0 0 3px rgb(240 201 135 / calc(var(--sx-glow, 0) * 0.75)));
}

.sx-thread__bead {
    fill: none;
    stroke: rgb(255 242 210);
    stroke-dasharray: 0.06 1.2;
    stroke-dashoffset: 0.06;
    stroke-linecap: round;
    stroke-width: 2.6;
    opacity: 0;
    filter: drop-shadow(0 0 4px rgb(255 218 150 / 0.95));
}

.sx-thread__land {
    fill: rgb(255 228 172);
    opacity: 0;
    filter: blur(3px);
}

.sx-thread__run {
    fill: none;
    stroke: rgb(255 238 200);
    stroke-dasharray: 0.08 1;
    stroke-dashoffset: 0.08;
    stroke-linecap: round;
    stroke-width: 1.8;
    opacity: 0;
    transition: opacity 300ms ease;
}

.sx-thread.is-lit .sx-thread__run {
    opacity: 0.9;
    animation: sx-thread-run 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

@keyframes sx-thread-run {
    to {
        stroke-dashoffset: -1;
    }
}

/*
 * 白天的星盘压在导航（深墨的字）后面：提亮、半透明，盘面不能是一块深色，不然导航的字糊进去。
 * 第 10 轮墙的右上角沉成暖褐，星盘换成暖古金（@designer 第 10 轮），靠近时对焦、再透一些。
 */
.sx--day .sx-astrolabe {
    opacity: calc(0.62 + var(--sx-near, 0) * 0.3);
    filter: blur(calc(2px - var(--sx-near, 0) * 2px)) drop-shadow(0 14px 24px rgb(52 28 14 / 0.35)) brightness(calc((1.12 + var(--sx-lit, 0) * 0.1) * (1 + var(--sx-near, 0) * 0.12))) sepia(0.2);
}

.sx--day .sx-thread__line {
    stroke: rgb(158 107 36);
    filter: drop-shadow(0 0 3px rgb(255 244 220 / calc(var(--sx-glow, 0) * 0.9)));
}

.sx--day .sx-thread__run {
    stroke: rgb(120 82 30);
}

.sx--day .sx-thread__bead {
    stroke: rgb(255 246 222);
    filter: drop-shadow(0 0 3px rgb(158 107 36 / 0.9));
}

.sx--day .sx-thread__land {
    fill: rgb(255 240 205);
}

.sx--day .sx-astrolabe__glint-stop {
    stop-color: #c9923a;
}

@media (prefers-reduced-motion: reduce) {
    .sx-thread.is-lit .sx-thread__run {
        animation: none;
    }

    .sx-thread__run,
    .sx-thread__bead {
        display: none;
    }

    /* 少动效时星盘不转、不追指针，只在指针停在它上面时提亮（帧循环不跟指针）。 */
    .sx-layer:has(.sx-astro-hit:hover) .sx-astrolabe {
        filter: blur(1px) drop-shadow(0 18px 30px rgb(0 0 0 / 0.5)) brightness(0.62);
    }
}

/* 白天不是灯，是窗光里的一块亮斑：柔光叠上去，暖白。 */
.sx--day .sx-lantern {
    mix-blend-mode: soft-light;
}

.sx--day .sx-lantern__glow {
    background: radial-gradient(closest-side, rgb(255 248 228 / 0.7), rgb(255 238 204 / 0.3) 45%, transparent);
}

/* 首屏的字压在一切之上：细看的那张纸凑到最前（`z-index: 2`）时也不盖住标题与按钮。 */
.sx-hero {
    position: absolute;
    inset: 0;
    z-index: 3;
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

/*
 * ── 从字到世界（第 7 轮）：每样东西怎么显出来写在各自的 `is-on` 上；沉回纸里统一在 `.sx-relay.is-sinking`。
 * 显出来有过渡，收回去没有：收的时候它们已经沉没了（看不见），下一圈从没写的样子起。
 */

.sx-relay {
    transition: none;
}

.sx-relay.is-sinking {
    opacity: 0;
    transition: opacity 1700ms cubic-bezier(0.45, 0, 0.55, 1);
}

/* 墨沉回纸里：字与线先褪成纸色，再隐掉，不是生硬地淡出（@designer 第 7 轮）。 */
.sx-relay.is-sinking .sx-ink,
.sx-relay.is-sinking .sx-mark {
    fill: #b8996c;
    transition: fill 1100ms ease;
}

.sx-relay.is-sinking [stroke] {
    stroke: #b8996c;
    transition: stroke 1100ms ease;
}

/* 一：落墨。敲门那一行从左往右写出来，笔尖前一团湿墨；刚写的墨更黑，慢慢干成纸上的墨色。 */
.sx-write {
    clip-path: inset(-6px 100% -6px 0);
}

.sx-write.is-on {
    clip-path: inset(-6px -4px -6px 0);
    animation: sx-dry 2800ms ease-out backwards;
    transition: clip-path 1900ms cubic-bezier(0.35, 0.1, 0.55, 0.95);
}

@keyframes sx-dry {
    from {
        fill: #0f0703;
    }
    to {
        fill: #3b2a1d;
    }
}

.sx-quill {
    opacity: 0;
}

.sx-quill.is-on {
    animation: sx-quill 1900ms cubic-bezier(0.35, 0.1, 0.55, 0.95) both;
}

@keyframes sx-quill {
    0% {
        opacity: 0;
        transform: translateX(0);
    }
    8% {
        opacity: 0.85;
    }
    86% {
        opacity: 0.85;
    }
    100% {
        opacity: 0;
        transform: translateX(206px);
    }
}

/* 二：海岸线描出来，陆地染上，灰塔升起，红色航线从霜港流向灰塔（显出来以后一直慢慢流）。 */
.sx-coast {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
}

.sx-map-ink.is-on .sx-coast {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 1500ms cubic-bezier(0.45, 0, 0.3, 1);
}

.sx-land,
.sx-contour,
.sx-port,
.sx-tower {
    opacity: 0;
}

.sx-tower {
    transform: translate3d(0, 10px, 0);
}

.sx-map-ink.is-on .sx-land {
    opacity: 1;
    transition: opacity 1200ms ease 450ms;
}

.sx-map-ink.is-on .sx-contour {
    opacity: 1;
    transition: opacity 900ms ease 1100ms;
}

.sx-map-ink.is-on .sx-port {
    opacity: 1;
    transition: opacity 600ms ease 700ms;
}

.sx-map-ink.is-on .sx-tower {
    opacity: 1;
    transform: none;
    transition:
        opacity 700ms ease 1000ms,
        transform 1100ms var(--sx-ease) 1000ms;
}

.sx-route,
.sx-plot-arc {
    clip-path: inset(-30px 100% -30px 0);
}

.sx-map-ink.is-on .sx-route {
    clip-path: inset(-30px -6px -30px 0);
    animation: sx-flow 2.4s linear infinite;
    transition: clip-path 1300ms var(--sx-ease) 1500ms;
}

@keyframes sx-flow {
    to {
        stroke-dashoffset: -14;
    }
}

/* 三：高亮从左往右涂过去，红圈与牵线一笔画出来，批注的字最后显出来。 */
.sx-mark {
    fill: #f0c160;
    fill-opacity: 0.72;
    transform: scaleX(0);
    transform-box: fill-box;
    transform-origin: 0 50%;
}

.sx-mark.is-on {
    transform: none;
    transition: transform 900ms var(--sx-ease);
}

.sx-note__ring,
.sx-note__thread {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
}

.sx-note.is-on .sx-note__ring {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 700ms var(--sx-ease) 650ms;
}

.sx-note.is-on .sx-note__thread {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 600ms var(--sx-ease) 1250ms;
}

.sx-note__text {
    opacity: 0;
}

.sx-note.is-on .sx-note__text {
    opacity: 1;
    transition: opacity 600ms ease 1700ms;
}

/* 五：时间线换到上面以后，红线从第一章牵到第五章，再显出“同一种敲法”。 */
.sx-plot-ink.is-on .sx-plot-arc {
    clip-path: inset(-30px -6px -30px 0);
    animation: sx-flow 2.4s linear infinite;
    transition: clip-path 1300ms var(--sx-ease) 900ms;
}

.sx-plot-label {
    opacity: 0;
}

.sx-plot-ink.is-on .sx-plot-label {
    opacity: 1;
    transition: opacity 700ms ease 1900ms;
}

/* 不演从字到世界（少动效、这一版不要它）：停在都显出来的样子，没有过渡，航线不流。 */
.sx--still .sx-relay,
.sx--still .sx-relay * {
    animation: none !important;
    transition: none !important;
}

/* ── 指针视差、悬停细看与鎏金反光（第 7 轮） ── */

.sx-par {
    transition: filter 600ms ease;
    will-change: transform;
}

.sx-par--book {
    position: relative;
}

.sx-lean {
    transform-origin: 50% 60%;
    transition: transform 800ms var(--sx-ease);
}

.sx--peek:not(.is-diving) .sx-peek {
    pointer-events: auto;
}

/*
 * 指针停在哪张纸上：那张稳住（漂浮停在半路）、微微前倾凑近，靠近指针的那一角再抬起两三度（第 8 轮，`--lift-x`、`--lift-y` 由脚本按
 * 指针在纸上的位置写，-1 到 1）；压在下面的那张多探出一点。
 */
.sx--peek .sx-peek:hover .sx-bob {
    animation-play-state: paused;
}

.sx--peek .sx-peek:hover .sx-lean {
    transform: perspective(900px) translate3d(0, -6px, 0) rotateX(calc(-5deg + var(--lift-y, 0) * 3deg)) rotateY(calc(var(--lift-x, 0) * -3.5deg)) scale(1.035);
    transition-duration: 320ms;
}

/* ── 点纸细看（第 8 轮）：那张凑到最前、去掉焦外的虚、影子拉远；别的几层与远处的桌子压暗 ── */

.sx--peek:not(.is-diving) .sx-peek {
    cursor: zoom-in;
}

.sx-layer.is-focused {
    z-index: 2;
}

.sx-layer.is-focused .sx-peek {
    cursor: zoom-out;
}

.sx-layer.is-focused .sx-bob {
    animation-play-state: paused;
}

/* 细看时还跟着指针轻轻偏一点，不前倾（已经凑到眼前了）。 */
.sx--peek .sx-layer.is-focused .sx-peek .sx-lean {
    transform: perspective(900px) rotateX(calc(var(--lift-y, 0) * 2deg)) rotateY(calc(var(--lift-x, 0) * -2.5deg));
}

/* 远处的桌子也压一压：压在外层（它的 transform 归镜头，filter 空着）；开场的里层另有自己的过渡，不动它。 */
.sx--focusing .sx-layer:not(.is-focused) .sx-par,
.sx--focusing .sx-carrier {
    filter: brightness(0.62) saturate(0.9);
}


.sx--peek .sx-peek:hover .sx-card--b {
    --sx-peek: 1;
}

/* 鎏金反光：书角上一团柔和的暖光，跟着指针走；遮罩用同一张照片，只叠在书角不透明的地方，不扫白光。 */
.sx-glint {
    position: absolute;
    inset: 0;
    background: radial-gradient(46% 36% at calc(40% + var(--sx-glint-x, 0) * 30%) calc(34% + var(--sx-glint-y, 0) * 26%), rgb(255 236 180 / 0.9), rgb(255 214 150 / 0.24) 46%, transparent 72%);
    filter: blur(1.4px);
    mix-blend-mode: soft-light;
    pointer-events: none;
    mask: var(--sx-book) center / 100% 100% no-repeat;
}

/*
 * 叠着的两张纸（人物卡与星璃的便笺、地图与时间线）：下面那张错开一点露出一角。地图与时间线换位（从字到世界的第五步）时，
 * 下面那张斜着抽出来、换到上面，上面那张往另一边让开、落到下面。
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

/* 下面那张错开一点露出一角；`--sx-peek` 是悬停细看时多探出来的那一点。 */
.sx-card--b {
    --sx-peek: 0;
    z-index: 0;
    transform: translate3d(calc(16px + var(--sx-peek) * 12px), calc(12px + var(--sx-peek) * 10px), 0) rotate(calc(4deg + var(--sx-peek) * 1.5deg)) scale(0.95);
    transition: transform 700ms var(--sx-ease);
}

/* 从字到世界的第四步：星璃的便笺往左下斜着抽出一截，露出她那几行字与小头像。 */
.sx-card--note.is-out {
    transform: translate3d(calc(-34px - var(--sx-peek) * 8px), calc(118px + var(--sx-peek) * 12px), 0) rotate(-5deg) scale(0.95);
    transition: transform 1100ms var(--sx-ease);
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
        transform: translate3d(calc(16px + var(--sx-peek) * 12px), calc(12px + var(--sx-peek) * 10px), 0) rotate(calc(4deg + var(--sx-peek) * 1.5deg)) scale(0.95);
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
 * ── 昼：午后的藏书阁 ──
 * 左上高窗斜进来一道日光；纸面提亮，所有的影子往右下落（@designer 第 8 轮：同一个窗光）。
 * 第 8 轮（开发者：白天明显不对）：桌布不再用夜里那一圈近黑的暗绒（亮墙中间像烧出来的洞）。
 * 第 9 轮（开发者选了旧橡木案）：桌面是生成的橡木照片（入库前降了饱和、提了亮、修掉一块黑节疤；第 11 轮换成胡桃木后删掉）。
 * 第 10 轮（开发者：首屏只有一张桌，其他地方灰蒙蒙一片，少了华丽感）：灰的是墙。墙改成中间暖象牙、往四角沉到深栗褐，
 * 顶上那一条留亮（导航是深墨的字）；桌面把橡木压成深暖的胡桃色，外圈露出酒红丝绒；纸与书角的影子加深。都用现有的素材（@designer 第 10 轮方向一）。
 * 第 11 轮（开发者：工作台的投影和周围突兀，垫一块红丝绸会不会好些）：突兀的是桌下那一团椭圆的暗（丝绒外圈加桌下的大影），
 * 在浅墙上拱过工作台的上沿。桌面换成生成的深胡桃木（`assets/walnut.webp`），四边柔化成一块矩形案面，透视下是往远处淡掉的梯形，
 * 不再拱起；工作台下垫一块深石榴红的丝绸，影子改成贴身的两层短影；桌子背后那圈暖光白天不画（@designer 第 11 轮）。
 */
.sx--day {
    background: #4a2e20;
}

.sx--day .sx-back {
    background:
        radial-gradient(56% 46% at 18% 0%, rgb(255 246 222 / 0.55), transparent 72%),
        radial-gradient(82% 74% at 50% 16%, #f6ecd8 0%, #efdfc0 30%, #cfa274 52%, #80502f 72%, #4a2e20 92%);
}

.sx--day .sx-vignette {
    background: radial-gradient(120% 100% at 50% 30%, transparent 58%, rgb(52 26 14 / 0.5) 100%);
}

/* 日光从左上的高窗斜着进来：光锥的起点挪到左上，整锥往右下斜约三十度，落在桌上；颜色是白里带一点金。 */
.sx--day .sx-light__aim {
    transform: translateX(-30%) rotate(-32deg);
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

/* 桌子背后那圈暖光白天不画：亮的象牙色工作台垫在丝绸上就站得住，光环反把它的边照虚（@designer 第 11 轮）。 */
.sx--day .sx-halo {
    display: none;
}

/*
 * 白天的桌面：深胡桃木案面，左上的窗光在上面落一片暖。四边柔化（两道线性渐变取交），透视下是往远处淡掉的梯形，
 * 远边是一条横的柔边，不像夜里那样用径向渐变（白天的墙亮，椭圆的暗会在工作台上沿拱起来）。
 * 两侧比桌子各宽出四成、上下各三成四：落地时淡掉的那一圈都在画外，眉题与章节条压在实的木面上。
 */
.sx--day .sx-cloth {
    inset: -34% -40%;
    border-radius: 0;
    background:
        radial-gradient(40% 46% at 30% 30%, rgb(255 228 184 / 0.14), transparent 72%),
        var(--sx-walnut) center / cover,
        #3c2214;
    mask-image:
        linear-gradient(to bottom, transparent 0, #000 12%, #000 88%, transparent 100%),
        linear-gradient(to right, transparent 0, #000 12%, #000 88%, transparent 100%);
    mask-composite: intersect;
}

/*
 * 丝绸垫：深石榴红的素缎，首屏时比工作台左右各宽一成、上下各宽一成二，随俯冲收成落地后的一道窄边（上下 12px、左右 18px）。
 * 用内缩（inset）收，不用缩放：包边与金线要保持原来的粗细。缎面是左上迎光、右下沉暗的一片同色渐变，
 * 只在露出来的边上有几处很浅的起伏（明暗差一成以内），不给白亮条；包边 3px 暗红，往里 6px 压一道细暗金线，背光那头淡下去。
 * 现在只用样式画；@designer 估计要一张生成的缎面照片才不像塑料（评审板上问）。
 */
.sx--day .sx-silk {
    display: block;
    position: absolute;
    inset:
        calc(-12% * (1 - var(--sx-silk)) - 12px * var(--sx-silk))
        calc(-10% * (1 - var(--sx-silk)) - 18px * var(--sx-silk));
    border: 3px solid;
    border-color: #5c1720 #3e0d13 #360b11 #521419;
    border-radius: 5px;
    background:
        radial-gradient(60% 70% at 16% 10%, rgb(255 224 176 / 0.12), transparent 70%),
        radial-gradient(34% 9% at 34% 100%, rgb(168 64 72 / 0.32), transparent 72%),
        radial-gradient(22% 7% at 70% 99%, rgb(34 6 10 / 0.34), transparent 72%),
        radial-gradient(6% 34% at 0% 62%, rgb(34 6 10 / 0.36), transparent 74%),
        radial-gradient(7% 28% at 100% 28%, rgb(168 64 72 / 0.24), transparent 74%),
        radial-gradient(26% 7% at 58% 0%, rgb(168 64 72 / 0.2), transparent 72%),
        linear-gradient(130deg, #8f2b33 0%, #7a2129 26%, #6e1b22 50%, #5c161d 78%, #4a1117 100%);
    box-shadow:
        0 4px 12px rgb(18 8 4 / 0.5),
        inset 0 0 0 1px rgb(30 4 8 / 0.35),
        inset 0 0 10px rgb(30 4 8 / 0.4);
    /* 首屏时工作台压着一层暗，垫子跟着暗一点，两样像在同一处光下；不压的话一块亮红抢了标题与按钮。 */
    filter: brightness(calc(0.84 + 0.16 * var(--sx-silk)));
    transition: box-shadow 600ms ease;
}

.sx--day .sx-silk::after {
    content: "";
    position: absolute;
    inset: 3px;
    border: 1px solid rgb(214 178 110 / 0.42);
    border-radius: 2px;
    mask-image: linear-gradient(130deg, #000 30%, rgb(0 0 0 / 0.43));
}

.sx--day .sx-carrier.is-landed .sx-silk {
    box-shadow:
        0 2px 8px rgb(16 8 4 / 0.42),
        inset 0 0 0 1px rgb(30 4 8 / 0.35),
        inset 0 0 10px rgb(30 4 8 / 0.4);
}

/* 窄屏的工作台离舞台两边只有 12px，垫子的边收到 8px，不伸出画外。 */
.sx--day.sx--narrow .sx-silk {
    inset: -8px;
}

.sx--day .sx-pool {
    background: radial-gradient(50% 50% at 50% 50%, rgb(255 250 236 / 0.3), transparent 72%);
}

/* 工作台压在丝绸上：贴身一层定住轮廓、往下一层短的柔影说它有厚度；落地后收轻，视线交给演示。 */
.sx--day .sx-desk {
    box-shadow:
        0 0 0 1px rgb(168 118 47 / 0.45),
        0 2px 6px rgb(34 6 10 / 0.45),
        0 12px 24px -6px rgb(38 8 12 / 0.38);
    transition: box-shadow 600ms ease;
}

.sx--day .sx-carrier.is-landed .sx-desk {
    box-shadow:
        0 0 0 1px rgb(168 118 47 / 0.45),
        0 6px 18px rgb(24 6 8 / 0.34);
}

/* 首屏压一压远处的桌子：白天的桌子是亮的象牙色，压的是浅的暖灰，不是黑。 */
.sx--day .sx-shade {
    background: radial-gradient(70% 62% at 40% 28%, rgb(255 248 232 / 0.2), rgb(150 128 100 / 0.45) 100%);
}

.sx--day .sx-dark {
    background: #ddd0b8;
}

/* 白天的纸两层影（@designer 第 9 轮）：贴身一层浅的定住轮廓，远一层柔的说它悬着；浅木面上单一层影，纸会糊进木纹里。 */
.sx--day .sx-sheet {
    --sx-rim: drop-shadow(calc(var(--sx-lx, 0) * 2.5px) calc(var(--sx-ly, 0) * 2.5px) 0.5px rgb(255 252 240 / calc(var(--sx-lit, 0) * 0.9)));
    --sx-shadow: drop-shadow(0 2px 3px rgb(58 34 18 / 0.22)) drop-shadow(calc(12px + var(--sx-focus, 0) * 8px - var(--sx-lx, 0) * 10px) calc(22px + var(--sx-focus, 0) * 10px - var(--sx-ly, 0) * 10px) calc(26px + var(--sx-focus, 0) * 8px) rgb(58 34 18 / calc(0.34 + var(--sx-focus, 0) * 0.1)));
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(1 + var(--sx-lit, 0) * 0.06));
}

.sx--day .sx-sheet--far {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(0.97 + var(--sx-focus, 0) * 0.03 + var(--sx-lit, 0) * 0.06)) blur(0.6px);
}

.sx--day .sx-sheet--mid {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(1 + var(--sx-lit, 0) * 0.06));
}

.sx--day .sx-sheet--near {
    filter: var(--sx-rim) var(--sx-shadow) brightness(calc(1 + var(--sx-lit, 0) * 0.06)) blur(0.8px);
}

/* 白天细看时别的几层只退半步：压得和夜里一样暗，亮墙上会发灰发脏。 */
.sx--day.sx--focusing .sx-layer:not(.is-focused) .sx-par,
.sx--day.sx--focusing .sx-carrier {
    filter: brightness(0.88) saturate(0.82);
}

.sx--day .sx-book {
    filter:
        blur(1.4px)
        drop-shadow(calc(var(--sx-lx, 0) * 3px) calc(var(--sx-ly, 0) * 3px) 0.6px rgb(255 248 230 / calc(var(--sx-lit, 0) * 0.7)))
        drop-shadow(calc(20px - var(--sx-lx, 0) * 10px) calc(26px - var(--sx-ly, 0) * 10px) 30px rgb(52 28 14 / 0.42))
        brightness(calc(1 + var(--sx-lit, 0) * 0.1));
}

.sx--day .sx-ribbon {
    filter: blur(2.2px) drop-shadow(12px 14px 14px rgb(64 38 18 / 0.24));
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
    .sx-light__cone,
    .sx-card {
        animation: none !important;
    }

    .sx-lean,
    .sx-card {
        transition: none !important;
    }
}
</style>
