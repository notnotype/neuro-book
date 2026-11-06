/**
 * 拖动手势的状态机（docs/specs/ui/layout-drag.md）：从按下到放下、与拖的是什么无关的判断都在这里。事件与时钟由适配层
 * 注入，不碰 DOM，所以门槛、帧合并、放下比较、取消和收场顺序能用手动时钟直接测。DOM 适配在 `vue/drag-session.ts`。
 *
 * 阶段：空闲 → 待起拖（只有指针）→ 拖动中 → 空闲。拖动中有一段内部的“放下中”：边缘滚动时松手要等下一帧才放下，因为虚拟
 * 列表在滚动事件之后才补上新进视口的行，当帧判定会落在空白上。这一帧里浏览器已经释放了捕获，所以失去捕获不算取消。
 */

import type {GridDropPoint} from "./grid-drop";

export interface DragGestureConfig {
    /** 鼠标与笔过门槛要移动的距离。 */
    readonly distancePx: number;
    /** 触摸要按住多久。 */
    readonly touchDelayMs: number;
    /** 触摸按住期间允许的抖动，超过就让给滚动。 */
    readonly touchTolerancePx: number;
}

export const DRAG_GESTURE_DEFAULTS: DragGestureConfig = {distancePx: 6, touchDelayMs: 200, touchTolerancePx: 6};

export type DragCancelReason =
    | "escape"
    | "pointer-cancel"
    | "capture-lost"
    | "blur"
    | "hidden"
    | "focus-left"
    | "pressed-elsewhere"
    | "structure-changed"
    | "disposed";

export type DragEnd =
    | {readonly kind: "committed"}
    | {readonly kind: "no-action"}
    | {readonly kind: "cancelled"; readonly reason: DragCancelReason};

/** 一场进行中对外发布的状态。 */
export interface DragState<S, D> {
    readonly source: S;
    readonly point: GridDropPoint;
    readonly drop: D | null;
    readonly keyboard: boolean;
}

/** 判定的输入：键盘拖动时 `region` 是停在的区域，指针拖动为 null。 */
export interface DragGestureQuery<S, R> {
    readonly source: S;
    readonly point: GridDropPoint;
    readonly region: R | null;
}

export interface DragClock {
    delay(run: () => void, ms: number): unknown;
    cancelDelay(handle: unknown): void;
    requestFrame(run: () => void): unknown;
    cancelFrame(handle: unknown): void;
}

/** 区域里键盘能停的位置与方向键的轴。 */
export interface DragStops {
    /** 方向键的轴。`both` 是四个方向键都走同一列位置：右、下往后，左、上往前（位置不在一条线上时）。 */
    readonly axis: "horizontal" | "vertical" | "both" | null;
    readonly points: ReadonlyArray<GridDropPoint>;
}

export interface DragGestureKeyboard<S, R> {
    regions(source: S): ReadonlyArray<R>;
    stops(region: R): DragStops;
    start(source: S, regions: ReadonlyArray<R>): {readonly region: number; readonly at: number | GridDropPoint};
}

export interface DragEdgeRect {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface DragGestureAutoScroll {
    rect(): DragEdgeRect;
    /** 滚一步；返回是否真的滚动了（到头为 false）。 */
    scrollBy(step: number): boolean;
    readonly edgePx?: number | undefined;
    readonly maxStepPx?: number | undefined;
}

export interface DragGestureHost<S, D, R> {
    readonly clock: DragClock;
    readonly config?: Partial<DragGestureConfig> | undefined;
    readonly scroll?: "reevaluate" | "withdraw" | undefined;
    readonly autoScroll?: DragGestureAutoScroll | undefined;
    readonly keyboard?: DragGestureKeyboard<S, R> | undefined;
    readonly activate?: ((source: S) => boolean) | undefined;
    readonly structure?: (() => string) | undefined;
    resolve(query: DragGestureQuery<S, R>): D | null;
    actionKey(drop: D): string | null;
    commit(drop: D, source: S): void;
    publish(state: DragState<S, D> | null): void;
    readonly ended?: ((end: DragEnd, last: DragState<S, D>) => void) | undefined;
    readonly activeChanged?: ((active: boolean) => void) | undefined;
    /** 进入待起拖：适配层装上指针监听。 */
    armed(): void;
    /** 待起拖放弃了：适配层拆掉指针监听。 */
    disarmed(): void;
    /** 拿起：适配层取捕获、装这一场的监听。指针拖动 `pointerId` 不为 null；取不到捕获返回 false。 */
    grabbed(pointerId: number | null): boolean;
    /** 收场：适配层拆监听、放捕获。 */
    released(): void;
    /** 键盘拖动结束后把焦点还给来源。 */
    readonly restoreFocus?: ((source: S) => void) | undefined;
}

export interface DragPress<S> {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly point: GridDropPoint;
    readonly source: S;
}

export interface DragGesture<S> {
    /** 没有待起拖也没有进行中的一场。 */
    readonly idle: boolean;
    /** 进行中的是键盘拖动。 */
    readonly keyboard: boolean;
    /** 任何一次按下：清掉上一场留下的“要吞 click”。 */
    pressed(): void;
    press(input: DragPress<S>): void;
    move(pointerId: number, point: GridDropPoint, buttons: number): void;
    release(pointerId: number, point: GridDropPoint): void;
    pointerCancel(pointerId: number): void;
    cancel(reason: DragCancelReason): void;
    /** 根里面滚动了；边缘滚动自己滚的不算。 */
    scrolled(): void;
    /** 窗口尺寸变了。 */
    resized(): void;
    /** 内容变了而指针没动：撤下落点，直到指针再动。 */
    invalidate(): void;
    /** 宿主那边已经结束了这场：收场，不调 `ended`。 */
    abort(): void;
    startKeyboard(source: S): boolean;
    /** 返回这个键是否归会话（适配层据此拦下）。 */
    key(input: {readonly key: string; readonly shift: boolean}): boolean;
    /** 这次 click 要不要吞。 */
    takeClick(detail: number): boolean;
    dispose(): void;
}

const EDGE_PX_DEFAULT = 24;
const EDGE_MAX_STEP_PX_DEFAULT = 16;

/** 一场进行中这些键归会话：内层（标签带的方向键、收起开关与选择）收不到，指针拖动也一样。 */
const SESSION_KEYS: ReadonlySet<string> = new Set([" ", "Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

/** 方向键在轴上的步进：沿轴的前进与后退，其它方向键不动。 */
function stepOf(key: string, axis: DragStops["axis"]): number {
    if (axis === "both") return key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
    if (axis === "horizontal") return key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    if (axis === "vertical") return key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    return 0;
}

/**
 * 这一刻边缘滚动该滚多快（负数向上）：指针在横向范围内、离上下边缘不到 `edgePx` 或已越过边缘时滚，越靠边越快；元素矮到
 * 上下两条边缘带相接时不滚，否则指针在哪都在滚。
 */
export function edgeScrollStep(rect: DragEdgeRect, point: GridDropPoint, edgePx = EDGE_PX_DEFAULT, maxStepPx = EDGE_MAX_STEP_PX_DEFAULT): number {
    if (point.x < rect.left || point.x > rect.right || rect.bottom - rect.top <= edgePx * 2) return 0;
    const fromTop = point.y - rect.top;
    const fromBottom = rect.bottom - point.y;
    if (fromTop < edgePx) return -Math.ceil(Math.min(1, (edgePx - fromTop) / edgePx) * maxStepPx);
    if (fromBottom < edgePx) return Math.ceil(Math.min(1, (edgePx - fromBottom) / edgePx) * maxStepPx);
    return 0;
}

interface Armed<S> {
    readonly pointerId: number;
    readonly touch: boolean;
    readonly start: GridDropPoint;
    /** 触摸按住到时用的坐标：抖动过的最后位置。 */
    latest: GridDropPoint;
    readonly source: S;
    timer: unknown;
}

interface KeyboardCursor<R> {
    readonly regions: ReadonlyArray<R>;
    region: number;
    stop: number;
}

interface Active<S, D, R> {
    readonly pointerId: number | null;
    readonly cursor: KeyboardCursor<R> | null;
    readonly source: S;
    readonly structure: string | null;
    point: GridDropPoint;
    /** 最后发布过的落点；放下只认它的动作。撤下后为 null。 */
    shown: D | null;
    last: DragState<S, D>;
    /** 松手了，在等下一帧放下。 */
    dropping: boolean;
}

export function createDragGesture<S, D, R = never>(host: DragGestureHost<S, D, R>): DragGesture<S> {
    const config = {...DRAG_GESTURE_DEFAULTS, ...host.config};
    const {clock} = host;
    let armed: Armed<S> | null = null;
    let active: Active<S, D, R> | null = null;
    let frame: unknown = null;
    let scrollFrame: unknown = null;
    let focusFrame: unknown = null;
    /** 边缘滚动正在滚：这期间的滚动事件是自己滚的。 */
    let autoScrolling = false;
    /** 指针拖动刚结束：同一手势末尾的 click 要吞掉。 */
    let swallowClick = false;

    function clearFrame(): void {
        if (frame !== null) clock.cancelFrame(frame);
        frame = null;
    }

    function clearScrollFrame(): void {
        if (scrollFrame !== null) clock.cancelFrame(scrollFrame);
        scrollFrame = null;
        autoScrolling = false;
    }

    function disarm(): void {
        const current = armed;
        if (current === null) return;
        if (current.timer !== null) clock.cancelDelay(current.timer);
        armed = null;
        host.disarmed();
    }

    /** 收场，顺序见 Spec 的“时序与寿命”。`end` 为 null 是宿主自己结束的（`abort`），不回调。 */
    function finish(end: DragEnd | null, dropped: D | null): void {
        const current = active;
        if (current === null) return;
        active = null;
        clearFrame();
        clearScrollFrame();
        if (current.pointerId !== null) swallowClick = true;
        host.released();
        host.publish(null);
        host.activeChanged?.(false);
        if (end !== null) host.ended?.(end, current.last);
        if (dropped !== null) host.commit(dropped, current.source);
        if (current.cursor === null || end === null) return;
        if (end.kind !== "cancelled") {
            // 提交引起的重渲染在下一帧之前完成，旧的来源元素这时已经换掉，还焦点才找得到留下来的那个。
            focusFrame = clock.requestFrame(() => {
                focusFrame = null;
                host.restoreFocus?.(current.source);
            });
        } else if (end.reason !== "focus-left" && end.reason !== "disposed") {
            host.restoreFocus?.(current.source);
        }
    }

    function cancel(reason: DragCancelReason): void {
        if (active === null) return;
        // 放下中的这一帧里浏览器已经随松手释放了捕获，这不是取消。
        if (active.dropping && reason === "capture-lost") return;
        finish({kind: "cancelled", reason}, null);
    }

    /** 判定一次；结构变了就取消整场并返回 undefined。 */
    function evaluate(current: Active<S, D, R>): D | null | undefined {
        if (current.structure !== null && host.structure?.() !== current.structure) {
            cancel("structure-changed");
            return undefined;
        }
        const {cursor} = current;
        return host.resolve({source: current.source, point: current.point, region: cursor === null ? null : (cursor.regions[cursor.region] ?? null)});
    }

    function publish(): void {
        clearFrame();
        const current = active;
        if (current === null) return;
        const drop = evaluate(current);
        if (drop === undefined) return;
        current.shown = drop;
        current.last = {source: current.source, point: current.point, drop, keyboard: current.cursor !== null};
        host.publish(current.last);
    }

    function schedule(): void {
        if (active !== null && frame === null) frame = clock.requestFrame(publish);
    }

    function withdraw(): void {
        const current = active;
        // 放下中不撤：边缘滚动最后一步的滚动事件在放下那一帧之前到，撤了这次放下就静默不写了。
        if (current === null || current.dropping) return;
        clearFrame();
        current.shown = null;
        current.last = {...current.last, drop: null};
        host.publish(current.last);
    }

    /** 放下：用此刻的坐标再判一次，不发布；与最后显示过的动作相同才提交。 */
    function drop(): void {
        const current = active;
        if (current === null) return;
        const final = evaluate(current);
        if (final === undefined) return;
        const key = final === null ? null : host.actionKey(final);
        const same = key !== null && current.shown !== null && host.actionKey(current.shown) === key;
        if (same) finish({kind: "committed"}, final);
        else finish({kind: "no-action"}, null);
    }

    function autoScrollTick(): void {
        scrollFrame = null;
        const current = active;
        const scroller = host.autoScroll;
        const step = current === null || scroller === undefined ? 0 : edgeScrollStep(scroller.rect(), current.point, scroller.edgePx, scroller.maxStepPx);
        if (current === null || scroller === undefined || step === 0) {
            autoScrolling = false;
            return;
        }
        // 先按上一帧滚动后渲染出的内容判，再滚这一帧：虚拟列表在滚动事件之后才补上新进视口的行，同一帧里判会落在空白上。
        publish();
        if (active !== current) return;
        autoScrolling = true;
        if (!scroller.scrollBy(step)) {
            autoScrolling = false;
            return;
        }
        scrollFrame = clock.requestFrame(autoScrollTick);
    }

    /** 指针进了边缘带就排上边缘滚动；已经在滚时不用排。 */
    function armAutoScroll(point: GridDropPoint): void {
        const scroller = host.autoScroll;
        if (active === null || scroller === undefined || scrollFrame !== null) return;
        if (edgeScrollStep(scroller.rect(), point, scroller.edgePx, scroller.maxStepPx) !== 0) scrollFrame = clock.requestFrame(autoScrollTick);
    }

    function begin(from: Armed<S>, point: GridDropPoint): void {
        if (from.timer !== null) clock.cancelDelay(from.timer);
        armed = null;
        if (host.activate !== undefined && !host.activate(from.source)) {
            host.disarmed();
            return;
        }
        start({pointerId: from.pointerId, cursor: null, source: from.source, point});
    }

    /** 进入拖动中；捕获取不到时取消并返回 null。键盘拖动的第一次发布由调用方在定好起点后做。 */
    function start(init: {readonly pointerId: number | null; readonly cursor: KeyboardCursor<R> | null; readonly source: S; readonly point: GridDropPoint}): Active<S, D, R> | null {
        const current: Active<S, D, R> = {
            ...init,
            structure: host.structure?.() ?? null,
            shown: null,
            last: {source: init.source, point: init.point, drop: null, keyboard: init.cursor !== null},
            dropping: false,
        };
        active = current;
        host.activeChanged?.(true);
        if (!host.grabbed(init.pointerId)) {
            cancel("capture-lost");
            return null;
        }
        if (init.cursor === null) publish();
        return current;
    }

    /** 键盘拖动移到第 `region` 个区域的第 `stop` 个位置（夹在范围内），立即发布。 */
    function moveCursor(current: Active<S, D, R>, cursor: KeyboardCursor<R>, region: number, stop: number): void {
        const keyboard = host.keyboard;
        const target = cursor.regions[region];
        if (keyboard === undefined || target === undefined) return;
        const {points} = keyboard.stops(target);
        if (points.length === 0) return;
        cursor.region = region;
        cursor.stop = Math.max(0, Math.min(stop, points.length - 1));
        current.point = points[cursor.stop] as GridDropPoint;
        publish();
    }

    return {
        get idle() {
            return armed === null && active === null;
        },
        get keyboard() {
            return active?.cursor != null;
        },
        pressed() {
            swallowClick = false;
        },
        press(input) {
            if (armed !== null || active !== null) return;
            const next: Armed<S> = {pointerId: input.pointerId, touch: input.pointerType === "touch", start: input.point, latest: input.point, source: input.source, timer: null};
            armed = next;
            if (next.touch) next.timer = clock.delay(() => begin(next, next.latest), config.touchDelayMs);
            host.armed();
        },
        move(pointerId, point, buttons) {
            const from = armed;
            if (from !== null && pointerId === from.pointerId) {
                // 没有按键的移动：松手事件丢了（松手在别的窗口或原生菜单上），这次按下已经结束。
                if (buttons === 0) {
                    disarm();
                    return;
                }
                const moved = Math.hypot(point.x - from.start.x, point.y - from.start.y);
                if (from.touch) {
                    if (moved > config.touchTolerancePx) disarm();
                    else from.latest = point;
                } else if (moved >= config.distancePx) {
                    begin(from, point);
                    // 拿起时已经发布过这个坐标，不用再排一帧；但这一下可能已经在边缘上，边缘滚动要从这里开始。
                    armAutoScroll(point);
                }
                return;
            }
            const current = active;
            // 放下中的这一帧不再跟指针：要按松手的坐标放下。
            if (current === null || current.dropping || pointerId !== current.pointerId) return;
            current.point = point;
            schedule();
            armAutoScroll(point);
        },
        release(pointerId, point) {
            if (armed !== null && pointerId === armed.pointerId) {
                disarm();
                return;
            }
            const current = active;
            if (current === null || current.dropping || pointerId !== current.pointerId) return;
            clearFrame();
            current.point = point;
            if (!autoScrolling) {
                drop();
                return;
            }
            // 边缘滚动中松手：显示的落点是上一帧滚动之前判的，这一刻指针下的行可能已经换了。先停滚，等下一帧内容按最后的
            // 滚动位置渲染完，发布一次让用户看到，再按同一个落点放下，不让这次放下因为“与显示的不同”而静默不写。
            clearScrollFrame();
            current.dropping = true;
            swallowClick = true;
            frame = clock.requestFrame(() => {
                frame = null;
                if (active !== current) return;
                publish();
                drop();
            });
        },
        pointerCancel(pointerId) {
            if (armed !== null && pointerId === armed.pointerId) disarm();
            else if (active !== null && pointerId === active.pointerId) cancel("pointer-cancel");
        },
        cancel,
        scrolled() {
            if (active === null || autoScrolling) return;
            if (host.scroll === "withdraw") withdraw();
            else schedule();
        },
        resized: schedule,
        invalidate: withdraw,
        abort() {
            disarm();
            finish(null, null);
        },
        startKeyboard(source) {
            const keyboard = host.keyboard;
            if (keyboard === undefined || armed !== null || active !== null) return false;
            if (host.activate !== undefined && !host.activate(source)) return false;
            const regions = keyboard.regions(source);
            if (regions.length === 0) return false;
            const cursor: KeyboardCursor<R> = {regions, region: 0, stop: 0};
            const current = start({pointerId: null, cursor, source, point: {x: 0, y: 0}});
            if (current === null) return true;
            const {region, at} = keyboard.start(source, regions);
            cursor.region = region;
            if (typeof at === "number") {
                moveCursor(current, cursor, region, at);
            } else {
                // 来源不在任何停靠位上：停在它自己的坐标，直接 Enter 不移动。
                cursor.stop = -1;
                current.point = at;
                publish();
            }
            return true;
        },
        key({key, shift}) {
            const current = active;
            if (current === null || !SESSION_KEYS.has(key)) return false;
            if (key === "Escape") {
                cancel("escape");
                return true;
            }
            const cursor = current.cursor;
            if (cursor === null) return true;
            if (key === "Enter") {
                drop();
            } else if (key === "Tab") {
                const count = cursor.regions.length;
                moveCursor(current, cursor, (cursor.region + (shift ? count - 1 : 1)) % count, 0);
            } else {
                const target = cursor.regions[cursor.region];
                const step = target === undefined || host.keyboard === undefined ? 0 : stepOf(key, host.keyboard.stops(target).axis);
                if (step !== 0) moveCursor(current, cursor, cursor.region, cursor.stop + step);
            }
            return true;
        },
        takeClick(detail) {
            if (!swallowClick || detail === 0) return false;
            swallowClick = false;
            return true;
        },
        dispose() {
            disarm();
            cancel("disposed");
            if (focusFrame !== null) clock.cancelFrame(focusFrame);
            focusFrame = null;
        },
    };
}

declare const dropKindData: unique symbol;

/** 一种来源能落到哪些元素的约定：提供方定义、双方共用。类型参数是落点登记时给出的数据。 */
export interface DropKind<T> {
    readonly id: string;
    readonly [dropKindData]?: T;
}

/** 放在核心入口：`shared/` 里的合同要能定义它，又不把 Vue 层带进来。 */
export function defineDropKind<T>(id: string): DropKind<T> {
    return {id};
}
