/**
 * 第 4 轮首屏《入殿·俯案成界》的镜头（w00056 t06）：首屏是暗夜圣案前的一幕，往下滚一屏，镜头沿进深方向俯冲，
 * 前景的书角与悬浮的羊皮页从身边掠过，远处那张桌子（真工作台）放平、推近，最后 1:1 停在第一幕的位置。
 *
 * 这里全是纯函数：给舞台尺寸与进度，算每一层此刻的变换。各层不共用一个 3D 场景（真工作台不进 `preserve-3d`），
 * 而是按同一台相机各自投影：先算出它在屏幕上的中心与缩放（平面的），再叠上它自己的倾角（元素自带的 `perspective()`）。
 * 这样落地时工作台的变换正好是恒等，可以直接换成 `none`：字是清楚的，命中测试与拖动的落点按视口坐标照常。
 */
import type {Box} from "./desk";

export interface StageSize {
    readonly width: number;
    readonly height: number;
}

/** 相机到屏幕平面的距离（px）：所有层共用。 */
export const PERSPECTIVE = 1000;
/** 首屏时那张桌子在屏幕平面后面多深；滚完一屏它来到屏幕平面上。 */
export const DESK_DEPTH = 1700;
/** 桌子自己倾斜时用的透视（桌子本地的 px）：只管“放平”这一下的梯形感，和相机无关。 */
const TILT_PERSPECTIVE = 1400;
/** 首屏时桌子向后倒的角度。 */
const TILT = 24;
/** 工作台下面留给字幕的那一条。 */
export const CAPTION_BAND = 116;
/** 宽屏才演镜头；更窄时工作台平放在首屏文字下面，不俯冲。 */
export const SANCTUM_MIN_WIDTH = 900;

/**
 * 首屏停着时的几样动静（第 7 轮，开发者：首屏换得慢、动静小；@designer：一条单线接力的叙事，加克制的指针响应）：
 * - `relay` 从字到世界：手稿上落墨写出敲门那一行，金尘飞到地图上显出海岸与灰塔，红笔圈出伏笔，金尘飞到人物卡、抽出星璃的便笺，
 *   金尘沿航线走进剧情时间线，最后墨沉回纸里，再来一圈；约五秒一步，演一半停一半，同一时刻只有一处在动。
 * - `parallax` 指针视差：几张纸、书角与丝带按远近跟着指针挪几个像素、纸倾不过两度，带阻尼的惯性；顶光不动。
 * - `glint` 鎏金反光：书角的鎏金、标题下的花饰与按钮的金边上一团柔和的反光，跟着指针走（不扫白光）。
 * - `peek` 悬停细看：指针停在哪张纸上，那张稳住、微微前倾，压在下面的那张多探出一点。
 * - `ribbon` 丝带尾巴：指针一动，前景丝带的末端比书角慢半拍摆过去。
 */
export type SceneEffect = "relay" | "parallax" | "glint" | "peek" | "ribbon";
export const SCENE_EFFECTS: readonly SceneEffect[] = ["relay", "parallax", "glint", "peek", "ribbon"];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** 在 `from` 到 `to` 之间平滑地从 0 走到 1（两头不突变）。 */
export const smooth = (from: number, to: number, value: number): number => {
    const t = clamp01((value - from) / (to - from));
    return t * t * (3 - 2 * t);
};
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const round = (value: number): number => Math.round(value * 100) / 100;

/** 第一幕里工作台的位置（舞台坐标）：约九成宽、封顶 1320；顶上留一点，底下留字幕。 */
export function landingBox(stage: StageSize): Box {
    const margin = Math.max(40, Math.round(stage.width * 0.05));
    const width = Math.min(1320, stage.width - margin * 2);
    const top = 36;
    const height = Math.max(420, Math.min(800, stage.height - top - CAPTION_BAND));
    return {left: Math.round((stage.width - width) / 2), top, width, height};
}

/** 工作台放在哪（舞台坐标）：宽屏是落地的位置；窄屏不俯冲，平放在首屏文字下面。 */
export function deskBox(stage: StageSize): Box {
    if (stage.width >= SANCTUM_MIN_WIDTH) return landingBox(stage);
    const top = Math.round(stage.height * 0.46);
    return {left: 12, top, width: stage.width - 24, height: Math.max(320, stage.height - top - 28)};
}

/** 消失点：落地后工作台的中心。这样桌子在 p=1 时不论多深都正好投到自己的落点上。 */
function vanishing(stage: StageSize): {readonly x: number; readonly y: number} {
    const box = landingBox(stage);
    return {x: box.left + box.width / 2, y: box.top + box.height / 2};
}

/**
 * 相机往前走了多远：开头走得快（一滚就有东西从身边掠过），收尾放慢落定。
 * 桌子的缩放是 `PERSPECTIVE / (PERSPECTIVE - z)`，离得越近长得越快；相机收尾放慢正好抵掉这一点，看起来是匀匀地推近、轻轻停住。
 */
export function camera(progress: number): number {
    return DESK_DEPTH * (1 - (1 - clamp01(progress)) ** 2.2);
}

const scaleAt = (depth: number): number => PERSPECTIVE / (PERSPECTIVE - depth);

export interface DeskShot {
    /** 落地时是 `none`。 */
    readonly transform: string;
    /** 压在工作台上的暗：首屏的主角是标题，远处的桌子压到四成亮（中间留一块顶光照着的亮斑），推近到一半时还原。 */
    readonly shade: number;
    /** 推近时扫过纸面的那道暖光：位置 0 到 1（左上到右下），以及它此刻的浓淡。 */
    readonly sheen: number;
    readonly sheenOpacity: number;
    /** 桌子背后那圈暖光：越近越亮，落地后托住象牙色的工作台，不让它硬生生嵌在黑里。 */
    readonly halo: number;
    readonly landed: boolean;
}

export function deskShot(stage: StageSize, progress: number): DeskShot {
    const p = clamp01(progress);
    const center = vanishing(stage);
    const scale = scaleAt(-DESK_DEPTH + camera(p));
    const y = lerp(stage.height * 0.75, center.y, smooth(0, 0.92, p));
    const tilt = TILT * (1 - smooth(0.16, 0.94, p));
    const landed = p >= 0.999;
    const sheenOpacity = smooth(0.42, 0.62, p) * (1 - smooth(0.82, 0.99, p));
    return {
        transform: landed ? "none" : `translate3d(0px, ${round(y - center.y)}px, 0px) scale(${round(scale * 1000) / 1000}) perspective(${TILT_PERSPECTIVE}px) rotateX(${round(tilt)}deg)`,
        shade: round(0.9 * (1 - smooth(0.04, 0.5, p))),
        sheen: round(smooth(0.42, 0.95, p)),
        sheenOpacity: round(sheenOpacity),
        halo: round(lerp(0.55, 1, smooth(0.3, 1, p))),
        landed,
    };
}

/** 悬在空中的一层（羊皮页、前景的书角与丝带）：首屏时在屏幕上的中心（按舞台的比例）与深度；正的深度在屏幕平面前面。 */
export interface Floater {
    readonly at: {readonly x: number; readonly y: number};
    readonly depth: number;
    /** 它自己的姿态（倾角、转角），叠在投影之后；写成 CSS 变换函数。 */
    readonly pose: string;
    /** 到这个深度开始淡、到下一个深度淡完（相机穿过之前就要淡掉，不然会糊在镜头上）。 */
    readonly fade: readonly [number, number];
}

export interface FloaterShot {
    readonly transform: string;
    readonly opacity: number;
    readonly visible: boolean;
}

/**
 * 投影一层：首屏时它在 `at`，往后它和桌子在同一个世界里随相机前进，离镜头越近越大、越往外走。
 * 元素本身左上角放在舞台原点，`width`、`height` 是它首屏时的大小。
 */
export function floaterShot(stage: StageSize, floater: Floater, size: {readonly width: number; readonly height: number}, progress: number): FloaterShot {
    const center = vanishing(stage);
    const startScale = scaleAt(floater.depth);
    const screen0 = {x: floater.at.x * stage.width, y: floater.at.y * stage.height};
    const world = {x: center.x + (screen0.x - center.x) / startScale, y: center.y + (screen0.y - center.y) / startScale};
    const depth = floater.depth + camera(progress);
    const opacity = 1 - smooth(floater.fade[0], floater.fade[1], depth);
    if (opacity <= 0.001 || depth >= PERSPECTIVE * 0.9) return {transform: "none", opacity: 0, visible: false};
    const scale = scaleAt(depth);
    const x = center.x + (world.x - center.x) * scale;
    const y = center.y + (world.y - center.y) * scale;
    const relative = scale / startScale;
    return {
        transform: `translate3d(${round(x - size.width / 2)}px, ${round(y - size.height / 2)}px, 0px) scale(${round(relative * 1000) / 1000}) ${floater.pose}`,
        opacity: round(opacity),
        visible: true,
    };
}

/** 首屏的字：最先退场，只淡出、往上飘一点（不加模糊：大块文字边滚边糊会掉帧，也像起雾）。 */
export function heroShot(progress: number): {readonly opacity: number; readonly transform: string; readonly visible: boolean} {
    const fade = smooth(0, 0.24, progress);
    return {opacity: round(1 - fade), transform: `translate3d(0px, ${round(-64 * smooth(0, 0.32, progress))}px, 0px)`, visible: fade < 0.999};
}

/** 顶上那束光：镜头往前时它从头顶滑过去、淡一些；落地后剩一点余晖。 */
export function lightShot(stage: StageSize, progress: number): {readonly transform: string; readonly opacity: number} {
    const t = smooth(0, 1, progress);
    return {transform: `translate3d(0px, ${round(-stage.height * 0.34 * t)}px, 0px) scale(${round(1 + 0.5 * t)})`, opacity: round(1 - 0.62 * t)};
}
