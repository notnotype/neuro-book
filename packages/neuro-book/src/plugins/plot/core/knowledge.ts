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

import type {CanonReadView, EventKey, Mark, Mode, ReadPosition, StoryChange, TellingPosition} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS, type Degree, type How} from "../shared/declarations";

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

/** 读取位置，或“某条变更之前”（传话链用：比那条变更更早的变更之后）。 */
export type KnowingAt = ReadPosition | {readonly before: string};

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
        const limit = "before" in at ? this.view.eventKey(at.before, this.mode) : at === this.#position ? this.#positionKey : this.view.positionKey(at);
        if (limit === null) return null;
        let best: Candidate | null = null;
        for (const candidate of [...(this.#explicitOf(person).get(point) ?? []), ...(this.#derivedOf().get(person)?.get(point) ?? [])]) {
            if (this.view.compareKeys(candidate.key, limit) >= 0) continue;
            if (best === null) {
                best = candidate;
                continue;
            }
            const order = this.view.compareKeys(candidate.key, best.key);
            // 同一条变更：显式的优先。
            if (order > 0 || (order === 0 && candidate.change !== undefined && candidate.change === best.change && candidate.explicit && !best.explicit)) best = candidate;
        }
        return best?.row ?? null;
    }

    /** 某人在这个位置上全部有效的行（显式的与推出的涉及过的知识点）。 */
    all(person: string): KnowingRow[] {
        const points = new Set([...this.#explicitOf(person).keys(), ...(this.#derivedOf().get(person)?.keys() ?? [])]);
        return [...points].sort().flatMap((point) => {
            const row = this.effective(person, point);
            return row === null ? [] : [row];
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
            if (step.kind !== "init" && step.kind !== "patch") continue;
            // 同一条变更的几个补丁各有一步，值都是这条变更套完以后的：只看一次。
            if (step.kind === "patch") {
                if (seenChanges.has(step.change)) continue;
                seenChanges.add(step.change);
            }
            const list = new Map((Array.isArray(step.kind === "init" ? step.value : step.result) ? ((step.kind === "init" ? step.value : step.result) as Array<Record<string, unknown>>) : []).map((element) => [String(element.id), element]));
            const key = step.kind === "init" ? INITIAL_KEY : this.view.eventKey(step.change, this.mode);
            if (key !== null) {
                for (const point of new Set([...previous.keys(), ...list.keys()])) {
                    const before = previous.get(point);
                    const after = list.get(point);
                    if (step.kind !== "init" && JSON.stringify(before) === JSON.stringify(after)) continue;
                    if (step.kind === "init" && after === undefined) continue;
                    const history = rows.get(point) ?? [];
                    history.push({key, explicit: true, row: after === undefined ? null : explicitRow(point, after, step.kind === "patch" ? step.change : undefined), ...(step.kind === "patch" ? {change: step.change} : {})});
                    rows.set(point, history);
                }
            }
            previous = list;
        }
        return rows;
    }

    /** 推出的候选：在场的 `presentLearns`、隐秘目标的持有者。整份视图算一次。 */
    #derivedOf(): Map<string, Map<string, Candidate[]>> {
        if (this.#derived !== null) return this.#derived;
        const derived = new Map<string, Map<string, Candidate[]>>();
        const add = (person: string, point: string, candidate: Candidate) => {
            const byPoint = derived.get(person) ?? new Map<string, Candidate[]>();
            byPoint.set(point, [...(byPoint.get(point) ?? []), candidate]);
            derived.set(person, byPoint);
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

/** 在场的取法（canon.model 输出 29）：实际模式取已写、生效、套上的；按计划模式再加上这个位置计入的计划。 */
export function countedChanges(view: CanonReadView, mode: Mode, position: ReadPosition): StoryChange[] {
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

/** 一个人是不是马甲：是就归到本体（传话人按本体算，knowledge.md 输出 5）。 */
export function bodyOf(view: CanonReadView, entry: string): string {
    const stored = view.object({kind: "entry", id: entry}) as {sameAs?: string} | undefined;
    return stored?.sameAs ?? entry;
}

/** 读者在讲述位置 P 上对一个知识点的程度（输出 6）：读过的生效讲述里有明说的揭示是知道，只有暗示是怀疑，都没有是不知道。 */
export function readerKnowing(view: CanonReadView, point: string, at: TellingPosition): "knows" | "suspects" | "unaware" {
    let degree: "knows" | "suspects" | "unaware" = "unaware";
    for (const item of view.tellings({until: at, mark: MARK_IDS.reveal})) {
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
    for (const item of view.tellings({effective: true, mark: MARK_IDS.reveal})) {
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
