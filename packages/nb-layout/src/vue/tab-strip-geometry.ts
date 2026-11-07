/**
 * 标签条的插入判定（docs/specs/ui/workbench-layout.md 输出 25）：指针在 `TabStrip` 里算插到哪。读 DOM，只认 `TabStrip` 写的 `data-tab-row`、`data-panel-tab`、`data-tab-partition`。
 *
 * 返回邻居的标签键，不返回下标：收进“更多”的标签不在 DOM 里，下标、分区要不要换、是不是原位，都要宿主按它的文档换算。
 */

import {resolveListInsertion} from "../grid-drop";
import type {GridDropPoint, GridDropRect} from "../grid-drop";

const rectOf = (element: Element): GridDropRect => {
    const box = element.getBoundingClientRect();
    return {left: box.left, top: box.top, right: box.right, bottom: box.bottom};
};

interface Member {
    readonly id: string;
    /** 整个标签（含关闭按钮）的矩形。 */
    readonly rect: GridDropRect;
    readonly partition: string | null;
}

/** 看得见的一行：多行时一个分区会折成几条。 */
interface Line {
    readonly partition: string | null;
    readonly rect: GridDropRect;
    readonly members: ReadonlyArray<Member>;
}

const memberOf = (tab: HTMLElement): Member => ({id: tab.dataset.panelTab as string, rect: rectOf(tab.parentElement as HTMLElement), partition: tab.dataset.tabPartition ?? null});

/** 这个标签条按呈现顺序的全部标签（含滚出视口的、折到别的行的）。 */
const allMembers = (strip: Element): Member[] => [...strip.querySelectorAll<HTMLElement>("[data-panel-tab]")].map(memberOf);

function linesOf(strip: Element): Line[] {
    const lines: Line[] = [];
    const stripRect = rectOf(strip);
    for (const row of strip.querySelectorAll<HTMLElement>("[data-tab-row]")) {
        const frames = [...row.querySelectorAll<HTMLElement>("[data-panel-tab]")].map(memberOf);
        const rowPartition = row.dataset.tabRowPartition ?? null;
        const byTop = new Map<number, Member[]>();
        for (const frame of frames) {
            const key = Math.round(frame.rect.top);
            byTop.set(key, [...(byTop.get(key) ?? []), frame]);
        }
        const rowRect = rectOf(row);
        for (const [, members] of [...byTop].sort(([a], [b]) => a - b)) {
            const top = Math.min(...members.map((member) => member.rect.top));
            const bottom = Math.max(...members.map((member) => member.rect.bottom));
            lines.push({partition: rowPartition, rect: {left: Math.max(stripRect.left, rowRect.left), right: Math.min(stripRect.right, rowRect.right), top, bottom}, members});
        }
        // 空的行（多行时没有普通标签）：整行是一个插入位。
        if (frames.length === 0) lines.push({partition: rowPartition, rect: rowRect, members: []});
    }
    return lines;
}

export interface TabStripInsertion {
    /** 插到这个标签前面；分区末尾时是 null。 */
    readonly before: string | null;
    /** 插入位前面那个标签（分区里）；`before` 为 null 时插到它后面，它也没有时分区是空的。 */
    readonly after: string | null;
    /** 落到哪个分区；没有分区的标签条是 null。 */
    readonly partition: string | null;
    readonly indicator: GridDropRect;
}

/** 指针在标签条里的插入位：先按纵向距离选行（在行里的距离为 0），再在行里求。 */
export function resolveTabStripInsertion(strip: Element, point: GridDropPoint): TabStripInsertion | null {
    const lines = linesOf(strip);
    if (lines.length === 0) return null;
    const distance = (line: Line): number => (point.y < line.rect.top ? line.rect.top - point.y : point.y > line.rect.bottom ? point.y - line.rect.bottom : 0);
    const line = lines.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
    const containerRect = {...line.rect, left: Math.min(line.rect.left, point.x), right: Math.max(line.rect.right, point.x)};
    const insertion = resolveListInsertion({orientation: "horizontal", point: {x: point.x, y: (line.rect.top + line.rect.bottom) / 2}, containerRect, members: line.members.map(({id, rect}) => ({id, rect}))});
    if (insertion === null) return null;
    const all = allMembers(strip);
    const samePartition = (partition: string | null): ReadonlyArray<Member> => all.filter((member) => member.partition === partition);
    if (insertion.beforeId !== null) {
        // 单行时几个分区同在一行：插在固定标签前面才算进固定区，所以分区看后面那个标签。
        const before = all.find((member) => member.id === insertion.beforeId);
        const partition = before?.partition ?? line.partition;
        const inPartition = samePartition(partition);
        const at = inPartition.findIndex((member) => member.id === insertion.beforeId);
        return {before: insertion.beforeId, after: inPartition[at - 1]?.id ?? null, partition, indicator: insertion.indicator};
    }
    // 行尾的插入位：共享算法只认这一行看得见的成员，`null` 只是“最后一个看得见的之后”。换算成完整顺序里它的后继（滚出视口的、折到下一行的都算），
    // 后继看得见时线画在它前面（换行处归一到下一行行首）；没有后继才是分区末尾。
    const visible = line.members.filter((member) => member.rect.right > containerRect.left && member.rect.left < containerRect.right);
    const last = visible.at(-1);
    const partition = last?.partition ?? line.partition;
    const inPartition = samePartition(partition);
    const successor = last === undefined ? undefined : inPartition[inPartition.findIndex((member) => member.id === last.id) + 1];
    if (successor === undefined) return {before: null, after: last?.id ?? null, partition, indicator: insertion.indicator};
    const view = rectOf(strip);
    const seen = successor.rect.left >= view.left && successor.rect.right <= view.right && successor.rect.top >= view.top && successor.rect.bottom <= view.bottom;
    return {before: successor.id, after: last?.id ?? null, partition, indicator: seen ? {left: successor.rect.left - 1, right: successor.rect.left + 1, top: successor.rect.top, bottom: successor.rect.bottom} : insertion.indicator};
}

/**
 * 键盘能停的位置：每个标签的左缘，和每行最后一个的右缘。放回 `resolveTabStripInsertion` 就是对应的插入位。只留落在标签条看得见的范围里的点（横向滚走的、纵向收起来的行都不算）：
 * 指针也到不了那里，停靠点落在标签条外面就看不见了。比行还宽的标签只看它的边，不会让一整行都没有位置。
 */
export function tabStripStops(strip: Element): ReadonlyArray<GridDropPoint> {
    const view = rectOf(strip.querySelector("[role='tablist']") ?? strip);
    const stops: GridDropPoint[] = [];
    for (const line of linesOf(strip)) {
        const y = (line.rect.top + line.rect.bottom) / 2;
        if (y < view.top || y > view.bottom) continue;
        const seen = (x: number): boolean => x >= line.rect.left && x <= line.rect.right;
        for (const member of line.members) if (seen(member.rect.left + 1)) stops.push({x: member.rect.left + 1, y});
        const last = line.members.at(-1);
        if (last !== undefined && seen(last.rect.right - 1)) stops.push({x: last.rect.right - 1, y});
        if (line.members.length === 0) stops.push({x: line.rect.left + 1, y});
    }
    return stops;
}
