/**
 * 世界服务的语义（docs/specs/canon/project.md 方法表与输出 5、6、7、8、9、10、11、15、16、17、19）。文件、锁、时钟、
 * 摘要与小模型都由宿主注入，所以本模块不引用 `node:*`；插件把这些方法接到远程服务上。
 *
 * - 读取在调用时取当前那一份世界，同步算完，所以一次读取内部只看到一个版本。
 * - 写入排成一个队列，一次一个：在当前世界上算出修订 → 追加进日志并落盘 → 换上新世界 → 发 `changed`。日志尾部被
 *   别的进程动过时，先读进新增的行、套上，再在新世界上重新算这次请求（按版本判冲突）。
 * - 独占写入是有期限的租约，到期按注入的时钟判断（每次写入、申请、读状态时检查）。
 * - 归纳缓存没命中时排进补算；补算在写入队列之外调小模型，补上后发 `reduced`，版本不变。引擎读语义档时现查缓存，
 *   所以补上以后不必重建引擎。
 */

import {EMPTY_DIAGNOSTIC_REGISTRY, type DiagnosticRegistry} from "../components/diagnostics-registry";
import {EMPTY_MARK_REGISTRY, markStatus, type MarkRegistry} from "../components/marks";
import type {ComponentRegistry} from "../components/registry";
import {compareIds} from "../core/ids";
import {ChapterOrder, compareRanks, defaultPosition, placementRank} from "../core/position";
import type {AuthorSource, Decision, ObjectRef, ReadPosition, Revision, StoryChange, Telling, WriteRequest} from "../core/schema";
import {canonicalJson, stableStringify} from "../core/stable-json";
import type {Mode, PendingItem, PlanProgress, ReductionInput} from "../engine/types";
import type {LogFiles} from "../node/files";
import {appendRevision, openLog, readNew, type LogDiagnostic, type LogLock, type Tail} from "../node/log";
import {appendReduction, loadReductions} from "../node/cache";
import {renderEntryForAgent, renderEntryForAuthor} from "../render/entry";
import {writeBack, type WriteBackInput, type WriteBackResult} from "../render/writeback";
import {editInPlace, recordDelta, type EditResult, type InPlaceEdit} from "../world/edits";
import {marksIn} from "../world/references";
import {compareOccurrences, readBy, TellingLocator, type Located, type TellingPosition} from "../world/tellings";
import type {RevertRequest} from "../world/authorization";
import {decisionView, aboutMatches} from "../world/decisions";
import {World, type RevertMeta, type WriteResult} from "../world/world";

export interface ServicePorts {
    readonly files: LogFiles;
    readonly lock: LogLock;
    /** `.nbook/world/log/` 与 `.nbook/world/`（写一半的旁存）、`.nbook/cache/reductions.jsonl`。 */
    readonly logDir: string;
    readonly sideDir: string;
    readonly cachePath: string;
    readonly chapterText: (chapter: string) => string | undefined;
    readonly digest: (text: string) => string;
    /** 毫秒时钟（租约到期）与 ISO 时间（修订的 time）。 */
    readonly clock: () => number;
    readonly now: () => string;
    /**
     * 定时：独占到期时主动结束、发 `exclusive` 事件（输出 10），不等下一次调用。宿主传 `setTimeout` 包一层；测试传可以
     * 手动触发的实现，与注入的时钟一起推进。没有时到期只在下一次调用时生效。
     */
    readonly timer?: {readonly set: (ms: number, run: () => void) => unknown; readonly clear: (handle: unknown) => void};
    /** 小模型：没有时语义档一直是“未归纳”的写法（输入与前置条件）。 */
    readonly reducer?: {readonly version: string; readonly reduce: (input: ReductionInput) => Promise<string>};
    /** 项目标识，作者授权的 `binds.project`（输入与前置条件）。 */
    readonly project?: string;
    /** 作者来源的签名校验（输入与前置条件）；没有时需要来源的写入都不通过。 */
    readonly verifyAuthorSource?: (source: AuthorSource) => boolean;
}

export type ServiceEvent =
    | {readonly kind: "changed"; readonly version: number; readonly revision: string; readonly by: Revision["by"]; readonly what: string; readonly title: string}
    | {readonly kind: "exclusive"; readonly holder: string | null}
    | {readonly kind: "reduced"}
    /** 宿主通知某一章（`null` 是全部）的正文变了，正文快照随之更新，版本不变（project.md 输出 25）。 */
    | {readonly kind: "textChanged"; readonly chapter: string | null};

/**
 * 读取结果带的戳（model.md 输出 36、project.md 输出 19）：世界版本、正文快照的摘要、整份读取输入的摘要。同一份读取输入
 * 算出的结果逐字相同，游标绑定 `inputDigest`。
 */
export interface ReadStamp {
    readonly version: number;
    readonly textDigest: string;
    readonly inputDigest: string;
}

export type ServiceState = "writable" | "read-only" | "stopped";

export type ServiceFailure =
    | {readonly code: "busy"; readonly holder: string; readonly since: number}
    | {readonly code: "exclusive-lost"}
    | {readonly code: "world-read-only"; readonly reason: string}
    | {readonly code: "write-unknown"}
    | {readonly code: "world-locked"}
    | {readonly code: "write-failed"; readonly message: string}
    | {readonly code: "too-large"}
    | {readonly code: "stopping"}
    | {readonly code: "cursor-stale"}
    | {readonly code: "chapter-not-found"};

/**
 * 服务的诊断：打开日志时的那几种，加上服务自己的。Spec 只给 `binder-invalid` 定了码，其余的码是实现取的名字。
 */
export type ServiceDiagnostic =
    | LogDiagnostic
    | {readonly code: "binder-invalid"}
    /** 世界只读，宿主给的新章序只用于计算，没有记进日志（输出 9）。 */
    | {readonly code: "reorder-not-recorded"; readonly reason: string}
    /** 写完核对尾部发现重号，或尾部比记下的短（输出 8、17）；世界随之只读。 */
    | {readonly code: "duplicate-version"}
    | {readonly code: "external-change"; readonly message: string}
    | {readonly code: "reduction-cache-bad-line"; readonly line: number}
    | {readonly code: "reduce-failed"; readonly message: string};

export const LEASE_MS = 60_000;

/** 剧情变更涉及这个条目：在 `involves` 里、是参与者（本体或马甲）、或补丁改到它（列表按条目筛时用）。 */
function concerns(change: StoryChange, entry: string): boolean {
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

/** 一条讲述的提示（model.md 输出 24、26、28、34）：失联、原句出现几次而没给 `nth`、带的标注只读（`mark` 是它在 `marks` 里的下标）。 */
export interface TellingHint {
    readonly code: "telling-lost" | "duplicate-quote" | "mark-kind-unknown" | "mark-version-unsupported";
    readonly detail: string;
    readonly mark?: number;
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

/** 对象上一条只读的标注（model.md 输出 28）：在对象里的位置、种类与原因。 */
export interface MarkHint {
    readonly code: "mark-kind-unknown" | "mark-version-unsupported";
    readonly path: string;
    readonly kind: string;
}

function markHintsOf(marks: MarkRegistry, kind: ObjectRef["kind"], object: unknown): MarkHint[] {
    const hints: MarkHint[] = [];
    for (const location of marksIn(kind, object)) {
        for (const [index, mark] of location.marks.entries()) {
            const code = markStatus(marks, mark);
            if (code !== null) hints.push({code, path: `${location.path}[${String(index)}]`, kind: mark.kind});
        }
    }
    return hints;
}

/** 世界服务交出的世界：读的部分。写入的方法（publish、revert、reorder 等）不在其中。 */
export type WorldSnapshot = Pick<World, "version" | "data" | "options" | "engine" | "revisions" | "recordedChapters" | "object" | "pending" | "dependents" | "requested">;

interface Lease {
    readonly token: string;
    readonly label: string;
    readonly since: number;
    expires: number;
}

export class WorldService {
    #world: World;
    #tail: Tail;
    #state: ServiceState;
    #readOnlyReason: string | null;
    #lease: Lease | null = null;
    #queue: Promise<unknown> = Promise.resolve();
    #listeners = new Set<(event: ServiceEvent) => void>();
    #reductions: Map<string, string>;
    #pendingReductions = new Map<string, ReductionInput>();
    #reducing = false;
    #tokens = 0;
    #leaseTimer: unknown = null;
    /**
     * 正文快照：宿主最近一次给出的各章正文与它的摘要（取不到正文的章是 `undefined` 与 `null`）。打开时按章序全读一次，
     * `textChanged` 时只重读那一章；世界的 `chapterText` 读这里，不再每次写入都去读文件。
     */
    readonly #texts = new Map<string, {readonly text: string | undefined; readonly digest: string | null}>();
    #textGeneration = 0;
    #stampCache: {readonly world: World; readonly generation: number; readonly stamp: ReadStamp} | null = null;
    /** 讲述按正文快照与当前章序定位（model.md 输出 24、26）；结果按章与那一章的正文缓存。 */
    readonly #locator = new TellingLocator((chapter) => this.#texts.get(chapter)?.text, () => this.#world.options.order);
    readonly diagnostics: ServiceDiagnostic[];
    readonly #ports: ServicePorts;

    private constructor(ports: ServicePorts, world: World, tail: Tail, readOnly: string | null, diagnostics: ServiceDiagnostic[], reductions: Map<string, string>) {
        this.#ports = ports;
        this.#world = world;
        this.#tail = tail;
        this.#state = readOnly === null ? "writable" : "read-only";
        this.#readOnlyReason = readOnly;
        this.diagnostics = diagnostics;
        this.#reductions = reductions;
    }

    /**
     * 打开世界（输出 4）；章序与登记的类型由宿主给。打开后章序与记下的不同就发布章序调整（输出 9）。宿主读不出活页夹清单
     * 时给 `invalid`：按日志里最近一次记下的章序计算，不发布章序调整，写诊断（输出 23）。
     */
    static async open(ports: ServicePorts, initial: {readonly chapters: readonly string[] | "invalid"; readonly registry: ComponentRegistry; readonly marks?: MarkRegistry; readonly diagnostics?: DiagnosticRegistry}): Promise<WorldService | {readonly code: "world-locked"}> {
        const opened = await openLog(ports.files, ports.logDir, {lock: ports.lock, sideDir: ports.sideDir, now: ports.now});
        if ("code" in opened) return opened;
        const cache = await loadReductions(ports.files, ports.cachePath);
        let service!: WorldService;
        const reductions = cache.entries;
        // 清单坏了：用日志里最后一次章序调整记下的章序。
        let recorded: readonly string[] = [];
        for (const revision of opened.revisions) for (const op of revision.ops) if (op.kind === "chapters") recorded = op.after;
        const chapters = initial.chapters !== "invalid" ? initial.chapters : recorded;
        const options = {
            order: new ChapterOrder(chapters),
            registry: initial.registry,
            ...(initial.marks === undefined ? {} : {marks: initial.marks}),
            ...(initial.diagnostics === undefined ? {} : {diagnostics: initial.diagnostics}),
            reductions: (input: ReductionInput) => service.#lookup(input),
            chapterText: (chapter: string) => service.#texts.get(chapter)?.text,
            digest: ports.digest,
            ...(ports.project === undefined ? {} : {project: ports.project}),
            ...(ports.verifyAuthorSource === undefined ? {} : {verifyAuthorSource: ports.verifyAuthorSource}),
        };
        const world = World.replay(opened.revisions, options);
        const readOnly = opened.readOnly === null ? null : `${opened.readOnly.segment}:${String(opened.readOnly.line)} ${opened.readOnly.message}`;
        const diagnostics: ServiceDiagnostic[] = [...opened.diagnostics, ...cache.badLines.map((line) => ({code: "reduction-cache-bad-line" as const, line}))];
        service = new WorldService(ports, world, opened.tail, readOnly, diagnostics, reductions);
        service.#syncTexts(chapters);
        await service.setChapters(initial.chapters);
        return service;
    }

    /**
     * 当前的世界，只读：写入一律经服务的方法（排队、落盘、发事件）。世界本身的 `publish` 等方法只算出新世界、不写日志，
     * 所以不从这里交出去。
     */
    get world(): WorldSnapshot {
        return this.#world;
    }

    subscribe(listener: (event: ServiceEvent) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #emit(event: ServiceEvent): void {
        for (const listener of this.#listeners) listener(event);
    }

    /* ---------- 读 ---------- */

    status() {
        this.#expireLease();
        return {
            ...this.#stamp(),
            state: this.#state,
            ...(this.#readOnlyReason === null ? {} : {reason: this.#readOnlyReason}),
            exclusive: this.#lease === null ? null : {label: this.#lease.label, since: this.#lease.since},
            diagnostics: [...this.diagnostics, ...this.#world.options.registry.diagnostics, ...(this.#world.options.marks ?? EMPTY_MARK_REGISTRY).diagnostics, ...(this.#world.options.diagnostics ?? EMPTY_DIAGNOSTIC_REGISTRY).diagnostics],
            recomputed: this.#world.engine.recomputed,
        };
    }

    entry(id: string, position: ReadPosition, mode: Mode, withOrigins = false) {
        const world = this.#world;
        const stamp = this.#stamp();
        const view = world.engine.entry(id, position, mode);
        if (view === "chapter-not-found" || view === null || !withOrigins) return view === "chapter-not-found" ? view : {...stamp, view};
        const origins: Record<string, unknown> = {};
        for (const [namespace, data] of Object.entries(view.namespaces)) {
            for (const field of Object.keys(data.fields)) origins[`${namespace}.${field}`] = world.engine.origins({entry: id, path: `${namespace}.${field}`}, position, mode);
        }
        return {...stamp, view, origins};
    }

    /**
     * 按 id 读一个存下来的对象（条目、剧情变更、核对点、决策、正文建议）；不存在时为 null（方法表 `object`）。
     * 对象上只读的标注（种类不在、版本对不上）列在 `markHints` 里（model.md 输出 28）。
     */
    object(ref: ObjectRef): ReadStamp & {readonly object: unknown; readonly markHints?: readonly MarkHint[]} {
        const world = this.#world;
        const object = world.object(ref) ?? null;
        const hints = markHintsOf(world.options.marks ?? EMPTY_MARK_REGISTRY, ref.kind, object);
        return {...this.#stamp(), object, ...(hints.length === 0 ? {} : {markHints: hints})};
    }

    pending(position?: ReadPosition): (ReadStamp & {items: readonly PendingItem[]}) | "chapter-not-found" {
        const world = this.#world;
        const items = world.pending(position ?? defaultPosition(world.options.order));
        return items === "chapter-not-found" ? items : {...this.#stamp(), items};
    }

    /** 条目树的一层：父条目（null 是根）下按顺序的条目（输出：`tree`）。 */
    tree(parent: string | null, cursor?: string, limit = 50) {
        const world = this.#world;
        const children = [...world.data.entries.values()].filter((entry) => entry.parent === parent).sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
        const stamp = this.#stamp();
        const page = this.#page(stamp, children, cursor, limit, {method: "tree", parent});
        if (page === "cursor-stale") return page;
        return {
            ...stamp,
            items: page.items.map((entry) => ({id: entry.id, name: entry.init.name, type: entry.type, folder: entry.folder, deleted: entry.deleted === true, hasChildren: [...world.data.entries.values()].some((other) => other.parent === entry.id)})),
            ...(page.next === undefined ? {} : {cursor: page.next}),
        };
    }

    /** 按名字或别名找条目，用这个位置上有效的名字（输出：`lookup`）。 */
    lookup(names: readonly string[], position: ReadPosition) {
        const world = this.#world;
        const found: Record<string, string[]> = {};
        for (const name of names) found[name] = [];
        for (const entry of world.data.entries.values()) {
            if (entry.deleted === true) continue;
            const view = world.engine.entry(entry.id, position, "actual");
            if (view === "chapter-not-found") return view;
            if (view === null || view.deleted || !view.appeared) continue;
            for (const name of names) if (view.name === name || view.aliases.includes(name)) found[name]!.push(entry.id);
        }
        return {...this.#stamp(), found};
    }

    /** 剧情变更的列表，按全序；每条带生效状态与这次套没套上（输出：`changes`）。 */
    /**
     * 剧情变更（方法表 `changes`）：`entry` 筛涉及它的（`involves`、参与者、补丁地址）；`nature` 筛性质（没写的是 `event`）；
     * `progress` 筛计划在全书当前进展上的进展（model.md 输出 13，只有计划有进展）。按安放的先后排。
     */
    changes(filter: {readonly chapter?: string; readonly entry?: string; readonly line?: string; readonly kind?: "written" | "plan"; readonly status?: "active" | "held" | "undone"; readonly nature?: "event" | "narration"; readonly progress?: PlanProgress} = {}, cursor?: string, limit = 50) {
        const world = this.#world;
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
        const stamp = this.#stamp();
        const page = this.#page(stamp, matching, cursor, limit, {method: "changes", ...filter});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items.map((change) => ({change, outcome: world.engine.outcome(change.id) ?? null})), ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /**
     * 讲述（project.md 方法表的 `tellings`，model.md 输出 24 到 27）：每条带所在的对象、发生点或失联的原因。生效的按读的
     * 先后排（章序、段、段内偏移、讲述 id），其余排在后面（按对象、讲述 id）。`until` 只留在这个讲述位置读过的；
     * `effective` 筛生效与否；`entry` 筛这个条目自己的、涉及它的剧情变更的、核对它的；`mark` 筛带这个种类标注的。
     */
    tellings(filter: {readonly from?: string; readonly to?: string; readonly entry?: string; readonly effective?: boolean; readonly until?: TellingPosition; readonly mark?: string} = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        const order = world.options.order;
        const inRange = (chapter: string | undefined) => {
            if (filter.from === undefined && filter.to === undefined) return true;
            const index = chapter === undefined ? undefined : order.index(chapter);
            if (index === undefined) return false;
            return (filter.from === undefined || index >= (order.index(filter.from) ?? Infinity)) && (filter.to === undefined || index <= (order.index(filter.to) ?? -Infinity));
        };
        const items: {telling: Telling; owner: ObjectRef; path: string; located: Located}[] = [];
        const collect = (owner: ObjectRef, path: string, tellings: readonly Telling[], concerns: boolean) => {
            if (filter.entry !== undefined && !concerns) return;
            for (const telling of tellings) {
                if (!inRange(telling.chapter)) continue;
                if (filter.mark !== undefined && !(telling.marks ?? []).some((mark) => mark.kind === filter.mark)) continue;
                const located = this.#locator.locate(telling);
                const effective = located.kind === "found";
                if (filter.effective !== undefined && filter.effective !== effective) continue;
                if (filter.until !== undefined && (located.kind !== "found" || !readBy(order, located.occurrence, filter.until))) continue;
                items.push({telling, owner, path, located});
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
        const stamp = this.#stamp();
        const page = this.#page(stamp, items, cursor, limit, {method: "tellings", ...filter});
        if (page === "cursor-stale") return page;
        const marks = world.options.marks ?? EMPTY_MARK_REGISTRY;
        return {
            ...stamp,
            items: page.items.map((item) => {
                const hints = tellingHints(marks, item.telling, item.located);
                return {...item, ...(hints.length === 0 ? {} : {hints})};
            }),
            ...(page.next === undefined ? {} : {cursor: page.next}),
        };
    }

    /**
     * 某人在场的剧情变更（方法表 `presence`，model.md 输出 29）：`from`、`to` 是安放所在章的范围（含两头；不写 `from` 时含前史）。
     * 实际模式取已写、生效、套上的变更；按计划模式再加上在 `to` 的章末（没写时在缺省读取位置）计入的计划。参与者里
     * `who` 或 `as` 是他、`role` 为 `present` 的算在场；没记参与者的变更不算，只计数（`uncast`）。
     */
    presence(person: string, filter: {readonly from?: string; readonly to?: string; readonly mode?: Mode} = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        const order = world.options.order;
        const from = filter.from === undefined ? undefined : order.index(filter.from);
        const to = filter.to === undefined ? undefined : order.index(filter.to);
        if ((filter.from !== undefined && from === undefined) || (filter.to !== undefined && to === undefined)) return "chapter-not-found" as const;
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
        const uncast = counted.filter((change) => change.cast === undefined).length;
        sortByPlacement(order, present);
        const stamp = this.#stamp();
        const page = this.#page(stamp, present, cursor, limit, {method: "presence", person, ...filter});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items.map((change) => ({change})), uncast, ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /** 决策，按 id；状态筛选、游标分页（project.md 方法表的 `decisions`）。 */
    /**
     * 决策（方法表 `decisions`），按 id：状态与挂的对象筛选。每条带读取时的说明（model.md 输出 31 到 33）：建议标
     * “作者未确认”，已定而没给理由的写“作者没说理由”，不在已定状态时存着的结论等列在“重新打开前定下的”下面，
     * 挂的条目删了显示“已删除的条目”。
     */
    decisions(filter: {readonly status?: Decision["status"]; readonly about?: ObjectRef | {readonly kind: "chapter"; readonly id: string}} = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        const matching = [...world.data.decisions.values()]
            .filter((item) => filter.status === undefined || item.status === filter.status)
            .filter((item) => filter.about === undefined || item.about.some((about) => aboutMatches(about, filter.about!)))
            .sort((a, b) => compareIds(a.id, b.id));
        const stamp = this.#stamp();
        const page = this.#page(stamp, matching, cursor, limit, {method: "decisions", ...filter});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items.map((decision) => decisionView(decision, (id) => world.data.entries.get(id))), ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /** 正文建议，按 id；状态筛选、游标分页（方法表）。 */
    suggestions(status?: "open" | "applied" | "declined", cursor?: string, limit = 50) {
        const world = this.#world;
        const matching = [...world.data.suggestions.values()].filter((item) => status === undefined || item.status === status).sort((a, b) => compareIds(a.id, b.id));
        const stamp = this.#stamp();
        const page = this.#page(stamp, matching, cursor, limit, {method: "suggestions", status});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items, ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /** 改动记录，按版本从新到旧，带能不能还原（revisions.md 输出 14）。 */
    revisions(filter: {readonly chapter?: string; readonly entry?: string; readonly by?: Revision["by"]["kind"]} = {}, cursor?: string, limit = 20) {
        const world = this.#world;
        const matching = [...world.revisions].reverse().filter((revision) =>
            (filter.chapter === undefined || revision.chapter === filter.chapter) &&
            (filter.by === undefined || revision.by.kind === filter.by) &&
            // 改过这个条目的修订，与新写或改过指向它的引用的修订（revisions.md 输出 14，引用按发布时存下的 `refs`）。
            (filter.entry === undefined || revision.ops.some((op) => op.kind !== "chapters" && op.ref.id === filter.entry) || (revision.refs ?? []).some((reference) => reference.target.id === filter.entry)),
        );
        const stamp = this.#stamp();
        const page = this.#page(stamp, matching, cursor, limit, {method: "revisions", ...filter});
        if (page === "cursor-stale") return page;
        return {
            ...stamp,
            items: page.items.map((revision) => {
                const set = world.dependents(revision.id);
                const revertable = set === "not-revertable" ? {ok: false, reason: "not-revertable"} : set.length > 1 ? {ok: false, reason: "has-dependents", dependents: set.slice(1)} : {ok: true};
                return {id: revision.id, version: revision.version, by: revision.by, what: revision.what, title: revision.title, time: revision.time, chapter: revision.chapter, impact: revision.impact, revertable};
            }),
            ...(page.next === undefined ? {} : {cursor: page.next}),
        };
    }

    render(entry: string, position: ReadPosition, mode: Mode, audience: "author" | "agent") {
        const result = audience === "author" ? renderEntryForAuthor(this.#world, entry, position, mode) : renderEntryForAgent(this.#world, entry, position, mode);
        return result === null || result === "chapter-not-found" ? result : {...result, ...this.#stamp()};
    }

    /** 预览写入请求，或还原请求（另给补偿要的作者授权，revisions.md 输出 5、21）。 */
    preview(request: WriteRequest): WriteResult;
    preview(request: RevertRequest): ReturnType<World["previewRevert"]>;
    preview(request: WriteRequest | RevertRequest): WriteResult | ReturnType<World["previewRevert"]> {
        if ("puts" in request) return this.#world.preview(request, this.#ports.now());
        const {revert, withDependents, ...meta} = request;
        return this.#world.previewRevert(revert, withDependents, meta, this.#ports.now());
    }

    /** 按请求 id 查结局（输出 16）。 */
    outcome(requestId: string): {readonly published: true; readonly revision: string; readonly version: number} | {readonly published: false} | {readonly code: "write-unknown"} {
        if (this.#state === "read-only" && this.#readOnlyReason === "write-unknown") return {code: "write-unknown"};
        const revision = this.#world.requested(requestId);
        return revision === undefined ? {published: false} : {published: true, revision: revision.id, version: revision.version};
    }

    /* ---------- 写 ---------- */

    publish(request: WriteRequest, token?: string): Promise<WriteResult | {readonly ok: false; readonly failure: ServiceFailure}> {
        return this.#write(token, (world) => world.publish(request, this.#ports.now()));
    }

    editInPlace(edit: InPlaceEdit, token?: string): Promise<EditResult | {readonly ok: false; readonly failure: ServiceFailure}> {
        return this.#write(token, (world) => editInPlace(world, edit, this.#ports.now()));
    }

    recordDelta(input: Parameters<typeof recordDelta>[1], token?: string): Promise<EditResult | {readonly ok: false; readonly failure: ServiceFailure}> {
        return this.#write(token, (world) => recordDelta(world, input, this.#ports.now()));
    }

    writeBack(input: WriteBackInput, token?: string): Promise<WriteBackResult | {readonly ok: false; readonly failure: ServiceFailure}> {
        return this.#write(token, (world) => writeBack(world, input, this.#ports.now()));
    }

    revert(target: string, withDependents: boolean, meta: RevertMeta, token?: string) {
        return this.#write(token, (world) => world.revert(target, withDependents, meta, this.#ports.now()));
    }

    /**
     * 写入的公共路径：排队、检查独占、在当前世界上算、追加落盘、换上新世界。`compute` 必须是纯函数（重算时会再调一次）。
     */
    #write<R extends {readonly ok: boolean}>(token: string | undefined, compute: (world: World) => R, system = false): Promise<R | {readonly ok: false; readonly failure: ServiceFailure}> {
        const run = async (): Promise<R | {readonly ok: false; readonly failure: ServiceFailure}> => {
            if (this.#state === "stopped") return {ok: false, failure: {code: "stopping"}};
            if (this.#state === "read-only") return {ok: false, failure: this.#readOnlyReason === "write-unknown" ? {code: "write-unknown"} : {code: "world-read-only", reason: this.#readOnlyReason ?? ""}};
            this.#expireLease();
            const lease = this.#lease;
            if (!system && lease !== null && lease.token !== token) return {ok: false, failure: {code: "busy", holder: lease.label, since: lease.since}};
            if (!system && token !== undefined && (lease === null || lease.token !== token)) return {ok: false, failure: {code: "exclusive-lost"}};
            if (lease !== null && lease.token === token) {
                lease.expires = this.#ports.clock() + LEASE_MS;
                this.#scheduleExpiry();
            }
            for (let attempt = 0; attempt < 3; attempt += 1) {
                const result = compute(this.#world);
                if (!result.ok || (result as {repeated?: boolean}).repeated === true) return result;
                const published = result as unknown as Extract<WriteResult, {ok: true}>;
                const appended = await appendRevision(this.#ports.files, this.#ports.logDir, this.#tail, published.revision, this.#ports.lock);
                if ("tail" in appended) {
                    this.#world = published.world;
                    this.#tail = appended.tail;
                    const revision = published.revision;
                    this.#emit({kind: "changed", version: revision.version, revision: revision.id, by: revision.by, what: revision.what, title: revision.title});
                    this.#queueLatestReductions(revision);
                    return result;
                }
                if (appended.code === "tail-moved") {
                    const absorbed = await this.#absorb();
                    if (absorbed !== null) return {ok: false, failure: absorbed};
                    continue;
                }
                if (appended.code === "write-unknown" || appended.code === "duplicate-version") {
                    this.#state = "read-only";
                    this.#readOnlyReason = appended.code === "write-unknown" ? "write-unknown" : "duplicate-version";
                    if (appended.code === "duplicate-version") this.diagnostics.push({code: "duplicate-version"});
                    return {ok: false, failure: appended.code === "write-unknown" ? {code: "write-unknown"} : {code: "world-read-only", reason: "duplicate-version"}};
                }
                return {ok: false, failure: appended.code === "write-failed" ? {code: "write-failed", message: appended.message} : {code: appended.code}};
            }
            return {ok: false, failure: {code: "world-locked"}};
        };
        const next = this.#queue.then(run, run);
        this.#queue = next.catch(() => undefined);
        return next;
    }

    /** 读进别的进程写的行（输出 17）；尾部变短转只读。 */
    async #absorb(): Promise<ServiceFailure | null> {
        const caught = await readNew(this.#ports.files, this.#ports.logDir, this.#tail, this.#ports.lock);
        if ("code" in caught) {
            if (caught.code === "world-locked") return {code: "world-locked"};
            this.#state = "read-only";
            this.#readOnlyReason = `external-change: ${caught.message ?? ""}`;
            this.diagnostics.push({code: "external-change", message: caught.message ?? ""});
            return {code: "world-read-only", reason: this.#readOnlyReason};
        }
        for (const revision of caught.revisions) {
            this.#world = this.#world.absorb(revision);
            this.#emit({kind: "changed", version: revision.version, revision: revision.id, by: revision.by, what: revision.what, title: revision.title});
        }
        this.#tail = caught.tail;
        return null;
    }

    /** 日志目录变了（宿主的监视器去抖后调）：持锁读进别的进程的行（输出 17）。 */
    externalChanged(): Promise<unknown> {
        const run = async () => (this.#state === "writable" ? this.#absorb() : null);
        const next = this.#queue.then(run, run);
        this.#queue = next.catch(() => undefined);
        return next;
    }

    /**
     * 宿主通知正文变了（project.md 输出 25）：重读这一章（不给章就是全部）进正文快照，版本不变，发 `textChanged`。
     * 不在章序里的章不读。
     */
    textChanged(chapter?: string): void {
        const chapters = chapter === undefined ? [...this.#world.options.order.ids] : this.#world.options.order.has(chapter) ? [chapter] : [];
        for (const id of chapters) this.#loadText(id);
        this.#textGeneration += 1;
        this.#emit({kind: "textChanged", chapter: chapter ?? null});
    }

    /** 宿主给出新章序（输出 9）：与记下的不同就发布章序调整；`invalid` 时保持原章序并写诊断（输出 23）。 */
    async setChapters(chapters: readonly string[] | "invalid"): Promise<void> {
        if (chapters === "invalid") {
            this.diagnostics.push({code: "binder-invalid"});
            return;
        }
        this.#syncTexts(chapters);
        const order = new ChapterOrder(chapters);
        await this.#write(undefined, (world) => {
            const moved = world.withOptions({...world.options, order});
            const result = moved.reorder(order, this.#ports.now(), `reorder-${this.#ports.digest(stableStringify({chapters, version: world.version}))}`);
            return result ?? {ok: true as const, world: moved, revision: undefined as never, ids: {}, repeated: true};
        }, true).then((result) => {
            // 没有要发布的章序调整，或世界只读时：只换上新章序计算。
            if ((result as {repeated?: boolean}).repeated === true || !result.ok) this.#world = this.#world.withOptions({...this.#world.options, order});
            if (!result.ok && "failure" in result && (result.failure.code === "world-read-only" || result.failure.code === "write-unknown")) {
                this.diagnostics.push({code: "reorder-not-recorded", reason: result.failure.code});
            }
        });
    }

    /**
     * 登记变了（插件启停）：换上新登记，版本不变。Component 类型变了整本重算；标注种类与诊断的登记变了只影响之后的
     * 校验、提示与读取输入的摘要，不重算。排进写入队列：正在落盘的发布完成时会换上它算出的世界，登记要在它之后换，
     * 否则被盖掉。
     */
    setRegistries(registries: {readonly registry?: ComponentRegistry; readonly marks?: MarkRegistry; readonly diagnostics?: DiagnosticRegistry}): Promise<void> {
        const run = () => {
            this.#world = this.#world.withOptions({...this.#world.options, ...registries});
        };
        const next = this.#queue.then(run, run);
        this.#queue = next.catch(() => undefined);
        return next;
    }

    /* ---------- 独占写入（输出 10） ---------- */

    acquireExclusive(label: string): {readonly token: string; readonly expires: number} | {readonly code: "busy"; readonly holder: string; readonly since: number} {
        this.#expireLease();
        if (this.#lease !== null) return {code: "busy", holder: this.#lease.label, since: this.#lease.since};
        const now = this.#ports.clock();
        const token = `lease-${String(++this.#tokens)}-${String(now)}`;
        this.#lease = {token, label, since: now, expires: now + LEASE_MS};
        this.#scheduleExpiry();
        this.#emit({kind: "exclusive", holder: label});
        return {token, expires: this.#lease.expires};
    }

    renewExclusive(token: string): {readonly expires: number} | {readonly code: "exclusive-lost"} {
        this.#expireLease();
        if (this.#lease?.token !== token) return {code: "exclusive-lost"};
        this.#lease.expires = this.#ports.clock() + LEASE_MS;
        this.#scheduleExpiry();
        return {expires: this.#lease.expires};
    }

    releaseExclusive(token: string): void {
        if (this.#lease?.token === token) this.#endLease();
    }

    breakExclusive(): void {
        if (this.#lease !== null) this.#endLease();
    }

    #expireLease(): void {
        if (this.#lease !== null && this.#ports.clock() >= this.#lease.expires) this.#endLease();
    }

    /** 按当前租约的到期时间重排定时；到点时按注入的时钟再判一次（续期过就再排）。 */
    #scheduleExpiry(): void {
        const timer = this.#ports.timer;
        if (timer === undefined) return;
        if (this.#leaseTimer !== null) timer.clear(this.#leaseTimer);
        this.#leaseTimer = null;
        const lease = this.#lease;
        if (lease === null || this.#state === "stopped") return;
        this.#leaseTimer = timer.set(Math.max(0, lease.expires - this.#ports.clock()), () => {
            this.#leaseTimer = null;
            if (this.#lease !== lease) return;
            this.#expireLease();
            if (this.#lease === lease) this.#scheduleExpiry();
        });
    }

    #endLease(): void {
        this.#lease = null;
        if (this.#leaseTimer !== null) this.#ports.timer?.clear(this.#leaseTimer);
        this.#leaseTimer = null;
        this.#emit({kind: "exclusive", holder: null});
    }

    /* ---------- 归纳（输出 11） ---------- */

    #key(input: ReductionInput): string {
        return this.#ports.digest(stableStringify({...input, model: this.#ports.reducer?.version ?? null}));
    }

    #lookup(input: ReductionInput): string | undefined {
        // 没有小模型、缓存也是空的（第一版的产品就是这样）：不必算键。键要对整串事件做摘要，事件多的字段每次读取都要付。
        if (this.#ports.reducer === undefined && this.#reductions.size === 0) return undefined;
        const key = this.#key(input);
        const hit = this.#reductions.get(key);
        if (hit === undefined && this.#ports.reducer !== undefined && !this.#pendingReductions.has(key)) {
            this.#pendingReductions.set(key, input);
            queueMicrotask(() => void this.#drainReductions());
        }
        return hit;
    }

    /**
     * 发布后把最新一章末尾缺的归纳排进去（输出 11）：读一遍这次修订动到的条目在那里的视图，没命中的由 `#lookup` 排上。
     * 只读这次动到的条目，不扫整本：别的条目的归纳输入没变，缺的话在读到时才排。
     */
    #queueLatestReductions(revision: Revision): void {
        if (this.#ports.reducer === undefined) return;
        const world = this.#world;
        const last = world.options.order.ids.at(-1);
        if (last === undefined) return;
        const entries = new Set<string>();
        for (const op of revision.ops) {
            if (op.kind === "chapters") continue;
            if (op.ref.kind === "entry") entries.add(op.ref.id);
            if (op.ref.kind === "change") for (const patch of world.data.changes.get(op.ref.id)?.patches ?? []) entries.add(patch.at.entry);
        }
        for (const entry of entries) world.engine.entry(entry, {kind: "chapter", chapter: last, edge: "end"}, "actual");
    }

    /** 补算排着的归纳；同一个输入同一时刻只算一次。失败的丢掉，下次遇到再排。 */
    async #drainReductions(): Promise<void> {
        if (this.#reducing || this.#ports.reducer === undefined) return;
        this.#reducing = true;
        try {
            while (this.#pendingReductions.size > 0 && this.#state !== "stopped") {
                const [key, input] = this.#pendingReductions.entries().next().value as [string, ReductionInput];
                try {
                    const text = await this.#ports.reducer.reduce(input);
                    // 等小模型期间可能已经停止。
                    if ((this.#state as ServiceState) === "stopped") return;
                    // 落盘成功才算补上：写缓存失败时不留在内存里，下次读到再排（输出 11）。
                    await appendReduction(this.#ports.files, this.#ports.cachePath, key, text);
                    this.#reductions.set(key, text);
                    this.#emit({kind: "reduced"});
                } catch (error) {
                    this.diagnostics.push({code: "reduce-failed", message: error instanceof Error ? error.message : String(error)});
                } finally {
                    this.#pendingReductions.delete(key);
                }
            }
        } finally {
            this.#reducing = false;
        }
    }

    /** 等排着的写入与补算都结束（测试与停止用）。 */
    async idle(): Promise<void> {
        await this.#queue;
        while (this.#reducing || this.#pendingReductions.size > 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    /** 停止（输出 15）：正在进行的写入做完，之后的写入得到 `stopping`，独占结束，补算丢弃。 */
    async stop(): Promise<void> {
        const pending = this.#queue;
        this.#state = "stopped";
        this.#pendingReductions.clear();
        if (this.#lease !== null) this.#endLease();
        await pending;
    }

    /* ---------- 正文快照与读取输入（model.md 输出 36） ---------- */

    #loadText(chapter: string): void {
        const text = this.#ports.chapterText(chapter);
        this.#texts.set(chapter, {text, digest: text === undefined ? null : this.#ports.digest(text)});
    }

    /** 让正文快照只含章序里的章：新出现的读进来，不在章序里的去掉。 */
    #syncTexts(chapters: readonly string[]): void {
        const wanted = new Set(chapters);
        let changed = false;
        for (const id of chapters) {
            if (this.#texts.has(id)) continue;
            this.#loadText(id);
            changed = true;
        }
        for (const id of [...this.#texts.keys()]) {
            if (wanted.has(id)) continue;
            this.#texts.delete(id);
            changed = true;
        }
        if (changed) this.#textGeneration += 1;
    }

    /**
     * 这次读取的戳。世界（版本、章序、登记都在它的 options 里）与正文快照都没变时用上一次算好的：全书的正文快照摘要
     * 要拼一千多章的摘要，每次读取都算不划算。
     */
    #stamp(): ReadStamp {
        const world = this.#world;
        const cached = this.#stampCache;
        if (cached !== null && cached.world === world && cached.generation === this.#textGeneration) return cached.stamp;
        const ids = world.options.order.ids;
        const textDigest = this.#ports.digest(canonicalJson(ids.map((id) => [id, this.#texts.get(id)?.digest ?? null])));
        const inputDigest = this.#ports.digest(canonicalJson({
            version: world.version,
            chapters: ids.map((id) => [id, "main"]),
            text: textDigest,
            registry: {
                components: world.options.registry.versions.map(([id, version]) => [id, version]),
                marks: (world.options.marks ?? EMPTY_MARK_REGISTRY).versions.map(([id, version]) => [id, version]),
                diagnostics: (world.options.diagnostics ?? EMPTY_DIAGNOSTIC_REGISTRY).versions.map(([id, version]) => [id, version]),
            },
            pluginData: [],
            calendar: null,
            fuzzy: null,
        }));
        const stamp = {version: world.version, textDigest, inputDigest};
        this.#stampCache = {world, generation: this.#textGeneration, stamp};
        return stamp;
    }

    /* ---------- 游标（输出 19） ---------- */

    /**
     * 游标是“读取输入的摘要:读取参数的摘要:偏移”（输出 19）：读取输入的任何一项变了，或者拿着游标换了方法、换了筛选，
     * 都得到 `cursor-stale`。`params` 是方法名与影响结果的参数（条数不算：换条数接着翻不会漏项）。
     */
    #page<T>(stamp: ReadStamp, items: readonly T[], cursor: string | undefined, limit: number, params: {readonly method: string} & Readonly<Record<string, unknown>>): {items: readonly T[]; next?: string} | "cursor-stale" {
        const query = this.#ports.digest(stableStringify(params));
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
}
