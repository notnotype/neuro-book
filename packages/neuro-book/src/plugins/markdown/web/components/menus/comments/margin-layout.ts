/**
 * 批注页边的尺寸（docs/specs/workbench/markdown-editing.md 输出 33）：页边卡片的宽度与它和稿纸之间的空。`MarkdownControl` 用它们给
 * 稿纸让位并算页边够不够宽，`MarkdownCommentMargin` 用它们摆卡片，所以放在一处。
 */

export const MARGIN_WIDTH = 264;
/** 页边与稿纸之间的空。 */
export const MARGIN_GAP = 16;

/** 槽位之间留的空：槽位的高度含它，卡片面比槽位矮这么多，相邻两段的卡片不贴在一起。 */
export const SLOT_GAP = 3;
/** 最小高度的封顶（意见区的行数）：段落很高时一句话不拖出一张很高的空卡。 */
export const MIN_CAP_LINES = 8;

/** 一个槽位对着的段与它后面一段的几何（视口坐标，只用差值）。 */
export interface SlotGeometry {
    readonly top: number;
    /** 这一段的高度。 */
    readonly height: number;
    /** 下一段的底边；没有下一段为 null。 */
    readonly nextBottom: number | null;
    /** 下一段有没有批注：有就不能借它的地方。 */
    readonly nextCommented: boolean;
}

/** 卡片的尺寸：`oneLine` 是放下一行意见的卡片高度（行高加上下内边距与描边）。 */
export interface SlotMetrics {
    readonly oneLine: number;
    /** 最小高度的封顶：`MIN_CAP_LINES` 行意见的卡片高度。 */
    readonly minCap: number;
}

export interface SlotRange {
    readonly min: number;
    readonly max: number;
}

/**
 * 槽位的高度范围（docs/specs/workbench/markdown-editing.md 输出 33）：不小于这一段的高度（封顶 `minCap`，也至少放得下一行意见），不高于这一段
 * 的高度；下一段没有批注时放宽到两倍段高，但不越过下一段的底边（没有下一段时不受限）。都减去槽位之间的空。
 */
export function slotRange(geometry: SlotGeometry, metrics: SlotMetrics): SlotRange {
    const own = Math.max(0, geometry.height - SLOT_GAP);
    const min = Math.max(metrics.oneLine, Math.min(own, metrics.minCap));
    const room = geometry.nextBottom === null ? 2 * geometry.height : Math.min(2 * geometry.height, geometry.nextBottom - geometry.top);
    const borrowed = geometry.nextCommented ? own : Math.max(own, room - SLOT_GAP);
    return {min, max: Math.max(min, borrowed)};
}
