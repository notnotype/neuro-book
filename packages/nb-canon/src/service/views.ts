/**
 * 视图（docs/specs/canon/project.md 输出 24）：一张令牌绑定看的人、线与位置上限。带令牌的读取只看得到上限之前的东西：
 * 读取位置不写时夹到上限，写了晚于上限的位置或范围得到 `view-denied`；列表只返回安放（讲述位置）不晚于上限的。
 * 视图只管线与位置，不按知情过滤内容（那是剧情插件在视图之上做的）。
 *
 * 令牌的寿命由调用方的那一层管：远程调用方断开、进程内的插件入口停止时，那一层调 `closeView`。被拒的读取每次记一条，
 * 每个项目实例只在内存里留最近 500 条，实例停止时丢弃。
 */

import {placementRank, positionRank, rankBefore, type ChapterOrder, type Rank} from "../core/position";
import type {ObjectRef, Placement, ReadPosition, StoryChange} from "../core/schema";
import type {ChangeOutcome, EntryView, Mode} from "../engine/types";
import type {AgentBlock, AuthorBlock} from "../render/render";
import type {TimeAnswer, TimeQuery} from "../time/queries";
import {readBy, type TellingPosition} from "../world/tellings";
import type {ChangeFilter, PresenceFilter, ReadStamp, TellingFilter, TellingItem} from "./reads";

export interface ViewGrant {
    /** 看的人（条目 id）；写手的视图可以没有。 */
    readonly viewer: string | null;
    readonly line: string;
    /** 位置上限：读到这里为止。 */
    readonly until: ReadPosition;
    /** 用途：`writer`、`character` 或别的文字，进审计。 */
    readonly purpose: string;
}

export interface ViewDenial {
    /** 序号：审计的游标按它（单调增加，不复用）。 */
    readonly seq: number;
    readonly time: string;
    readonly viewer: string | null;
    readonly purpose: string;
    readonly method: string;
    /** `denied`：内核拒了这次读取；`placeholder`：插件在视图之上把一些对象换成了占位。 */
    readonly kind: "denied" | "placeholder";
    /** 被挡的对象（插件记的占位带它）。 */
    readonly blocked?: readonly ObjectRef[];
    /** 要读的位置、范围或讲述位置；读了不许带令牌的方法时没有。 */
    readonly position?: unknown;
}

export const VIEW_AUDIT_KEPT = 500;

/** 带视图令牌的一页。 */
export type ViewedPage<T> = ReadStamp & {readonly items: readonly T[]; readonly cursor?: string};

/** 带视图令牌的读取（`WorldService.viewed`、项目内快照的 `viewed`）：方法表里允许带令牌的几种，越界的得到 `view-denied`。 */
export interface ViewedReads {
    entry(id: string, position: ReadPosition | undefined, mode?: Mode): (ReadStamp & {readonly view: EntryView | null; readonly origins?: Readonly<Record<string, unknown>>}) | "chapter-not-found" | "line-not-found" | "view-denied";
    render(entry: string, position: ReadPosition | undefined, mode: Mode, audience: "author" | "agent"): (ReadStamp & {readonly position: ReadPosition; readonly mode: Mode; readonly blocks: readonly (AuthorBlock | AgentBlock)[]}) | null | "chapter-not-found" | "view-denied";
    lookup(names: readonly string[], position: ReadPosition | undefined): (ReadStamp & {readonly found: Readonly<Record<string, readonly string[]>>}) | "chapter-not-found" | "view-denied";
    presence(person: string, filter?: PresenceFilter, cursor?: string, limit?: number): (ViewedPage<{readonly change: StoryChange}> & {readonly uncast: number}) | "chapter-not-found" | "cursor-stale" | "view-denied";
    changes(filter?: ChangeFilter, cursor?: string, limit?: number): ViewedPage<{readonly change: StoryChange; readonly outcome: ChangeOutcome | null}> | "cursor-stale" | "view-denied";
    tellings(filter?: TellingFilter, cursor?: string, limit?: number): ViewedPage<TellingItem> | "cursor-stale" | "view-denied";
    /** 时间的查询（canon.time 输出 15）：网络只用上限之前安放的事；点名上限之后的事或章得到 `view-denied` 并记审计。 */
    /** 列表（一段时间里的事、浏览的这一级里的事）分页，同不带令牌的 `time`。 */
    time(query: TimeQuery, mode?: Mode, cursor?: string, limit?: number): (ReadStamp & {readonly answer: TimeAnswer; readonly cursor?: string}) | "view-denied" | "cursor-stale";
    /** 带令牌调了表里不许带令牌的方法（`object`、`pending`、写入……）：记一条审计并拒。 */
    deny(method: string): "view-denied";
}

/** 上限在章序里的键；章不在序里时为 null（打开视图时就拒）。 */
export function boundRank(order: ChapterOrder, grant: ViewGrant): Rank | null {
    return positionRank(order, grant.until);
}

/** 读取位置不晚于上限（读取位置是“读到这里为止”，相等就是同一处）。 */
export function positionWithin(order: ChapterOrder, grant: ViewGrant, position: ReadPosition): boolean {
    const bound = boundRank(order, grant);
    const rank = positionRank(order, position);
    if (bound === null || rank === null) return false;
    return !rankBefore(bound, rank);
}

/** 安放在上限之前（未排章的不在任何视图里）。 */
export function placementWithin(order: ChapterOrder, grant: ViewGrant, placement: Placement): boolean {
    const bound = boundRank(order, grant);
    const rank = placementRank(order, placement);
    return bound !== null && rank !== null && rankBefore(rank, bound);
}

/** 上限写成讲述位置：章首、章末，或初值（那时什么都没读）。 */
export function boundTellingPosition(grant: ViewGrant): TellingPosition | null {
    return grant.until.kind === "initial" ? null : {chapter: grant.until.chapter, edge: grant.until.edge};
}

/** 讲述读过（发生点不晚于上限）；正文以外的与失联的都没有发生点，不在视图里。 */
export function tellingWithin(order: ChapterOrder, grant: ViewGrant, item: TellingItem): boolean {
    const bound = boundTellingPosition(grant);
    return bound !== null && item.located.kind === "found" && readBy(order, item.located.occurrence, bound);
}

/**
 * 讲述位置（`tellings` 的 `until`）不晚于上限：早于上限所在的章，或在同一章而上限是章末、或两者都是章首。上限是初值时，
 * 任何讲述位置都晚于它。
 */
export function tellingPositionWithin(order: ChapterOrder, grant: ViewGrant, position: TellingPosition): boolean {
    if (grant.until.kind === "initial") return false;
    const bound = order.index(grant.until.chapter);
    const index = order.index(position.chapter);
    if (bound === undefined || index === undefined) return false;
    if (index !== bound) return index < bound;
    return grant.until.edge === "end" || ("edge" in position && position.edge === "start");
}

/** 章的范围（`presence` 的 `to`、`tellings` 的 `to`）晚于上限所在的章：拒。上限是初值时，任何章都晚于它。 */
export function chapterWithin(order: ChapterOrder, grant: ViewGrant, chapter: string): boolean {
    if (grant.until.kind === "initial") return false;
    const bound = order.index(grant.until.chapter);
    const index = order.index(chapter);
    return bound !== undefined && index !== undefined && index <= bound;
}

/** 被拒的读取的审计：只留最近的那些。 */
export class ViewAudit {
    readonly #entries: ViewDenial[] = [];
    #seq = 0;

    record(denial: Omit<ViewDenial, "seq">): void {
        this.#entries.push({seq: ++this.#seq, ...denial});
        if (this.#entries.length > VIEW_AUDIT_KEPT) this.#entries.splice(0, this.#entries.length - VIEW_AUDIT_KEPT);
    }

    get entries(): readonly ViewDenial[] {
        return this.#entries;
    }
}
