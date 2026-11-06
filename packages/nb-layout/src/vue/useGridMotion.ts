/**
 * 外框的过渡（docs/specs/ui/nested-grid.md 的“过渡”）：布局变了之后决定要不要滑过去。
 *
 * 判定按结果，不只看来源：矩形没变就什么都不做；变了再排除手势与容器尺寸。容器尺寸有两个来源，晚一拍到：宿主用自己的
 * `ResizeObserver` 量完先发布布局，这个 grid 自己的实测盒下一个回调才变，中间 Vue 会刷新一次。所以两个都要比，只比一个的话，第二拍
 * 会被当成程序变化，每次改窗口高度都滑一下。
 */

import {nextTick, onBeforeUnmount, ref, shallowRef} from "vue";
import type {Ref} from "vue";

import {enteringRects, flyingContents, followingLeaves, placementMoved} from "../grid-motion";
import type {GridLayerItem, GridRect} from "../grid-rects";
import type {GridExtent} from "../grid-types";
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
    | {readonly kind: "move"; readonly entering: ReadonlyMap<string, GridRect>; readonly following: ReadonlySet<string>; readonly flying: ReadonlySet<string>};

/** 根尺寸是子项加出来的（621.9999999999999 与 622），差一点舍入不算容器变了：算成变了，程序调整的过渡会直接跳到终点。 */
const EXTENT_TOLERANCE_PX = 0.5;

const sameExtent = (left: GridExtent, right: GridExtent): boolean => Math.abs(left.width - right.width) <= EXTENT_TOLERANCE_PX && Math.abs(left.height - right.height) <= EXTENT_TOLERANCE_PX;

/**
 * 要不要过渡（纯函数，改 `memory`）。来源是数据：预览进行中，或上一次还在预览中（松手、取消、被拒撤下预览的那一次），都算手势引起的。
 * 不靠谁先调了什么、watcher 谁先建。
 */
export function decideMotion(frame: GridMotionFrame, memory: GridMotionMemory): GridMotionDecision {
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
    return {kind: "move", entering: enteringRects(frame.items, frame.previous), following: followingLeaves(frame.items, frame.previous), flying: flyingContents(frame.items, frame.previous)};
}

export function useGridMotion(options: {readonly root: Readonly<Ref<HTMLElement | null>>; readonly onSettled: () => void}) {
    const moving = ref(false);
    /** 新项第一帧的矩形；下一轮写终点，过渡才启动。 */
    const growing = shallowRef<ReadonlyMap<string, GridRect>>(new Map());
    /** 内容跟着外框逐帧变化的叶；只在过渡中有。 */
    const following = shallowRef<ReadonlySet<string>>(new Set());
    /** 正飞过别的面板的叶与内容项；只在过渡中有。 */
    const flying = shallowRef<ReadonlySet<string>>(new Set());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const memory = EMPTY_GRID_MOTION_MEMORY();

    function stop(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (!moving.value) return;
        moving.value = false;
        growing.value = new Map();
        following.value = new Set();
        flying.value = new Set();
        // 分隔线的对齐读 DOM：过渡开始时读到的是旧位置，结束再对齐一次。
        options.onSettled();
    }

    function start(durationMs: number, entering: ReadonlyMap<string, GridRect>, nextFollowing: ReadonlySet<string>, nextFlying: ReadonlySet<string>): void {
        if (timer !== null) clearTimeout(timer);
        // 过渡中又来一次变化：上一轮保持最终尺寸的叶（新叶、从零出来的）继续保持，否则内容会被压到外框此刻的宽度，再跟着长回去。
        following.value = moving.value ? new Set([...nextFollowing].filter((key) => following.value.has(key))) : nextFollowing;
        moving.value = true;
        flying.value = new Set([...(flying.value), ...nextFlying]);
        timer = setTimeout(stop, durationMs + MOTION_SLACK_MS);
        if (entering.size === 0) return;
        growing.value = entering;
        // 先让第一帧的矩形进到样式里（强制一次布局），再写终点：否则浏览器把两次改动并成一次，过渡不启动。
        void nextTick(() => {
            void options.root.value?.offsetWidth;
            growing.value = new Map();
        });
    }

    /** 布局变了（渲染之前调）。 */
    function update(frame: GridMotionFrame): void {
        const decision = decideMotion(frame, memory);
        if (decision.kind === "stop") {
            stop();
            return;
        }
        if (decision.kind === "none") return;
        const root = options.root.value;
        const duration = root === null ? 0 : layoutMotionMs(root);
        if (duration > 0) start(duration, decision.entering, decision.following, decision.flying);
    }

    onBeforeUnmount(() => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    });

    return {
        moving,
        growing,
        following,
        flying,
        update,
        /** 过渡中开始手势：外框直接到终点，拖动没有拖尾。 */
        stop,
    };
}
