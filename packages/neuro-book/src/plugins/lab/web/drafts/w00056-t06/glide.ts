/**
 * 第一幕演示指针走的路（w00056 t06 第 8 轮）：开发者看第 7 轮时说拖动太慢、走的是直角，要带弧度。
 *
 * 两种路：
 * - 没有路点：一道微微拱起的弧（三次贝塞尔，弦高约一成，往上拱，像手腕自然的走法）。
 * - 有路点：折线的每个拐角换成一段圆弧（圆角折线）。路点是为实时布局挑的走廊（标签条里、不收这个标签的面板上，见
 *   `HomepageSanctum.vue` 的 `drag`），圆角只在拐角两边各吃进一段，整条路仍在走廊的折线旁边，不会像样条那样拱出走廊。
 *
 * 整条路按弧长取点：调用方只给一个 0 到 1 的进度（一次缓入缓出），路点处不停、不减速。
 */
import type {Point} from "./desk";

export interface Glide {
    /** 走了 `fraction`（按弧长，0 到 1）时在哪。 */
    at(fraction: number): Point;
    /** 整条路多长（px）：调用方按它定时长。 */
    readonly length: number;
}

/** 弧的弦高占弦长的比例（@designer 第 8 轮：8% 到 14%）。 */
const BOW = 0.1;
/** 圆角最大半径：拐角两边各吃进这么多（不超过那一边的四成五）。 */
const FILLET = 120;
/** 每一段曲线取多少个点量弧长。 */
const SAMPLES = 48;

const add = (a: Point, b: Point): Point => ({x: a.x + b.x, y: a.y + b.y});
const sub = (a: Point, b: Point): Point => ({x: a.x - b.x, y: a.y - b.y});
const scale = (a: Point, k: number): Point => ({x: a.x * k, y: a.y * k});
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

function quadratic(from: Point, control: Point, to: Point): (t: number) => Point {
    return (t) => {
        const u = 1 - t;
        return {x: u * u * from.x + 2 * u * t * control.x + t * t * to.x, y: u * u * from.y + 2 * u * t * control.y + t * t * to.y};
    };
}

function cubic(from: Point, c1: Point, c2: Point, to: Point): (t: number) => Point {
    return (t) => {
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        return {x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y};
    };
}

const line = (from: Point, to: Point): ((t: number) => Point) => (t) => add(from, scale(sub(to, from), t));

/** 一道往上拱的弧：两个控制点在弦的三分点上、沿法线偏 `h`；三次贝塞尔在中点偏出 0.75h，所以 h 取弦高的 4/3。 */
function bowed(from: Point, to: Point): (t: number) => Point {
    const chord = distance(from, to);
    if (chord < 1) return line(from, to);
    let normal = {x: -(to.y - from.y) / chord, y: (to.x - from.x) / chord};
    // 往上拱（屏幕坐标 y 朝下）；竖直的弦往左拱。
    if (normal.y > 0 || (normal.y === 0 && normal.x > 0)) normal = scale(normal, -1);
    const lift = (BOW * chord * 4) / 3;
    const c1 = add(add(from, scale(sub(to, from), 1 / 3)), scale(normal, lift));
    const c2 = add(add(from, scale(sub(to, from), 2 / 3)), scale(normal, lift));
    return cubic(from, c1, c2, to);
}

/** 圆角折线：各段依次是直线、拐角的圆弧、直线……拐角半径取 `FILLET` 与两边四成五里小的那个。 */
function filleted(points: readonly Point[]): Array<(t: number) => Point> {
    const pieces: Array<(t: number) => Point> = [];
    let cursor = points[0]!;
    for (let index = 1; index < points.length - 1; index += 1) {
        const corner = points[index]!;
        const before = points[index - 1]!;
        const after = points[index + 1]!;
        const inLength = distance(before, corner);
        const outLength = distance(corner, after);
        const radius = Math.min(FILLET, inLength * 0.45, outLength * 0.45);
        if (radius < 1) {
            pieces.push(line(cursor, corner));
            cursor = corner;
            continue;
        }
        const enter = add(corner, scale(sub(before, corner), radius / inLength));
        const leave = add(corner, scale(sub(after, corner), radius / outLength));
        pieces.push(line(cursor, enter), quadratic(enter, corner, leave));
        cursor = leave;
    }
    pieces.push(line(cursor, points.at(-1)!));
    return pieces;
}

/** 从 `from` 经 `via` 到 `to` 的一条路。 */
export function glidePath(from: Point, to: Point, via: readonly Point[] = []): Glide {
    const pieces = via.length === 0 ? [bowed(from, to)] : filleted([from, ...via, to]);
    // 量弧长：每段取等分的点连成折线，累计长度；取点时在折线上按长度插值。
    const samples: Point[] = [from];
    for (const piece of pieces) for (let step = 1; step <= SAMPLES; step += 1) samples.push(piece(step / SAMPLES));
    const lengths = [0];
    for (let index = 1; index < samples.length; index += 1) lengths.push(lengths[index - 1]! + distance(samples[index - 1]!, samples[index]!));
    const total = lengths.at(-1)!;
    return {
        length: total,
        at(fraction) {
            if (total === 0 || fraction <= 0) return samples[0]!;
            if (fraction >= 1) return samples.at(-1)!;
            const goal = fraction * total;
            let low = 0;
            let high = lengths.length - 1;
            while (high - low > 1) {
                const middle = (low + high) >> 1;
                if (lengths[middle]! < goal) low = middle;
                else high = middle;
            }
            const span = lengths[high]! - lengths[low]!;
            const t = span === 0 ? 0 : (goal - lengths[low]!) / span;
            return add(samples[low]!, scale(sub(samples[high]!, samples[low]!), t));
        },
    };
}

/**
 * 指针走这么长的路要多久（ms）：短的路不至于一闪而过，长的路封顶。第 8 轮照 @designer 定在一次拖动 0.5 到 0.95 秒，
 * 开发者第 11 轮说太快（第 7 轮嫌慢），第 12 轮放慢到 0.7 到 1.3 秒，滑到来源上的那一段也跟着放慢一些。
 */
export function glideTime(length: number, kind: "reach" | "drag"): number {
    return kind === "drag" ? Math.min(1300, Math.max(700, 380 + length * 1.05)) : Math.min(760, Math.max(340, 240 + length * 0.68));
}
