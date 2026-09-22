/**
 * 分隔线的交互反馈：显现时序、装饰带几何、光标映射与**每文档唯一**的临时 cursor 所有权。
 *
 * 为什么不写进 `Splitter`：一次按下可能同时命中同一 scope 的两条线（T/十字），显现与光标必须由
 * 判定命中的那一层统一决定；落在单个组件上会各亮各的、各写各的 cursor。
 *
 * 光标只覆盖**显式 cursor**（`input`、`link` 等）声明，因此占用时注入一条属性作用域的临时样式，
 * 释放时连同样式一起移除：不做常驻全局 `!important`。
 */
import type {SashHitTarget, SashPoint, SashPointerKind} from "./sash-hit-area";

/** 悬停停留多久后才显示分隔线（毫秒）；拖拽与键盘不受它限制。 */
export const SASH_HOVER_DELAY_MS = 250;

export type SashCursor = "ew-resize" | "ns-resize" | "move";

/** 命中集合 → 光标：单轴给对应方向的双向箭头，同 scope 两轴同时命中给移动光标。 */
export function sashCursorFor(hits: readonly SashHitTarget[]): SashCursor | null {
    if (hits.length === 0) {
        return null;
    }
    const axis = hits[0]!.axis;
    if (hits.every((hit) => hit.axis === axis)) {
        return axis === "width" ? "ew-resize" : "ns-resize";
    }
    return "move";
}

const CURSOR_ATTRIBUTE = "data-nb-sash-cursor";
const CURSOR_STYLE_ATTRIBUTE = "data-nb-sash-cursor-styles";

/** 当前 owner：同一文档同一时刻只有一个，后来的 scope 不抢占。 */
const owners = new WeakMap<Document, symbol>();
const styles = new WeakMap<Document, HTMLStyleElement>();

export type SashCursorOwner = {
    /** 设置/更新自己的光标；被别的 scope 持有时是 no-op。 */
    set(cursor: SashCursor): void;
    /** 释放所有权并移除临时样式；不是 owner 时是 no-op。 */
    release(): void;
};

export function acquireSashCursor(doc: Document): SashCursorOwner {
    const token = Symbol("nb-sash-cursor");
    let mine = false;
    return {
        set(cursor) {
            const current = owners.get(doc);
            if (current === undefined) {
                owners.set(doc, token);
                mine = true;
            } else if (current !== token) {
                return;
            }
            ensureStyle(doc);
            doc.documentElement.setAttribute(CURSOR_ATTRIBUTE, cursor);
        },
        release() {
            if (!mine || owners.get(doc) !== token) {
                return;
            }
            owners.delete(doc);
            mine = false;
            doc.documentElement.removeAttribute(CURSOR_ATTRIBUTE);
            styles.get(doc)?.remove();
            styles.delete(doc);
        },
    };
}

function ensureStyle(doc: Document): HTMLStyleElement {
    const existing = styles.get(doc);
    if (existing !== undefined && existing.isConnected) {
        return existing;
    }
    const style = doc.createElement("style");
    style.setAttribute(CURSOR_STYLE_ATTRIBUTE, "");
    style.textContent = (["ew-resize", "ns-resize", "move"] as const)
        .map((value) => `:root[${CURSOR_ATTRIBUTE}="${value}"],:root[${CURSOR_ATTRIBUTE}="${value}"] *{cursor:${value} !important;}`)
        .join("\n");
    doc.head.appendChild(style);
    styles.set(doc, style);
    return style;
}

/** 命中事实 → 稳定键（`branchId:index`）；scope 的 hovered/active/revealed 共用它。 */
export function sashHitKey(hit: {branchId: string; sashIndex: number}): string {
    return `${hit.branchId}:${hit.sashIndex}`;
}

/** 装饰带的目标厚度（CSS px）。比 1px 逻辑接缝厚一档，但不跟着接缝尺寸一起变粗。 */
export const SASH_BAND_MAX_PX = 3;

/** 装饰带在主轴上的落位：`startPx` 相对分隔元素自身起点（负值表示伸进前一个面板），`thicknessPx` 是呈现厚度。 */
export type SashBandBox = {startPx: number; thicknessPx: number};

export type SashBandInput = {
    /** 逻辑接缝的主轴尺寸（分隔元素的流内尺寸，CSS px）。 */
    sashPx: number;
    /** 前一个相邻面板的当前呈现主轴尺寸；0 表示它已收起或贴边。 */
    beforePx: number;
    /** 后一个相邻面板的当前呈现主轴尺寸。 */
    afterPx: number;
    /** 设备像素对齐位移（本地 CSS px，可正可负）；缺省不对齐。 */
    alignmentDeltaPx?: number;
};

/**
 * 装饰带的几何：固定目标厚度 3 CSS px，落位被**前后相邻面板的当前呈现**夹住。
 *
 * 为什么不能只按接缝算：收起边界上相邻面板是 0px，装饰带若照旧向两侧各扩半个厚度，
 * 就会越出分隔元素所在的盒子，被祖先的 `overflow-hidden` 从 3px 裁成 2px——「线变细」是裁出来的，
 * 不是画细的。这里让可用范围（前邻起点 → 后邻终点）成为硬边界：贴边向内移动，厚度优先保持完整，
 * 空间确实不足时才退到可用空间（两侧都没有空间时最多就是接缝本身）。
 *
 * `alignmentDeltaPx` 先加、再夹：设备像素对齐永远让位于可用范围，宁可差半个设备像素也不越界。
 * 非法输入返回 `null`——宁可不画，也不画一条位置或厚度不确定的线。
 */
export function sashBandBox(input: SashBandInput): SashBandBox | null {
    const {sashPx, beforePx, afterPx} = input;
    const delta = input.alignmentDeltaPx ?? 0;
    if (!Number.isFinite(sashPx) || sashPx <= 0
        || !Number.isFinite(beforePx) || beforePx < 0
        || !Number.isFinite(afterPx) || afterPx < 0
        || !Number.isFinite(delta)) {
        return null;
    }
    const thicknessPx = Math.min(SASH_BAND_MAX_PX, beforePx + sashPx + afterPx);
    const centered = sashPx / 2 - thicknessPx / 2 + delta;
    // 末尾的 `+ 0` 把贴边夹紧时可能出现的 `-0` 归一成 `0`：调用方会把它写进样式、测试也会直接比数值。
    const startPx = Math.min(Math.max(centered, -beforePx), sashPx + afterPx - thicknessPx) + 0;
    return {startPx, thicknessPx};
}

export type {SashHitTarget, SashPoint, SashPointerKind};
