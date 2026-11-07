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

import {GREGORIAN, resolveFuzzy, validateCalendar, type Calendar, type CalendarProblem, type FuzzyProblem} from "@notnotype/nb-time";

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
import {renderEntryForAgent, renderEntryForAuthor, type RenderOptions} from "../render/entry";
import {writeBack, type WriteBackInput, type WriteBackResult} from "../render/writeback";
import {editInPlace, recordDelta, type EditResult, type InPlaceEdit} from "../world/edits";
import {marksIn} from "../world/references";
import {TellingLocator, type Occurrence} from "../world/tellings";
import {processFindings, type DiagnosticCompute, type Finding} from "./diagnostics";
import {canonHints, HINT_GROUP_ORDER, occurrencePosition, PENDING_GROUP_ORDER, placementPosition, sortableCanonItem, sortGroup, type GroupItem, type PendingPage, type Sortable, type SortPosition} from "./pending-groups";
import {boundRank, chapterWithin, placementWithin, positionWithin, tellingPositionWithin, tellingWithin, ViewAudit, type ViewedReads, type ViewGrant} from "./views";
import {DEFAULT_TIME} from "../time/network";
import {answerTime, type TimeAnswer, type TimeQuery} from "../time/queries";
import {timeState, type TimeState} from "../time/state";
import {lineTable, MAIN_LINE} from "../lines/table";
import {changeItem, createReadView, lineSummaries, pageOf, readStampOf, type CanonReadView, type ReadStamp, listChanges, listDecisions, listPresence, listTellings, tellingInLine, type ChangeFilter, type DecisionFilter, type PresenceFilter, type TellingFilter} from "./reads";
import type {RevertRequest} from "../world/authorization";
import {decisionView} from "../world/decisions";
import {World, type ChapterLine, type RevertMeta, type WriteResult} from "../world/world";

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

export type {ReadStamp} from "./reads";
export type {ViewedReads} from "./views";

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
    /** 活页夹里章讲的线两种模式下都不存在，这一段按主线算（canon.worldlines 输出 13）。 */
    | {readonly code: "binder-line-unknown"; readonly chapter: string; readonly from: number; readonly line: string}
    /** 世界只读，宿主给的新章序只用于计算，没有记进日志（输出 9）。 */
    | {readonly code: "reorder-not-recorded"; readonly reason: string}
    /** 写完核对尾部发现重号，或尾部比记下的短（输出 8、17）；世界随之只读。 */
    | {readonly code: "duplicate-version"}
    | {readonly code: "external-change"; readonly message: string}
    | {readonly code: "reduction-cache-bad-line"; readonly line: number}
    /** 作品设置里的历法不合法（canon.time 输出 13、16）：`using` 是现在用的那一份。 */
    | {readonly code: "calendar-invalid"; readonly problems: readonly CalendarProblem[]; readonly using: "previous" | "builtin"}
    /** 模糊词表里某一项不合法，作废（canon.time 输入表）。 */
    | {readonly code: "fuzzy-word-invalid"; readonly problems: readonly FuzzyProblem[]}
    | {readonly code: "reduce-failed"; readonly message: string};

export const LEASE_MS = 60_000;

/** 三组的结果缓存几份（按读取输入、模式与位置）；翻页与各组总数读缓存，不重新调诊断。 */
const GROUPS_CACHE_LIMIT = 8;
const TIMINGS_KEPT = 20;
const SLOW_DIAGNOSTIC_MS = 200;

export type PendingGroupName = "pending" | "hints" | "handled";

interface PendingGroups {
    readonly pending: readonly GroupItem[];
    readonly hints: readonly GroupItem[];
    readonly handled: readonly GroupItem[];
    readonly unavailable: readonly {readonly diagnostic: string; readonly reason: string}[];
    readonly truncated: readonly string[];
    readonly disabled: readonly string[];
}

/** 世界里的全部讲述，按讲述 id（发现挂在讲述上时找它的发生点）。 */
function tellingsById(world: World): Map<string, Telling> {
    const found = new Map<string, Telling>();
    for (const change of world.data.changes.values()) for (const telling of change.told) found.set(telling.id, telling);
    for (const check of world.data.checks.values()) found.set(check.told.id, check.told);
    for (const entry of world.data.entries.values()) for (const tellings of Object.values(entry.retold ?? {})) for (const telling of tellings) found.set(telling.id, telling);
    return found;
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
export type WorldSnapshot = Pick<World, "version" | "data" | "options" | "line" | "revisions" | "recordedChapters" | "object" | "pending" | "dependents" | "requested">;

interface Lease {
    readonly token: string;
    readonly label: string;
    readonly since: number;
    expires: number;
}

/** 这次更新重算的事件数：主线加这次更新过的子线（`ms` 只算计算，不含写盘）。 */
function recomputedOn(world: World): number {
    const others = new Set(world.lines.updates.map((update) => update.line).filter((line) => line !== MAIN_LINE));
    return [...others].reduce((sum, line) => sum + (world.lines.peek(line)?.engine.recomputed ?? 0), world.line().engine.recomputed);
}

export class WorldService {
    #world: World;
    #tail: Tail;
    #state: ServiceState;
    #readOnlyReason: string | null;
    #lease: Lease | null = null;
    readonly #work: {open: {readonly recomputed: number; readonly ms: number} | null; publish: {readonly recomputed: number; readonly ms: number} | null} = {open: null, publish: null};
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
    /** 世界以外的读取输入（正文快照、插件的诊断数据版本）每变一次加一；读取的戳与诊断结果的缓存按它作废。 */
    #inputGeneration = 0;
    /** 插件经项目内接口登记的诊断计算与数据版本，按插件 id（model.md “诊断的计算”）。 */
    readonly #computers = new Map<string, {readonly token: object; readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}>();
    /** 这个实例里登记过的诊断 id 与插件：插件停用以后，它的诊断列在“因插件停用而未计算的诊断”里（model.md 输出 34）。 */
    readonly #seenDiagnostics = new Map<string, string>();
    /** 三组的计算结果，按读取输入的摘要、模式与位置；只留最近几份。 */
    readonly #groupsCache = new Map<string, PendingGroups>();
    /** 打开着的视图，按令牌（输出 24）；令牌的寿命由调用方那一层管，它在调用方断开或入口停止时调 `closeView`。 */
    readonly #views = new Map<string, ViewGrant>();
    readonly #viewAudit = new ViewAudit();
    /** 最近几次诊断计算的耗时（project.md 输出 26）。 */
    readonly #timings: {readonly diagnostic: string; readonly ms: number}[] = [];
    #stampCache: {readonly world: World; readonly generation: number; readonly stamp: ReadStamp} | null = null;
    #viewCache: {readonly world: World; readonly generation: number; readonly views: Map<string, CanonReadView>} | null = null;
    readonly #boundedStates = new WeakMap<World, Map<string, TimeState>>();
    /** 讲述按正文快照与当前章序定位（model.md 输出 24、26）；结果按章与那一章的正文缓存。 */
    readonly #locator = new TellingLocator((chapter) => this.#texts.get(chapter)?.text, () => this.#world.options.order);
    readonly diagnostics: ServiceDiagnostic[];
    /** 历法与词表的诊断（`setTime` 整份重算）。 */
    #timeDiagnostics: ServiceDiagnostic[] = [];
    /** 最近一次合法的历法（canon.time 输出 16）。 */
    #lastValidCalendar: Calendar | null = null;
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
    static async open(ports: ServicePorts, initial: {readonly chapters: readonly string[] | "invalid"; readonly chapterLines?: ReadonlyMap<string, readonly ChapterLine[]>; readonly registry: ComponentRegistry; readonly marks?: MarkRegistry; readonly diagnostics?: DiagnosticRegistry}): Promise<WorldService | {readonly code: "world-locked"}> {
        const started = performance.now();
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
        service.#noteDiagnostics(initial.diagnostics);
        await service.setChapters(initial.chapters, initial.chapterLines);
        service.#work.open = {recomputed: recomputedOn(service.#world), ms: performance.now() - started};
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
            diagnostics: [...this.diagnostics, ...this.#timeDiagnostics, ...this.#binderLineDiagnostics(), ...this.#world.options.registry.diagnostics, ...(this.#world.options.marks ?? EMPTY_MARK_REGISTRY).diagnostics, ...(this.#world.options.diagnostics ?? EMPTY_DIAGNOSTIC_REGISTRY).diagnostics],
            /** 最近几次插件诊断的计算耗时，超过 200 毫秒的标 `slow`（project.md 输出 26）。 */
            diagnosticTimings: this.#timings.map((timing) => ({...timing, ...(timing.ms > SLOW_DIAGNOSTIC_MS ? {slow: true as const} : {})})),
            /** 当前打开的视图数（project.md 输出 26）：看令牌有没有随调用方收口。 */
            openViews: this.#views.size,
            recomputed: this.#world.line().engine.recomputed,
            /** 最近一次打开与发布的重算量与耗时（project.md 方法表 `status`）。 */
            work: {...this.#work},
            /** 各条世界线：已建的与是否常驻、最近一次发布更新了哪些线与原因（project.md 输出 26）。 */
            lines: {built: this.#world.lines.builtLines, updated: this.#world.lines.updates},
        };
    }

    /** 世界线的树（project.md 方法表 `lines`）：线表，加各线是否已建与常驻。 */
    lines() {
        const world = this.#world;
        const built = new Map(world.lines.builtLines.map((item) => [item.line, item.resident]));
        return {...this.#stampOf(world), lines: lineSummaries(world).map((summary) => ({...summary, built: built.has(summary.id), resident: built.get(summary.id) === true}))};
    }

    /** 每次读状态时按当前世界与活页夹重算：线写下以后诊断自己消失。 */
    #binderLineDiagnostics(): ServiceDiagnostic[] {
        const world = this.#world;
        const table = lineTable(world.data, world.options.order);
        const found: ServiceDiagnostic[] = [];
        for (const [chapter, segments] of world.options.chapterLines ?? []) {
            for (const segment of segments) {
                const entry = table.lines.get(segment.line);
                if (segment.line !== MAIN_LINE && (entry === undefined || (!entry.exists.actual && !entry.exists.planned))) found.push({code: "binder-line-unknown", chapter, from: segment.from, line: segment.line});
            }
        }
        return found;
    }

    entry(id: string, position: ReadPosition, mode: Mode, withOrigins = false) {
        return this.#entryOn(this.#world, id, position, mode, withOrigins);
    }

    #entryOn(world: World, id: string, position: ReadPosition, mode: Mode, withOrigins = false) {
        const stamp = this.#stampOf(world);
        // 读取位置的线（worldlines 输出 12）：经那条线的读取视图读，来历里带过去的那一步才换成 carried。
        if (world.lineAt(position, mode) === undefined) return "line-not-found" as const;
        const lineRead = this.#readViewOf(world, world.positionLine(position, mode));
        const view = lineRead.entry(id, position, mode);
        if (view === "chapter-not-found" || view === null || !withOrigins) return view === "chapter-not-found" ? view : {...stamp, view};
        const origins: Record<string, unknown> = {};
        for (const [namespace, data] of Object.entries(view.namespaces)) {
            for (const field of Object.keys(data.fields)) origins[`${namespace}.${field}`] = lineRead.origins({entry: id, path: `${namespace}.${field}`}, position, mode);
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

    /**
     * 待处理、提示或已处理的一页（方法表 `pending`，model.md 输出 16、34、35）：内核自己的与插件诊断的按同一个全序排。
     * 每页都带完整与否、没算出与被截断的诊断、因插件停用而未计算的诊断、各组的总数，以及待定的决策与未处理的正文建议各有几条。
     */
    pending(query: {readonly position?: ReadPosition; readonly mode?: Mode; readonly group?: PendingGroupName} = {}, cursor?: string, limit = 50): PendingPage | "chapter-not-found" | "line-not-found" | "cursor-stale" {
        const world = this.#world;
        const position = query.position ?? defaultPosition(world.options.order);
        const mode = query.mode ?? "actual";
        const group = query.group ?? "pending";
        const groups = this.#groups(world, position, mode);
        if (typeof groups === "string") return groups;
        const stamp = this.#stamp();
        const page = this.#page(stamp, groups[group], cursor, limit, {method: "pending", position, mode, group});
        if (page === "cursor-stale") return page;
        return {
            ...stamp,
            group,
            items: page.items,
            complete: groups.unavailable.length === 0 && groups.truncated.length === 0,
            unavailable: groups.unavailable,
            truncated: groups.truncated,
            disabled: groups.disabled,
            counts: {pending: groups.pending.length, hints: groups.hints.length, handled: groups.handled.length},
            decisionsPending: [...world.data.decisions.values()].filter((decision) => decision.status === "pending").length,
            suggestionsOpen: [...world.data.suggestions.values()].filter((suggestion) => suggestion.status === "open").length,
            ...(page.next === undefined ? {} : {cursor: page.next}),
        };
    }

    /** 三组的计算：内核的待处理与提示，再调每个登记了的诊断（输出 34 的处理顺序见 diagnostics.ts）。按读取输入缓存。 */
    #groups(world: World, position: ReadPosition, mode: Mode): PendingGroups | "chapter-not-found" | "line-not-found" {
        const key = `${this.#stamp().inputDigest}|${mode}|${stableStringify(position)}`;
        const cached = this.#groupsCache.get(key);
        if (cached !== undefined) return cached;
        const canon = world.pending(position, mode);
        if (typeof canon === "string") return canon;
        const order = world.options.order;
        const pending: Sortable[] = canon.map((item) => sortableCanonItem(world, item));
        const hints: Sortable[] = canonHints(world, this.#locator);
        const handled: Sortable[] = [];
        const unavailable: {diagnostic: string; reason: string}[] = [];
        const truncated: string[] = [];
        const registry = world.options.diagnostics ?? EMPTY_DIAGNOSTIC_REGISTRY;
        // 插件诊断按读取位置的线的视图算（DS：与内核的待处理同一条线）；线在上面已查过存在。
        const view = this.#readViewOf(world, world.positionLine(position, mode));
        let tellings: Map<string, Telling> | undefined;
        const findingPosition = (finding: Finding): {position: SortPosition; occurrence?: Occurrence} => {
            if (finding.at === undefined) return {position: null};
            if (finding.at.kind === "placement") return {position: placementPosition(order, finding.at.placement)};
            tellings ??= tellingsById(world);
            const telling = tellings.get(finding.at.telling);
            const located = telling === undefined ? undefined : this.#locator.locate(telling);
            return located?.kind === "found" ? {position: occurrencePosition(order, located.occurrence), occurrence: located.occurrence} : {position: null};
        };
        for (const [id] of registry.versions) {
            const declaration = registry.byId(id)!;
            const compute = this.#computers.get(declaration.plugin)?.compute[id];
            if (compute === undefined) {
                unavailable.push({diagnostic: id, reason: "not-registered"});
                continue;
            }
            let returned: readonly Finding[];
            const begin = performance.now();
            try {
                returned = compute(view, position, mode);
            } catch (error) {
                // 一个诊断抛错不影响别的：这次没有它的结果，读取照常返回并标不完整（model.md 输出 34）。
                unavailable.push({diagnostic: id, reason: `threw: ${error instanceof Error ? error.message : String(error)}`});
                continue;
            } finally {
                this.#recordTiming(id, performance.now() - begin);
            }
            const processed = processFindings(declaration, returned, world.data.decisions.values());
            for (const note of processed.notes) {
                if (note.code === "diagnostic-unavailable") unavailable.push({diagnostic: id, reason: note.reason});
                if (note.code === "diagnostic-truncated") truncated.push(id);
                if (note.code === "diagnostic-duplicate-key") hints.push({position: null, kindOrder: HINT_GROUP_ORDER.finding, sortId: `${id}\u0000${note.key}`, item: {kind: "hint", hint: {code: "diagnostic-duplicate-key", diagnostic: id, key: note.key}}});
            }
            const target = declaration.level === "pending" ? pending : hints;
            const kindOrder = declaration.level === "pending" ? PENDING_GROUP_ORDER.finding : HINT_GROUP_ORDER.finding;
            for (const finding of processed.findings) {
                const {position: at, occurrence} = findingPosition(finding);
                const earlier = processed.earlier.get(canonicalJson(finding.key));
                target.push({position: at, kindOrder, sortId: `${id}\u0000${canonicalJson(finding.key)}`, item: {kind: "finding", diagnostic: id, level: declaration.level, finding, ...(occurrence === undefined ? {} : {occurrence}), ...(earlier === undefined ? {} : {earlierDecision: earlier})}});
            }
            for (const {finding, decision} of processed.handled) {
                const {position: at, occurrence} = findingPosition(finding);
                handled.push({position: at, kindOrder, sortId: `${id}\u0000${canonicalJson(finding.key)}`, item: {kind: "finding", diagnostic: id, level: declaration.level, finding, ...(occurrence === undefined ? {} : {occurrence}), handledBy: decision}});
            }
        }
        // 因插件停用而未计算的：这个实例里登记过、或作者的决策挂着，而现在不在登记里的诊断。
        const known = new Set([...this.#seenDiagnostics.keys()]);
        for (const decision of world.data.decisions.values()) for (const about of decision.about) if (about.kind === "diagnostic") known.add(about.id);
        const disabled = [...known].filter((id) => registry.byId(id) === undefined).sort();
        const groups: PendingGroups = {pending: sortGroup(pending), hints: sortGroup(hints), handled: sortGroup(handled), unavailable, truncated, disabled};
        this.#groupsCache.set(key, groups);
        if (this.#groupsCache.size > GROUPS_CACHE_LIMIT) this.#groupsCache.delete(this.#groupsCache.keys().next().value!);
        return groups;
    }

    #noteDiagnostics(registry: DiagnosticRegistry | undefined): void {
        for (const [id] of registry?.versions ?? []) this.#seenDiagnostics.set(id, registry!.byId(id)!.plugin);
    }

    #recordTiming(diagnostic: string, ms: number): void {
        this.#timings.push({diagnostic, ms});
        if (this.#timings.length > TIMINGS_KEPT) this.#timings.shift();
    }

    /* ---------- 时间（canon.time） ---------- */

    /** 时间的查询（canon.time 输出 8）：在当前世界的时间状态上回答；一段时间里的事分页。 */
    time(query: TimeQuery, mode: Mode = "actual", cursor?: string, limit = 50, line?: string): (ReadStamp & {readonly answer: TimeAnswer; readonly cursor?: string}) | "cursor-stale" | "line-not-found" {
        const world = this.#world;
        // 线缺省取当前线（最新一章讲的线）；这条线在这个模式下读不到得 `line-not-found`（project.md 方法表 `time`）。
        const on = line ?? world.positionLine(defaultPosition(world.options.order), mode);
        if (world.lineAt({...defaultPosition(world.options.order), line: on}, mode) === undefined) return "line-not-found";
        return this.#pagedTime(this.#stampOf(world), answerTime(world.time(mode, on), world.options.time ?? DEFAULT_TIME, world.data, query), cursor, limit, {method: "time", query, mode, line: on});
    }

    /**
     * 时间回答里的列表（一段时间里的事、浏览的这一级里的事）按 project 输出 18 分页：一定的在前，可能的在后，每项带 `sure`。
     * 带视图令牌时游标的参数另带令牌的上限，换令牌不能接着翻。
     */
    #pagedTime(stamp: ReadStamp, answer: TimeAnswer, cursor: string | undefined, limit: number, params: {readonly method: string} & Readonly<Record<string, unknown>>): (ReadStamp & {readonly answer: TimeAnswer; readonly cursor?: string}) | "cursor-stale" {
        if (!("kind" in answer) || (answer.kind !== "during" && answer.kind !== "browse")) return {...stamp, answer};
        const {sure, maybe, ...rest} = answer as {readonly sure: readonly string[]; readonly maybe: readonly string[]} & Readonly<Record<string, unknown>>;
        const listed = [...sure.map((change) => ({change, sure: true})), ...maybe.map((change) => ({change, sure: false}))];
        const page = this.#page(stamp, listed, cursor, limit, params);
        if (page === "cursor-stale") return page;
        return {...stamp, answer: {...rest, items: page.items}, ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /**
     * 带视图令牌时的时间状态（canon.time 输出 15）：网络只用安放在上限之前的事，否则上限之后的说法会收窄可见的事的范围。按世界、模式与
     * 上限缓存最多 8 份，不同令牌同一上限共用。
     */
    #boundedTime(world: World, grant: ViewGrant, mode: Mode): TimeState {
        let byWorld = this.#boundedStates.get(world);
        if (byWorld === undefined) {
            byWorld = new Map();
            this.#boundedStates.set(world, byWorld);
        }
        const key = `${mode}|${grant.line}|${stableStringify(grant.until)}`;
        let state = byWorld.get(key);
        if (state === undefined) {
            const order = world.options.order;
            const lineView = world.line(grant.line);
            if (lineView === undefined) return timeState(new Map(), {changes: new Map(), entries: world.data.entries, order, createdAt: world.data.createdAt}, world.options.time ?? DEFAULT_TIME, mode, []);
            const {records, engine} = lineView;
            const visible = new Map([...records.changes].filter(([, change]) => placementWithin(order, grant, change.at)));
            const plans = mode === "planned" ? [...visible.values()].filter((change) => change.kind === "plan" && change.status === "active" && engine.progress(change.id, grant.until) === "unfulfilled").map((change) => change.id) : [];
            const settings = world.options.time ?? DEFAULT_TIME;
            // 回溯到的那一刻（输出 6）照样进网络；父线也按同一上限截，上限之后的说法不能收窄切口与触发处的差。
            const rollback = world.rollbackOf(grant.line, (parent) => this.#boundedTime(world, {...grant, line: parent}, mode));
            state = timeState(visible, {changes: visible, entries: world.data.entries, order, createdAt: world.data.createdAt}, settings, mode, plans, rollback);
            byWorld.set(key, state);
            if (byWorld.size > 8) byWorld.delete(byWorld.keys().next().value!);
        }
        return state;
    }

    /* ---------- 项目内的快照 ---------- */

    /**
     * 给项目里别的插件的一份快照：只读视图、带令牌的读取与戳都建在同一份世界与当前的正文快照上。只在拿到它的同步段里有效：
     * 中间 `await` 过、正文或插件数据变了以后再用就抛错（那是调用方的错，用一份过期的快照会让视图过滤跨两份读取输入）。
     * 世界本身不可变，换了版本也不影响已拿到的快照里的世界。
     */
    snapshot(): {readonly view: CanonReadView; readonly viewed: (token: string) => ViewedReads; readonly stamp: ReadStamp} {
        const world = this.#world;
        return {view: this.#readViewOf(world), viewed: (token) => this.#guarded(this.#viewedOn(token, world)), stamp: this.#stampOf(world)};
    }

    /**
     * 一份世界在当前读取输入上的只读视图。世界与输入代次都没变时交出同一个对象（快照与诊断的计算共用）：插件按视图对象缓存
     * 它的索引（例如剧情的知情索引），同一份输入上的几次读取就不用每次重建。输入变了以后旧对象的方法一律抛错，见 `#guarded`。
     */
    /**
     * 一份世界在一条线上的读取视图：世界与读取输入都没变时交出同一个对象（快照与诊断共用），按线各一个。线必须存在且可建
     * （`onLine` 先查）。
     */
    #readViewOf(world: World, line: string = MAIN_LINE): CanonReadView {
        let cached = this.#viewCache;
        if (cached === null || cached.world !== world || cached.generation !== this.#inputGeneration) {
            cached = {world, generation: this.#inputGeneration, views: new Map()};
            this.#viewCache = cached;
        }
        let view = cached.views.get(line);
        if (view === undefined) {
            const onLine: CanonReadView["onLine"] = (other, mode = "actual") => {
                const entry = lineTable(world.data, world.options.order).lines.get(other);
                if (other !== MAIN_LINE && (entry === undefined || !entry.exists[mode])) return {code: "line-not-found"};
                if (entry?.unbuildable !== null && entry !== undefined) return {code: "line-not-found", reason: entry.unbuildable};
                return this.#readViewOf(world, other);
            };
            view = this.#guarded(createReadView(world, this.#locator, this.#stampOf(world), {text: (chapter) => this.#texts.get(chapter)?.text, digest: (chapter) => this.#texts.get(chapter)?.digest ?? null}, line, onLine));
            cached.views.set(line, view);
        }
        return view;
    }

    /**
     * 包一层：输入代次变了以后（正文快照或插件数据换了）调用就抛错，持有旧快照的调用方要重新取。`compareKeys` 只比较传进来的
     * 两个键、不读世界与输入，又是诊断里调用最多的方法（排序与逐个比较），不包。
     */
    #guarded<T extends object>(target: T): T {
        const generation = this.#inputGeneration;
        const check = () => {
            if (this.#inputGeneration !== generation) throw new Error("canon snapshot used after the text snapshot or plugin data changed; take a new snapshot");
        };
        return Object.freeze(Object.fromEntries(Object.entries(target).map(([key, value]) => [key, typeof value === "function" && key !== "compareKeys" ? (...args: unknown[]) => {
            check();
            return (value as (...inner: unknown[]) => unknown)(...args);
        } : value]))) as T;
    }

    /* ---------- 视图（输出 24） ---------- */

    /** 打开一张视图：上限要在章序里；阶段 D 之前只有主线。 */
    openView(grant: ViewGrant): {readonly token: string} | "chapter-not-found" | {readonly code: "line-not-found"} {
        // 线要存在（至少按计划模式）且可建（worldlines 输出 1、18）。
        const entry = lineTable(this.#world.data, this.#world.options.order).lines.get(grant.line);
        if (grant.line !== MAIN_LINE && (entry === undefined || !entry.exists.planned || entry.unbuildable !== null)) return {code: "line-not-found"};
        if (boundRank(this.#world.options.order, grant) === null) return "chapter-not-found";
        // 令牌不可预测：拿着它的读取在服务里只按令牌认，可猜的连续编号会让别的调用方冒用（远程门面另外只认调用方自己开的）。
        const token = `view-${globalThis.crypto.randomUUID()}`;
        this.#views.set(token, {...grant});
        return {token};
    }

    closeView(token: string): void {
        this.#views.delete(token);
    }

    /**
     * 视图的审计，按发生的先后（最近 500 条）：被拒的读取，与插件经 `auditView` 记下的占位。可以按看的人筛。游标是条目的
     * 序号（审计不是读取输入的一部分，不随世界版本作废）；被挤出 500 条的部分就读不到了。
     */
    viewAudit(filter: {readonly viewer?: string | null} = {}, cursor?: string, limit = 50) {
        const after = cursor === undefined ? 0 : Number(cursor);
        if (!Number.isInteger(after) || after < 0) return "cursor-stale" as const;
        const matching = this.#viewAudit.entries.filter((entry) => entry.seq > after && (filter.viewer === undefined || entry.viewer === filter.viewer));
        const items = matching.slice(0, limit);
        return {...this.#stamp(), items, ...(matching.length > limit ? {cursor: String(items.at(-1)!.seq)} : {})};
    }

    /** 插件在一张视图之上又挡掉了什么（例如剧情插件把知识点换成占位）：记进同一份审计（project.md 输出 24）。 */
    /**
     * 建在视图之上的一层（剧情插件的视角句柄）拒了一次读取，而它手里已经没有令牌（句柄关了、从没有过）：照样记一条拒绝，
     * 看的人与用途由调用方给（不知道时为 null 与空串）。
     */
    denyView(who: Pick<ViewGrant, "viewer" | "purpose">, method: string): void {
        this.#deny(who, method);
    }

    auditView(token: string, entry: {readonly method: string; readonly kind: "denied" | "placeholder"; readonly blocked?: readonly ObjectRef[]; readonly position?: unknown}): void {
        const grant = this.#views.get(token);
        this.#viewAudit.record({time: this.#ports.now(), viewer: grant?.viewer ?? null, purpose: grant?.purpose ?? "", ...entry});
    }

    /**
     * 带视图令牌的读取（输出 24 的方法表）：`entry`、`render`、`lookup` 的读取位置不写时是上限，写了晚于上限的拒；
     * `presence`、`changes`、`tellings` 只返回安放（讲述位置）不晚于上限的，范围晚于上限的拒。表里没有的方法带令牌
     * 一律拒（`deny`）。令牌失效以后每次调用都拒。每次被拒记一条审计。
     */
    viewed(token: string): ViewedReads {
        return this.#viewedOn(token, this.#world);
    }

    #viewedOn(token: string, world: World): ViewedReads {
        const grant = (method: string, position?: unknown): ViewGrant | "view-denied" => {
            const found = this.#views.get(token);
            // 令牌失效（closeView、调用方断开）或从没发过：照样记一条，看的人与用途不知道。
            if (found === undefined) return this.#deny({viewer: null, purpose: ""}, method, position);
            return found;
        };
        const order = () => world.options.order;
        const within = (method: string, position: ReadPosition | undefined): {grant: ViewGrant; position: ReadPosition} | "view-denied" => {
            const found = grant(method, position);
            if (found === "view-denied") return found;
            if (position !== undefined && !positionWithin(order(), found, position)) return this.#deny(found, method, position);
            // 令牌只读它那条线（project 输出 24）：位置写了别的线拒，没写补上令牌的线。
            if (position?.line !== undefined && position.line !== found.line) return this.#deny(found, method, position);
            return {grant: found, position: {...(position ?? found.until), line: found.line}};
        };
        const chapters = (method: string, ...ids: (string | undefined)[]): ViewGrant | "view-denied" => {
            const found = grant(method, ids);
            if (found === "view-denied") return found;
            for (const id of ids) if (id !== undefined && !chapterWithin(order(), found, id)) return this.#deny(found, method, id);
            return found;
        };
        return {
            // 条目与渲染不给“之后才启用的命名空间”（`upcoming`）：那是上限之后的事。
            entry: (id, position, mode = "actual") => {
                const ok = within("entry", position);
                if (ok === "view-denied") return ok;
                const read = this.#entryOn(world, id, ok.position, mode);
                return typeof read === "string" || read.view === null ? read : {...read, view: {...read.view, upcoming: []}};
            },
            render: (entry, position, mode, audience) => {
                const ok = within("render", position);
                return ok === "view-denied" ? ok : this.#renderOn(world, entry, ok.position, mode, audience, {hideUpcoming: true});
            },
            lookup: (names, position) => {
                const ok = within("lookup", position);
                return ok === "view-denied" ? ok : this.#lookupOn(world, names, ok.position);
            },
            presence: (person, filter = {}, cursor, limit = 50) => {
                const found = chapters("presence", filter.from, filter.to);
                if (found === "view-denied") return found;
                // 按计划模式计入的计划按这次读到的位置算：给了更早的 `to` 就是那一章的末尾，否则是上限（上限是章首时，这一章里
                // 已写的兑现还没发生）。上限只截、不替换调用方给的更早的范围。
                const toEnd = filter.to === undefined ? undefined : ({kind: "chapter", chapter: filter.to, edge: "end"} as const);
                const upTo = toEnd !== undefined && positionWithin(order(), found, toEnd) ? toEnd : found.until;
                // 令牌只读它那条线：筛选里写了别的线拒，没写补上令牌的线。
                if (filter.line !== undefined && filter.line !== found.line) return this.#deny(found, "presence", filter);
                const listed = listPresence(world, person, {...filter, ...(filter.to === undefined && found.until.kind === "chapter" ? {to: found.until.chapter} : {})}, upTo, found.line);
                if (typeof listed === "string") return listed;
                const stamp = this.#stampOf(world);
                const page = this.#page(stamp, listed.changes.filter((change) => placementWithin(order(), found, change.at)), cursor, limit, {method: "presence", view: token, person, ...filter});
                if (page === "cursor-stale") return page;
                return {...stamp, items: page.items.map((change) => ({change})), uncast: listed.uncast, ...(page.next === undefined ? {} : {cursor: page.next})};
            },
            changes: (filter = {}, cursor, limit = 50) => {
                const found = chapters("changes", filter.chapter);
                if (found === "view-denied") return found;
                // 带令牌时 `worldline` 是令牌的线、只列它视图里的；要别的线的拒。
                if ((filter.worldline !== undefined && filter.worldline !== found.line) || (filter.inView !== undefined && filter.inView !== found.line)) return this.#deny(found, "changes", filter);
                const stamp = this.#stampOf(world);
                const scoped = {...filter, worldline: found.line, inView: found.line};
                // 计划的进展按上限算，不按全书：上限之后才兑现的计划在视图里是未兑现。
                const page = this.#page(stamp, listChanges(world, scoped, found.until).filter((change) => placementWithin(order(), found, change.at)), cursor, limit, {method: "changes", view: token, ...scoped});
                if (page === "cursor-stale") return page;
                return {...stamp, items: page.items.map((change) => changeItem(world, change, found.line)), ...(page.next === undefined ? {} : {cursor: page.next})};
            },
            time: (query, mode = "actual", cursor, limit = 50) => {
                const found = grant("time", query);
                if (found === "view-denied") return found;
                // 点名的事、章晚于上限：拒（上限之后的事在这张视图里不存在）。
                const named = query.kind === "event" ? [query.change] : query.kind === "between" ? [query.a, query.b] : query.kind === "age" ? [query.at] : [];
                for (const id of named) {
                    const at = world.data.changes.get(id)?.at;
                    if (at !== undefined && !placementWithin(order(), found, at)) return this.#deny(found, "time", query);
                }
                if (query.kind === "chapter" && !chapterWithin(order(), found, query.chapter)) return this.#deny(found, "time", query);
                const state = this.#boundedTime(world, found, mode);
                return this.#pagedTime(this.#stampOf(world), answerTime(state, world.options.time ?? DEFAULT_TIME, world.data, query), cursor, limit, {method: "time", query, mode, until: found.until, line: found.line});
            },
            tellings: (filter = {}, cursor, limit = 50) => {
                const found = chapters("tellings", filter.from, filter.to, filter.until?.chapter);
                if (found === "view-denied") return found;
                if (filter.until !== undefined && !tellingPositionWithin(order(), found, filter.until)) return this.#deny(found, "tellings", filter.until);
                const stamp = this.#stampOf(world);
                const page = this.#page(stamp, listTellings(world, this.#locator, filter).filter((item) => tellingWithin(order(), found, item) && tellingInLine(world, found.line, item)), cursor, limit, {method: "tellings", view: token, ...filter});
                if (page === "cursor-stale") return page;
                return {...stamp, items: page.items, ...(page.next === undefined ? {} : {cursor: page.next})};
            },
            deny: (method) => {
                const found = grant(method);
                return found === "view-denied" ? found : this.#deny(found, method);
            },
        };
    }

    #deny(grant: Pick<ViewGrant, "viewer" | "purpose">, method: string, position?: unknown): "view-denied" {
        this.#viewAudit.record({time: this.#ports.now(), viewer: grant.viewer, purpose: grant.purpose, method, kind: "denied", ...(position === undefined ? {} : {position})});
        return "view-denied";
    }

    /* ---------- 插件诊断的项目内接口（model.md “诊断的计算”） ---------- */

    /**
     * 插件的项目入口启动后登记它声明的诊断的计算与数据版本；返回的函数在入口停止时调用，登记随之失效。同一插件再登记
     * 一次就替换上一次的。登记与数据版本都是读取输入的一部分，变了以后旧游标得到 `cursor-stale`。
     */
    registerDiagnostics(plugin: string, registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}): () => void {
        // 按这次登记的令牌认：报告数据版本会换掉记录，后来的再登记会替换它，旧的停止函数都不该删掉别人的登记。
        const token = {};
        this.#computers.set(plugin, {token, compute: registration.compute, dataVersion: registration.dataVersion});
        this.#inputGeneration += 1;
        return () => {
            if (this.#computers.get(plugin)?.token !== token) return;
            this.#computers.delete(plugin);
            this.#inputGeneration += 1;
        };
    }

    /** 插件的数据变了（例如剧情插件存下了新的窄问题答案）：之后的读取按新数据算。没登记过的插件不起作用。 */
    reportDataVersion(plugin: string, dataVersion: string): void {
        const current = this.#computers.get(plugin);
        if (current === undefined || current.dataVersion === dataVersion) return;
        this.#computers.set(plugin, {...current, dataVersion});
        this.#inputGeneration += 1;
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
        return this.#lookupOn(this.#world, names, position);
    }

    #lookupOn(world: World, names: readonly string[], position: ReadPosition) {
        const found: Record<string, string[]> = {};
        for (const name of names) found[name] = [];
        // 按读取位置的线（输出 12）：线读不到得 `line-not-found`。
        const engine = world.lineAt(position)?.engine;
        if (engine === undefined) return "line-not-found" as const;
        for (const entry of world.data.entries.values()) {
            if (entry.deleted === true) continue;
            const view = engine.entry(entry.id, position, "actual");
            if (view === "chapter-not-found") return view;
            if (view === null || view.deleted || !view.appeared) continue;
            for (const name of names) if (view.name === name || view.aliases.includes(name)) found[name]!.push(entry.id);
        }
        return {...this.#stampOf(world), found};
    }

    /** 剧情变更（方法表 `changes`，筛选与先后见 reads.ts）；每条带这次套没套上。 */
    changes(filter: ChangeFilter = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        // 套没套上与计划进展按 `worldline` 算，缺省当前线（活页夹最新一章末尾讲的线）。线不存在得 `line-not-found`。
        const worldline = filter.worldline ?? world.positionLine(defaultPosition(world.options.order));
        for (const line of [worldline, filter.inView]) if (line !== undefined && world.line(line) === undefined) return "line-not-found" as const;
        const stamp = this.#stamp();
        const page = this.#page(stamp, listChanges(world, {...filter, worldline}), cursor, limit, {method: "changes", ...filter, worldline});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items.map((change) => changeItem(world, change, worldline)), ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /** 讲述（方法表 `tellings`，model.md 输出 24 到 27；筛选与先后见 reads.ts）。 */
    tellings(filter: TellingFilter = {}, cursor?: string, limit = 50) {
        const stamp = this.#stamp();
        const page = this.#page(stamp, listTellings(this.#world, this.#locator, filter), cursor, limit, {method: "tellings", ...filter});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items, ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /** 某人在场的剧情变更（方法表 `presence`，model.md 输出 29；取法见 reads.ts），另给没记参与者的条数。 */
    presence(person: string, filter: PresenceFilter = {}, cursor?: string, limit = 50) {
        const found = listPresence(this.#world, person, filter, undefined, filter.line ?? this.#world.positionLine(defaultPosition(this.#world.options.order)));
        if (typeof found === "string") return found;
        const stamp = this.#stamp();
        const page = this.#page(stamp, found.changes, cursor, limit, {method: "presence", person, ...filter});
        if (page === "cursor-stale") return page;
        return {...stamp, items: page.items.map((change) => ({change})), uncast: found.uncast, ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    /**
     * 决策（方法表 `decisions`），按 id：状态与挂的对象筛选。每条带读取时的说明（model.md 输出 31 到 33）：建议标
     * “作者未确认”，已定而没给理由的写“作者没说理由”，不在已定状态时存着的结论等列在“重新打开前定下的”下面，
     * 挂的条目删了显示“已删除的条目”。
     */
    decisions(filter: DecisionFilter = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        const stamp = this.#stamp();
        const page = this.#page(stamp, listDecisions(world, filter), cursor, limit, {method: "decisions", ...filter});
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
        return this.#renderOn(this.#world, entry, position, mode, audience);
    }

    #renderOn(world: World, entry: string, position: ReadPosition, mode: Mode, audience: "author" | "agent", options: RenderOptions = {}) {
        const result = audience === "author" ? renderEntryForAuthor(world, entry, position, mode, options) : renderEntryForAgent(world, entry, position, mode, options);
        return result === null || typeof result === "string" ? result : {...result, ...this.#stampOf(world)};
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
        const revision = this.#world.requested(requestId);
        if (revision !== undefined) return {published: true, revision: revision.id, version: revision.version};
        // 只读时日志可能没读全（坏行、外部改动）：内存里没有这个请求不等于没发布。
        return this.#state === "read-only" ? {code: "write-unknown"} : {published: false};
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
                const started = performance.now();
                const result = compute(this.#world);
                if (!result.ok || (result as {repeated?: boolean}).repeated === true) return result;
                const published = result as unknown as Extract<WriteResult, {ok: true}>;
                const work = {recomputed: recomputedOn(published.world), ms: performance.now() - started};
                const appended = await appendRevision(this.#ports.files, this.#ports.logDir, this.#tail, published.revision, this.#ports.lock);
                if ("tail" in appended) {
                    this.#world = published.world;
                    this.#tail = appended.tail;
                    this.#work.publish = work;
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
        // 整批换上再发事件（输出 17）：监听者在第一条 `changed` 里读到的也是读全了的世界，不是读了一半的中间版本（输出 5）。
        this.#world = caught.revisions.reduce((world, revision) => world.absorb(revision), this.#world);
        this.#tail = caught.tail;
        for (const revision of caught.revisions) this.#emit({kind: "changed", version: revision.version, revision: revision.id, by: revision.by, what: revision.what, title: revision.title});
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
        this.#inputGeneration += 1;
        this.#emit({kind: "textChanged", chapter: chapter ?? null});
    }

    /** 宿主给出新章序（输出 9）：与记下的不同就发布章序调整；`invalid` 时保持原章序并写诊断（输出 23）。 */
    async setChapters(chapters: readonly string[] | "invalid", chapterLines?: ReadonlyMap<string, readonly ChapterLine[]>): Promise<void> {
        if (chapters === "invalid") {
            this.diagnostics.push({code: "binder-invalid"});
            return;
        }
        this.#syncTexts(chapters);
        const order = new ChapterOrder(chapters);
        await this.#write(undefined, (world) => {
            const moved = world.withOptions({...world.options, order, chapterLines: chapterLines ?? new Map()});
            const result = moved.reorder(order, this.#ports.now(), `reorder-${this.#ports.digest(stableStringify({chapters, version: world.version}))}`);
            return result ?? {ok: true as const, world: moved, revision: undefined as never, ids: {}, repeated: true};
        }, true).then((result) => {
            // 没有要发布的章序调整，或世界只读时：只换上新章序计算。
            if ((result as {repeated?: boolean}).repeated === true || !result.ok) this.#world = this.#world.withOptions({...this.#world.options, order, chapterLines: chapterLines ?? new Map()});
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
    /**
     * 作品设置里的历法与模糊词表变了（canon.time 输出 4、13、16）：历法合法就用它并记成“最近一次合法的”；不合法就用最近一次合法的，
     * 从来没有合法的用内置公历，诊断写明用的是哪一份。词表不合法的项作废。诊断每次整份重算，设置修好以后消失。范围、打架与依据都按
     * 新的重算（换一份世界，读取输入的摘要随之变）。`previous` 是宿主存下的最近一次合法的历法（输出 16 的持久化由宿主做）。
     */
    setTime(raw: {readonly calendar?: unknown; readonly fuzzy?: unknown; readonly previous?: Calendar}): Promise<{readonly calendar: Calendar; readonly valid: boolean}> {
        const run = () => {
            const checked = raw.calendar === undefined ? null : validateCalendar(raw.calendar);
            const diagnostics: ServiceDiagnostic[] = [];
            let calendar: Calendar;
            if (checked === null) {
                // 设置里没有历法：用内置公历（设置说明写“不填时用公历”）。“最近一次合法的”只给写了却不合法的时候用，清空以后从头算。
                this.#lastValidCalendar = null;
                calendar = GREGORIAN;
            } else if (checked.ok) {
                calendar = checked.calendar;
                this.#lastValidCalendar = calendar;
            } else {
                if (raw.previous !== undefined && this.#lastValidCalendar === null && validateCalendar(raw.previous).ok) this.#lastValidCalendar = raw.previous;
                calendar = this.#lastValidCalendar ?? GREGORIAN;
                diagnostics.push({code: "calendar-invalid", problems: checked.problems, using: this.#lastValidCalendar === null ? "builtin" : "previous"});
            }
            const fuzzy = resolveFuzzy(raw.fuzzy, calendar);
            if (fuzzy.problems.length > 0) diagnostics.push({code: "fuzzy-word-invalid", problems: fuzzy.problems});
            this.#timeDiagnostics = diagnostics;
            this.#world = this.#world.withOptions({...this.#world.options, time: {calendar, fuzzy: fuzzy.table}});
            return {calendar, valid: checked === null || checked.ok};
        };
        const next = this.#queue.then(run, run);
        this.#queue = next.then(() => undefined, () => undefined);
        return next;
    }

    setRegistries(registries: {readonly registry?: ComponentRegistry; readonly marks?: MarkRegistry; readonly diagnostics?: DiagnosticRegistry}): Promise<void> {
        const run = () => {
            this.#noteDiagnostics(registries.diagnostics);
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
        for (const entry of entries) world.line().engine.entry(entry, {kind: "chapter", chapter: last, edge: "end"}, "actual");
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
        if (changed) this.#inputGeneration += 1;
    }

    /**
     * 这次读取的戳。世界（版本、章序、登记都在它的 options 里）与正文快照都没变时用上一次算好的：全书的正文快照摘要
     * 要拼一千多章的摘要，每次读取都算不划算。
     */
    #stamp(): ReadStamp {
        return this.#stampOf(this.#world);
    }

    /** 一份世界在当前正文快照与插件数据版本上的戳；按世界与输入代次缓存（全书的正文快照摘要要拼一千多章的摘要）。 */
    #stampOf(world: World): ReadStamp {
        const cached = this.#stampCache;
        if (cached !== null && cached.world === world && cached.generation === this.#inputGeneration) return cached.stamp;
        const stamp = readStampOf(world, (chapter) => this.#texts.get(chapter)?.digest ?? null, [...this.#computers.entries()].map(([plugin, registration]) => [plugin, registration.dataVersion] as const));
        this.#stampCache = {world, generation: this.#inputGeneration, stamp};
        return stamp;
    }

    /* ---------- 游标（输出 19） ---------- */

    /**
     * 游标是“读取输入的摘要:读取参数的摘要:偏移”（输出 19）：读取输入的任何一项变了，或者拿着游标换了方法、换了筛选，
     * 都得到 `cursor-stale`。`params` 是方法名与影响结果的参数（条数不算：换条数接着翻不会漏项）。
     */
    #page<T>(stamp: ReadStamp, items: readonly T[], cursor: string | undefined, limit: number, params: {readonly method: string} & Readonly<Record<string, unknown>>): {readonly items: readonly T[]; readonly next?: string} | "cursor-stale" {
        return pageOf(stamp, items, cursor, limit, params, this.#ports.digest);
    }
}
