/**
 * 位置：存在对象上的“安放”与读取用的“读取位置”，以及它们的先后（docs/specs/canon/model.md 输出 2）。
 *
 * 全序：前史按 `order`，之后各章按宿主给的章序，章内按排序键；键相同按写入它的修订的版本，再按 id 的数值部分。
 * 未排章与安放在章序里没有的章（已删除）上的对象不在序里。读取位置：初值在一切之前（前史也不套）；
 * 第 N 章开头在第 N 章的所有安放之前；第 N 章末尾在它们之后。
 */

import {compareIds} from "./ids";
import type {Placement, ReadPosition} from "./schema";

export type {Placement, ReadPosition};

/** 宿主给的章序；`index` 对不在序里的章返回 undefined。 */
export class ChapterOrder {
    readonly ids: readonly string[];
    readonly #index: ReadonlyMap<string, number>;

    constructor(ids: readonly string[]) {
        this.ids = [...ids];
        this.#index = new Map(ids.map((id, index) => [id, index]));
    }

    index(chapter: string): number | undefined {
        return this.#index.get(chapter);
    }

    has(chapter: string): boolean {
        return this.#index.has(chapter);
    }
}

/**
 * 一个安放在全序里的键：`[段, 主序, 次序]`。前史段 0，章段 1；不在序里（未排章、章已删除）返回 null。
 * 读取位置用同一种键比较：章开头的次序是 −∞，末尾是 +∞。
 */
export type Rank = readonly [number, number, number];

export function placementRank(order: ChapterOrder, placement: Placement): Rank | null {
    if (placement.kind === "prehistory") return [0, placement.order, 0];
    if (placement.kind === "unscheduled") return null;
    const index = order.index(placement.chapter);
    return index === undefined ? null : [1, index, placement.key];
}

/** 读取位置的键；章不在序里返回 null（调用方报 `chapter-not-found`）。初值返回 −∞ 的键。 */
export function positionRank(order: ChapterOrder, position: ReadPosition): Rank | null {
    if (position.kind === "initial") return [-1, 0, 0];
    const index = order.index(position.chapter);
    if (index === undefined) return null;
    return [1, index, position.edge === "start" ? -Infinity : Infinity];
}

export function compareRanks(a: Rank, b: Rank): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** 安放在读取位置之前（这个位置要套上它）。 */
export function rankBefore(placement: Rank, position: Rank): boolean {
    return compareRanks(placement, position) < 0;
}

/** 同一键上的次序：写入它的修订的版本，再按 id 的数值部分（model.md 输出 2）。 */
export interface OrderTie {
    readonly version: number;
    readonly id: string;
}

export function compareTie(a: OrderTie, b: OrderTie): number {
    return a.version - b.version || compareIds(a.id, b.id);
}

/** 一章的开头位置与末尾位置。 */
export function chapterStart(chapter: string): ReadPosition {
    return {kind: "chapter", chapter, edge: "start"};
}

export function chapterEnd(chapter: string): ReadPosition {
    return {kind: "chapter", chapter, edge: "end"};
}

/** 缺省的读取位置：有章时是最新一章末尾，没有章时是初值（model.md 输出 21）。 */
export function defaultPosition(order: ChapterOrder): ReadPosition {
    const last = order.ids.at(-1);
    return last === undefined ? {kind: "initial"} : chapterEnd(last);
}

/** 按全序列出所有读取位置：初值、每章开头与末尾。差分测试与规模测量用。 */
export function allPositions(order: ChapterOrder): ReadPosition[] {
    const positions: ReadPosition[] = [{kind: "initial"}];
    for (const chapter of order.ids) positions.push(chapterStart(chapter), chapterEnd(chapter));
    return positions;
}
