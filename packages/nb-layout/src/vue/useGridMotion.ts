/**
 * 外框的过渡（docs/specs/ui/nested-grid.md 的“过渡”）：布局变了之后决定要不要滑过去。
 *
 * 判定按结果，不只看来源：矩形没变就什么都不做；变了再排除手势与容器尺寸。容器尺寸有两个来源，晚一拍到：宿主用自己的
 * `ResizeObserver` 量完先发布布局，这个 grid 自己的实测盒下一个回调才变，中间 Vue 会刷新一次。所以两个都要比，只比一个的话，第二拍
 * 会被当成程序变化，每次改窗口高度都滑一下。
 */

import {nextTick, onBeforeUnmount, ref, shallowRef} from "vue";
import type {Ref} from "vue";

import {enteringRects, placementMoved} from "../grid-rects";
import type {GridPlacementItem, GridRect} from "../grid-rects";
import type {GridExtent} from "../grid-types";
import {layoutMotionMs} from "./layout-motion";

/** 计时比过渡长一点：过渡要到下一次样式计算才开始，定时器先到的话最后一帧会跳到终点。 */
const MOTION_SLACK_MS = 50;

export interface GridMotionFrame {
    readonly items: ReadonlyArray<GridPlacementItem<unknown>>;
    /** 上一次的项；第一次没有。 */
    readonly previous: ReadonlyArray<GridPlacementItem<unknown>> | null;
    /** 宿主算布局用的根尺寸；空布局（还没量到）为 null。 */
    readonly rootSize: GridExtent | null;
    /** 这个 grid 自己量到的容器。 */
    readonly extent: GridExtent;
    readonly dpr: number;
}

const sameExtent = (left: GridExtent, right: GridExtent): boolean => left.width === right.width && left.height === right.height;

export function useGridMotion(options: {readonly root: Readonly<Ref<HTMLElement | null>>; readonly onSettled: () => void}) {
    const moving = ref(false);
    /** 新项第一帧的矩形；下一轮写终点，过渡才启动。 */
    const growing = shallowRef<ReadonlyMap<string, GridRect>>(new Map());
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 这一轮的几何变化来自手势（预览、撤回、落账）：不过渡。消费一次就清。 */
    let fromGesture = false;
    let lastRootSize: GridExtent | null = null;
    let lastExtent: GridExtent | null = null;
    let lastDpr: number | null = null;

    function stop(): void {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (!moving.value) return;
        moving.value = false;
        growing.value = new Map();
        // 分隔线的对齐读 DOM：过渡开始时读到的是旧位置，结束再对齐一次。
        options.onSettled();
    }

    function start(durationMs: number, entering: ReadonlyMap<string, GridRect>): void {
        if (timer !== null) clearTimeout(timer);
        moving.value = true;
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
        const gesture = fromGesture;
        fromGesture = false;
        // 第一次有真实布局：之前的矩形都是 0，不算移动。
        const first = lastRootSize === null;
        const resized = (lastRootSize !== null && frame.rootSize !== null && !sameExtent(lastRootSize, frame.rootSize))
            || (lastExtent !== null && !sameExtent(lastExtent, frame.extent));
        const rescaled = lastDpr !== null && lastDpr !== frame.dpr;
        if (frame.rootSize !== null) lastRootSize = {...frame.rootSize};
        lastExtent = {...frame.extent};
        lastDpr = frame.dpr;
        if (resized || rescaled) {
            stop();
            return;
        }
        if (first || gesture || frame.previous === null || frame.previous.length === 0) return;
        if (!placementMoved(frame.items, frame.previous)) return;
        const root = options.root.value;
        const duration = root === null ? 0 : layoutMotionMs(root);
        if (duration > 0) start(duration, enteringRects(frame.items, frame.previous));
    }

    onBeforeUnmount(() => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    });

    return {
        moving,
        growing,
        update,
        /** 过渡中开始手势：外框直接到终点，拖动没有拖尾。 */
        stop,
        /** 接下来这次几何变化来自手势。 */
        markGesture: () => {
            fromGesture = true;
        },
    };
}
