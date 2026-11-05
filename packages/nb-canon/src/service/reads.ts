/**
 * 世界服务的列表读取（docs/specs/canon/project.md 方法表的 `changes`、`tellings`、`presence`、`decisions`）算出完整的结果，
 * 与给插件诊断的只读世界 `CanonReadView`（model.md “诊断的计算”）共用。分页、读取的戳与游标在 service.ts；这里只管
 * “在一份世界与正文快照上算出哪些、按什么先后”。
 *
 * 诊断在一次读取里同步调用：拿到的视图就是这次读取的世界与正文快照，读的过程中不会变。
 */

import {EMPTY_MARK_REGISTRY, markStatus, type MarkRegistry, type MarkType} from "../components/marks";
import {effectiveFields} from "../components/registry";
import {deepFreeze} from "../core/freeze";
import {DEFAULT_TIME} from "../time/network";
import {answerTime, type TimeAnswer, type TimeQuery} from "../time/queries";
import {compareIds} from "../core/ids";
import {compareRanks, compareTie, defaultPosition, placementRank, positionRank, rankBefore, type ChapterOrder} from "../core/position";
import type {Address, Decision, Entry, FieldDeclaration, ObjectRef, Placement, ReadPosition, StoryChange, Telling} from "../core/schema";
import {canonicalJson, stableStringify} from "../core/stable-json";
import type {ChangeOutcome, EntryView, EventKey, Mode, OriginStep, PlanProgress} from "../engine/types";
import {aboutMatches} from "../world/decisions";
import {compareOccurrences, readBy, TellingLocator, type Located, type TellingPosition} from "../world/tellings";
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

/** 读取的戳（model.md 输出 36）：世界版本、正文快照的摘要、整份读取输入的摘要。 */
export interface ReadStamp {
    readonly version: number;
    readonly textDigest: string;
    readonly inputDigest: string;
}

/**
 * 给插件的只读世界（model.md “诊断的计算”）：同一份读取输入上的条目、剧情变更、讲述、在场与决策，不分页。插件只读它，
 * 不写世界；同一次读取里几个诊断共用一份。插件按 `stamp.inputDigest` 缓存自己算的东西。
 */
export interface CanonReadView {
    readonly version: number;
    readonly stamp: ReadStamp;
    /** 这份视图是哪条世界线的；分叉之前只有主线。 */
    readonly line: string;
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
    /** 一个地址的来历（model.md 输出 15）：每一步是哪条变更、改后的值。列表的地址给出整个列表在每一步之后的值。 */
    origins(address: Address, position: ReadPosition, mode: Mode): readonly OriginStep[] | "chapter-not-found";
    /** 一条剧情变更这次套没套上；不在实际模式的事件里时为 undefined。 */
    outcome(change: string): ChangeOutcome | undefined;
    /** 计划在一个读取位置上的进展（model.md 输出 13）。 */
    progress(plan: string, position: ReadPosition): PlanProgress | "chapter-not-found";
    /** 一条剧情变更在这个模式的先后里的排序键（与计算用的先后相同）；不进这个模式的为 null。 */
    eventKey(change: string, mode: Mode): EventKey | null;
    /** 一个安放的排序键（例如条目的出场）：同一安放上排在任何变更之前。未排章与不在章序里的为 null。 */
    placementKey(placement: Placement): EventKey | null;
    /**
     * 一个读取位置的排序键：键比它小的事件在这个位置之前（初值在一切之前，章首在这一章的事件之前，章末在之后）。章不在章序里时为 null。
     */
    positionKey(position: ReadPosition): EventKey | null;
    /** 两个排序键的先后。 */
    compareKeys(a: EventKey, b: EventKey): number;
    /** 按计划模式在这个位置计入的计划，按先后排（model.md 输出 5）。 */
    plannedAt(position: ReadPosition): readonly string[] | "chapter-not-found";
    /** 一个条目在一个命名空间上的字段声明（类型固定的加实例上的）；类型不可用时为 undefined。 */
    fields(entry: string, namespace: string): readonly FieldDeclaration[] | undefined;
    /** 登记的标注种类（引用路径在 `refs`）；没登记时为 undefined。 */
    markType(kind: string): MarkType | undefined;
    /** 时间的查询（canon.time 输出 8），同步；剧情的诊断按需用。 */
    time(query: TimeQuery, mode: Mode): TimeAnswer;
}

export function createReadView(world: World, locator: TellingLocator, stamp: ReadStamp): CanonReadView {
    const order = world.options.order;
    // 视图本身、章序与戳都冻结：同一个视图对象会交给一份读取输入上的几个插件（服务的 `#readViewOf`），谁改了都会影响别人。
    const view: CanonReadView = {
        version: world.version,
        stamp: deepFreeze(stamp),
        line: "main",
        chapters: deepFreeze([...order.ids]),
        // 引擎算出的结果可能与引擎的快照共用对象：交出去之前深冻结（core/freeze.ts）。存下来的对象在世界表里已经冻过。
        entry: (id, position, mode) => deepFreeze(world.engine.entry(id, position, mode)),
        object: (ref) => world.object(ref),
        entries: () => [...world.data.entries.values()],
        changes: (filter = {}) => listChanges(world, filter),
        tellings: (filter = {}) => deepFreeze(listTellings(world, locator, filter)),
        presence: (person, filter = {}) => listPresence(world, person, filter),
        decisions: (filter = {}) => listDecisions(world, filter),
        chapterEntries: (chapter) => deepFreeze(world.engine.chapterEntries(chapter)),
        origins: (address, position, mode) => deepFreeze(world.engine.origins(address, position, mode)),
        outcome: (change) => deepFreeze(world.engine.outcome(change)),
        progress: (plan, position) => world.engine.progress(plan, position),
        // 排序键与下面两个键一样每次新算、不与引擎的快照共用对象，不冻结：剧情建知情索引时对每条变更取一次，冻结是这一步最大的开销。
        eventKey: (change, mode) => world.engine.eventKey(change, mode),
        placementKey: (placement) => {
            const rank = placementRank(order, placement);
            return rank === null ? null : {rank, tie: {version: -1, id: ""}};
        },
        positionKey: (position) => {
            const rank = positionRank(order, position);
            return rank === null ? null : {rank, tie: {version: Number.POSITIVE_INFINITY, id: ""}};
        },
        compareKeys: (a, b) => compareRanks(a.rank, b.rank) || compareTie(a.tie, b.tie),
        plannedAt: (position) => deepFreeze(world.engine.plannedAt(position)),
        fields: (entry, namespace) => {
            const data = world.data.entries.get(entry)?.init.data[namespace];
            const type = world.options.registry.byNamespace(namespace);
            return data === undefined || type === undefined || type.id !== data.type ? undefined : deepFreeze(effectiveFields(type, data.declared));
        },
        markType: (kind) => deepFreeze((world.options.marks ?? EMPTY_MARK_REGISTRY).byKind(kind)),
        time: (query, mode) => deepFreeze(answerTime(world.time(mode), world.options.time ?? DEFAULT_TIME, world.data, query)),
    };
    return Object.freeze(view);
}

/**
 * 不经世界服务，由一份世界与一张正文表建只读视图（测试与别的宿主用）：讲述按这张表定位，戳按世界的摘要函数算，
 * 算法同世界服务（model.md 输出 36；插件的数据版本、历法与模糊词表都当作没有）。
 */
export function createWorldReadView(world: World, texts: ReadonlyMap<string, string>): CanonReadView {
    const order = world.options.order;
    const stamp = readStampOf(world, (chapter) => (texts.has(chapter) ? world.options.digest(texts.get(chapter)!) : null), []);
    return createReadView(world, new TellingLocator((chapter) => texts.get(chapter), () => order), stamp);
}

/**
 * 读取的戳（model.md 输出 36）：正文快照的摘要是按章序排的 `[[章 id, 正文的摘要或 null]]` 的规范 JSON 的摘要；读取输入的
 * 摘要覆盖世界版本、章序与各章讲的线、正文快照、三张登记的版本表、插件的数据版本、历法与模糊词表（后两样随阶段 C）。
 */
export function readStampOf(world: World, chapterDigest: (chapter: string) => string | null, pluginData: readonly (readonly [string, string])[]): ReadStamp {
    const ids = world.options.order.ids;
    const digest = world.options.digest;
    const textDigest = digest(canonicalJson(ids.map((id) => [id, chapterDigest(id)])));
    const inputDigest = digest(canonicalJson({
        version: world.version,
        chapters: ids.map((id) => [id, "main"]),
        text: textDigest,
        registry: {
            components: world.options.registry.versions.map(([id, version]) => [id, version]),
            marks: (world.options.marks ?? EMPTY_MARK_REGISTRY).versions.map(([id, version]) => [id, version]),
            diagnostics: [...(world.options.diagnostics?.versions ?? [])].map(([id, version]) => [id, version]),
        },
        pluginData: [...pluginData].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([plugin, version]) => [plugin, version]),
        // 历法与词表按内容取摘要（model.md 输出 36）：作者改了历法没加版本号，缓存与游标照样作废。没给时用内置的那一份。
        calendar: digest(canonicalJson((world.options.time ?? DEFAULT_TIME).calendar)),
        fuzzy: digest(canonicalJson((world.options.time ?? DEFAULT_TIME).fuzzy)),
    }));
    return Object.freeze({version: world.version, textDigest, inputDigest});
}

/**
 * 列表的一页（project.md 输出 19）：游标是“读取输入的摘要:读取参数的摘要:偏移”，读取输入变了、或者拿着游标换了方法与筛选，
 * 得到 `cursor-stale`。`params` 是方法名与影响结果的参数（条数不算）。canon 与插件的列表共用它。
 */
export function pageOf<T>(stamp: ReadStamp, items: readonly T[], cursor: string | undefined, limit: number, params: {readonly method: string} & Readonly<Record<string, unknown>>, digest: (text: string) => string): {readonly items: readonly T[]; readonly next?: string} | "cursor-stale" {
    const query = digest(stableStringify(params));
    let offset = 0;
    if (cursor !== undefined) {
        const [input, bound, at, ...rest] = cursor.split(":");
        if (input !== stamp.inputDigest || bound !== query || rest.length > 0 || at === undefined || !/^\d+$/u.test(at)) return "cursor-stale";
        offset = Number(at);
    }
    const slice = items.slice(offset, offset + limit);
    const next = offset + limit < items.length ? `${stamp.inputDigest}:${query}:${String(offset + limit)}` : undefined;
    return {items: slice, ...(next === undefined ? {} : {next})};
}

/** 剧情变更涉及这个条目：在 `involves` 里、是参与者（本体或马甲）、或补丁改到它（列表按条目筛时用）。 */
export function concerns(change: StoryChange, entry: string): boolean {
    return change.involves.includes(entry) || (change.cast ?? []).some((member) => member.who === entry || member.as === entry) || change.patches.some((patch) => patch.at.entry === entry);
}

/** 按安放的先后排（前史、各章按章序与排序键），同一位置按 id；未排章的排在最后。每条的排序键只算一次（几千条时比较里重算很贵）。 */
function sortByPlacement(order: ChapterOrder, changes: StoryChange[]): void {
    const ranked = changes.map((change) => ({change, rank: placementRank(order, change.at)}));
    ranked.sort((a, b) => {
        if (a.rank === null || b.rank === null) return a.rank === b.rank ? compareIds(a.change.id, b.change.id) : a.rank === null ? 1 : -1;
        return compareRanks(a.rank, b.rank) || compareIds(a.change.id, b.change.id);
    });
    for (const [index, item] of ranked.entries()) changes[index] = item.change;
}

/**
 * 剧情变更（方法表 `changes`）：`entry` 筛涉及它的；`nature` 筛性质（没写的是 `event`）；`progress` 筛计划在全书当前
 * 进展上的进展（model.md 输出 13，只有计划有进展）。按安放的先后排。
 */
export function listChanges(world: World, filter: ChangeFilter, progressAt?: ReadPosition): StoryChange[] {
    const order = world.options.order;
    const latest = progressAt ?? defaultPosition(order);
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
export function listPresence(world: World, person: string, filter: PresenceFilter, until?: ReadPosition): {readonly changes: StoryChange[]; readonly uncast: number} | "chapter-not-found" {
    const order = world.options.order;
    const from = filter.from === undefined ? undefined : order.index(filter.from);
    const to = filter.to === undefined ? undefined : order.index(filter.to);
    if ((filter.from !== undefined && from === undefined) || (filter.to !== undefined && to === undefined)) return "chapter-not-found";
    // `until`（带视图令牌时是上限）：只算安放在它之前的，按计划模式计入的计划也按它算；没给时按 `to` 那一章的末尾。
    const bound = until === undefined ? null : positionRank(order, until);
    const inRange = (change: StoryChange) => {
        const rank = placementRank(order, change.at);
        if (rank === null) return false;
        if (bound !== null && !rankBefore(rank, bound)) return false;
        if (from !== undefined && (rank[0] !== 1 || rank[1] < from)) return false;
        return to === undefined || rank[0] !== 1 || rank[1] <= to;
    };
    const counted: StoryChange[] = [];
    for (const change of world.data.changes.values()) {
        if (change.kind !== "written" || change.status !== "active" || !inRange(change)) continue;
        if (change.patches.length === 0 || world.engine.outcome(change.id)?.applied === true) counted.push(change);
    }
    if (filter.mode === "planned") {
        const planned = world.engine.plannedAt(until ?? (filter.to === undefined ? defaultPosition(order) : {kind: "chapter", chapter: filter.to, edge: "end"}));
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
