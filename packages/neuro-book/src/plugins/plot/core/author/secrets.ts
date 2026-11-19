/**
 * 作者用的保密表（docs/specs/plot/knowledge.md 输出 14）与主要角色（docs/specs/plot/goals.md 输出 6）：“谁知道什么”一页要的全部
 * 东西，用同一份读取视图算。整张表算完再分页：分段条数、候选的人要按全表算，行要按主体在条目树里的顺序排。
 *
 * 导出的读取按视图、模式、位置与参数缓存整张结果（`../view-cache.ts`，同知情索引）：同一份读取输入上的再读、下一页与几个分页读
 * 同一个人只做投影（plot/author-ui.md 输出 20 的“再读与下一页 100 毫秒”）。返回的对象共用，调用方不改它。
 */

import type {CanonReadView, Entry, Mode, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS} from "../../shared/declarations";
import type {Secrecy} from "../../shared/declarations";
import {knowingIndex} from "../knowledge";
import {perViewCache} from "../view-cache";
import {authorDecision, authorPeople, bodyOf, firstReveals, isSecret, pointsAt, readerAt, secrecyOf} from "./knowing";
import type {AuthorDecision, AuthorDegree, AuthorPlace} from "./knowing";

export const SECRET_SEGMENTS = ["all", "readerOnly", "readerUnaware", "noPlan"] as const;
export type SecretSegment = (typeof SECRET_SEGMENTS)[number];

/** “别的人”一格至多列这么多人，其余只给总数。 */
export const OTHERS_MAX = 12;

export interface SecretReveal {
    readonly plan: string;
    /** 安放的章；未排章时为 null。 */
    readonly chapter: string | null;
    readonly mode: "hint" | "explicit";
    /** 在所选位置已经兑现。 */
    readonly done: boolean;
}

export interface SecretRow {
    readonly point: string;
    readonly secrecy: Secrecy;
    /** 条目树里的父条目；根下为 null。 */
    readonly subject: string | null;
    /** 点名的人各自的程度（没有行是 `none`）与他以为的那句。 */
    readonly people: Readonly<Record<string, {readonly degree: AuthorDegree; readonly belief: string | null}>>;
    /** 没点名的人里知道、信错了、怀疑、忘了的，至多 `OTHERS_MAX` 个。 */
    readonly others: readonly {readonly person: string; readonly degree: AuthorDegree}[];
    readonly othersTotal: number;
    readonly reader: {readonly degree: "knows" | "suspects" | "unaware"; readonly suspects: AuthorPlace | null; readonly knows: AuthorPlace | null};
    readonly reveals: readonly SecretReveal[];
    /** 直接挂在它上面、待定或已定的决策。 */
    readonly decisions: readonly AuthorDecision[];
    /** 只经读者守卫关联的决策。 */
    readonly guards: readonly AuthorDecision[];
}

export interface SecretsTable {
    readonly rows: readonly SecretRow[];
    readonly counts: Readonly<Record<SecretSegment, number>>;
    /** 候选的人：任何一行里知道、信错了、怀疑、忘了的人加主要角色，按 id 排。 */
    readonly candidates: readonly string[];
    readonly main: readonly string[];
    /** 每个人在多少行里知道、信错了、怀疑或忘了（缺省点名用）。 */
    readonly appearances: ReadonlyMap<string, number>;
}

const KNOWING_DEGREES: ReadonlySet<AuthorDegree> = new Set(["knows", "misbelieves", "suspects", "forgot"]);
const AWARE_DEGREES: ReadonlySet<AuthorDegree> = new Set(["knows", "misbelieves", "suspects"]);

/** “谁知道什么”缺省选几个人（plot/author-ui.md 输出 10）。 */
export const DEFAULT_PEOPLE = 3;

/**
 * 缺省点名的人（plot/author-ui.md 输出 10）：主要角色里按名字的前 3 个；没有主要角色时，候选里出现在行里最多的前 3 个（一样多按名字）。
 * 名字按同一份视图读。
 */
export function defaultPeople(view: CanonReadView, position: ReadPosition, mode: Mode, table: Pick<SecretsTable, "main" | "candidates" | "appearances">): string[] {
    const nameOf = (id: string): string => {
        const read = view.entry(id, position, mode);
        return read === null || read === "chapter-not-found" ? id : read.name;
    };
    const byName = (a: string, b: string) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : a < b ? -1 : 1);
    if (table.main.length > 0) return [...table.main].sort(byName).slice(0, DEFAULT_PEOPLE);
    return [...table.candidates].sort((a, b) => (table.appearances.get(b) ?? 0) - (table.appearances.get(a) ?? 0) || byName(a, b)).slice(0, DEFAULT_PEOPLE);
}

/** 主要角色（goals.md 输出 6）：读取位置上持有进行或受挫目标的人或组织（本体），按 id 排。 */
export function mainCharacters(view: CanonReadView, position: ReadPosition, mode: Mode): string[] {
    const holders = new Set<string>();
    for (const entry of view.entries()) {
        if (entry.type !== ENTRY_TYPES.goal || entry.deleted === true || entry.parent === null) continue;
        const read = view.entry(entry.id, position, mode);
        if (read === null || read === "chapter-not-found" || read.deleted || !read.appeared) continue;
        const status = read.namespaces.goal?.fields.状态?.value;
        if (status === "active" || status === "blocked") holders.add(bodyOf(view, entry.parent));
    }
    return [...holders].sort();
}

/** 条目在条目树里的排序键：从根到它，每一层的（顺序，id）。 */
export function treeKey(view: CanonReadView, id: string | null): readonly (string | number)[] {
    const chain: (string | number)[] = [];
    const seen = new Set<string>();
    let current = id;
    while (current !== null && !seen.has(current)) {
        seen.add(current);
        const entry = view.object({kind: "entry", id: current}) as Entry | undefined;
        if (entry === undefined) break;
        chain.unshift(entry.order, entry.id);
        current = entry.parent;
    }
    return chain;
}

export function compareKeys(a: readonly (string | number)[], b: readonly (string | number)[]): number {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const x = a[index]!;
        const y = b[index]!;
        if (x === y) continue;
        return typeof x === "number" && typeof y === "number" ? x - y : String(x) < String(y) ? -1 : 1;
    }
    return a.length - b.length;
}

/** 所选线上看得到、生效的揭示计划（未来的也列；取消、被取代的不列），按知识点分组。 */
function revealsByPoint(view: CanonReadView, position: ReadPosition): Map<string, SecretReveal[]> {
    const found = new Map<string, SecretReveal[]>();
    for (const plan of view.changes({kind: "plan", status: "active", inView: view.line}) as readonly StoryChange[]) {
        const progress = view.progress(plan.id, position);
        if (progress === "cancelled" || progress === "replaced" || progress === "chapter-not-found") continue;
        for (const telling of plan.told) {
            for (const mark of telling.marks ?? []) {
                if (mark.kind !== MARK_IDS.reveal || mark.version !== 1 || typeof mark.point !== "string") continue;
                const list = found.get(mark.point) ?? [];
                list.push({plan: plan.id, chapter: plan.at.kind === "chapter" ? plan.at.chapter : null, mode: mark.mode === "explicit" ? "explicit" : "hint", done: progress === "fulfilled"});
                found.set(mark.point, list);
            }
        }
    }
    return found;
}

/**
 * 整张保密表。`people` 是调用方点名的人（表的列）；其余的人进“别的人”一格。行按主体在条目树里的顺序、再按名字排；分段只筛行，
 * 条数与候选按全表算。
 */
export function secretsTable(view: CanonReadView, mode: Mode, position: ReadPosition, people: readonly string[], segment: SecretSegment = "all"): SecretsTable {
    return tableCache(view, JSON.stringify([mode, position, people, segment]), () => buildSecretsTable(view, mode, position, people, segment));
}
const tableCache = perViewCache<SecretsTable>();

function buildSecretsTable(view: CanonReadView, mode: Mode, position: ReadPosition, people: readonly string[], segment: SecretSegment): SecretsTable {
    const index = knowingIndex(view, mode, position);
    const everyone = authorPeople(view, position);
    const named = new Set(people.map((person) => bodyOf(view, person)));
    const main = mainCharacters(view, position, mode);
    const reveals = revealsByPoint(view, position);
    const live = view.decisions().filter((decision) => decision.status === "pending" || decision.status === "decided");
    const candidates = new Set(main);
    const appearances = new Map<string, number>();
    const hangs = (decision: (typeof live)[number], point: string): boolean => decision.about.some((about) => (about.kind === "entry" && about.id === point) || (about.kind === "address" && about.at.entry === point));
    const guards = (decision: (typeof live)[number], point: string): boolean => !hangs(decision, point) && (decision.marks ?? []).some((mark) => mark.kind === MARK_IDS.guardReader && (mark as {point?: unknown}).point === point);
    /** 排序与分段要的几样，不进结果：名字、主体在树里的键、是不是有人知道、信错了或怀疑。 */
    const built: {readonly row: SecretRow; readonly name: string; readonly order: readonly (string | number)[]; readonly aware: boolean}[] = [];
    for (const point of pointsAt(view, position, mode)) {
        const secrecy = secrecyOf(view, point.id, position, mode);
        if (!isSecret(secrecy)) continue;
        const columns: Record<string, {degree: AuthorDegree; belief: string | null}> = {};
        const others: {person: string; degree: AuthorDegree}[] = [];
        let aware = false;
        for (const person of everyone) {
            const row = index.effective(person, point.id);
            const degree: AuthorDegree = row?.程度 ?? "none";
            if (KNOWING_DEGREES.has(degree)) {
                candidates.add(person);
                appearances.set(person, (appearances.get(person) ?? 0) + 1);
            }
            if (AWARE_DEGREES.has(degree)) aware = true;
            if (named.has(person)) columns[person] = {degree, belief: row?.他以为的 ?? null};
            else if (KNOWING_DEGREES.has(degree)) others.push({person, degree});
        }
        for (const person of named) columns[person] ??= {degree: "none", belief: null};
        const first = firstReveals(view, point.id);
        const place = (found: AuthorPlace | null): AuthorPlace | null => (found === null ? null : {chapter: found.chapter, paragraph: found.paragraph});
        const read = view.entry(point.id, position, mode);
        built.push({
            row: {
                point: point.id,
                secrecy,
                subject: point.parent,
                people: columns,
                others: others.slice(0, OTHERS_MAX),
                othersTotal: others.length,
                reader: {degree: readerAt(view, point.id, position), suspects: place(first.suspects), knows: place(first.knows)},
                reveals: reveals.get(point.id) ?? [],
                decisions: live.filter((decision) => hangs(decision, point.id)).map(authorDecision),
                guards: live.filter((decision) => guards(decision, point.id)).map(authorDecision),
            },
            name: read === null || read === "chapter-not-found" ? point.init.name : read.name,
            order: treeKey(view, point.parent),
            aware,
        });
    }
    built.sort((a, b) => compareKeys(a.order, b.order) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.row.point < b.row.point ? -1 : 1));
    const inSegment = (item: (typeof built)[number], which: SecretSegment): boolean => {
        if (which === "readerOnly") return item.row.reader.degree !== "unaware" && !item.aware;
        if (which === "readerUnaware") return item.row.reader.degree === "unaware";
        if (which === "noPlan") return item.row.reader.degree !== "knows" && item.row.reveals.length === 0 && item.row.decisions.length === 0;
        return true;
    };
    const counts = Object.fromEntries(SECRET_SEGMENTS.map((which) => [which, built.filter((item) => inSegment(item, which)).length])) as Record<SecretSegment, number>;
    return {rows: built.filter((item) => inSegment(item, segment)).map((item) => item.row), counts, candidates: [...candidates].sort(), main, appearances};
}
