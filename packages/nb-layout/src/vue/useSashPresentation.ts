/**
 * 分隔线的呈现（`NestedGrid` 画 `SashHandle` 用的属性）：宿主给的种类、样式与两侧显示名，位置与过渡，读屏名称与取值。
 *
 * 宿主回调（`sashKind`、`sashStyle`、`paneLabel`）每条线每次重算只问一次：整张表在一个 computed 里算出来，渲染函数只读表、不写任何状态。
 * 不用挂在 `layers` 上的 watcher 去填表：单独换 `paneLabel` 时 `layers` 没变，名字也要跟着变；computed 读到 `props` 上的回调，两者都会触发重算。
 * 宿主回调里读的响应式状态（例如当前语言）也由这个 computed 追踪。
 */
import {computed, type ComputedRef} from "vue";

import type {GridSashPlacement, GridLayerItem, GridRect} from "../grid-rects";
import type {GridLayoutResult} from "../grid-types";
import {ariaMax, buildGridBranchPanels, panelBounds} from "./grid-splitter";
import {gridRectStyle} from "./useContentLayer";
import type {LayoutTranslate} from "./text";

type SashRef = {readonly branch: string; readonly before: string; readonly after: string};

/** 宿主给的分隔线回调：`NestedGrid` 的同名属性，整份 `props` 直接传进来。 */
export type SashHostCallbacks = {
    readonly sashKind?: ((sash: SashRef) => string | undefined) | undefined;
    readonly sashStyle?: ((sash: SashRef) => Record<string, string> | undefined) | undefined;
    readonly sashDisabled?: ((sash: SashRef) => boolean) | undefined;
    readonly paneLabel?: ((id: string) => string | undefined) | undefined;
};

/** 宿主给一条分隔线的种类、样式与两侧的显示名（`before`、`after` 已经是翻译好的名字）。 */
type SashLook = {readonly kind: string | undefined; readonly style: Record<string, string> | undefined; readonly before: string; readonly after: string};

type SashItem = GridSashPlacement<unknown> & {readonly kind: "sash"};

export function useSashPresentation(options: {
    host: SashHostCallbacks;
    layers: () => ReadonlyArray<GridLayerItem<unknown>>;
    /** 本轮的布局：分隔线两侧的尺寸与面板约束。 */
    layout: () => GridLayoutResult;
    /** 整个网格不能拖（停用、最大化）。 */
    gesturesDisabled: () => boolean;
    /** 过渡里用着起点矩形的项（`useGridMotion` 的 `growing`）。 */
    growing: () => ReadonlyMap<string, GridRect>;
    /** 交换里带上的项的裁切（`swapClipStyle`）。 */
    swapClip: (item: GridLayerItem<unknown>, rect: GridRect) => Record<string, string>;
    domIdOf: (key: string) => string;
    /** 分隔线控制的窗格的 DOM id（空格分隔）：外框里只剩面板头时，真正被调整的是活动的内容。 */
    controlledIds: (leaf: string) => string;
    text: LayoutTranslate;
}) {
    const {host} = options;

    function paneNameOf(id: string): string {
        const label = host.paneLabel?.(id);
        return label === undefined || label === "" ? id : label;
    }

    /**
     * 交换里滑出去的线两侧已经不在宿主的布局里，问宿主只会得到错的结果，沿用它离开前最后一次的（上一张表里的那一条）。
     * 上一张表只被这个 computed 读写：离开的线沿用的是同一个值，重算多少次结果都一样；不在渲染层里的线自然不进新表。
     */
    let previous: ReadonlyMap<string, SashLook> = new Map();
    const looks: ComputedRef<ReadonlyMap<string, SashLook>> = computed(() => {
        const table = new Map<string, SashLook>();
        for (const item of options.layers()) {
            if (item.kind !== "sash") continue;
            if (item.leaving === true) {
                table.set(item.key, previous.get(item.key) ?? {kind: undefined, style: undefined, before: item.before, after: item.after});
                continue;
            }
            const ref = {branch: item.branch.id, before: item.before, after: item.after};
            table.set(item.key, {kind: host.sashKind?.(ref), style: host.sashStyle?.(ref), before: paneNameOf(item.before), after: paneNameOf(item.after)});
        }
        previous = table;
        return table;
    });

    // 渲染的项都来自 `layers`，表里一定有它。
    const lookOf = (sash: SashItem): SashLook => looks.value.get(sash.key)!;

    /**
     * 这条线沿自己的长度方向为零：它在一个收起为零的分支里（docs/specs/ui/nested-grid.md 输出 136），两边的叶都看不见。
     * 粗细还在，所以 `SashHandle` 按粗细判的“接缝”认不出它；按不可交互交给它，就不可聚焦、不进指针命中，展开后矩形有了长度自己恢复。
     */
    function isZeroLength(sash: SashItem): boolean {
        return (sash.axis === "width" ? sash.rect.height : sash.rect.width) <= 0;
    }

    /** 分隔线的读屏名称：两侧用显示名（`paneLabel`），离开的线用离开前最后一次的。 */
    function ariaLabelOf(sash: SashItem): string {
        const look = lookOf(sash);
        return options.text(sash.axis === "width" ? "splitter.resizeWidth" : "splitter.resizeHeight", {before: look.before, after: look.after});
    }

    function sashPropsOf(sash: SashItem) {
        const {text, domIdOf} = options;
        // 交换里滑出去的分隔线：两侧已经不在布局里，尺寸用冻结的，不能拖。
        if (sash.frozen !== undefined) {
            return {
                branchId: sash.branch.id,
                index: sash.index,
                axis: sash.axis,
                size: sash.size,
                beforePx: sash.frozen.beforePx,
                afterPx: sash.frozen.afterPx,
                disabled: true,
                detached: true,
                ends: sash.ends,
                ariaLabel: ariaLabelOf(sash),
                ariaControls: domIdOf(`leaf:${sash.controls}`),
                ariaMin: 0,
                ariaMax: Math.round(sash.branchLength),
                ariaNow: Math.round(sash.frozen.beforePx),
                ariaValueText: text("splitter.pixels", {size: Math.round(sash.frozen.beforePx)}),
            };
        }
        const layout = options.layout();
        const nowPx = Math.max(0, layout.sizes[sash.before]?.[sash.axis] ?? 0);
        // 只为这一条线前面的那个孩子建面板配置，不为整支分支建。
        const child = sash.branch.children[sash.index];
        const panel = child === undefined ? undefined : buildGridBranchPanels([child], layout, sash.axis)[0];
        return {
            branchId: sash.branch.id,
            index: sash.index,
            axis: sash.axis,
            size: sash.size,
            beforePx: nowPx,
            afterPx: Math.max(0, layout.sizes[sash.after]?.[sash.axis] ?? 0),
            disabled: options.gesturesDisabled() || isZeroLength(sash) || host.sashDisabled?.({branch: sash.branch.id, before: sash.before, after: sash.after}) === true,
            detached: false,
            ends: sash.ends,
            ariaLabel: ariaLabelOf(sash),
            ariaControls: options.controlledIds(sash.controls),
            ariaMin: Math.round(panelBounds(panel).low),
            ariaMax: ariaMax(panel, sash.branchLength),
            ariaNow: Math.round(nowPx),
            ariaValueText: panel?.collapse?.collapsed === true ? text("splitter.collapsed") : text("splitter.pixels", {size: Math.round(nowPx)}),
        };
    }

    return {
        /** 写到 `data-sash-kind` 的种类。 */
        sashKindOf: (sash: SashItem) => lookOf(sash).kind,
        sashBoxStyle(sash: SashItem): Record<string, string> {
            const rect = options.growing().get(sash.key) ?? sash.rect;
            return {...lookOf(sash).style, position: "absolute", ...gridRectStyle(rect), ...options.swapClip(sash, rect)};
        },
        /** 交给 `SashHandle` 的属性。 */
        sashProps: sashPropsOf,
    };
}
