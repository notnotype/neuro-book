/**
 * 外框的过渡（docs/specs/ui/nested-grid.md 输出 35）：布局变了之后决定要不要滑过去。
 *
 * 判定按结果，不只看来源：矩形没变就什么都不做；变了再排除手势与容器尺寸。容器尺寸有两个来源，晚一拍到：宿主用自己的
 * `ResizeObserver` 量完先发布布局，这个 grid 自己的实测盒下一个回调才变，中间 Vue 会刷新一次。所以两个都要比，只比一个的话，第二拍
 * 会被当成程序变化，每次改窗口高度都滑一下。
 */

import {nextTick, onBeforeUnmount, ref, shallowRef} from "vue";
import type {Ref} from "vue";

import {dockedLeaves, enteringRects, floatLiftStarts, flyingContents, followingLeaves, keptSizeStarts, leavingContents, leavingPlacements, placementMoved, releaseStarts, rightAnchored, shrinkingLeaves, zeroLeaves} from "../grid-motion";
import type {GridContentPlacement, GridLayerItem, GridPlacementItem, GridRect} from "../grid-rects";
import {planSwap, swapTouchesBand} from "../grid-swap";
import type {GridSwap, GridSwapBand} from "../grid-swap";
import type {GridExtent, GridIssue} from "../grid-types";
import {layoutMotionMs} from "./layout-motion";

/** 计时比过渡长一点：过渡要到下一次样式计算才开始，定时器先到的话最后一帧会跳到终点。 */
const MOTION_SLACK_MS = 50;

export interface GridMotionFrame {
    readonly items: ReadonlyArray<GridLayerItem<unknown>>;
    /** 上一次的项；第一次没有。 */
    readonly previous: ReadonlyArray<GridLayerItem<unknown>> | null;
    /** 宿主算布局用的根尺寸；空布局（还没量到）为 null。 */
    readonly rootSize: GridExtent | null;
    /** 这个 grid 自己量到的容器。 */
    readonly extent: GridExtent;
    readonly dpr: number;
    /** 手势预览进行中。 */
    readonly previewing: boolean;
    /** 有拿起的内容（实时布局拖动中）：离开的叶不留。 */
    readonly holding?: boolean;
    /** 这一次布局变化要按交换走（`token` 刚变的那一次，由 `NestedGrid` 判）。 */
    readonly swap?: GridSwap | null;
    /** 进行中的交换，与带上每组此刻的偏移（下标同 `band.groups`，`update` 从 DOM 读）。 */
    readonly band?: GridSwapBand | null;
    readonly bandNow?: ReadonlyArray<number>;
    /** 正在别的过渡里的叶（节点 id）：长出来、缩回去的。 */
    readonly busy?: ReadonlySet<string>;
    /** 刚放开的浮动窗（id 到松手时的偏移，`releaseStarts`）：由 `NestedGrid` 的 `placeFloat(id, null)` 记下，下一帧之前的一次判定用，用完即清。 */
    readonly released?: ReadonlyMap<string, {readonly x: number; readonly y: number}>;
}

/** 上一次判定时记下的事实：判容器尺寸、缩放与手势收尾要比它。 */
export interface GridMotionMemory {
    rootSize: GridExtent | null;
    extent: GridExtent | null;
    dpr: number | null;
    previewing: boolean;
}

export const EMPTY_GRID_MOTION_MEMORY = (): GridMotionMemory => ({rootSize: null, extent: null, dpr: null, previewing: false});

export type GridMotionDecision =
    /** 不过渡：没变、手势引起的、第一次。 */
    | {readonly kind: "none"}
    /** 容器尺寸或缩放变了：进行中的过渡直接到终点。 */
    | {readonly kind: "stop"}
    | GridMotionMove;

/** 要过渡：第一帧的矩形（新项与内容不跟外框的叶）、内容跟外框的项、压在上面飞的项、留着缩回去的叶、内容不跟外框的叶、内容贴外框右边的项、降到零的叶与此刻为零的叶。 */
export interface GridMotionMove {
    readonly kind: "move";
    readonly entering: ReadonlyMap<string, GridRect>;
    readonly following: ReadonlySet<string>;
    readonly flying: ReadonlySet<string>;
    readonly leaving: ReadonlyArray<GridLeavingItem>;
    readonly keptSize: ReadonlySet<string>;
    readonly rightAnchored: ReadonlySet<string>;
    /** 这一轮降到零的叶（节点 id，`shrinkingLeaves`）。 */
    readonly shrinking: ReadonlySet<string>;
    /** 这一轮从浮动窗回到树里的叶（外框的 `key`，`dockedLeaves`）。 */
    readonly docked: ReadonlySet<string>;
    /** 此刻为零的叶（节点 id）：上一轮在缩的叶仍在这里面的接着缩。 */
    readonly zero: ReadonlySet<string>;
    /** 宿主去掉、留到过渡结束的内容项（`leavingContents`），含上一轮留下、叶仍在缩回去的。 */
    readonly leavingContents: ReadonlyArray<GridContentPlacement>;
    /** 这一轮开始的交换（`planSwap`）：带上的几组。没有时进行中的交换照旧。 */
    readonly swap?: GridSwapBand;
    /** 给了交换但没用上的原因（这一轮照常过渡）。 */
    readonly swapSkipped?: GridIssue<"swap-skipped">;
    /**
     * 这一轮开始前先把进行中的过渡全部送到终点（`stop`）：新的交换和进行中的带不相交（`swapTouchesBand`）。这一轮按空带规划，
     * 上一轮留着滑出去的项不在 `leaving` 里。
     */
    readonly settleFirst?: true;
}

/** 在过渡里留着的离开的项：缩回去的叶（`leavingPlacements`），交换里滑出去的叶与分隔线（`planSwap`）。 */
export type GridLeavingItem = GridPlacementItem<unknown>;

/** 留着缩回去的叶、宿主已去掉而留着的内容项都不算布局的一部分（见 `decideMotion`）。 */
const withoutLeaving = (list: ReadonlyArray<GridLayerItem<unknown>>): ReadonlyArray<GridLayerItem<unknown>> => list.filter((item) => item.leaving !== true);

/** 根尺寸是子项加出来的（621.9999999999999 与 622），差一点舍入不算容器变了：算成变了，程序调整的过渡会直接跳到终点。 */
const EXTENT_TOLERANCE_PX = 0.5;

const sameExtent = (left: GridExtent, right: GridExtent): boolean => Math.abs(left.width - right.width) <= EXTENT_TOLERANCE_PX && Math.abs(left.height - right.height) <= EXTENT_TOLERANCE_PX;

const leafIds = (list: ReadonlyArray<GridLeavingItem>): string[] => list.flatMap((item) => (item.kind === "leaf" ? [item.node.id] : []));

/** 只留叶这一轮还在缩回去的内容项：留着缩回的离开的叶，或此刻为零的叶。 */
function withTheirLeaves(contents: ReadonlyArray<GridContentPlacement>, leaving: ReadonlyArray<GridLeavingItem>, zero: ReadonlySet<string>): GridContentPlacement[] {
    const outgoing = new Set([...leafIds(leaving), ...zero]);
    return contents.filter((item) => outgoing.has(item.leaf));
}

/**
 * 要不要过渡（纯函数，改 `memory`）。来源是数据：预览进行中，或上一次还在预览中（松手、取消、被拒撤下预览的那一次），都算手势引起的。
 * 不靠谁先调了什么、watcher 谁先建。
 */
export function decideMotion(input: GridMotionFrame, memory: GridMotionMemory): GridMotionDecision {
    // 留着缩回去的叶不算布局的一部分：加上、摘掉它们各引起一次判定，算进去就是两次布局变化，摘掉时又判成离开，停不下来。
    const frame = {...input, items: withoutLeaving(input.items), previous: input.previous === null ? null : withoutLeaving(input.previous)};
    const gesture = frame.previewing || memory.previewing;
    // 第一次有真实布局：之前的矩形都是 0，不算移动。
    const first = memory.rootSize === null;
    const resized = (memory.rootSize !== null && frame.rootSize !== null && !sameExtent(memory.rootSize, frame.rootSize))
        || (memory.extent !== null && !sameExtent(memory.extent, frame.extent));
    const rescaled = memory.dpr !== null && memory.dpr !== frame.dpr;
    if (frame.rootSize !== null) memory.rootSize = {...frame.rootSize};
    memory.extent = {...frame.extent};
    memory.dpr = frame.dpr;
    memory.previewing = frame.previewing;
    if (resized || rescaled) return {kind: "stop"};
    if (first || gesture || frame.previous === null || frame.previous.length === 0) return {kind: "none"};
    if (!placementMoved(frame.items, frame.previous)) return {kind: "none"};
    // 新开的浮动窗从内容原来的叶出发：在 `enteringRects` 之后并进去，挨着的分隔线不拿它当起点。它跟外框，头逐帧重排，不按最终尺寸裁。
    const lifts = frame.holding === true ? new Map<string, GridRect>() : floatLiftStarts(frame.items, frame.previous);
    const entering = new Map([...enteringRects(frame.items, frame.previous), ...lifts]);
    const following = new Set([...followingLeaves(frame.items, frame.previous), ...lifts.keys()]);
    const flying = flyingContents(frame.items, frame.previous);
    const leaving = leavingPlacements(frame.items, frame.previous, frame.holding === true);
    const kept = keptSizeStarts({items: frame.items, previous: frame.previous, entering, following, leaving});
    // 刚放开的窗从松手处出发（输出 172）：最后并进起点，在 `kept` 之后，不影响跟外框与保持尺寸的判定。
    const released = frame.released === undefined ? new Map<string, GridRect>() : releaseStarts(frame.items, frame.previous, frame.released);
    // 上一轮还在缩回去的叶（`input.items` 里带 `leaving` 的）：这一轮又有别的变化时接着留着缩完，不然它缩到一半就没了。回到树里的、这一轮重新判成离开的不算。
    const present = new Set([...frame.items, ...leaving].map((item) => item.key));
    const still = input.items.filter((item): item is GridLeavingItem => item.kind !== "content" && item.leaving === true && !present.has(item.key));
    const shrinking = shrinkingLeaves(frame.items, frame.previous);
    const zero = zeroLeaves(frame.items);
    // 留着的内容项跟着它的叶（输出 155）：叶这一轮新判成缩回去的，新去掉的内容项留下（拖动中不留）；上一轮留下的接着留，宿主又加回来的不算。
    // 两样最后都按这一轮最终留着的叶过滤（`withTheirLeaves`），叶与内容要么一起留、要么一起摘。
    const fresh = leavingContents(frame.items, frame.previous, new Set([...leafIds(leaving), ...shrinking]), frame.holding === true);
    const freshKeys = new Set(fresh.map((item) => item.key));
    const stillContents = input.items.filter((item): item is GridContentPlacement => item.kind === "content" && item.leaving === true && !present.has(item.key) && !freshKeys.has(item.key));
    const move: GridMotionMove = {
        kind: "move",
        entering: new Map([...entering, ...kept, ...released]),
        following,
        flying,
        leaving: [...still, ...leaving],
        keptSize: new Set(kept.keys()),
        rightAnchored: rightAnchored({items: frame.items, leaving, starts: kept, following, flying}),
        shrinking,
        docked: dockedLeaves(frame.items, frame.previous),
        zero,
        leavingContents: withTheirLeaves([...stillContents, ...fresh], [...still, ...leaving], zero),
    };
    if (input.swap == null || frame.holding === true) return move;
    // 同时只有一条带：别处的另一次交换先把进行中的送到终点，这一轮当作静止时开始（docs/specs/ui/nested-grid.md 输出 73）。
    const settle = input.band != null && !swapTouchesBand(input.swap, input.band);
    const plan = settle
        ? planSwap({swap: input.swap, items: frame.items, previous: frame.previous, band: null, now: [], busy: new Set()})
        : planSwap({swap: input.swap, items: frame.items, previous: frame.previous, band: input.band ?? null, now: input.bandNow ?? [], busy: input.busy ?? new Set()});
    if (plan.kind === "skip") return {...move, swapSkipped: plan.issue};
    // 带上的项整块平移，不按别的规则长、缩、跟外框；进行中的交换里留着的项换成这一轮的终点，被摘掉的组一起去掉。
    const banded = new Set([...plan.starts.keys(), ...(settle ? [] : input.band?.groups ?? []).flatMap((group) => group.home.map((item) => item.key))]);
    const without = (keys: ReadonlySet<string>): ReadonlySet<string> => new Set([...keys].filter((key) => !banded.has(key)));
    return {
        ...move,
        entering: new Map([...[...move.entering].filter(([key]) => !banded.has(key)), ...plan.starts]),
        following: without(move.following),
        flying: without(move.flying),
        keptSize: without(move.keptSize),
        rightAnchored: without(move.rightAnchored),
        leaving: [...(settle ? leaving : move.leaving).filter((item) => !banded.has(item.key)), ...plan.leaving],
        // 先送到终点时（`settle`）上一轮的叶不留，它们的内容也不留。交换里滑出去的叶不会带着内容：兄弟没有合拢，`leavingPlacements` 不判它们离开，
        // 上一帧带 `leaving` 的项也进不了交换的候选（输出 155）。
        leavingContents: withTheirLeaves(move.leavingContents, [...(settle ? leaving : move.leaving).filter((item) => !banded.has(item.key))], zero),
        swap: plan.band,
        ...(settle ? {settleFirst: true as const} : {}),
    };
}

export function useGridMotion(options: {
    readonly root: Readonly<Ref<HTMLElement | null>>;
    readonly onSettled: () => void;
    /** 给了交换但没用上（这一轮照常过渡）：原因交给宿主记诊断。 */
    readonly onSwapSkipped?: (issue: GridIssue<"swap-skipped">) => void;
}) {
    const moving = ref(false);
    /** 新项第一帧的矩形；下一轮写终点，过渡才启动。 */
    const growing = shallowRef<ReadonlyMap<string, GridRect>>(new Map());
    /**
     * 回到树里、这一次渲染用着起点（在 `growing` 里）的浮动窗外框（`key`）：这一次照旧画成浮动窗，和 `growing` 同一刻清掉。
     * 用起点的那一次渲染不带过渡标记（`NestedGrid` 的 `structureMoving`），这时摘掉浮动窗的样子，投影与圆角就一下子没了（输出 110）；
     * 下一次写终点时带着标记摘，才随过渡淡去。松手的起点（`releaseStarts`）是这样的；框架按钮的停靠没有起点，同一次渲染里摘、带标记，不进这里。
     */
    const docking = shallowRef<ReadonlySet<string>>(new Set());
    /** 内容跟着外框逐帧变化的叶；只在过渡中有。 */
    const following = shallowRef<ReadonlySet<string>>(new Set());
    /** 正飞过别的面板的叶与内容项；只在过渡中有。 */
    const flying = shallowRef<ReadonlySet<string>>(new Set());
    /** 离开了、在这一轮过渡里留着缩回去的叶；过渡结束（`stop`）就摘掉。 */
    const leaving = shallowRef<ReadonlyArray<GridLeavingItem>>([]);
    /** 内容不跟外框的叶（`keptSizeStarts`）：它们的内容按叶的矩形摆；只在过渡中有。 */
    const keptSize = shallowRef<ReadonlySet<string>>(new Set());
    /** 内容贴外框右边的项（`rightAnchored`）；只在过渡中有。 */
    const anchoredRight = shallowRef<ReadonlySet<string>>(new Set());
    /** 落地的卡片下面还画着的内容项（`land` 的 `held`）：已经不活动、不可交互，过渡结束（`stop`）才隐藏。只在过渡中有。 */
    const held = shallowRef<ReadonlySet<string>>(new Set());
    /** 降到零的叶（节点 id，`shrinkingLeaves`）：停放、不可交互，过渡结束（`stop`）前头与内容还画着。只在过渡中有。 */
    const shrinking = shallowRef<ReadonlySet<string>>(new Set());
    /** 进行中的交换（docs/specs/ui/nested-grid.md 输出 70 到 73）：带上的几组；过渡结束（`stop`）就清掉。 */
    const band = shallowRef<GridSwapBand | null>(null);
    /** 宿主去掉、留到过渡结束的内容项（输出 155）；过渡结束（`stop`）就摘掉，内容这时才卸载。 */
    const leavingContentItems = shallowRef<ReadonlyArray<GridContentPlacement>>([]);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const memory = EMPTY_GRID_MOTION_MEMORY();
    /** 正落地的内容项：内容体一次到终点尺寸，不跟着外框。它从小卡的矩形出发，跟着走就是先压成小卡再逐帧长回去。 */
    const landing = new Set<string>();
    /** 这一轮是布局变化开始的：落地也会先把 `moving` 打开，那时还没有上一轮的名单可以继承。 */
    let inRound = false;

    /**
     * 摘掉过渡标记停不下进行中的过渡：`transition-property` 缺省是 all，还算匹配，过渡按开始时的时长走完，这期间量到的矩形都是中间值。这里直接走到终点，同步生效。
     * 只看网格根的直接子元素：内容里的动画不归这里管。
     */
    function finishTransitions(): void {
        for (const child of options.root.value?.children ?? []) {
            if (typeof child.getAnimations !== "function") continue;
            for (const animation of child.getAnimations()) if ("transitionProperty" in animation) animation.finish();
        }
    }

    function disarmTimer(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    /** 过渡的收尾：时长之外多等一小段，让浏览器自己的过渡先走完；每次重新计时，旧的作废。 */
    function armTimer(durationMs: number): void {
        disarmTimer();
        timer = setTimeout(stop, durationMs + MOTION_SLACK_MS);
    }

    /** 当前网格上的布局过渡时长；没挂上时是 0。 */
    function motionDuration(): number {
        const root = options.root.value;
        return root === null ? 0 : layoutMotionMs(root);
    }

    /** 先让第一帧的矩形进到样式里（强制一次布局），再清掉起点写终点：否则浏览器把两次改动并成一次，过渡不启动。 */
    function flushGrowingStart(): void {
        void nextTick(() => {
            void options.root.value?.offsetWidth;
            growing.value = new Map();
            docking.value = new Set();
        });
    }

    function stop(): void {
        disarmTimer();
        if (!moving.value) return;
        finishTransitions();
        moving.value = false;
        inRound = false;
        landing.clear();
        growing.value = new Map();
        docking.value = new Set();
        following.value = new Set();
        flying.value = new Set();
        leaving.value = [];
        keptSize.value = new Set();
        anchoredRight.value = new Set();
        held.value = new Set();
        shrinking.value = new Set();
        band.value = null;
        leavingContentItems.value = [];
        // 分隔线的对齐读 DOM：过渡开始时读到的是旧位置，结束再对齐一次。
        options.onSettled();
    }

    function start(durationMs: number, move: GridMotionMove): void {
        // 过渡中又来一次变化：上一轮保持最终尺寸的叶（新叶、从零出来的）继续保持，否则内容会被压到外框此刻的宽度，再跟着长回去。
        const follow = [...move.following].filter((key) => !landing.has(key));
        following.value = new Set(inRound ? follow.filter((key) => following.value.has(key)) : follow);
        // 继续保持最终尺寸的叶接着按叶的矩形摆、接着贴右边：这一轮它可能没动（不在这一轮的名单里），外框还在走上一轮的过渡。
        const carried = (list: ReadonlySet<string>): string[] => (inRound ? [...list].filter((key) => !following.value.has(key)) : []);
        keptSize.value = new Set([...carried(keptSize.value), ...move.keptSize]);
        anchoredRight.value = new Set([...carried(anchoredRight.value), ...move.rightAnchored]);
        // 上一轮在缩、这一轮仍为零的接着画到结束（外壳落账后的第二次发布也是一轮，不接着的话缩到一半就没了）；又长出来的不算。
        shrinking.value = new Set([...(inRound ? [...shrinking.value].filter((id) => move.zero.has(id)) : []), ...move.shrinking]);
        inRound = true;
        moving.value = true;
        flying.value = new Set([...(flying.value), ...move.flying]);
        // `move.leaving` 里有上一轮还没缩完的（`decideMotion` 接着留）；不在里面的是又回到了树里。
        leaving.value = move.leaving;
        leavingContentItems.value = move.leavingContents;
        if (move.swap !== undefined) band.value = move.swap;
        armTimer(durationMs);
        const entering = move.entering;
        if (entering.size === 0) return;
        // 过渡中又来一次变化时，已经画着的项的起点是上一帧的矩形，也就是上一轮的终点，正是它此刻在走的那次过渡的终点：样式写回这个值不打断那次过渡
        // （CSS 过渡里终点没变就接着走），下一帧写新终点时从此刻的位置反向，不跳。所以不用读 DOM 取当前位置；起点不再是上一轮的终点时这条就不成立了。
        // 交换是例外：起点是读到的此刻位置（`bandOffsets`），写起点的那一帧不带过渡标记，进行中的过渡就停在那里，下一帧整条带重新开始一段完整的过渡。
        growing.value = entering;
        docking.value = new Set([...move.docked].filter((key) => entering.has(key)));
        flushGrowingStart();
    }

    /**
     * 带上每组此刻的偏移：读它第一块叶的外框此刻的位置（过渡中的计算样式就是这一刻画着的值），减去它在原位的位置。只在交换进行中又来一次交换时读，
     * 平常的过渡不读 DOM。读不到（元素不在了）的按它这一轮的终点。
     */
    function bandOffsets(current: GridSwapBand): number[] {
        const children = [...(options.root.value?.children ?? [])] as HTMLElement[];
        return current.groups.map((group) => {
            const leaf = group.home.find((item) => item.kind === "leaf");
            const element = leaf?.kind === "leaf" ? children.find((child) => child.dataset.leaf === leaf.node.id) : undefined;
            if (leaf === undefined || element === undefined) return group.offset;
            const style = getComputedStyle(element);
            const position = Number.parseFloat(current.axis === "width" ? style.left : style.top);
            return Number.isFinite(position) ? position - (current.axis === "width" ? leaf.rect.x : leaf.rect.y) : group.offset;
        });
    }

    /** 正在别的过渡里的叶（长出来、缩回去，内容不跟外框的那些）：这时不交换。 */
    function busyLeaves(): ReadonlySet<string> {
        if (!moving.value) return new Set();
        return new Set([...[...keptSize.value].map((key) => key.replace(/^leaf:/, "")), ...shrinking.value]);
    }

    /** 布局变了（渲染之前调）。 */
    function update(frame: GridMotionFrame): void {
        const current = band.value;
        const decision = decideMotion(frame.swap == null ? frame : {...frame, band: current, bandNow: current === null ? [] : bandOffsets(current), busy: busyLeaves()}, memory);
        if (decision.kind === "stop") {
            stop();
            return;
        }
        if (decision.kind === "none") return;
        if (decision.swapSkipped !== undefined) options.onSwapSkipped?.(decision.swapSkipped);
        if (decision.settleFirst === true) stop();
        const duration = motionDuration();
        if (duration > 0) start(duration, decision);
        // 过渡中切到了减少动态效果：不开新一轮，进行中的直接到终点，留着缩回去的叶也摘掉（不然它和回到树里的同一块叶一起画）。
        else stop();
    }

    /**
     * 拿起的内容项落地：外框从卡片的矩形飞到叶的矩形（下一次渲染写终点，过渡这时启动）。`entering` 是同时出现的叶从哪里长出来（落进新浮动窗时是卡片的矩形），
     * 和新项一样先写第一帧、再写终点。`held` 是落进的叶里刚才还显示着的内容：卡片长满之前它还在下面，不然卡片四周是空的叶。
     */
    function land(key: string, entering?: ReadonlyMap<string, GridRect>, kept?: ReadonlySet<string>): void {
        const duration = motionDuration();
        if (duration <= 0) return;
        landing.add(key);
        if (kept !== undefined && kept.size > 0) held.value = new Set([...held.value, ...kept]);
        following.value = new Set([...following.value].filter((candidate) => candidate !== key));
        flying.value = new Set([...flying.value, key]);
        moving.value = true;
        armTimer(duration);
        if (entering === undefined || entering.size === 0) return;
        // 同一轮的布局变化可能刚写了别的新项的起点：并进去，不盖掉。
        growing.value = new Map([...growing.value, ...entering]);
        flushGrowingStart();
    }

    onBeforeUnmount(disarmTimer);

    return {
        moving,
        growing,
        docking,
        following,
        flying,
        leaving,
        keptSize,
        anchoredRight,
        held,
        shrinking,
        band,
        leavingContents: leavingContentItems,
        update,
        land,
        /** 过渡中开始手势：外框直接到终点，拖动没有拖尾。 */
        stop,
    };
}
