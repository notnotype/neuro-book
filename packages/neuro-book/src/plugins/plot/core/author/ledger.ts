/**
 * 作者用的伏笔账本（docs/specs/plot/foreshadowing.md 输出 9）：每个伏笔的阶段、意图、上次提到、间隔与“久没提”（与诊断 longSilence
 * 同一个算法，`silenceOf`）、下一步计划、没打算怎么收（只算生效未兑现的回收计划，比诊断 noPayoffPlanned 严，见行里的说明）、
 * 节点带要的节点；分段与全表条数。计划都只算还作数的：未兑现、未取消，拆出的要拆出它的兑现还在（`splitStillHolds`）。
 * 旧的 `ledger`（输出 8）给 Agent 用，口径不变。
 *
 * 导出的读取按视图、模式、位置与参数缓存整张结果（`../view-cache.ts`，同知情索引）：同一份读取输入上的再读、下一页与几个分页读
 * 同一个人只做投影（plot/author-ui.md 输出 20 的“再读与下一页 100 毫秒”）。返回的对象共用，调用方不改它。
 */

import type {CanonReadView, Mode, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {foreshadowIndex, silenceOf, tellingPositionOf} from "../foreshadowing";
import {perViewCache} from "../view-cache";
import {splitStillHolds} from "./knowing";
import type {Role} from "../foreshadowing";

export const LEDGER_SEGMENTS = ["unpaid", "silent", "unplanned", "dropped", "all"] as const;
export type LedgerSegment = (typeof LEDGER_SEGMENTS)[number];

export interface AuthorLedgerRow {
    readonly id: string;
    readonly name: string;
    readonly importance: string | null;
    readonly stage: string;
    /** 作者把意图标成了放弃。 */
    readonly dropped: boolean;
    readonly lastMentioned: string | null;
    /** 已埋、没回收时，从上次提到到读取位置所在章的章数与是否超过参考间隔；否则为 null。 */
    readonly silence: {readonly chapters: number; readonly long: boolean} | null;
    /** 读取位置之后、生效、未兑现的最早计划节点。 */
    readonly next: {readonly role: Role; readonly chapter: string; readonly plan: string} | null;
    readonly unplanned: boolean;
    /** 写了的节点（读到这个位置为止）与打算写的节点（生效、未兑现），节点带用。 */
    readonly nodes: readonly {readonly role: Role; readonly chapter: string; readonly written: boolean}[];
}

export function authorLedger(view: CanonReadView, mode: Mode, position: ReadPosition, segment: LedgerSegment = "unpaid"): {readonly rows: readonly AuthorLedgerRow[]; readonly counts: Readonly<Record<LedgerSegment, number>>} {
    return tableCache(view, JSON.stringify([mode, position, segment]), () => buildAuthorLedger(view, mode, position, segment));
}
const tableCache = perViewCache<{readonly rows: readonly AuthorLedgerRow[]; readonly counts: Readonly<Record<LedgerSegment, number>>}>();

function buildAuthorLedger(view: CanonReadView, mode: Mode, position: ReadPosition, segment: LedgerSegment): {readonly rows: readonly AuthorLedgerRow[]; readonly counts: Readonly<Record<LedgerSegment, number>>} {
    const index = foreshadowIndex(view, position, mode);
    const until = tellingPositionOf(position);
    const order = new Map(view.chapters.map((chapter, at) => [chapter, at]));
    const now = position.kind === "chapter" ? (order.get(position.chapter) ?? -1) : -1;
    // 章末读完了这一章：之后的计划从下一章起；章首这一章的计划还算“之后”。
    const after = (chapter: string) => {
        const at = order.get(chapter) ?? -1;
        return position.kind === "chapter" && position.edge === "end" ? at > now : at >= now;
    };
    /** 失效拆出的计划不是打算（`splitStillHolds`）：不算下一步，也不画进节点带。 */
    const planHolds = (id: string): boolean => {
        const plan = view.object({kind: "change", id}) as StoryChange | undefined;
        return plan !== undefined && splitStillHolds(view, plan);
    };
    const rows = index.foreshadows.map((foreshadow): AuthorLedgerRow => {
        const stage = index.stage(foreshadow.id, until);
        const written = index.nodesRead(foreshadow.id, until);
        const planned = index.planned.filter((node) => node.foreshadow === foreshadow.id && view.progress(node.plan, position) === "unfulfilled" && planHolds(node.plan));
        const silence = silenceOf(view, index, foreshadow, until);
        const next = planned.filter((node) => after(node.chapter)).sort((a, b) => (order.get(a.chapter) ?? 0) - (order.get(b.chapter) ?? 0))[0];
        return {
            id: foreshadow.id,
            name: foreshadow.name,
            importance: foreshadow.importance,
            stage: stage.stage,
            dropped: foreshadow.intent === "dropped",
            lastMentioned: written.at(-1)?.occurrence.chapter ?? null,
            silence: silence === null ? null : {chapters: silence.chapters, long: silence.long},
            next: next === undefined ? null : {role: next.role, chapter: next.chapter, plan: next.plan},
            // 没打算怎么收（foreshadowing.md 输出 9）：没回收，也没有还作数的回收计划。诊断 noPayoffPlanned 按“带回收节点的计划”算
            // （输出 7，已取消、失效拆出的也算），这里只算上面筛过的、生效未兑现的。
            unplanned: !["unplanted", "paidOff"].includes(index.lineStage(foreshadow.id, until)) && !planned.some((node) => node.role === "payoff"),
            nodes: [...written.map((node) => ({role: node.role, chapter: node.occurrence.chapter, written: true})), ...planned.map((node) => ({role: node.role, chapter: node.chapter, written: false}))],
        };
    });
    const inSegment = (row: AuthorLedgerRow, which: LedgerSegment): boolean => {
        if (which === "unpaid") return row.stage !== "paidOff" && !row.dropped;
        if (which === "silent") return row.silence?.long === true && !row.dropped;
        if (which === "unplanned") return row.unplanned && !row.dropped;
        if (which === "dropped") return row.dropped;
        return true;
    };
    const counts = Object.fromEntries(LEDGER_SEGMENTS.map((which) => [which, rows.filter((row) => inSegment(row, which)).length])) as Record<LedgerSegment, number>;
    return {rows: rows.filter((row) => inSegment(row, segment)), counts};
}
