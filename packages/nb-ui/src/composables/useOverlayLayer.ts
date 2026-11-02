/**
 * 对话框一族的层级：`Dialog`、`AlertDialog`（模态）与 `FloatingWindow`（窗口）各在 setup 里调一次，只调一次。
 *
 * 两套叠放规则靠两条不重叠的层级带共存：窗口按嵌套深度占 `dialogWindow` 起的一段（从窗口里开出来的窗口压住外层），
 * 模态按打开顺序占 `dialog` 起的一段（useModalLayer）。窗口带整体在模态带之下，所以窗口里可以开模态，模态里不该开窗口。
 *
 * 同时负责两件要沿组件树往下传的事：
 * - 嵌套层数（`NB_DIALOG_LAYER`）：叠在另一个对话框或窗口里的面画二级（`nested`）。只在这里读写，外框组件
 *   `DialogSurface` 从属性拿 `nested`，自己不读注入，否则它读到的是父组件刚提供的值，每一层都会判成二级。
 * - 窗口深度（`NB_DIALOG_WINDOW_DEPTH`）：模态原样往下传，窗口加一。
 *
 * 并向内容树提供局部浮层层级（`NB_POPOVER_Z_INDEX`）：模态给一个高于所有模态层的固定值，窗口给“自己 + 1”。
 * `Drawer` 与 `QuickPick` 不用它：抽屉只参加模态的叠放、不画二级的面，命令面板有自己固定的一档。
 */
import {computed, inject, provide} from "vue";
import type {ComputedRef} from "vue";

import {NB_DIALOG_LAYER, NB_DIALOG_WINDOW_DEPTH, NB_DIALOG_WINDOW_Z_STEP, NB_MODAL_POPOVER_Z_INDEX, NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../theme/z-index";
import {useModalLayer} from "./useModalLayer";

/** 窗口带 8990–8999 一共容纳的嵌套层数（步长 NB_DIALOG_WINDOW_Z_STEP）。 */
const MAX_WINDOW_DEPTH = 5;

export type OverlayLayer = {
    readonly zIndex: ComputedRef<number>;
    /** 叠在另一个对话框或窗口里：画二级的面。 */
    readonly nested: boolean;
};

export function useOverlayLayer(options: {kind: "modal" | "window"; open: () => boolean}): OverlayLayer {
    const parentLayer = inject(NB_DIALOG_LAYER, 0);
    provide(NB_DIALOG_LAYER, parentLayer + 1);
    const parentDepth = inject(NB_DIALOG_WINDOW_DEPTH, 0);

    if (options.kind === "modal") {
        provide(NB_DIALOG_WINDOW_DEPTH, parentDepth);
        provide(NB_POPOVER_Z_INDEX, NB_MODAL_POPOVER_Z_INDEX);
        const {zIndex} = useModalLayer(options.open);
        return {zIndex, nested: parentLayer >= 1};
    }

    const depth = parentDepth + 1;
    if (depth > MAX_WINDOW_DEPTH) {
        console.warn(`[nb-ui/FloatingWindow] 浮动窗口嵌套到第 ${String(depth)} 层，超过 ${String(MAX_WINDOW_DEPTH)} 层的部分与最内层同档，会与模态对话框争层级。`);
    }
    const windowZIndex = NB_Z_INDEX.dialogWindow + (Math.min(depth, MAX_WINDOW_DEPTH) - 1) * NB_DIALOG_WINDOW_Z_STEP;
    provide(NB_DIALOG_WINDOW_DEPTH, depth);
    provide(NB_POPOVER_Z_INDEX, windowZIndex + 1);
    return {zIndex: computed(() => windowZIndex), nested: parentLayer >= 1};
}
