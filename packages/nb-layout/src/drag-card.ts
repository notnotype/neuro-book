/**
 * 拖动中跟手的卡片（Spec `ui/layout-drag` 的“拖动卡片”）：逐帧把尺寸缩向目标、把位置追到“抓住的点在指针下”。纯 TS，时间由调用方给；
 * 一张卡片一个对象，卡片不要了就丢掉，再要时重新拿起。卡片缩到多大、什么时候要卡片由宿主定。
 *
 * 尺寸指数逼近，离终点不到 `stillPx` 就取终点：不截断的话宽高每帧都在变，卡片里的内容按卡片大小排版，每帧都要重排。
 * 尺寸写出去取整到像素，并且至多每 `refreshMs` 变一次（到终点那一帧马上写）；位置每帧跟手，按画出来的尺寸算，抓住的点才一直在指针下。
 */

import type {GridDropPoint, GridDropRect} from "./grid-drop";
import type {GridRect} from "./grid-rects";

export interface DragCardSize {
    readonly width: number;
    readonly height: number;
}

export interface DragCardOptions {
    /** 逼近的时间常数：每帧按 `1 - e^(-elapsed / tauMs)` 的比例走。缺省 90。 */
    readonly tauMs?: number;
    /** 离终点这么近就算到了。缺省 0.1。 */
    readonly stillPx?: number;
    /** 帧的时间戳有抖动：离该写尺寸的时刻差这么多也算到了，不然 60Hz 的屏上每秒 30 次有时要隔三帧才写一次。缺省 2。 */
    readonly refreshSlackMs?: number;
}

export interface DragCardFrame {
    readonly now: number;
    /** 离上一帧的毫秒数；不是有限数或为负时按 0。 */
    readonly elapsed: number;
    /** 指针（视口坐标）。 */
    readonly pointer: GridDropPoint;
    /** 网格根左上角的视口坐标：交回的矩形相对它。 */
    readonly origin: GridDropPoint;
    /** 这一帧要缩向的尺寸。 */
    readonly target: DragCardSize;
    /** 尺寸至多多久变一次；缺省 0，每帧都可以。宿主的设置一场里可能变，所以按帧给。 */
    readonly refreshMs?: number;
}

export interface DragCard {
    /** 一帧：交回要写的矩形（相对 `origin`），和上一次一样时是 null；`settling` 为真是尺寸或追赶还没到终点，要再排一帧。 */
    step(frame: DragCardFrame): {readonly rect: GridRect | null; readonly settling: boolean};
}

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 从内容此刻所在的矩形（视口坐标）拿起：尺寸是它的，抓住的点是指针在它上面的比例，卡片从这个矩形的位置追到指针下。
 * 量不到（null、宽或高不是正的有限数）时尺寸是 `fallback`，抓在上沿中点，不追赶。
 */
export function createDragCard(from: GridDropRect | null, pointer: GridDropPoint, fallback: DragCardSize, options: DragCardOptions = {}): DragCard {
    const tauMs = options.tauMs ?? 90;
    const stillPx = options.stillPx ?? 0.1;
    const slackMs = options.refreshSlackMs ?? 2;
    const width = from === null ? 0 : from.right - from.left;
    const height = from === null ? 0 : from.bottom - from.top;
    const usable = from !== null && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    let size: DragCardSize = usable ? {width, height} : fallback;
    const grab = usable ? {x: clampUnit((pointer.x - from.left) / width), y: clampUnit((pointer.y - from.top) / height)} : {x: 0.5, y: 0};
    /** 卡片离跟手的位置还差多少：拿起时指针可能在矩形外面，抓住的点夹在卡片边上，卡片从矩形的位置追到指针下，和尺寸同一个时间常数。 */
    let chase = usable ? {x: from.left - (pointer.x - grab.x * width), y: from.top - (pointer.y - grab.y * height)} : {x: 0, y: 0};
    /** 上一次交回的矩形：它的宽高就是卡片此刻画出来的大小。null 是还没交回过，这一帧不按时间逼近。 */
    let written: GridRect | null = null;
    /** 尺寸下一次该写的时刻：写过之后按间隔往后排，落后一个间隔以上就从现在算。 */
    let sizeDue = 0;

    return {
        step: ({now, elapsed, pointer: at, origin, target, refreshMs = 0}) => {
            const dt = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
            const blend = written === null ? 0 : 1 - Math.exp(-dt / tauMs);
            const approach = (value: number, to: number): number => (Math.abs(to - value) < stillPx ? to : value + (to - value) * blend);
            size = {width: approach(size.width, target.width), height: approach(size.height, target.height)};
            chase = {x: approach(chase.x, 0), y: approach(chase.y, 0)};
            const rounded = {width: Math.round(size.width), height: Math.round(size.height)};
            const arrived = size.width === target.width && size.height === target.height;
            const drawn = written === null ? null : {width: written.width, height: written.height};
            let shown = drawn ?? rounded;
            if (drawn !== null && (arrived || now >= sizeDue - slackMs) && (rounded.width !== drawn.width || rounded.height !== drawn.height)) shown = rounded;
            if (shown !== drawn) sizeDue = drawn === null || now - sizeDue >= refreshMs ? now + refreshMs : sizeDue + refreshMs;
            const rect = {x: at.x - origin.x - grab.x * shown.width + chase.x, y: at.y - origin.y - grab.y * shown.height + chase.y, width: shown.width, height: shown.height};
            const settling = !arrived || chase.x !== 0 || chase.y !== 0;
            if (written !== null && written.x === rect.x && written.y === rect.y && written.width === rect.width && written.height === rect.height) return {rect: null, settling};
            written = rect;
            return {rect, settling};
        },
    };
}
