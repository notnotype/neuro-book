import {computed, toValue, type ComputedRef, type MaybeRefOrGetter} from "vue";

/**
 * 下拉菜单/选择器长列表黄金截断高度（齐腰截半露底）计算 Composable。
 *
 * 视觉与交互心理学原理：
 * 在长列表滚动设计中，若视口底边恰好停留在某项的缝隙处，用户极易产生「列表已结束」的错觉；
 * 若截断过少（<20%）会产生「1px 脏边/渲染瑕疵」误判；若截断过多（>80%）则会产生刺眼的「被削顶削底感」。
 * 黄金截断高度将视口精确横截在第 N+1 项的 50%~64% 处（横穿西文字体基线或中文字符躯干中间），
 * 给予用户最清晰、自然的「下方还有内容可滚」的潜意识视觉线索。
 */
export interface DropdownTruncatedHeightOptions {
    /** 尺寸档位预设：'default' (32px 项高) 或 'sm' (26px 项高) */
    size?: MaybeRefOrGetter<"default" | "sm" | undefined>;
    /** 期望完整展示的项数（default 档默认 6 项，sm 档默认 5 项） */
    visibleCount?: MaybeRefOrGetter<number | undefined>;
    /** 被截断项的可见露出比例（默认 0.53，文字基线黄金截断比率，取值范围建议 0.45 ~ 0.68） */
    fractionalRatio?: MaybeRefOrGetter<number | undefined>;
    /** 单项自定义基准高度（像素，未指定时按 size 档位自动推导：default=32, sm=26） */
    itemHeight?: MaybeRefOrGetter<number | undefined>;
    /** 项间垂直外间距（像素，默认 4px，对应 tailwind mb-1 / gap-1） */
    itemGap?: MaybeRefOrGetter<number | undefined>;
    /** 视口内部额外上下留白（像素，默认 0） */
    viewportPadding?: MaybeRefOrGetter<number | undefined>;
    /** 视口绝对最大高度上限（像素，未指定时不限） */
    maxHeightLimit?: MaybeRefOrGetter<number | undefined>;
    /** 显式指定的固定高度字符串或像素数值（若提供则直接使用，如 "210px"） */
    explicitMaxHeight?: MaybeRefOrGetter<string | number | undefined>;
}

export interface DropdownTruncatedHeightReturn {
    /** 计算出的视口最大高度 CSS 字符串（例如 "238px" / "233px" / "168px"） */
    viewportMaxHeight: ComputedRef<string>;
    /** 当前生效的单项高度（像素） */
    resolvedItemHeight: ComputedRef<number>;
    /** 当前生效的项间距（像素） */
    resolvedItemGap: ComputedRef<number>;
    /** 当前生效的完整可见项数 */
    resolvedVisibleCount: ComputedRef<number>;
}

/** 默认档单项高度（32px，对齐 --control-h-sm） */
export const DROPDOWN_ITEM_HEIGHT_DEFAULT = 32;
/** 紧凑档单项高度（26px，对齐 --control-h-sm - 6px） */
export const DROPDOWN_ITEM_HEIGHT_SM = 26;
/** 默认项间距（实际子像素渲染平均 3.6px，对齐 mb-1） */
export const DROPDOWN_ITEM_GAP_DEFAULT = 3.6;
/** 默认齐腰截半比例（48%~50% 严格截半横截，绝不露整项） */
export const DROPDOWN_FRACTIONAL_RATIO_DEFAULT = 0.48;

export function useDropdownTruncatedHeight(
    options: DropdownTruncatedHeightOptions = {},
): DropdownTruncatedHeightReturn {
    const resolvedSize = computed(() => toValue(options.size) ?? "default");

    const resolvedItemHeight = computed(() => {
        const custom = toValue(options.itemHeight);
        if (typeof custom === "number" && custom > 0) {
            return custom;
        }
        return resolvedSize.value === "sm" ? DROPDOWN_ITEM_HEIGHT_SM : DROPDOWN_ITEM_HEIGHT_DEFAULT;
    });

    const resolvedItemGap = computed(() => {
        const custom = toValue(options.itemGap);
        return typeof custom === "number" && custom >= 0 ? custom : DROPDOWN_ITEM_GAP_DEFAULT;
    });

    const resolvedVisibleCount = computed(() => {
        const custom = toValue(options.visibleCount);
        if (typeof custom === "number" && custom > 0) {
            return custom;
        }
        return resolvedSize.value === "sm" ? 5 : 6;
    });

    const resolvedFractionalRatio = computed(() => {
        const custom = toValue(options.fractionalRatio);
        return typeof custom === "number" && custom > 0 ? custom : DROPDOWN_FRACTIONAL_RATIO_DEFAULT;
    });

    const viewportMaxHeight = computed(() => {
        const explicit = toValue(options.explicitMaxHeight);
        if (typeof explicit === "string" && explicit.trim() !== "") {
            return explicit.trim();
        }
        if (typeof explicit === "number" && explicit > 0) {
            return `${Math.round(explicit)}px`;
        }

        const count = resolvedVisibleCount.value;
        const h = resolvedItemHeight.value;
        const g = resolvedItemGap.value;
        const f = resolvedFractionalRatio.value;
        const p = toValue(options.viewportPadding) ?? 0;

        // 计算公式：完整项总高度 + 第 N+1 项严格截半露出高度 (约 48%~50%) + 内衬留白
        let total = count * (h + g) + Math.round(f * h) + p;

        const limit = toValue(options.maxHeightLimit);
        if (typeof limit === "number" && limit > 0 && total > limit) {
            total = limit;
        }

        return `${Math.round(total)}px`;
    });

    return {
        viewportMaxHeight,
        resolvedItemHeight,
        resolvedItemGap,
        resolvedVisibleCount,
    };
}
