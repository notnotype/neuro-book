/**
 * 虚拟列表的窗口（docs/specs/workbench/files-explorer.md 的“焦点”）：固定行高，只渲染视口内的行与上下余量，再加上
 * 必须保持挂载的行（焦点行、正在编辑的行）：`aria-activedescendant` 只能指向现存的元素，焦点行滚出视口也要在。
 */

/** 视口上下各多渲染这么多行。 */
export const OVERSCAN = 10;

export interface WindowInput {
    readonly count: number;
    readonly rowHeight: number;
    readonly viewport: number;
    readonly scrollTop: number;
    /** 窗口之外也要渲染的行下标。 */
    readonly keep: ReadonlyArray<number>;
}

/** 要渲染的行下标，升序。 */
export function renderedRows(input: WindowInput): number[] {
    const {count, rowHeight, viewport, scrollTop} = input;
    if (count === 0 || rowHeight <= 0) return [];
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const last = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
    const indices = new Set<number>();
    for (let index = first; index < last; index += 1) indices.add(index);
    for (const index of input.keep) if (index >= 0 && index < count) indices.add(index);
    return [...indices].sort((a, b) => a - b);
}

/** 让第 `index` 行完整进入视口所需的滚动位置；已经在视口里时原样返回。 */
export function revealTop(index: number, rowHeight: number, viewport: number, scrollTop: number): number {
    const top = index * rowHeight;
    if (top < scrollTop) return top;
    const bottom = top + rowHeight;
    if (bottom > scrollTop + viewport) return Math.max(0, bottom - viewport);
    return scrollTop;
}

/** 内容变短后（折叠、删除）滚动位置的合法上限。 */
export function clampTop(scrollTop: number, count: number, rowHeight: number, viewport: number): number {
    return Math.max(0, Math.min(scrollTop, count * rowHeight - viewport));
}
