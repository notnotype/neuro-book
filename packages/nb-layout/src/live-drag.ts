/**
 * 实时布局的编排（Spec `ui/layout-drag` 的“实时布局的编排”）：拖动中把判定出来的候选变成预览，管什么时候换预览、什么时候收起与展开来源、
 * 判定用哪份几何、什么时候拿起与收回卡片，以及一帧里各步的先后。落点、预览长什么样、几何怎么量都由宿主给；引擎只读宿主对落点的描述（`LiveDropFacts`）。
 *
 * 纯 TS，不碰 DOM 与 Vue：帧调度、指针、判定都经宿主的回调。公开的入口是 `./vue` 的 `createLiveDragSession`，它把会话与网格接好；
 * 这里的 `createLiveDrag` 不从包入口导出。
 *
 * 一帧的顺序固定：容器跟手先读（帧开头样式是干净的，读不强制重算）→ 让会话做完这一帧的判定（读 DOM，可能结束这一场）→ 写容器跟手 →
 * 取指针 → 换预览 → 写卡片；预览或卡片变了，渲染之后再放一次容器跟手。写在读前面的话，判定里的 `elementsFromPoint` 每帧要强制重算一次样式。
 * 帧循环按需排：指针动了、预览换了、卡片还没到、候选还没等够稳定、在容器里跟手，任一成立就排下一帧，都不成立就停（按住不动时不空转）。
 *
 * 判定的几何：拿起后第一帧开头量一份（帧回调晚于框架的渲染刷新，这一场的渲染已经做完）；来源第一次落到别处时收起，之后按宿主算的收起后的几何判；
 * 回到原处时展开，换回拿起时的那份。收起、展开（几何换了）那一刻起指针没动，宿主的判定沿用那一刻的结论（`unmoved`）。
 */

import {createDragCard} from "./drag-card";
import type {DragCard, DragCardSize} from "./drag-card";
import {createFrameLoop} from "./frame-loop";
import type {GridDropPoint, GridDropRect} from "./grid-drop";
import type {GridRect} from "./grid-rects";
import {initialLiveDrop, insideShownSlot, stepLiveDrop} from "./live-drop";
import type {LiveDropCandidate, LiveDropState, LivePreview} from "./live-drop";

/** 卡片缺省缩到这么大（和来源那块取较小者）。 */
const CARD_COMPACT: DragCardSize = {width: 380, height: 260};

/**
 * 宿主对一个落点的描述：引擎只读这几样，落点本身原样传回宿主。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveDropFacts {
    /** 摆出来一样的落点同一个键。 */
    readonly key: string;
    /** 放下去是原样。 */
    readonly inPlace: boolean;
    /** 落在这里还没离开来源：不收起来源。 */
    readonly home: boolean;
    /** 长出新块时的空位（视口坐标），指针在里面候选不变；并入没有空位。 */
    readonly slotOnScreen: GridDropRect | null;
    /** 落进哪个吸收来源的容器（标签条、入口条）：卡片收回、来源在容器里跟手。只有工作台验证过；不给就是 null。 */
    readonly container?: string | null;
}

/**
 * 要摆的预览：按落点、来源收起的样子，或没有预览（已提交的样子）。
 * @experimental 1.0 之前签名会变。
 */
export type LiveShowTarget<D> = {readonly kind: "drop"; readonly drop: D} | {readonly kind: "source-removed"} | null;

/**
 * 容器里跟手的位置：指针与吸收它的容器。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveFollowAt {
    readonly point: GridDropPoint;
    readonly container: string;
}

/**
 * 宿主要写的那份：领域判断。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveDragHost<S, D, G> {
    facts(source: S, drop: D): LiveDropFacts;
    /**
     * 摆预览。按 `target` 摆出来了返回真；摆不出来返回假，并且宿主自己摆兜底：来源收起着摆来源收起的样子，没收起摆已提交的样子。
     * 走了兜底也返回假。引擎先收起或展开来源，再调这里；`collapsed` 是此刻来源收起着。
     */
    show(target: LiveShowTarget<D>, context: {readonly source: S; readonly collapsed: boolean}): boolean;
    /** 判定的几何：拿起后第一帧开头量一次。 */
    measure(source: S): G;
    /** 来源收起后的几何；null 是收起不改几何（收起失败，或收起来源不影响判定），引擎照旧用 `before`，也不开始 `unmoved`。 */
    collapsed(source: S, before: G): G | null;
    /** 来源那块摘掉它还在：要卡片时马上收起来源（撕下）。只有工作台验证过；不给就是不撕下。一场只问一次。 */
    staysWithoutSource?(source: S): boolean;
    card: {
        /** 卡片里放哪个内容项（`NestedGrid` 的 `lifted.key`）。 */
        readonly key: (source: S) => string;
        /** 某块的矩形（视口坐标）：`container` 为 null 是来源那块，否则是吸收过它的那块；量不到为 null。读传进来的这一刻判定的几何（收起后就是收起后的那份），不读 DOM。 */
        readonly rect: (source: S, container: string | null, geometry: G) => GridDropRect | null;
        /** 缩到多大（再不大于来源那块），缺省 380×260。 */
        readonly compact?: DragCardSize;
        /** 指针还在来源那块里时保持来源那块的大小、离开才缩，缺省假（一拿起就缩）；来源那块量不到时一律缩。 */
        readonly keepSizeInsideHome?: () => boolean;
        /** 尺寸多久写一次（毫秒），缺省 0（每帧）。 */
        readonly refreshMs?: () => number;
    };
    /** 容器里跟手：先读后写。只有工作台验证过。 */
    follow?: {
        /** 只读，返回写的那一步：调用方在判定（也读 DOM）之后再写。null 是不在跟手，放回原位。 */
        readonly read: (at: LiveFollowAt | null) => () => void;
        /** 同上，等这一帧的渲染做完再放：预览或卡片刚变，按上一帧的状态放会错一帧。 */
        readonly afterRender: (at: LiveFollowAt | null) => void;
    };
}

/**
 * 由会话与网格接好的那几项（`createLiveDragSession` 给）。
 */
export interface LiveDragWiring {
    /** 让会话做完这一帧的判定；可能在里面结束这一场。 */
    judge(): void;
    pointer(): GridDropPoint | null;
    /** 网格根的左上角（视口坐标）：卡片与空位相对它。拿起时读一次。 */
    origin(): GridDropPoint;
    /** 写卡片的矩形（相对网格根）。 */
    place(rect: GridRect): void;
    changed?(state: LiveDragState): void;
    requestFrame(run: (now: number) => void): number;
    cancelFrame(frame: number): void;
}

/**
 * 可见的状态。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveDragState {
    readonly active: boolean;
    /** 此刻的预览：无、来源收起、候选的键。 */
    readonly preview: LivePreview;
    /** 按候选摆出来了（`show` 返回真）；原位、摆不出来为假。 */
    readonly previewed: boolean;
    /** 来源此刻收起着。 */
    readonly collapsed: boolean;
    /** 拿起的内容项；被容器吸收、没拿起时为 null。 */
    readonly lifted: {readonly key: string} | null;
    /** 已显示的空位，相对网格根。 */
    readonly slotInGrid: GridRect | null;
}

/**
 * 一场实时布局。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveDrag<S, D, G> {
    state(): LiveDragState;
    begin(source: S, point: GridDropPoint | null): void;
    /** 这一刻判定的落点。帧循环停着时排一帧。 */
    offer(drop: D | null): void;
    /** 有新的指针样本：帧循环停着时排一帧。 */
    wake(): void;
    /** 拿起后量到之前为 null：宿主这次判定现量一份传下去、不存。每次换几何身份都变，宿主的预览缓存按身份作废。 */
    geometry(): G | null;
    /** 来源收起或展开（几何换了）那一刻起指针没动：宿主沿用自己那一刻的判定。第一次不等就清掉。 */
    unmoved(point: GridDropPoint): boolean;
    /** 指针在已显示的空位里（含边距）：候选不变，返回它。 */
    sticky(point: GridDropPoint): D | null;
    /** 此刻按候选摆出来的落点（`previewed` 为真时的那个）。 */
    previewedDrop(): D | null;
    end(): void;
}

const IDLE_STATE: LiveDragState = {active: false, preview: {kind: "none"}, previewed: false, collapsed: false, lifted: null, slotInGrid: null};

const samePoint = (a: GridDropPoint, b: GridDropPoint): boolean => a.x === b.x && a.y === b.y;
const sameRect = (a: GridRect | null, b: GridRect | null): boolean => a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
const samePreview = (a: LivePreview, b: LivePreview): boolean => a.kind === b.kind && (a.kind !== "candidate" || (b.kind === "candidate" && a.key === b.key));
const sameState = (a: LiveDragState, b: LiveDragState): boolean =>
    a.active === b.active && a.previewed === b.previewed && a.collapsed === b.collapsed && a.lifted?.key === b.lifted?.key && samePreview(a.preview, b.preview) && sameRect(a.slotInGrid, b.slotInGrid);
const inside = (rect: GridDropRect, point: GridDropPoint): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;

/** 一场的状态：拿起时新建，收场换成空闲的一份。 */
interface LiveRun<S, D, G> {
    readonly source: S;
    pointer: GridDropPoint | null;
    readonly origin: GridDropPoint;
    /** 判定的几何；拿起后第一帧开头量。 */
    geometry: G | null;
    /** 收起前的几何：展开时换回它。不为 null 就是几何因收起换过。 */
    beforeCollapse: G | null;
    /** 收起或展开、几何换了那一刻的指针；指针第一次不等就清掉。 */
    unmovedAt: GridDropPoint | null;
    collapsed: boolean;
    /** 已经吸收来源的容器：预览摆着它（或它本来就在那里）。 */
    absorbedIn: string | null;
    /** 来源那块的矩形：第一次要卡片时问，之后不变。undefined 是还没问。 */
    homeRect: GridDropRect | null | undefined;
    /** 来源那块摘掉它还在不在：第一次要时问一次。 */
    stays: boolean | undefined;
    card: DragCard | null;
    lifted: {readonly key: string} | null;
    live: LiveDropState;
    started: boolean;
    /** 这一刻的候选与它的描述（`offer` 时算一次）。 */
    offered: {readonly drop: D; readonly facts: LiveDropFacts} | null;
    /** 换预览那一刻的候选（空位粘住用）。 */
    shown: D | null;
    /** 按候选摆出来了的落点。 */
    previewed: D | null;
    slotInGrid: GridRect | null;
}

export function createLiveDrag<S, D, G>(host: LiveDragHost<S, D, G>, wiring: LiveDragWiring): LiveDrag<S, D, G> {
    let run: LiveRun<S, D, G> | null = null;
    let published: LiveDragState = IDLE_STATE;
    const loop = createFrameLoop({requestFrame: (frame) => wiring.requestFrame(frame), cancelFrame: (frame) => wiring.cancelFrame(frame), frame: (now, elapsed) => tick(now, elapsed)});

    function snapshot(): LiveDragState {
        if (run === null) return IDLE_STATE;
        return {active: true, preview: run.live.preview, previewed: run.previewed !== null, collapsed: run.collapsed, lifted: run.lifted, slotInGrid: run.slotInGrid};
    }
    function publish(): void {
        const next = snapshot();
        if (sameState(next, published)) return;
        published = next;
        wiring.changed?.(next);
    }

    const containerOf = (facts: LiveDropFacts): string | null => facts.container ?? null;

    function candidateOf(current: LiveRun<S, D, G>, facts: LiveDropFacts): LiveDropCandidate {
        const container = containerOf(facts);
        // 自己的容器、已经吸收它的那个要跟手；第一次进别的容器和别的落点一样等稳定：路过不闪。
        const immediate = container !== null && (facts.home || container === current.absorbedIn);
        return {key: facts.key, immediate, slot: facts.inPlace ? null : facts.slotOnScreen};
    }

    /** 不要卡片：候选在容器里，并且是容器里的原位或已经被这个容器吸收。别的时候都拿着卡片，原位也是。 */
    function wantsCard(current: LiveRun<S, D, G>): boolean {
        if (current.offered === null) return true;
        const container = containerOf(current.offered.facts);
        return container === null || !(current.offered.facts.inPlace || container === current.absorbedIn);
    }

    function followAt(current: LiveRun<S, D, G>): LiveFollowAt | null {
        if (current.pointer === null || current.offered === null || wantsCard(current)) return null;
        const container = containerOf(current.offered.facts);
        return container === null ? null : {point: current.pointer, container};
    }

    /** 收起来源；几何换了才开始 `unmoved`。 */
    function collapse(current: LiveRun<S, D, G>): void {
        current.collapsed = true;
        if (current.geometry === null) return;
        const next = host.collapsed(current.source, current.geometry);
        if (next === null) return;
        current.beforeCollapse = current.geometry;
        current.geometry = next;
        current.unmovedAt = current.pointer;
    }

    function expand(current: LiveRun<S, D, G>): void {
        current.collapsed = false;
        if (current.beforeCollapse === null) return;
        current.geometry = current.beforeCollapse;
        current.beforeCollapse = null;
        current.unmovedAt = current.pointer;
    }

    function showSourceRemoved(current: LiveRun<S, D, G>): void {
        current.shown = null;
        current.previewed = null;
        current.absorbedIn = null;
        host.show({kind: "source-removed"}, {source: current.source, collapsed: current.collapsed});
    }

    function slotRect(current: LiveRun<S, D, G>): GridRect | null {
        const {slot} = current.live;
        return slot === null ? null : {x: slot.left - current.origin.x, y: slot.top - current.origin.y, width: slot.right - slot.left, height: slot.bottom - slot.top};
    }

    /** 候选稳定了就换预览；换了返回真。 */
    function stepPreview(current: LiveRun<S, D, G>, now: number): boolean {
        if (!current.started) {
            current.started = true;
            current.live = initialLiveDrop(now);
        }
        const before = current.live.preview;
        const {offered} = current;
        current.live = stepLiveDrop(current.live, {now, candidate: offered === null ? null : candidateOf(current, offered.facts)});
        if (current.live.preview === before) return tearOff(current);
        const {preview} = current.live;
        // 落到别处才收起来源：自己的位置、放回原处都还没离开。
        const elsewhere = preview.kind === "source-removed" || (preview.kind === "candidate" && offered !== null && !offered.facts.inPlace && !offered.facts.home);
        if (elsewhere && !current.collapsed) collapse(current);
        // 回到原处（放下去是原样）：来源展开回原位，判定换回拿起时的几何。
        if (current.collapsed && preview.kind === "candidate" && offered !== null && offered.facts.inPlace) expand(current);
        if (preview.kind === "candidate" && offered !== null) {
            current.shown = offered.drop;
            const laid = host.show({kind: "drop", drop: offered.drop}, {source: current.source, collapsed: current.collapsed});
            current.previewed = laid ? offered.drop : null;
            current.absorbedIn = offered.facts.inPlace || laid ? containerOf(offered.facts) : null;
        } else if (preview.kind === "source-removed") {
            showSourceRemoved(current);
        }
        current.slotInGrid = slotRect(current);
        return true;
    }

    /**
     * 撕下：要拿起卡片、来源那块摘掉它还在时，马上收起来源，那一块接着显示下一个（不等第一个落点稳定：这段时间里内容在卡片上，正文是空的）。
     * 摘掉它那块就没了的，照旧等第一个落点。
     */
    function tearOff(current: LiveRun<S, D, G>): boolean {
        if (current.collapsed || !wantsCard(current) || host.staysWithoutSource === undefined) return false;
        current.stays ??= host.staysWithoutSource(current.source);
        if (!current.stays) return false;
        collapse(current);
        current.live = {...current.live, preview: {kind: "source-removed"}, slot: null};
        current.slotInGrid = null;
        showSourceRemoved(current);
        return true;
    }

    /** 写这一帧的卡片；返回卡片的尺寸或追赶还没到终点（还要下一帧）。 */
    function updateCard(current: LiveRun<S, D, G>, geometry: G, now: number, elapsed: number): boolean {
        const {pointer} = current;
        if (pointer === null || !wantsCard(current)) {
            current.lifted = null;
            current.card = null;
            return false;
        }
        if (current.homeRect === undefined) current.homeRect = host.card.rect(current.source, null, geometry);
        const home = current.homeRect;
        const limit = host.card.compact ?? CARD_COMPACT;
        const compact = {
            width: Math.min(limit.width, home === null ? limit.width : home.right - home.left),
            height: Math.min(limit.height, home === null ? limit.height : home.bottom - home.top),
        };
        // 撕下来：从此刻显示着它的那块开始缩；量不到就是缩好的大小。
        if (current.card === null) {
            const from = current.absorbedIn === null ? home : host.card.rect(current.source, current.absorbedIn, geometry);
            current.card = createDragCard(from, pointer, compact);
        }
        const keepSize = host.card.keepSizeInsideHome?.() === true && home !== null && inside(home, pointer);
        const target = keepSize ? {width: home.right - home.left, height: home.bottom - home.top} : compact;
        const {rect, settling} = current.card.step({now, elapsed, pointer, origin: current.origin, target, refreshMs: host.card.refreshMs?.() ?? 0});
        const key = host.card.key(current.source);
        if (current.lifted?.key !== key) current.lifted = {key};
        if (rect !== null) wiring.place(rect);
        return settling;
    }

    /** 候选等够稳定了：显示的就是此刻的候选。 */
    function settled(current: LiveRun<S, D, G>): boolean {
        const shownKey = current.live.preview.kind === "candidate" ? current.live.preview.key : null;
        return current.live.candidate === shownKey;
    }

    /** 跑一帧；返回要不要下一帧。 */
    function tick(now: number, elapsed: number): boolean {
        const current = run;
        if (current === null) return false;
        current.geometry ??= host.measure(current.source);
        const placeFollow = host.follow?.read(followAt(current));
        wiring.judge();
        // 判定时结构变了会结束这一场。
        if (run !== current) return false;
        placeFollow?.();
        const sample = wiring.pointer();
        const moved = sample !== null && (current.pointer === null || !samePoint(sample, current.pointer));
        current.pointer = sample ?? current.pointer;
        const lifted = current.lifted !== null;
        const changed = stepPreview(current, now);
        const settling = updateCard(current, current.geometry, now, elapsed);
        // 先交出状态（宿主在这里写响应式，排上渲染），再排“渲染之后放跟手的”：反过来时这一帧若只有卡片拿起或收回，渲染还没排上，宿主等到的是渲染之前。
        publish();
        if (changed || lifted !== (current.lifted !== null)) host.follow?.afterRender(followAt(current));
        return moved || changed || settling || !settled(current) || followAt(current) !== null;
    }

    return {
        state: () => published,
        begin: (source, point) => {
            run = {
                source,
                pointer: point,
                origin: wiring.origin(),
                geometry: null,
                beforeCollapse: null,
                unmovedAt: null,
                collapsed: false,
                absorbedIn: null,
                homeRect: undefined,
                stays: undefined,
                card: null,
                lifted: null,
                live: initialLiveDrop(0),
                started: false,
                offered: null,
                shown: null,
                previewed: null,
                slotInGrid: null,
            };
            publish();
            loop.start();
        },
        offer: (drop) => {
            const current = run;
            if (current === null) return;
            current.offered = drop === null ? null : {drop, facts: host.facts(current.source, drop)};
            loop.wake();
        },
        wake: () => {
            if (run !== null) loop.wake();
        },
        geometry: () => run?.geometry ?? null,
        unmoved: (point) => {
            const current = run;
            if (current === null || current.unmovedAt === null) return false;
            if (samePoint(current.unmovedAt, point)) return true;
            current.unmovedAt = null;
            return false;
        },
        sticky: (point) => (run !== null && insideShownSlot(run.live, point) ? run.shown : null),
        previewedDrop: () => run?.previewed ?? null,
        end: () => {
            const current = run;
            if (current === null) return;
            loop.stop();
            // 先放回跟手的，再撤预览：放回要读宿主这一场的状态。
            host.follow?.read(null)();
            run = null;
            host.show(null, {source: current.source, collapsed: false});
            publish();
        },
    };
}
