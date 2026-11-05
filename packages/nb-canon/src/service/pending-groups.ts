/**
 * 待处理、提示与已处理三组（docs/specs/canon/model.md 输出 16、34、35）：内核自己的待处理与提示，加上插件诊断的发现，
 * 按同一个全序排。
 *
 * 全序：先按项的排序位置——前史在前，再按章序；同一章里，带安放的项按排序键在前，带讲述发生点的项按段与偏移在后——
 * 没有排序位置的排在最后；同一位置按种类，再按项的排序 id，最后按整项的规范 JSON。世界线与时间的种类随阶段 C、D 加。
 */

import {EMPTY_MARK_REGISTRY, markStatus} from "../components/marks";
import {placementRank, type ChapterOrder} from "../core/position";
import type {ObjectRef, Placement, Telling} from "../core/schema";
import {stableStringify} from "../core/stable-json";
import type {PendingItem} from "../engine/types";
import {timeItemChanges, timeItemKey, type TimePendingItem} from "../time/state";
import {namespaceAvailability} from "../model/apply";
import {marksIn} from "../world/references";
import type {LostReason, Occurrence, TellingLocator} from "../world/tellings";
import type {World} from "../world/world";
import type {Finding} from "./diagnostics";

/** 内核自己的提示（model.md 输出 16、26、28、34）。 */
export type CanonHint =
    | {readonly code: "telling-lost"; readonly telling: string; readonly owner: ObjectRef; readonly reason: LostReason}
    | {readonly code: "duplicate-quote"; readonly telling: string; readonly owner: ObjectRef; readonly count: number}
    | {readonly code: "mark-kind-unknown" | "mark-version-unsupported"; readonly owner: ObjectRef; readonly path: string; readonly kind: string}
    | {readonly code: "component-unknown" | "component-version-unsupported"; readonly entry: string; readonly namespace: string}
    | {readonly code: "diagnostic-duplicate-key"; readonly diagnostic: string; readonly key: string};

/** 三组里的一项。插件的发现带诊断 id 与级别；已处理组里的带处理它的决策，旧版本的决策放在 `earlierDecision`。 */
export type GroupItem =
    | {readonly kind: "canon"; readonly item: PendingItem | TimePendingItem}
    | {readonly kind: "hint"; readonly hint: CanonHint}
    | {
          readonly kind: "finding";
          readonly diagnostic: string;
          readonly level: "pending" | "hint";
          readonly finding: Finding;
          /** 发现挂在讲述上、讲述能定位时的发生点。 */
          readonly occurrence?: Occurrence;
          readonly earlierDecision?: string;
          readonly handledBy?: string;
      };

/** `pending` 的一页（project.md 方法表）：这一组的项、完整与否、没算出与被截断的诊断、因插件停用而未计算的诊断、各组总数。 */
export interface PendingPage {
    readonly version: number;
    readonly textDigest: string;
    readonly inputDigest: string;
    readonly group: "pending" | "hints" | "handled";
    readonly items: readonly GroupItem[];
    readonly complete: boolean;
    readonly unavailable: readonly {readonly diagnostic: string; readonly reason: string}[];
    readonly truncated: readonly string[];
    readonly disabled: readonly string[];
    readonly counts: {readonly pending: number; readonly hints: number; readonly handled: number};
    readonly decisionsPending: number;
    readonly suggestionsOpen: number;
    readonly cursor?: string;
}

/** 排序位置：`[0, 前史序]`、`[1, 章序, 0, 排序键]`（安放）或 `[1, 章序, 1, 段, 偏移]`（讲述发生点）；没有时为 null。 */
export type SortPosition = readonly number[] | null;

export function placementPosition(order: ChapterOrder, placement: Placement | undefined): SortPosition {
    if (placement === undefined) return null;
    const rank = placementRank(order, placement);
    if (rank === null) return null;
    return rank[0] === 0 ? [0, rank[1]] : [1, rank[1], 0, rank[2]];
}

export function occurrencePosition(order: ChapterOrder, occurrence: Occurrence): SortPosition {
    const index = order.index(occurrence.chapter);
    return index === undefined ? null : [1, index, 1, occurrence.paragraph, occurrence.offset];
}

export interface Sortable {
    readonly position: SortPosition;
    /** 同一位置上种类的先后（各组自己的表）。 */
    readonly kindOrder: number;
    readonly sortId: string;
    readonly item: GroupItem;
}

function comparePositions(a: SortPosition, b: SortPosition): number {
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const left = a[index] ?? -Infinity;
        const right = b[index] ?? -Infinity;
        if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
}

export function sortGroup(items: Sortable[]): GroupItem[] {
    // 最后一级按整项的规范 JSON：项都是 JSON 值，stableStringify 与 RFC 8785 的键序相同。
    const keyed = items.map((entry) => ({entry, json: stableStringify(entry.item)}));
    keyed.sort((a, b) => comparePositions(a.entry.position, b.entry.position) || a.entry.kindOrder - b.entry.kindOrder || (a.entry.sortId < b.entry.sortId ? -1 : a.entry.sortId > b.entry.sortId ? 1 : 0) || (a.json < b.json ? -1 : a.json > b.json ? 1 : 0));
    return keyed.map(({entry}) => entry.item);
}

/** 待处理组里内核各种项的先后；插件的发现排在最后（输出 16）。 */
export const PENDING_GROUP_ORDER = {"check-mismatch": 0, "cannot-apply": 1, held: 2, "chapter-deleted": 3, "time-conflict": 5, "time-invalid": 5, "time-placement-mismatch": 5, finding: 6} as const;
/** 提示组里的先后：讲述失联、原句重复、标注与 Component 的版本与类型不在、插件的诊断。 */
export const HINT_GROUP_ORDER = {"telling-lost": 0, "duplicate-quote": 1, mark: 2, finding: 5} as const;

/** 内核自己的待处理项的排序位置与排序 id（输出 16：核对点取比较时点，按根因合并的取最早那条的安放）。 */
export function sortableCanonItem(world: World, item: PendingItem | TimePendingItem): Sortable {
    const order = world.options.order;
    const changeAt = (id: string) => world.data.changes.get(id)?.at;
    let position: SortPosition = null;
    let sortId = "";
    if (item.kind === "check-mismatch") {
        const check = world.data.checks.get(item.check);
        const anchored = check?.anchor === undefined ? undefined : changeAt(check.anchor.change);
        position = placementPosition(order, anchored ?? check?.place);
        sortId = item.check;
    } else if (item.kind === "cannot-apply") {
        position = item.changes.map((id) => placementPosition(order, changeAt(id))).reduce<SortPosition>((earliest, next) => (comparePositions(next, earliest) < 0 ? next : earliest), null);
        sortId = item.root;
    } else if (item.kind === "held") {
        position = placementPosition(order, changeAt(item.change));
        sortId = item.change;
    } else if (item.kind === "time-conflict" || item.kind === "time-invalid" || item.kind === "time-placement-mismatch") {
        // 涉及几件事的取其中最早的安放（输出 16）；排序 id 是项的键。
        position = timeItemChanges(item).map((id) => placementPosition(order, changeAt(id))).reduce<SortPosition>((earliest, next) => (comparePositions(next, earliest) < 0 ? next : earliest), null);
        sortId = timeItemKey(item);
    } else {
        sortId = item.ref.id;
    }
    return {position, kindOrder: PENDING_GROUP_ORDER[item.kind], sortId, item: {kind: "canon", item}};
}

/**
 * 内核自己的提示（输出 16、26、28、34）：讲述失联、原句重复、只读的标注、条目上类型不在或版本对不上的 Component。
 * 失联的讲述排在它所在对象的安放上；标注排在它挂的讲述的发生点（或对象的安放）上；Component 的没有排序位置。
 */
export function canonHints(world: World, locator: TellingLocator): Sortable[] {
    const order = world.options.order;
    const marks = world.options.marks ?? EMPTY_MARK_REGISTRY;
    const found: Sortable[] = [];
    const ownerPlacement = (owner: ObjectRef): Placement | undefined => (owner.kind === "change" ? world.data.changes.get(owner.id)?.at : owner.kind === "check" ? world.data.checks.get(owner.id)?.place : undefined);
    const tellingPositions = new Map<string, SortPosition>();
    const visitTellings = (owner: ObjectRef, tellings: readonly Telling[]) => {
        for (const telling of tellings) {
            const located = locator.locate(telling);
            const position = located.kind === "found" ? occurrencePosition(order, located.occurrence) : placementPosition(order, ownerPlacement(owner));
            tellingPositions.set(`${owner.kind}:${owner.id}:${telling.id}`, position);
            if (located.kind === "lost") found.push({position, kindOrder: HINT_GROUP_ORDER["telling-lost"], sortId: telling.id, item: {kind: "hint", hint: {code: "telling-lost", telling: telling.id, owner, reason: located.reason}}});
            if (located.kind === "found" && located.count > 1 && telling.nth === undefined) found.push({position, kindOrder: HINT_GROUP_ORDER["duplicate-quote"], sortId: telling.id, item: {kind: "hint", hint: {code: "duplicate-quote", telling: telling.id, owner, count: located.count}}});
        }
    };
    for (const change of world.data.changes.values()) visitTellings({kind: "change", id: change.id}, change.told);
    for (const check of world.data.checks.values()) visitTellings({kind: "check", id: check.id}, [check.told]);
    for (const entry of world.data.entries.values()) for (const tellings of Object.values(entry.retold ?? {})) visitTellings({kind: "entry", id: entry.id}, tellings);

    const markOwners: Array<[ObjectRef["kind"], Iterable<{readonly id: string}>]> = [["change", world.data.changes.values()], ["check", world.data.checks.values()], ["entry", world.data.entries.values()], ["decision", world.data.decisions.values()]];
    for (const [kind, objects] of markOwners) {
        for (const object of objects) {
            const owner: ObjectRef = {kind, id: object.id};
            for (const location of marksIn(kind, object)) {
                const position = location.telling === undefined ? placementPosition(order, ownerPlacement(owner)) : (tellingPositions.get(`${kind}:${object.id}:${location.telling}`) ?? null);
                for (const [index, mark] of location.marks.entries()) {
                    const code = markStatus(marks, mark);
                    if (code !== null) found.push({position, kindOrder: HINT_GROUP_ORDER.mark, sortId: object.id, item: {kind: "hint", hint: {code, owner, path: `${location.path}[${String(index)}]`, kind: mark.kind}}});
                }
            }
        }
    }
    for (const entry of world.data.entries.values()) {
        if (entry.deleted === true) continue;
        for (const [namespace, data] of Object.entries(entry.init.data)) {
            if (data.removed === true) continue;
            const availability = namespaceAvailability(world.options.registry, namespace, data);
            if (availability !== "ok") found.push({position: null, kindOrder: HINT_GROUP_ORDER.mark, sortId: entry.id, item: {kind: "hint", hint: {code: availability, entry: entry.id, namespace}}});
        }
    }
    return found;
}
