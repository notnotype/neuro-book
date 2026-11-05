/**
 * 待处理的排序（docs/specs/canon/model.md 输出 16），两种引擎共用：先按排序位置（前史在前，再按章序与排序键），没有排序位置
 * 的排在最后；同一位置按种类，再按项的排序 id。世界线、时间与插件诊断的种类随各自的能力加进来。
 */

import {compareIds} from "../core/ids";
import {compareRanks, type Rank} from "../core/position";
import type {PendingItem} from "./types";

/** 同一位置上各种待处理的先后。 */
export const PENDING_KIND_ORDER: Readonly<Record<PendingItem["kind"], number>> = {"check-mismatch": 0, "cannot-apply": 1, held: 2, "chapter-deleted": 3};

export interface RankedPending {
    readonly rank: Rank | null;
    readonly item: PendingItem;
    /** 项的排序 id：对象 id，按根因合并的取根因的 id。 */
    readonly id: string;
}

export function sortPending(items: RankedPending[]): readonly PendingItem[] {
    items.sort((a, b) => {
        if (a.rank === null || b.rank === null) {
            if (a.rank !== b.rank) return a.rank === null ? 1 : -1;
        } else {
            const byRank = compareRanks(a.rank, b.rank);
            if (byRank !== 0) return byRank;
        }
        return PENDING_KIND_ORDER[a.item.kind] - PENDING_KIND_ORDER[b.item.kind] || compareIds(a.id, b.id);
    });
    return items.map((item) => item.item);
}
