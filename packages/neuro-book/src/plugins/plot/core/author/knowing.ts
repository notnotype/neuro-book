/**
 * 作者用的知情读取（docs/specs/plot/knowledge.md 输出 11 到 16）：人物页“知道什么”、秘密的“谁知道”与保密表共用的口径。
 *
 * - 人群（输出 13）：所选线、位置与模式上已出场、未删除的人物与组织，马甲归到本体。
 * - 程度：有效知情行的程度；没有行写 `none`，由调用方按保密档决定写“不知道”还是“没有记录”（显式的 `unaware`、`forgot` 原样给）。
 * - 来处（输出 11）：胜出的那个候选（`KnowingIndex.winner`）是初值、一条变更、隐秘目标的出场，还是回溯带过去的。
 * - 读者在读取位置上的程度（输出 12）：读取位置换成讲述的截止，与线和模式无关。
 *
 * 只读世界引擎给的只读视图。
 * 导出的读取按视图、模式、位置与参数缓存整张结果（`../view-cache.ts`，同知情索引）：同一份读取输入上的再读、下一页与几个分页读
 * 同一个人只做投影（plot/author-ui.md 输出 20 的“再读与下一页 100 毫秒”）。返回的对象共用，调用方不改它。
 */

import {paragraphsOf} from "@notnotype/nb-canon/schema";
import type {CanonReadView, Decision, Entry, Mode, ReadPosition, StoryChange, TellingPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, DEFAULT_SECRECY, MARK_IDS} from "../../shared/declarations";
import type {Degree, How, Secrecy} from "../../shared/declarations";
import {foreshadowIndex, tellingPositionOf} from "../foreshadowing";
import {firstReveal, knowingIndex, readerKnowing} from "../knowledge";
import {perViewCache} from "../view-cache";
import type {KnowingIndex, KnowingWinner} from "../knowledge";

export type AuthorDegree = Degree | "none";

/** 一处“在哪”：章（前史为 null）与段（没有讲述时为 null）。 */
export interface AuthorPlace {
    readonly chapter: string | null;
    readonly paragraph: number | null;
}

export type KnowingOrigin =
    | {readonly kind: "initial"}
    | ({readonly kind: "event"; readonly change: string} & AuthorPlace)
    | {readonly kind: "goal"; readonly goal: string; readonly chapter: string | null}
    | {readonly kind: "carried"; readonly fork: string; readonly chapter: string | null; readonly line: string; readonly evidence: ({readonly change: string} & AuthorPlace) | null};

export interface AuthorKnowing {
    readonly point: string;
    readonly degree: AuthorDegree;
    readonly belief: string | null;
    readonly how: How | null;
    readonly from: string | null;
    readonly origin: KnowingOrigin | null;
}

/** 名字表的一项：结果里引用到的条目在同一线、位置、模式上的名字。 */
export interface AuthorName {
    readonly name: string;
    readonly type: string;
}

/** 收集结果里引用到的条目，最后按同一份视图读出名字（作者读取的 `names`）。 */
export class NameTable {
    readonly #ids = new Set<string>();

    constructor(
        readonly view: CanonReadView,
        readonly position: ReadPosition,
        readonly mode: Mode,
    ) {}

    add(id: string | null | undefined): void {
        if (typeof id === "string" && id !== "") this.#ids.add(id);
    }

    build(): Record<string, AuthorName> {
        const names: Record<string, AuthorName> = {};
        for (const id of this.#ids) {
            const read = this.view.entry(id, this.position, this.mode);
            const stored = this.view.object({kind: "entry", id}) as Entry | undefined;
            const name = read !== null && read !== "chapter-not-found" ? read.name : stored?.init.name;
            if (name !== undefined) names[id] = {name, type: stored?.type ?? ""};
        }
        return names;
    }
}

/** 马甲归到本体：`sameAs` 链走到底（链成环时停在第一次重复的地方）。 */
export function bodyOf(view: CanonReadView, id: string): string {
    const seen = new Set<string>();
    let current = id;
    for (;;) {
        if (seen.has(current)) return current;
        seen.add(current);
        const next = (view.object({kind: "entry", id: current}) as Entry | undefined)?.sameAs;
        if (next === undefined) return current;
        current = next;
    }
}

/** 人群（输出 13）：已出场、未删除的人物与组织的本体，按 id 排。 */
export function authorPeople(view: CanonReadView, position: ReadPosition): string[] {
    const limit = view.positionKey(position);
    const people = new Set<string>();
    for (const entry of view.entries()) {
        if (entry.deleted === true || (entry.type !== ENTRY_TYPES.person && entry.type !== ENTRY_TYPES.organization)) continue;
        if (entry.appears !== undefined) {
            const key = view.placementKey(entry.appears);
            if (key === null || limit === null || view.compareKeys(key, limit) >= 0) continue;
        }
        const body = bodyOf(view, entry.id);
        const stored = view.object({kind: "entry", id: body}) as Entry | undefined;
        if (stored?.deleted !== true) people.add(body);
    }
    return [...people].sort();
}

/** 知识点在这个位置上的保密档；读不到时按缺省（保密）。 */
export function secrecyOf(view: CanonReadView, point: string, position: ReadPosition, mode: Mode): Secrecy {
    const read = view.entry(point, position, mode);
    const value = read === null || read === "chapter-not-found" ? null : read.namespaces.point?.fields.保密?.value;
    return typeof value === "string" ? (value as Secrecy) : DEFAULT_SECRECY;
}

export const isSecret = (secrecy: Secrecy): boolean => secrecy === "secret" || secrecy === "topSecret";

/** 已出场、未删除的知识点。 */
export function pointsAt(view: CanonReadView, position: ReadPosition, mode: Mode): Entry[] {
    return view.entries().filter((entry) => {
        if (entry.type !== ENTRY_TYPES.point || entry.deleted === true) return false;
        const read = view.entry(entry.id, position, mode);
        return read !== null && read !== "chapter-not-found" && !read.deleted && read.appeared;
    });
}

/**
 * 一条变更在它安放的那一章里第一处生效讲述的段；前史、没有讲述时为 null。一次读取里同一章只取一次讲述（`cache`）。
 */
function placeOfChange(view: CanonReadView, change: string, cache: Map<string, ReturnType<CanonReadView["tellings"]>>): AuthorPlace {
    const stored = view.object({kind: "change", id: change}) as StoryChange | undefined;
    if (stored === undefined || stored.at.kind !== "chapter") return {chapter: null, paragraph: null};
    const chapter = stored.at.chapter;
    let tellings = cache.get(chapter);
    if (tellings === undefined) {
        tellings = view.tellings({from: chapter, to: chapter, effective: true});
        cache.set(chapter, tellings);
    }
    let paragraph: number | null = null;
    for (const item of tellings) {
        if (item.owner.kind !== "change" || item.owner.id !== change || item.located.kind !== "found" || item.located.occurrence.chapter !== chapter) continue;
        if (paragraph === null || item.located.occurrence.paragraph < paragraph) paragraph = item.located.occurrence.paragraph;
    }
    return {chapter, paragraph};
}

/** 胜出的候选写成来处（输出 11）。 */
export function originOf(view: CanonReadView, winner: KnowingWinner, cache: Map<string, ReturnType<CanonReadView["tellings"]>>): KnowingOrigin {
    if (winner.goal !== undefined) {
        const goal = view.object({kind: "entry", id: winner.goal}) as Entry | undefined;
        return {kind: "goal", goal: winner.goal, chapter: goal?.appears?.kind === "chapter" ? goal.appears.chapter : null};
    }
    if (winner.fork !== undefined) {
        const fork = view.object({kind: "change", id: winner.fork.id}) as StoryChange | undefined;
        // 带过去的行原样取自父线：它的 `change` 是父线上的原证据（推出的行也带着那条变更）。
        const evidence = winner.row.change === undefined ? null : {change: winner.row.change, ...placeOfChange(view, winner.row.change, cache)};
        return {kind: "carried", fork: winner.fork.id, chapter: fork?.at.kind === "chapter" ? fork.at.chapter : null, line: winner.fork.parent, evidence};
    }
    if (winner.change !== undefined) return {kind: "event", change: winner.change, ...placeOfChange(view, winner.change, cache)};
    return {kind: "initial"};
}

function authorRow(view: CanonReadView, index: KnowingIndex, person: string, point: string, cache: Map<string, ReturnType<CanonReadView["tellings"]>>): AuthorKnowing {
    const winner = index.winner(person, point);
    if (winner === null) return {point, degree: "none", belief: null, how: null, from: null, origin: null};
    const row = winner.row;
    return {point, degree: row.程度 ?? "none", belief: row.他以为的 ?? null, how: row.怎么知道 ?? null, from: row.谁告诉的 ?? null, origin: originOf(view, winner, cache)};
}

/** 读者在一个读取位置上的程度（输出 12）：初值是什么都没读；章首是读完上一章，章末是读完这一章。 */
export function readerAt(view: CanonReadView, point: string, position: ReadPosition): "knows" | "suspects" | "unaware" {
    const at: TellingPosition | null = tellingPositionOf(position);
    return at === null ? "unaware" : readerKnowing(view, point, at);
}

/** 整书第一次怀疑与知道的讲述（输出 7），另带那一段开头的 80 个码点。 */
export function firstReveals(view: CanonReadView, point: string): {readonly suspects: (AuthorPlace & {readonly excerpt: string}) | null; readonly knows: (AuthorPlace & {readonly excerpt: string}) | null} {
    const first = firstReveal(view, point);
    const excerpt = (chapter: string, paragraph: number): string => {
        const text = view.chapterText(chapter);
        if (text === undefined) return "";
        // 段用内核的切法（段号从 1 起），与讲述定位的是同一段。
        return [...(paragraphsOf(text)[paragraph - 1]?.text ?? "")].slice(0, 80).join("");
    };
    const of = (found: {readonly chapter: string; readonly paragraph: number} | undefined) => (found === undefined ? null : {chapter: found.chapter, paragraph: found.paragraph, excerpt: excerpt(found.chapter, found.paragraph)});
    return {suspects: of(first.suspects), knows: of(first.knows)};
}

/** 人物页“知道什么”（输出 16）：所有保密以上的知识点（没有行的也列）与有行的别的知识点。 */
const personCache = perViewCache<{readonly secrets: AuthorKnowing[]; readonly others: AuthorKnowing[]}>();
export function personKnowing(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly secrets: AuthorKnowing[]; readonly others: AuthorKnowing[]} {
    return personCache(view, JSON.stringify([mode, position, person]), () => buildPersonKnowing(view, mode, position, person));
}

function buildPersonKnowing(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly secrets: AuthorKnowing[]; readonly others: AuthorKnowing[]} {
    const index = knowingIndex(view, mode, position);
    const cache = new Map<string, ReturnType<CanonReadView["tellings"]>>();
    const body = bodyOf(view, person);
    const secrets: AuthorKnowing[] = [];
    const others: AuthorKnowing[] = [];
    const withRows = new Set(index.all(body).map((row) => row.point));
    for (const point of pointsAt(view, position, mode)) {
        const secret = isSecret(secrecyOf(view, point.id, position, mode));
        if (!secret && !withRows.has(point.id)) continue;
        (secret ? secrets : others).push(authorRow(view, index, body, point.id, cache));
    }
    return {secrets, others};
}

export interface PointRelated {
    /** 挂在它上面（挂点是它或它的地址）、待定或已定的决策。 */
    readonly decisions: readonly AuthorDecision[];
    /** 只经读者守卫关联的决策。 */
    readonly guards: readonly AuthorDecision[];
    /** 以它为答案的伏笔与它们在这个位置的阶段。 */
    readonly foreshadows: readonly {readonly id: string; readonly stage: string; readonly dropped: boolean}[];
    /** `起因` 是它的态度。 */
    readonly attitudes: readonly {readonly holder: string; readonly object: string}[];
    /** `隐秘` 指向它的目标。 */
    readonly goals: readonly string[];
}

export interface AuthorDecision {
    readonly id: string;
    readonly text: string;
    readonly status: "pending" | "decided";
    /** 已定的结论；待定的为 null（重新打开以后留着的旧结论不给）。 */
    readonly conclusion: string | null;
    readonly due: string | null;
}

/**
 * 拆出的计划（`splitFrom`）只在拆出它的那条兑现变更（`by`）还生效、补丁套上时才算数（canon.model 输出 13；同引擎计入计划的
 * 规则）：兑现被撤销以后，拆出的计划不再是打算（plot/knowledge.md 输出 14 的“失效拆出的不列”）。不是拆出的计划总算数。
 */
export function splitStillHolds(view: CanonReadView, plan: StoryChange): boolean {
    const split = plan.links.find((link) => link.kind === "splitFrom");
    if (split === undefined || split.kind !== "splitFrom") return true;
    const by = view.object({kind: "change", id: split.by}) as StoryChange | undefined;
    return by !== undefined && by.status === "active" && view.outcome(split.by)?.applied === true;
}

/** 直接挂在它上面（挂点是它或它的地址）；只经读者守卫指向它的另算。 */
const hangsDirectly = (decision: Decision, point: string): boolean => decision.about.some((about) => (about.kind === "entry" && about.id === point) || (about.kind === "address" && about.at.entry === point));
const guardsReader = (decision: Decision, point: string): boolean => (decision.marks ?? []).some((mark) => mark.kind === MARK_IDS.guardReader && (mark as {point?: unknown}).point === point);

export function authorDecision(decision: Decision): AuthorDecision {
    const status = decision.status === "decided" ? "decided" : "pending";
    return {id: decision.id, text: decision.text, status, conclusion: status === "decided" ? (decision.conclusion ?? null) : null, due: decision.due ?? null};
}

/** 和一个知识点有关的（输出 15 的第三节）。 */
export function pointRelated(view: CanonReadView, mode: Mode, position: ReadPosition, point: string): PointRelated {
    const live = view.decisions().filter((decision) => decision.status === "pending" || decision.status === "decided");
    const decisions = live.filter((decision) => hangsDirectly(decision, point)).map(authorDecision);
    const guards = live.filter((decision) => !hangsDirectly(decision, point) && guardsReader(decision, point)).map(authorDecision);
    const stageAt = tellingPositionOf(position);
    const foreshadowsIndex = foreshadowIndex(view, position, mode);
    const foreshadows: {id: string; stage: string; dropped: boolean}[] = [];
    const attitudes: {holder: string; object: string}[] = [];
    const goals: string[] = [];
    for (const entry of view.entries()) {
        if (entry.deleted === true) continue;
        if (entry.type === ENTRY_TYPES.foreshadow) {
            const read = view.entry(entry.id, position, mode);
            const answer = read === null || read === "chapter-not-found" ? null : (read.namespaces.fs?.fields.答案?.value as {ref?: unknown} | null | undefined)?.ref;
            if (answer === point) foreshadows.push({id: entry.id, ...foreshadowsIndex.stage(entry.id, stageAt)});
            continue;
        }
        if (entry.type === ENTRY_TYPES.goal) {
            const read = view.entry(entry.id, position, mode);
            const secret = read === null || read === "chapter-not-found" ? null : (read.namespaces.goal?.fields.隐秘?.value as {ref?: unknown} | null | undefined)?.ref;
            if (secret === point) goals.push(entry.id);
            continue;
        }
        const read = view.entry(entry.id, position, mode);
        const list = read === null || read === "chapter-not-found" ? null : read.namespaces.att?.fields.态度?.value;
        if (!Array.isArray(list)) continue;
        for (const element of list as Array<Record<string, unknown>>) {
            if ((element.起因 as {ref?: unknown} | null | undefined)?.ref === point) attitudes.push({holder: entry.id, object: String(element.id)});
        }
    }
    return {decisions, guards, foreshadows, attitudes, goals};
}

/** 一个知识点谁知道（输出 15）。子列表的上限由调用方截（远程单次预算）。 */
export function pointKnowing(view: CanonReadView, mode: Mode, position: ReadPosition, point: string): ReturnType<typeof buildPointKnowing> {
    return pointCache(view, JSON.stringify([mode, position, point]), () => buildPointKnowing(view, mode, position, point));
}
const pointCache = perViewCache<ReturnType<typeof buildPointKnowing>>();

function buildPointKnowing(view: CanonReadView, mode: Mode, position: ReadPosition, point: string) {
    const index = knowingIndex(view, mode, position);
    const cache = new Map<string, ReturnType<CanonReadView["tellings"]>>();
    const secrecy = secrecyOf(view, point, position, mode);
    const rows: (AuthorKnowing & {readonly person: string})[] = [];
    let rest = 0;
    for (const person of authorPeople(view, position)) {
        const row = authorRow(view, index, person, point, cache);
        if (row.degree === "none") rest += 1;
        else rows.push({...row, person});
    }
    return {
        point,
        secrecy,
        people: rows,
        /** 没有行的人数；保密以上写“不知道”，否则“没有记录”。 */
        rest: {count: rest, unaware: isSecret(secrecy)},
        reader: {degree: readerAt(view, point, position), ...firstReveals(view, point)},
        related: pointRelated(view, mode, position, point),
    };
}
