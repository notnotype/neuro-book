/**
 * 世界服务的列表读取（docs/specs/canon/project.md 方法表的 `changes`、`tellings`、`presence`、`decisions`）算出完整的结果，
 * 与给插件诊断的只读世界 `CanonReadView`（model.md “诊断的计算”）共用。分页、读取的戳与游标在 service.ts；这里只管
 * “在一份世界与正文快照上算出哪些、按什么先后”。
 *
 * 诊断在一次读取里同步调用：拿到的视图就是这次读取的世界与正文快照，读的过程中不会变。
 */

import {EMPTY_MARK_REGISTRY, markStatus, type MarkRegistry} from "../components/marks";
import {compareIds} from "../core/ids";
import {compareRanks, defaultPosition, placementRank, type ChapterOrder} from "../core/position";
import type {Decision, Entry, ObjectRef, ReadPosition, StoryChange, Telling} from "../core/schema";
import type {EntryView, Mode, PlanProgress} from "../engine/types";
import {aboutMatches} from "../world/decisions";
import {compareOccurrences, readBy, type Located, type TellingLocator, type TellingPosition} from "../world/tellings";
import type {World} from "../world/world";

export interface ChangeFilter {
    readonly chapter?: string;
    readonly entry?: string;
    readonly line?: string;
    readonly kind?: "written" | "plan";
    readonly status?: "active" | "held" | "undone";
    readonly nature?: "event" | "narration";
    readonly progress?: PlanProgress;
}

export interface TellingFilter {
    readonly from?: string;
    readonly to?: string;
    readonly entry?: string;
    readonly effective?: boolean;
    readonly until?: TellingPosition;
    readonly mark?: string;
}

export interface PresenceFilter {
    readonly from?: string;
    readonly to?: string;
    readonly mode?: Mode;
}

export interface DecisionFilter {
    readonly status?: Decision["status"];
    readonly about?: ObjectRef | {readonly kind: "chapter"; readonly id: string};
}

/** 一条讲述的提示（model.md 输出 24、26、28、34）：失联、原句出现几次而没给 `nth`、带的标注只读（`mark` 是它在 `marks` 里的下标）。 */
export interface TellingHint {
    readonly code: "telling-lost" | "duplicate-quote" | "mark-kind-unknown" | "mark-version-unsupported";
    readonly detail: string;
    readonly mark?: number;
}

export interface TellingItem {
    readonly telling: Telling;
    readonly owner: ObjectRef;
    /** 讲述在对象里的位置：`told`，或条目的 `retold["地址"]`。 */
    readonly path: string;
    readonly located: Located;
    readonly hints?: readonly TellingHint[];
}

/**
 * 给插件诊断的只读世界（model.md “诊断的计算”）：同一份读取输入上的条目、剧情变更、讲述、在场与决策，不分页。
 * 诊断只读它，不写世界；同一次读取里几个诊断共用一份。
 */
export interface CanonReadView {
    readonly version: number;
    /** 章序。 */
    readonly chapters: readonly string[];
    entry(id: string, position: ReadPosition, mode: Mode): EntryView | null | "chapter-not-found";
    /** 存下来的对象，没有时为 undefined。 */
    object(ref: ObjectRef): unknown;
    /** 存下来的全部条目（含墓碑）。 */
    entries(): readonly Entry[];
    changes(filter?: ChangeFilter): readonly StoryChange[];
    tellings(filter?: TellingFilter): readonly TellingItem[];
    presence(person: string, filter?: PresenceFilter): {readonly changes: readonly StoryChange[]; readonly uncast: number} | "chapter-not-found";
    decisions(filter?: DecisionFilter): readonly Decision[];
    /** 某一章涉及的条目（model.md 输出 20）。 */
    chapterEntries(chapter: string): readonly string[];
}

export function createReadView(world: World, locator: TellingLocator): CanonReadView {
    return {
        version: world.version,
        chapters: world.options.order.ids,
        entry: (id, position, mode) => world.engine.entry(id, position, mode),
        object: (ref) => world.object(ref),
        entries: () => [...world.data.entries.values()],
        changes: (filter = {}) => listChanges(world, filter),
        tellings: (filter = {}) => listTellings(world, locator, filter),
        presence: (person, filter = {}) => listPresence(world, person, filter),
        decisions: (filter = {}) => listDecisions(world, filter),
        chapterEntries: (chapter) => world.engine.chapterEntries(chapter),
    };
}

/** 剧情变更涉及这个条目：在 `involves` 里、是参与者（本体或马甲）、或补丁改到它（列表按条目筛时用）。 */
export function concerns(change: StoryChange, entry: string): boolean {
    return change.involves.includes(entry) || (change.cast ?? []).some((member) => member.who === entry || member.as === entry) || change.patches.some((patch) => patch.at.entry === entry);
}

/** 按安放的先后排（前史、各章按章序与排序键），同一位置按 id；未排章的排在最后。 */
function sortByPlacement(order: ChapterOrder, changes: StoryChange[]): void {
    changes.sort((a, b) => {
        const left = placementRank(order, a.at);
        const right = placementRank(order, b.at);
        if (left === null || right === null) return left === right ? compareIds(a.id, b.id) : left === null ? 1 : -1;
        return compareRanks(left, right) || compareIds(a.id, b.id);
    });
}

/**
 * 剧情变更（方法表 `changes`）：`entry` 筛涉及它的；`nature` 筛性质（没写的是 `event`）；`progress` 筛计划在全书当前
 * 进展上的进展（model.md 输出 13，只有计划有进展）。按安放的先后排。
 */
export function listChanges(world: World, filter: ChangeFilter): StoryChange[] {
    const order = world.options.order;
    const latest = defaultPosition(order);
    const matching = [...world.data.changes.values()].filter((change) =>
        (filter.chapter === undefined || (change.at.kind === "chapter" && change.at.chapter === filter.chapter)) &&
        (filter.entry === undefined || concerns(change, filter.entry)) &&
        (filter.line === undefined || change.lines.includes(filter.line)) &&
        (filter.kind === undefined || change.kind === filter.kind) &&
        (filter.status === undefined || change.status === filter.status) &&
        (filter.nature === undefined || (change.nature ?? "event") === filter.nature) &&
        (filter.progress === undefined || (change.kind === "plan" && world.engine.progress(change.id, latest) === filter.progress)),
    );
    sortByPlacement(order, matching);
    return matching;
}

/**
 * 讲述（model.md 输出 24 到 27）：每条带所在的对象、发生点或失联的原因。生效的按读的先后排（章序、段、段内偏移、讲述 id），
 * 其余排在后面（按对象、讲述 id）。`until` 只留在这个讲述位置读过的；`effective` 筛生效与否；`entry` 筛这个条目自己的、
 * 涉及它的剧情变更的、核对它的；`mark` 筛带这个种类标注的。
 */
export function listTellings(world: World, locator: TellingLocator, filter: TellingFilter): TellingItem[] {
    const order = world.options.order;
    const marks = world.options.marks ?? EMPTY_MARK_REGISTRY;
    const inRange = (chapter: string | undefined) => {
        if (filter.from === undefined && filter.to === undefined) return true;
        const index = chapter === undefined ? undefined : order.index(chapter);
        if (index === undefined) return false;
        return (filter.from === undefined || index >= (order.index(filter.from) ?? Infinity)) && (filter.to === undefined || index <= (order.index(filter.to) ?? -Infinity));
    };
    const items: TellingItem[] = [];
    const collect = (owner: ObjectRef, path: string, tellings: readonly Telling[], matches: boolean) => {
        if (filter.entry !== undefined && !matches) return;
        for (const telling of tellings) {
            if (!inRange(telling.chapter)) continue;
            if (filter.mark !== undefined && !(telling.marks ?? []).some((mark) => mark.kind === filter.mark)) continue;
            const located = locator.locate(telling);
            if (filter.effective !== undefined && filter.effective !== (located.kind === "found")) continue;
            if (filter.until !== undefined && (located.kind !== "found" || !readBy(order, located.occurrence, filter.until))) continue;
            const hints = tellingHints(marks, telling, located);
            items.push({telling, owner, path, located, ...(hints.length === 0 ? {} : {hints})});
        }
    };
    for (const change of world.data.changes.values()) collect({kind: "change", id: change.id}, "told", change.told, filter.entry === undefined || concerns(change, filter.entry));
    for (const check of world.data.checks.values()) collect({kind: "check", id: check.id}, "told", [check.told], filter.entry === undefined || check.at.entry === filter.entry);
    for (const entry of world.data.entries.values()) for (const [address, tellings] of Object.entries(entry.retold ?? {})) collect({kind: "entry", id: entry.id}, `retold[${JSON.stringify(address)}]`, tellings, filter.entry === undefined || entry.id === filter.entry);
    items.sort((a, b) => {
        if (a.located.kind === "found" && b.located.kind === "found") return compareOccurrences(order, a.located.occurrence, b.located.occurrence) || compareIds(a.telling.id, b.telling.id);
        if (a.located.kind === "found") return -1;
        if (b.located.kind === "found") return 1;
        return a.owner.kind.localeCompare(b.owner.kind) || compareIds(a.owner.id, b.owner.id) || compareIds(a.telling.id, b.telling.id);
    });
    return items;
}

function tellingHints(marks: MarkRegistry, telling: Telling, located: Located): TellingHint[] {
    const hints: TellingHint[] = [];
    if (located.kind === "lost") hints.push({code: "telling-lost", detail: located.reason});
    if (located.kind === "found" && located.count > 1 && telling.nth === undefined) hints.push({code: "duplicate-quote", detail: `${String(located.count)} occurrences`});
    for (const [index, mark] of (telling.marks ?? []).entries()) {
        const code = markStatus(marks, mark);
        if (code !== null) hints.push({code, detail: mark.kind, mark: index});
    }
    return hints;
}

/**
 * 某人在场的剧情变更（model.md 输出 29）：`from`、`to` 是安放所在章的范围（含两头；不写 `from` 时含前史）。实际模式取
 * 已写、生效、套上的变更；按计划模式再加上在 `to` 的章末（没写时在缺省读取位置）计入的计划。参与者里 `who` 或 `as` 是他、
 * `role` 为 `present` 的算在场；没记参与者的变更不算，只计数（`uncast`）。
 */
export function listPresence(world: World, person: string, filter: PresenceFilter): {readonly changes: StoryChange[]; readonly uncast: number} | "chapter-not-found" {
    const order = world.options.order;
    const from = filter.from === undefined ? undefined : order.index(filter.from);
    const to = filter.to === undefined ? undefined : order.index(filter.to);
    if ((filter.from !== undefined && from === undefined) || (filter.to !== undefined && to === undefined)) return "chapter-not-found";
    const inRange = (change: StoryChange) => {
        const rank = placementRank(order, change.at);
        if (rank === null) return false;
        if (from !== undefined && (rank[0] !== 1 || rank[1] < from)) return false;
        return to === undefined || rank[0] !== 1 || rank[1] <= to;
    };
    const counted: StoryChange[] = [];
    for (const change of world.data.changes.values()) {
        if (change.kind !== "written" || change.status !== "active" || !inRange(change)) continue;
        if (change.patches.length === 0 || world.engine.outcome(change.id)?.applied === true) counted.push(change);
    }
    if (filter.mode === "planned") {
        const planned = world.engine.plannedAt(filter.to === undefined ? defaultPosition(order) : {kind: "chapter", chapter: filter.to, edge: "end"});
        if (planned === "chapter-not-found") return planned;
        for (const id of planned) {
            const plan = world.data.changes.get(id);
            if (plan !== undefined && inRange(plan)) counted.push(plan);
        }
    }
    const present = counted.filter((change) => (change.cast ?? []).some((member) => member.role === "present" && (member.who === person || member.as === person)));
    sortByPlacement(order, present);
    return {changes: present, uncast: counted.filter((change) => change.cast === undefined).length};
}

/** 决策，按 id：状态与挂的对象筛选。 */
export function listDecisions(world: World, filter: DecisionFilter): Decision[] {
    return [...world.data.decisions.values()]
        .filter((item) => filter.status === undefined || item.status === filter.status)
        .filter((item) => filter.about === undefined || item.about.some((about) => aboutMatches(about, filter.about!)))
        .sort((a, b) => compareIds(a.id, b.id));
}
