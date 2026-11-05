/**
 * 知情（docs/specs/plot/knowledge.md 输出 1 到 7）：有效的知情、传话链、读者的知情。只读世界引擎给的只读视图
 * （`CanonReadView`），不存东西：结果随读取输入（`view.stamp`）变。
 *
 * 有效的知情（输出 3）是三种候选里排序键最大的一个：
 * - 显式的行的每一次变化：对一个人只取一次 `know.知情` 整个列表的来历，按相邻两步比较这一行，前后不同才算这一行的一次变化
 *   （加、去、子字段改、整段替换都这样判；整段替换写出相同的行不算）。同一列表里别的行的增删不会混进来。
 * - 在场推出的：带 `presentLearns` 标注、他在场（`cast` 里 `role: present`、记了 `who`）的变更；实际模式取已写、生效、
 *   套上的，按计划模式再加上这个位置计入的计划（同 canon.model 输出 29）。
 * - 隐秘目标推出的：目标条目的 `隐秘` 指向这个知识点、他是目标的父条目，从目标出场起 `knows`（goals.md 术语）。持有者按
 *   条目树当前的父条目算（条目树不随位置变）。
 * 同一条变更里显式的与推出的都有时显式的优先；显式去掉一行回到“没有行”。
 */

import {sameJson} from "@notnotype/nb-canon/schema";
import type {CanonReadView, EventKey, Mark, Mode, OriginStep, ReadPosition, StoryChange, TellingPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS, type Degree, type How} from "../shared/declarations";
import {perViewCache} from "./view-cache";

/** 一行知情（`know.知情` 的元素，加上它从哪来）。 */
export interface KnowingRow {
    readonly point: string;
    readonly 程度: Degree | null;
    readonly 他以为的?: string | null;
    readonly 怎么知道?: How | null;
    readonly 谁告诉的?: string | null;
    readonly 备注?: string | null;
    /** `explicit`：知情行；`present`：在场推出；`secretGoal`：隐秘目标的持有者推出。 */
    readonly source: "explicit" | "present" | "secretGoal";
    /** 让这一行成为现在这样的那条变更（显式的与在场推出的）；隐秘目标推出的、初值里就有的没有。 */
    readonly change?: string;
}

/** 一条变更让某人对一个知识点的有效知情起的变化（经历用，knowledge.md 输出 9）：改后为 null 是这一行被去掉了。 */
export interface KnowingChange {
    readonly point: string;
    readonly before: KnowingRow | null;
    readonly after: KnowingRow | null;
}

/** 一行里算作知情本身的字段（不含来源与所在的变更；没填的子字段不算，推出的行本来就不带它们）。 */
function knowingFields(row: KnowingRow | null): unknown {
    if (row === null) return null;
    const {source: _source, change: _change, ...fields} = row;
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined));
}

/**
 * 读取位置，或“某条变更之前”（传话链用：比那条变更更早的变更之后），或“某条变更之后”（含它；回溯带过去的知情取父线在触发处
 * 那一刻的有效知情，knowledge 输出 4）。
 */
export type KnowingAt = ReadPosition | {readonly before: string} | {readonly after: string};

/** 比任何安放都早的键：初值。 */
const INITIAL_KEY: EventKey = {rank: [Number.NEGATIVE_INFINITY, 0, 0], tie: {version: -1, id: ""}};

interface Candidate {
    readonly key: EventKey;
    readonly row: KnowingRow | null;
    /** 显式的变化优先于同一条变更推出的。 */
    readonly explicit: boolean;
    readonly change?: string;
}

/** 一份只读视图上、一个模式与一个读取位置的知情索引：每人的逐行历史与推出的候选，按需建，查表。 */
export class KnowingIndex {
    readonly #explicit = new Map<string, Map<string, Candidate[]>>();
    #derived: Map<string, Map<string, Candidate[]>> | null = null;
    readonly #position: ReadPosition;
    readonly #positionKey: EventKey | null;

    constructor(
        readonly view: CanonReadView,
        readonly mode: Mode,
        position: ReadPosition,
    ) {
        this.#position = position;
        this.#positionKey = view.positionKey(position);
    }

    get position(): ReadPosition {
        return this.#position;
    }

    /** 某人在这个位置（或某条变更之前）对一个知识点的有效知情；没有行时为 null。 */
    effective(person: string, point: string, at: KnowingAt = this.#position): KnowingRow | null {
        const inclusive = "after" in at;
        const limit = "before" in at ? this.view.eventKey(at.before, this.mode) : "after" in at ? this.view.eventKey(at.after, this.mode) : at === this.#position ? this.#positionKey : this.view.positionKey(at);
        if (limit === null) return null;
        let best: Candidate | null = null;
        for (const candidate of [...(this.#explicitOf(person).get(point) ?? []), ...(this.#derivedOf().get(person)?.get(point) ?? [])]) {
            const order = this.view.compareKeys(candidate.key, limit);
            if (inclusive ? order > 0 : order >= 0) continue;
            if (best === null) {
                best = candidate;
                continue;
            }
            const against = this.view.compareKeys(candidate.key, best.key);
            // 同一条变更：显式的优先。
            if (against > 0 || (against === 0 && candidate.change !== undefined && candidate.change === best.change && candidate.explicit && !best.explicit)) best = candidate;
        }
        return best?.row ?? null;
    }

    /** 某人在这个位置（缺省是索引的位置）上全部有效的行（显式的与推出的涉及过的知识点）。 */
    all(person: string, at: KnowingAt = this.#position): KnowingRow[] {
        const points = new Set([...this.#explicitOf(person).keys(), ...(this.#derivedOf().get(person)?.keys() ?? [])]);
        return [...points].sort().flatMap((point) => {
            const row = this.effective(person, point, at);
            return row === null ? [] : [row];
        });
    }

    /** 一条变更让这个人哪几行变成了什么（经历里“这条变更让 V 的有效知情起的变化”）：同一行里显式的优先。 */
    changedBy(person: string, change: string): KnowingChange[] {
        const chosen = new Map<string, Candidate>();
        const consider = (point: string, candidate: Candidate) => {
            if (candidate.change !== change) return;
            const existing = chosen.get(point);
            if (existing === undefined || (candidate.explicit && !existing.explicit)) chosen.set(point, candidate);
        };
        for (const [point, history] of this.#explicitOf(person)) for (const candidate of history) consider(point, candidate);
        for (const [point, history] of this.#derivedOf().get(person) ?? []) for (const candidate of history) consider(point, candidate);
        // 改前是这条变更之前的有效知情，改后是这条变更自己的候选（显式的优先；去掉一行是 null）。只比知情的字段，不比来源与
        // 所在的变更：推出了相同程度的在场不算变化。
        return [...chosen.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flatMap(([point, candidate]) => {
            const before = this.effective(person, point, {before: change});
            return sameJson(knowingFields(before), knowingFields(candidate.row)) ? [] : [{point, before, after: candidate.row}];
        });
    }

    /** 这个人的某一行最近一次让程度、怎么知道或谁告诉的变化的那条变更（传话链里“这一行所在的变更”）。 */
    rowChange(person: string, point: string): string | undefined {
        const history = (this.#explicitOf(person).get(point) ?? []).filter((candidate) => this.#positionKey !== null && this.view.compareKeys(candidate.key, this.#positionKey) < 0);
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const now = history[index]!.row;
            const before = index === 0 ? null : history[index - 1]!.row;
            if (now === null) return undefined;
            if (before === null || now.程度 !== before.程度 || now.怎么知道 !== before.怎么知道 || now.谁告诉的 !== before.谁告诉的) return history[index]!.change;
        }
        return undefined;
    }

    /** 一个人 `know.知情` 的逐行历史：每一行每一次真正的变化。来历取到这个位置为止（按计划模式时计入的计划随位置变）。 */
    #explicitOf(person: string): Map<string, Candidate[]> {
        const cached = this.#explicit.get(person);
        if (cached !== undefined) return cached;
        const rows = new Map<string, Candidate[]>();
        this.#explicit.set(person, rows);
        const steps = this.view.origins({entry: person, path: "know.知情"}, this.#position, this.mode);
        if (steps === "chapter-not-found") return rows;
        let previous = new Map<string, Record<string, unknown>>();
        const seenChanges = new Set<string>();
        for (const step of steps) {
            if (step.kind !== "init" && step.kind !== "patch" && step.kind !== "carried") continue;
            // 同一条变更的几个补丁各有一步，值都是这条变更套完以后的：只看一次。
            if (step.kind === "patch") {
                if (seenChanges.has(step.change)) continue;
                seenChanges.add(step.change);
            }
            const value = step.kind === "patch" ? step.result : step.value;
            const list = new Map((Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []).map((element) => [String(element.id), element]));
            const key = step.kind === "init" ? INITIAL_KEY : step.kind === "carried" ? step.key : this.view.eventKey(step.change, this.mode);
            if (key !== null) {
                // 回溯带过去的：这一步以后这个人的有效知情，从父线在触发处（没有时切口）算出的有效知情起（显式加推出，输出 4）。
                const carried = step.kind === "carried" ? this.#parentRows(person, step) : null;
                const points = new Set([...previous.keys(), ...list.keys(), ...(carried?.keys() ?? []), ...(carried === null ? [] : (this.#derivedOf().get(person)?.keys() ?? []))]);
                for (const point of points) {
                    const before = previous.get(point);
                    const after = list.get(point);
                    // 按规范的 JSON 比（键排序）：整段替换写出相同的行、只是键的顺序不同，不算这一行的变化。
                    if (step.kind === "patch" && sameJson(before, after)) continue;
                    if (step.kind === "init" && after === undefined) continue;
                    const history = rows.get(point) ?? [];
                    if (step.kind === "carried") {
                        // 父线上有行就取它；没有行就是这一行不带过去，回到“没有行”。
                        history.push({key, explicit: true, row: carried!.get(point) ?? null});
                    } else history.push({key, explicit: true, row: after === undefined ? null : explicitRow(point, after, step.kind === "patch" ? step.change : undefined), ...(step.kind === "patch" ? {change: step.change} : {})});
                    rows.set(point, history);
                }
            }
            previous = list;
        }
        return rows;
    }

    /** 带过去的那一步上，父线在触发处（没有时切口）这个人全部有效的知情行。父线不在（线不可建）时没有。 */
    #parentRows(person: string, step: Extract<OriginStep, {kind: "carried"}>): Map<string, KnowingRow> {
        // 带过去的值只按实际模式取（worldlines 输出 6）：父线上切口与触发处之间的计划不带过去，计划模式读子线也一样。
        const parent = this.view.onLine(step.line, "actual");
        if ("code" in parent) return new Map();
        const last = parent.chapters.at(-1);
        const index = knowingIndex(parent, "actual", last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"});
        return new Map(index.all(person, {after: step.change}).map((row) => [row.point, row]));
    }

    /** 推出的候选：在场的 `presentLearns`、隐秘目标的持有者。整份视图算一次。 */
    #derivedOf(): Map<string, Map<string, Candidate[]>> {
        if (this.#derived !== null) return this.#derived;
        const derived = new Map<string, Map<string, Candidate[]>>();
        const add = (person: string, point: string, candidate: Candidate) => {
            let byPoint = derived.get(person);
            if (byPoint === undefined) {
                byPoint = new Map();
                derived.set(person, byPoint);
            }
            const list = byPoint.get(point);
            if (list === undefined) byPoint.set(point, [candidate]);
            else list.push(candidate);
        };
        for (const change of countedChanges(this.view, this.mode, this.#position)) {
            const learns = (change.marks ?? []).filter((mark): mark is Mark & {point: string; degree?: "knows" | "suspects"} => mark.kind === MARK_IDS.presentLearns && mark.version === 1 && typeof mark.point === "string");
            if (learns.length === 0) continue;
            const key = this.view.eventKey(change.id, this.mode);
            if (key === null) continue;
            for (const member of change.cast ?? []) {
                if (member.role !== "present" || member.who === undefined) continue;
                for (const mark of learns) add(member.who, mark.point, {key, explicit: false, change: change.id, row: {point: mark.point, 程度: mark.degree ?? "knows", 怎么知道: "witnessed", source: "present", change: change.id}});
            }
        }
        for (const goal of this.view.entries()) {
            if (goal.deleted === true || goal.type !== ENTRY_TYPES.goal || goal.parent === null) continue;
            const read = this.view.entry(goal.id, this.#position, this.mode);
            if (read === null || read === "chapter-not-found" || read.deleted || !read.appeared) continue;
            const secret = (read.namespaces.goal?.fields.隐秘?.value as {ref?: unknown} | null | undefined)?.ref;
            if (typeof secret !== "string") continue;
            const key = goal.appears === undefined ? INITIAL_KEY : (this.view.placementKey(goal.appears) ?? INITIAL_KEY);
            add(goal.parent, secret, {key, explicit: false, row: {point: secret, 程度: "knows", 怎么知道: "other", source: "secretGoal"}});
        }
        this.#derived = derived;
        return derived;
    }
}

function explicitRow(point: string, element: Readonly<Record<string, unknown>>, change: string | undefined): KnowingRow {
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const ref = (value: unknown) => {
        const id = (value as {ref?: unknown} | null | undefined)?.ref;
        return typeof id === "string" ? id : null;
    };
    return {
        point,
        程度: (text(element.程度) as Degree | null) ?? null,
        他以为的: text(element.他以为的),
        怎么知道: (text(element.怎么知道) as How | null) ?? null,
        谁告诉的: ref(element.谁告诉的),
        备注: text(element.备注),
        source: "explicit",
        ...(change === undefined ? {} : {change}),
    };
}

const knowingIndexes = perViewCache<KnowingIndex>();
/** 一份视图在一个模式与读取位置上的知情索引：诊断、按视角的视图与远程读取共用（缓存见 `view-cache.ts`）。 */
export function knowingIndex(view: CanonReadView, mode: Mode, position: ReadPosition): KnowingIndex {
    return knowingIndexes(view, `${mode}|${JSON.stringify(position)}`, () => new KnowingIndex(view, mode, position));
}

const counted = perViewCache<readonly StoryChange[]>();
/**
 * 在场的取法（canon.model 输出 29）：实际模式取已写、生效、套上的；按计划模式再加上这个位置计入的计划。不保证先后。一次读取里
 * 知情、伏笔与账本都要，按视图、模式与位置缓存（`view-cache.ts`）：返回的数组是共用的，调用方不改它。
 */
export function countedChanges(view: CanonReadView, mode: Mode, position: ReadPosition): readonly StoryChange[] {
    return counted(view, `${mode}|${JSON.stringify(position)}`, () => computeCounted(view, mode, position));
}

function computeCounted(view: CanonReadView, mode: Mode, position: ReadPosition): readonly StoryChange[] {
    const limit = view.positionKey(position);
    if (limit === null) return [];
    const counted = view.changes({kind: "written", status: "active"}).filter((change) => {
        const key = view.eventKey(change.id, mode);
        if (key === null || view.compareKeys(key, limit) >= 0) return false;
        return change.patches.length === 0 || view.outcome(change.id)?.applied === true;
    });
    if (mode !== "planned") return counted;
    const planned = view.plannedAt(position);
    if (planned === "chapter-not-found") return counted;
    const plans = new Set(planned);
    return [...counted, ...view.changes({kind: "plan", status: "active"}).filter((plan) => plans.has(plan.id))];
}

/**
 * 某人到一个位置为止在场的剧情变更（canon.model 输出 29），按这个模式的先后排；另给这段里没记参与者的变更数。`cast` 里写成
 * 马甲的存成本体加 `as`，按本体或马甲都算他在场。
 */
export function presentChanges(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly changes: readonly StoryChange[]; readonly uncast: number} {
    const counted = countedChanges(view, mode, position);
    const keyed = counted
        .filter((change) => (change.cast ?? []).some((member) => member.role === "present" && (member.who === person || member.as === person)))
        .map((change) => ({change, key: view.eventKey(change.id, mode)!}));
    keyed.sort((a, b) => view.compareKeys(a.key, b.key));
    return {changes: keyed.map((item) => item.change), uncast: counted.filter((change) => change.cast === undefined).length};
}

/** 视图所在线上的“当前”读取位置：最后一章末尾，没有章时是初值。 */
function endOf(view: CanonReadView): ReadPosition {
    const last = view.chapters.at(-1);
    return last === undefined ? {kind: "initial"} : {kind: "chapter", chapter: last, edge: "end"};
}

/**
 * 某人到一个位置为止的经历（knowledge 输出 8）：在场的剧情变更，回溯者在子线上另带“记得原线上的”——父线上切口之后、不晚于触发处
 * 他在场的变更。顺序：切口之前共同的过去，记得的，再是他在这条线上自己经历的；`remembered` 是记得的那几条的 id，它们的知情变化
 * 要在父线的视图上算（`parent`）。
 */
export function experienceChanges(view: CanonReadView, mode: Mode, position: ReadPosition, person: string): {readonly changes: readonly StoryChange[]; readonly uncast: number; readonly remembered: ReadonlySet<string>; readonly parent: CanonReadView | null} {
    const present = presentChanges(view, mode, position, person);
    const fork = view.lines().find((line) => line.id === view.line);
    if (fork === undefined || fork.type !== "rollback" || fork.trigger === undefined || fork.who === undefined || bodyOf(view, fork.who) !== bodyOf(view, person)) return {...present, remembered: new Set(), parent: null};
    const parent = view.onLine(fork.parent, mode);
    if ("code" in parent) return {...present, remembered: new Set(), parent: null};
    const [cutOnParent, triggerOnParent, cutHere] = [parent.eventKey(fork.cut, mode), parent.eventKey(fork.trigger, mode), view.eventKey(fork.cut, mode)];
    if (cutOnParent === null || triggerOnParent === null || cutHere === null) return {...present, remembered: new Set(), parent: null};
    const remembered = presentChanges(parent, mode, endOf(parent), person).changes.filter((change) => {
        const key = parent.eventKey(change.id, mode);
        return key !== null && parent.compareKeys(key, cutOnParent) > 0 && parent.compareKeys(key, triggerOnParent) <= 0;
    });
    const shared = present.changes.filter((change) => {
        const key = view.eventKey(change.id, mode);
        return key !== null && view.compareKeys(key, cutHere) <= 0;
    });
    const own = present.changes.filter((change) => !shared.includes(change));
    return {changes: [...shared, ...remembered, ...own], uncast: present.uncast, remembered: new Set(remembered.map((change) => change.id)), parent};
}

/** 一条变更让某人的有效知情起的变化，在 `view` 那条线上算（记得原线上的变更用父线的视图）。 */
export function knowingChangesOf(view: CanonReadView, mode: Mode, person: string, change: string): KnowingChange[] {
    return knowingIndex(view, mode, endOf(view)).changedBy(person, change);
}

/** 一个人是不是马甲：是就归到本体（传话人按本体算，knowledge.md 输出 5）。 */
export function bodyOf(view: CanonReadView, entry: string): string {
    const stored = view.object({kind: "entry", id: entry}) as {sameAs?: string} | undefined;
    return stored?.sameAs ?? entry;
}

type ReaderFilter = {readonly until?: TellingPosition; readonly mark?: string; readonly effective?: boolean};

/**
 * 读者读过的讲述（knowledge 输出 6 的“读过的生效讲述”）：每一章按活页夹分的段，取每段那条线的视图里发生点落在这一段（段首
 * 到下一段首之前）的讲述。读者读的是活页夹的正文，所以回溯段里子线上变更的讲述算读过，主线视图里却看不到它们：不能只在
 * 一张视图上读。每条用到的线只取一次，再按段筛。
 */
export function readerTellings(view: CanonReadView, filter: ReaderFilter = {}): ReturnType<CanonReadView["tellings"]> {
    // 章 -> 段（线与起始段落号）。
    const segmentsOf = new Map(view.chapters.map((chapter) => [chapter, view.chapterLines(chapter)] as const));
    const lines = new Set([...segmentsOf.values()].flatMap((segments) => segments.map((segment) => segment.line)));
    const taken: Array<ReturnType<CanonReadView["tellings"]>[number]> = [];
    for (const line of lines) {
        const on = line === view.line ? view : view.onLine(line, "actual");
        if ("code" in on) continue;
        for (const item of on.tellings(filter)) {
            if (item.located.kind !== "found") {
                // 失联的讲述没有发生点：不属于哪一段，按它所在章的第一段那条线算（`effective` 筛选会先把它们去掉）。
                const first = item.telling.chapter === undefined ? undefined : segmentsOf.get(item.telling.chapter)?.[0];
                if (first?.line === line) taken.push(item);
                continue;
            }
            const segments = segmentsOf.get(item.located.occurrence.chapter) ?? [];
            const paragraph = item.located.occurrence.paragraph;
            const index = segments.findLastIndex((segment) => segment.from <= paragraph);
            if ((segments[Math.max(index, 0)]?.line ?? view.line) === line) taken.push(item);
        }
    }
    const order = new Map(view.chapters.map((chapter, index) => [chapter, index] as const));
    const position = (item: (typeof taken)[number]) => (item.located.kind === "found" ? [order.get(item.located.occurrence.chapter) ?? Infinity, item.located.occurrence.paragraph] : [Infinity, 0]);
    return taken.sort((a, b) => position(a)[0]! - position(b)[0]! || position(a)[1]! - position(b)[1]! || (a.telling.id < b.telling.id ? -1 : 1));
}

/** 读者在讲述位置 P 上对一个知识点的程度（输出 6）：读过的生效讲述里有明说的揭示是知道，只有暗示是怀疑，都没有是不知道。 */
export function readerKnowing(view: CanonReadView, point: string, at: TellingPosition): "knows" | "suspects" | "unaware" {
    let degree: "knows" | "suspects" | "unaware" = "unaware";
    for (const item of readerTellings(view, {until: at, mark: MARK_IDS.reveal})) {
        for (const mark of item.telling.marks ?? []) {
            if (mark.kind !== MARK_IDS.reveal || mark.version !== 1 || mark.point !== point) continue;
            if (mark.mode === "explicit") return "knows";
            degree = "suspects";
        }
    }
    return degree;
}

/** 读者第一次到怀疑、第一次到知道的讲述（输出 7）：讲述 id 与发生点。 */
export function firstReveal(view: CanonReadView, point: string): {readonly suspects?: {readonly telling: string; readonly chapter: string; readonly paragraph: number}; readonly knows?: {readonly telling: string; readonly chapter: string; readonly paragraph: number}} {
    let suspects: {telling: string; chapter: string; paragraph: number} | undefined;
    for (const item of readerTellings(view, {effective: true, mark: MARK_IDS.reveal})) {
        if (item.located.kind !== "found") continue;
        const occurrence = {telling: item.telling.id, chapter: item.located.occurrence.chapter, paragraph: item.located.occurrence.paragraph};
        for (const mark of item.telling.marks ?? []) {
            if (mark.kind !== MARK_IDS.reveal || mark.version !== 1 || mark.point !== point) continue;
            suspects ??= occurrence;
            if (mark.mode === "explicit") return {suspects, knows: occurrence};
        }
    }
    return suspects === undefined ? {} : {suspects};
}
