/**
 * 描边框与说明框的几何（docs/specs/agent/page-agent.md 输出 9、10）：都是纯函数，坐标是视口坐标。
 */

import type {GuideSide} from "../api";
import type {Box} from "../snapshot/walk";

/** 描边框离目标的间隙、描边的粗细、晕的宽度。 */
export const OUTLINE_GAP = 3;
export const OUTLINE_RING = 2;
export const OUTLINE_GLOW = 6;
/** 小于这个边长的目标按这个边长画框，太小的框看不出来。 */
export const MIN_FRAME = 28;
/** 画在目标里面时离目标边的距离。 */
export const INSIDE_INSET = 2;
/** 说明框离目标的距离：间隙、描边之外再空一点。 */
export const CALLOUT_OFFSET = OUTLINE_GAP + OUTLINE_RING + 7;

export interface Frame {
    /** 描边框的框：画在外侧时是目标外扩间隙之后的框，描边与晕画在它外面；画在里面时是目标内缩之后的框，描边画在它里面。 */
    readonly box: Box;
    readonly inside: boolean;
    readonly radius: number;
}

export const width = (box: Box): number => box.right - box.left;
export const height = (box: Box): number => box.bottom - box.top;

function expand(box: Box, by: number): Box {
    return {left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by};
}

/** 不到 `size` 的边按 `size` 画，以原来的中心为中心。 */
function atLeast(box: Box, size: number): Box {
    const grow = (from: number, to: number): [number, number] => {
        const length = to - from;
        if (length >= size) return [from, to];
        const center = (from + to) / 2;
        return [center - size / 2, center + size / 2];
    };
    const [left, right] = grow(box.left, box.right);
    const [top, bottom] = grow(box.top, box.bottom);
    return {left, top, right, bottom};
}

/**
 * 目标的描边框：画在目标外侧，离目标 3px；小于 28×28 的按 28×28 居中画。外侧的描边会伸出目标所在的可见区域时（目标贴着
 * 可见区域的边，例如整个面板）画在目标里面，伸出去的部分会被别的东西盖住或画到区域外面去。`radius` 是目标左上角的圆角。
 */
export function frameFor(target: Box, visible: Box, radius: number): Frame {
    const grown = atLeast(target, MIN_FRAME);
    const reach = OUTLINE_GAP + OUTLINE_RING;
    const fits = grown.left - reach >= visible.left && grown.top - reach >= visible.top
        && grown.right + reach <= visible.right && grown.bottom + reach <= visible.bottom;
    const cap = (box: Box, value: number): number => Math.max(0, Math.min(value, width(box) / 2, height(box) / 2));
    if (fits) {
        const box = expand(grown, OUTLINE_GAP);
        return {box, inside: false, radius: cap(box, radius + OUTLINE_GAP)};
    }
    const box = expand(grown, -INSIDE_INSET);
    return {box, inside: true, radius: cap(box, radius - INSIDE_INSET)};
}

/**
 * 目标滚出可见区域时说明框贴着的地方（输出 9）：可见区域里离目标最近的那条边上、目标中心夹进区域的那一点，交回一个零宽或
 * 零高的框，与说明框该放的方向（朝区域里面）。
 */
export function edgeAnchor(target: Box, visible: Box): {readonly box: Box; readonly side: GuideSide} {
    const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);
    const x = clamp((target.left + target.right) / 2, visible.left, visible.right);
    const y = clamp((target.top + target.bottom) / 2, visible.top, visible.bottom);
    if (target.bottom <= visible.top) return {box: {left: x, right: x, top: visible.top, bottom: visible.top}, side: "bottom"};
    if (target.top >= visible.bottom) return {box: {left: x, right: x, top: visible.bottom, bottom: visible.bottom}, side: "top"};
    if (target.right <= visible.left) return {box: {left: visible.left, right: visible.left, top: y, bottom: y}, side: "right"};
    return {box: {left: visible.right, right: visible.right, top: y, bottom: y}, side: "left"};
}

/**
 * 描边框只画在可见区域里（外扩描边与晕的宽度）：目标一部分滚到滚动区域外面时，那一截的描边不画到区域外面去。交回
 * `clip-path` 的多边形，坐标相对于描边框自己的框，可以是负数（描边与晕画在框外）。
 */
export function frameClip(frame: Frame, visible: Box): string {
    const pad = OUTLINE_GAP + OUTLINE_RING + OUTLINE_GLOW;
    const left = visible.left - pad - frame.box.left;
    const top = visible.top - pad - frame.box.top;
    const right = visible.right + pad - frame.box.left;
    const bottom = visible.bottom + pad - frame.box.top;
    const px = (value: number): string => `${String(Math.round(value))}px`;
    return `polygon(${px(left)} ${px(top)}, ${px(right)} ${px(top)}, ${px(right)} ${px(bottom)}, ${px(left)} ${px(bottom)})`;
}
