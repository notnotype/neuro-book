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
    /** 实测宽度（不含间距；间距由 `gap` 按实际摆出来的项数算）。 */
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

/**
 * `items` 是显示顺序；`available` 是条目区能用的宽度（固定区已经扣掉）；`more` 是“更多”按钮的宽度；`gap` 是相邻两项之间
 * 的间距，n 项之间有 n - 1 个（“更多”也算一项）。
 */
export function layoutStrip(items: ReadonlyArray<StripItem>, available: number, more: number, gap = 0): StripLayout {
    const total = items.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, items.length - 1);
    if (total <= available) return {shown: items.map((item) => item.id), hidden: []};
    const kept = new Set<string>();
    let used = 0;
    for (const item of [...items].sort(byRank)) {
        // 放进这一项后摆出来的是 kept.size + 1 项加“更多”，之间有 kept.size + 1 个间距。
        if (used + item.width + more + gap * (kept.size + 1) > available) break;
        kept.add(item.id);
        used += item.width;
    }
    return {
        shown: items.filter((item) => kept.has(item.id)).map((item) => item.id),
        hidden: items.filter((item) => !kept.has(item.id)).map((item) => item.id),
    };
}
