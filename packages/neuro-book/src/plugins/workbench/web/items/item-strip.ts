/**
 * 条目的溢出预算（docs/specs/ui/workbench-shell.md 外壳四输出 34）：给定可用宽度与每个条目的实测宽度，决定哪些摆出来、
 * 哪些收进“更多”。纯函数；量宽与重算时机归组件。
 *
 * 全部放得下就全部摆出来。否则先为“更多”按钮留出完整的位，再按 priority 降序、order 升序、id 依次放入，第一个放不下
 * 的和它之后的都收起：优先级高的总在优先级低的之前显示，不让一个窄的低优先级条目越过放不下的高优先级条目。结果按
 * 条目原来的显示顺序给出，收起的条目在“更多”里也按这个顺序。
 */

export interface StripItem {
    readonly id: string;
    readonly order: number;
    readonly priority: number;
    /** 实测宽度（含与相邻条目的间距）。 */
    readonly width: number;
}

export interface StripLayout {
    /** 摆出来的条目 id，按显示顺序。 */
    readonly shown: ReadonlyArray<string>;
    /** 收进“更多”的条目 id，按显示顺序；空时不画“更多”。 */
    readonly hidden: ReadonlyArray<string>;
}

function byRank(a: StripItem, b: StripItem): number {
    return b.priority - a.priority || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** `items` 是显示顺序；`available` 是条目区能用的宽度（固定区已经扣掉）；`more` 是“更多”按钮的宽度。 */
export function layoutStrip(items: ReadonlyArray<StripItem>, available: number, more: number): StripLayout {
    const total = items.reduce((sum, item) => sum + item.width, 0);
    if (total <= available) return {shown: items.map((item) => item.id), hidden: []};
    const budget = available - more;
    const kept = new Set<string>();
    let used = 0;
    for (const item of [...items].sort(byRank)) {
        if (used + item.width > budget) break;
        kept.add(item.id);
        used += item.width;
    }
    return {
        shown: items.filter((item) => kept.has(item.id)).map((item) => item.id),
        hidden: items.filter((item) => !kept.has(item.id)).map((item) => item.id),
    };
}
