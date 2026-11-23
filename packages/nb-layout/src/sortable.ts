/**
 * 可排序列表的位置判定（docs/specs/ui/sortable-list.md）：几组排成一串的项，被拖的那一项该落在哪个位置。纯函数，不碰 DOM：
 * 布局由调用方按这一刻量好交进来（预览就是真实布局，所以每次判定都量当前的，占位与各种间距都是真的，不另外建模）。
 *
 * 判定同标签条里排序（docs/specs/ui/workbench-layout.md 输出 38“标签条上”）：除来源之外的成员与第二个起的分区头排成一串“邻居”，
 * 往后时被拖的后沿过了下一个邻居的中线、往前时前沿过了上一个邻居的中线，就换过去。轴是哪一个由调用方决定，这里只有一维的区间。
 */

/** @experimental */
export type SortableAxis = "vertical" | "horizontal";

/**
 * 沿轴的一段：起点与终点。
 * @experimental
 */
export interface SortableSpan {
    readonly start: number;
    readonly end: number;
}

/**
 * 这一刻的布局，呈现顺序。来源也在里面，在它此刻（上一次预览）的位置上。
 * @experimental
 */
export interface SortableLayout {
    readonly sections: ReadonlyArray<{
        readonly id: string;
        /** 分区头；第一个分区可以没有。后面的分区没有头时，按两区相接处一个零长的邻居算。 */
        readonly head: SortableSpan | null;
        readonly members: ReadonlyArray<{readonly key: string; readonly span: SortableSpan}>;
    }>;
}

/**
 * 一个位置：哪个分区，按摘掉来源之后的次序数的第几位。
 * @experimental
 */
export interface SortableSlot {
    readonly section: string;
    readonly index: number;
}

/**
 * 分区与它的成员次序（宿主的模型）。
 * @experimental
 */
export interface SortableSection {
    readonly id: string;
    readonly keys: readonly string[];
}

/**
 * 按呈现顺序列出来源能去的每个位置：每区从 0 到（不算来源的）成员数，空分区只有第 0 位。
 * @experimental
 */
export function sortableSlots(sections: readonly SortableSection[], source: string): SortableSlot[] {
    return sections.flatMap((section) => {
        const count = section.keys.filter((key) => key !== source).length;
        return Array.from({length: count + 1}, (_, index) => ({section: section.id, index}));
    });
}

/**
 * `key` 此刻在哪个位置；不在任何分区里为 null。
 * @experimental
 */
export function slotOfKey(sections: readonly SortableSection[], key: string): SortableSlot | null {
    for (const section of sections) {
        const index = section.keys.indexOf(key);
        if (index >= 0) return {section: section.id, index};
    }
    return null;
}

/**
 * 把 `key` 移到 `to`（下标夹在那一区的范围里）。位置不变或 `key`、目标分区不存在时交回同一份。
 * @experimental
 */
export function moveInSections(sections: readonly SortableSection[], key: string, to: SortableSlot): readonly SortableSection[] {
    const from = slotOfKey(sections, key);
    const target = sections.find((section) => section.id === to.section);
    if (from === null || target === undefined) return sections;
    const remaining = target.keys.filter((entry) => entry !== key);
    const index = Math.max(0, Math.min(remaining.length, to.index));
    if (from.section === to.section && from.index === index) return sections;
    return sections.map((section) => {
        if (section.id === to.section) return {id: section.id, keys: [...remaining.slice(0, index), key, ...remaining.slice(index)]};
        if (section.id === from.section) return {id: section.id, keys: section.keys.filter((entry) => entry !== key)};
        return section;
    });
}

const mid = (span: SortableSpan): number => (span.start + span.end) / 2;

/**
 * 刚换过去时，从换位的地方往回挪不到这么多不换回来（工作台实时布局的粘滞是 8px）。中线的规则自带的回滞是“来源离开后邻居让出的长度”减去来源的
 * 长度：来源是一区唯一的一项（它一走那一区换成占位）、拖进或拖出空分区时，让出的比来源短，两头的判定线重叠，没有粘滞就会在
 * 分区头附近逐帧来回换。
 * @experimental
 */
export const SORTABLE_STICKY_PX = 12;

/**
 * 上一次换位：从哪到哪，换的时候被拖的前沿在哪。
 * @experimental
 */
export interface SortableSwitch {
    readonly from: SortableSlot;
    readonly to: SortableSlot;
    readonly at: number;
}

const sameSlot = (a: SortableSlot, b: SortableSlot): boolean => a.section === b.section && a.index === b.index;

/**
 * 被拖的东西此刻占 `held`（调用方已夹在列表范围里）：交回该在的位置；来源不在布局里时为 null。`last` 是这一场上一次换位
 * （调用方记着，见 `SORTABLE_STICKY_PX`）。
 *
 * 一次可以连换几位：第一步按真实布局比，后面几步用“摘掉来源”推算的位置（来源后面的邻居都往前让一个来源占的长度），推算与真实
 * 布局有出入时下一帧按重排后的真实布局再判。往后要过“下一个邻居的中线”（它此刻在来源后面，位置含来源的长度），往前要过
 * “上一个邻居的中线”，刚换过去时往回挪一点不会马上换回来。
 * @experimental
 */
export function sortableSlotIn(layout: SortableLayout, source: string, held: SortableSpan, last: SortableSwitch | null = null): SortableSlot | null {
    const slots: SortableSlot[] = [];
    /** `neighbors[k]` 在 `slots[k]` 与 `slots[k + 1]` 之间。 */
    const neighbors: SortableSpan[] = [];
    let current = -1;
    let sourceSpan: SortableSpan | null = null;
    /** 来源后面紧挨着的那个元素的起点：摘掉来源时后面的东西往前让 `它 - 来源的起点`（来源的长度加一个间距）。 */
    let afterSource: number | null = null;
    let lastEnd = 0;
    layout.sections.forEach((section, sectionIndex) => {
        if (sectionIndex > 0) {
            const head = section.head ?? {start: section.members[0]?.span.start ?? lastEnd, end: section.members[0]?.span.start ?? lastEnd};
            neighbors.push(head);
            if (sourceSpan !== null && afterSource === null) afterSource = head.start;
            lastEnd = head.end;
        }
        let index = 0;
        slots.push({section: section.id, index});
        for (const member of section.members) {
            if (member.key === source) {
                current = slots.length - 1;
                sourceSpan = member.span;
            } else {
                if (sourceSpan !== null && afterSource === null) afterSource = member.span.start;
                neighbors.push(member.span);
                index += 1;
                slots.push({section: section.id, index});
            }
            lastEnd = member.span.end;
        }
    });
    if (current < 0 || sourceSpan === null) return null;
    const from: SortableSpan = sourceSpan;
    const space = afterSource === null ? from.end - from.start : afterSource - from.start;
    // 摘掉来源后各邻居的中线：此刻在来源后面的往前让 `space`。
    const removed = neighbors.map((span, k) => mid(span) - (k >= current ? space : 0));
    let slot = current;
    for (let guard = 0; guard <= neighbors.length; guard += 1) {
        if (slot < neighbors.length && held.end > removed[slot]! + space) slot += 1;
        else if (slot > 0 && held.start < removed[slot - 1]!) slot -= 1;
        else break;
    }
    // 粘滞：正要换回上一次换过来的地方时，要从那次换位的位置往回挪够 SORTABLE_STICKY_PX 才换；往前接着拖不算。
    if (last !== null && sameSlot(slots[current]!, last.to) && sameSlot(slots[slot]!, last.from)) {
        const back = slot < current ? last.at - held.start : held.start - last.at;
        if (back < SORTABLE_STICKY_PX) return slots[current]!;
    }
    return slots[slot]!;
}
