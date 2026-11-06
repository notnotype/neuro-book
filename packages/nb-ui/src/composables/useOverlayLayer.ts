/**
 * 对话框一族的层级：`Dialog`、`AlertDialog`（模态）与 `FloatingWindow`（窗口）各在 setup 里调一次，只调一次。
 *
 * 两套叠放规则靠两条不重叠的层级带共存：窗口带（`dialogWindow` 起）分成若干条“车道”，每个最外层窗口占一条，按最近聚焦
 * 排序（打开、点击、聚焦都把它提到最上，同桌面系统的窗口）；从窗口里开出来的窗口在外层的车道里按嵌套深度往上，
 * 压住外层。模态按打开顺序占 `dialog` 起的一段（useModalLayer）。窗口带整体在模态带之下，所以窗口里可以开模态，模态里
 * 不该开窗口。
 *
 * 同时负责两件要沿组件树往下传的事：
 * - 嵌套层数（`NB_DIALOG_LAYER`）：叠在另一个对话框或窗口里的面画二级（`nested`）。只在这里读写，外框组件
 *   `DialogSurface` 从属性拿 `nested`，自己不读注入，否则它读到的是父组件刚提供的值，每一层都会判成二级。
 * - 窗口深度（`NB_DIALOG_WINDOW_DEPTH`）与所在的最外层窗口（`NB_DIALOG_WINDOW_FAMILY`）：模态原样往下传，窗口深度加一。
 *
 * 并向内容树提供局部浮层层级（`NB_POPOVER_Z_INDEX`）：模态给一个高于所有模态层的固定值，窗口给窗口带的最上一格。
 * `Drawer` 与 `QuickPick` 不用它：抽屉只参加模态的叠放、不画二级的面，命令面板有自己固定的一档。
 */
import {computed, inject, onBeforeUnmount, provide, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

import {NB_DIALOG_LAYER, NB_DIALOG_WINDOW_DEPTH, NB_DIALOG_WINDOW_FAMILY, NB_DIALOG_WINDOW_LANE, NB_DIALOG_WINDOW_MAX_LANES, NB_DIALOG_WINDOW_Z_STEP, NB_MODAL_POPOVER_Z_INDEX, NB_POPOVER_Z_INDEX, NB_WINDOW_POPOVER_Z_INDEX, NB_Z_INDEX} from "../theme/z-index";
import {useModalLayer} from "./useModalLayer";

/** 一条车道容纳的嵌套层数（步长 NB_DIALOG_WINDOW_Z_STEP，一条车道 NB_DIALOG_WINDOW_LANE）。 */
const MAX_WINDOW_DEPTH = 5;

/** 全应用一份：已打开的最外层窗口，最后一个在最上面。层级不能靠 DOM 顺序，也不能靠打开顺序：用户点哪个，哪个就该在上。 */
const openTopWindows = shallowRef<ReadonlyArray<symbol>>([]);

export type OverlayLayer = {
    readonly zIndex: ComputedRef<number>;
    /** 叠在另一个对话框或窗口里：画二级的面。 */
    readonly nested: boolean;
    /** 把所在的最外层窗口提到最上；模态没有这个概念，什么也不做。 */
    raise(): void;
};

export function useOverlayLayer(options: {kind: "modal" | "window"; open: () => boolean}): OverlayLayer {
    const parentLayer = inject(NB_DIALOG_LAYER, 0);
    provide(NB_DIALOG_LAYER, parentLayer + 1);
    const parentDepth = inject(NB_DIALOG_WINDOW_DEPTH, 0);

    if (options.kind === "modal") {
        provide(NB_DIALOG_WINDOW_DEPTH, parentDepth);
        provide(NB_POPOVER_Z_INDEX, NB_MODAL_POPOVER_Z_INDEX);
        const {zIndex} = useModalLayer(options.open);
        return {zIndex, nested: parentLayer >= 1, raise: () => undefined};
    }

    const depth = parentDepth + 1;
    if (depth > MAX_WINDOW_DEPTH) {
        console.warn(`[nb-ui/FloatingWindow] 浮动窗口嵌套到第 ${String(depth)} 层：超过 ${String(MAX_WINDOW_DEPTH)} 层的窗口与第 ${String(MAX_WINDOW_DEPTH)} 层同档，谁在上取决于 DOM 顺序。`);
    }
    provide(NB_DIALOG_WINDOW_DEPTH, depth);
    provide(NB_POPOVER_Z_INDEX, NB_WINDOW_POPOVER_Z_INDEX);
    const nested = parentLayer >= 1;
    const family = inject(NB_DIALOG_WINDOW_FAMILY, null);
    if (family !== null) {
        // 窗口里开出的窗口：跟着外层的车道，按深度压住外层。
        const zIndex = computed(() => family.base.value + (Math.min(depth, MAX_WINDOW_DEPTH) - 1) * NB_DIALOG_WINDOW_Z_STEP);
        return {zIndex, nested, raise: family.raise};
    }

    const token = Symbol("window-lane");
    const leave = (): void => {
        openTopWindows.value = openTopWindows.value.filter((entry) => entry !== token);
    };
    const raise = (): void => {
        const entries = openTopWindows.value;
        if (!options.open() || entries[entries.length - 1] === token) return;
        openTopWindows.value = [...entries.filter((entry) => entry !== token), token];
    };
    watch(options.open, (value) => {
        leave();
        if (value) openTopWindows.value = [...openTopWindows.value, token];
    }, {immediate: true});
    onBeforeUnmount(leave);
    // 车道比窗口多时，多出来的与最上面一条同档，谁在上取决于 DOM 顺序。
    const base = computed(() => NB_Z_INDEX.dialogWindow + Math.min(Math.max(0, openTopWindows.value.indexOf(token)), NB_DIALOG_WINDOW_MAX_LANES - 1) * NB_DIALOG_WINDOW_LANE);
    provide(NB_DIALOG_WINDOW_FAMILY, {base, raise});
    return {zIndex: base, nested, raise};
}
