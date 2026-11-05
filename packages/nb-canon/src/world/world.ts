/**
 * 内存里的世界：重放修订、发布写入请求（docs/specs/canon/revisions.md），纯计算、不碰文件。
 *
 * 一次发布：校验请求的形状 → 查请求 id → 临时 id 换成正式 id → 按对象判冲突 → 套上新值、算出只存变了的叶子 →
 * 用增量引擎在新世界上算 → 逐项校验 → 算“带来的变化” → 得到修订与新的世界。中途任何一步不过就整次拒收，
 * 本世界不变（输出 1）。写盘由 service 做：它先把修订追加进日志，落盘后才换上新世界（project.md 输出 6）。
 *
 * World 是不可变的：发布返回新的 World，旧的照常可读，所以读取总是看到某一个版本。
 */

import {effectiveFields, fieldsProblem, type ComponentRegistry} from "../components/registry";
import {valueProblem} from "../components/values";
import {addressKey, parsePath} from "../core/address";
import {RESERVED_ROOTS} from "../core/identifiers";
import {idListsOf} from "../core/id-lists";
import {compareIds, ID_PREFIX, IdAllocator} from "../core/ids";
import {readNumbers} from "../core/numerals";
import {applyChanges, diffValues, parseSegments, type FieldChange} from "../core/paths";
import {chapterEnd, defaultPosition, type ChapterOrder} from "../core/position";
import {
    OBJECT_SCHEMAS,
    schemaProblems,
    WriteRequestSchema,
    type Address,
    type Check,
    type Entry,
    type ObjectKind,
    type ObjectRef,
    type Op,
    type Patch,
    type ReadPosition,
    type Revision,
    type StoryChange,
    type Telling,
    type WriteRequest,
} from "../core/schema";
import {sameJson, stableStringify} from "../core/stable-json";
import {createIncrementalEngine, type ChangedRefs, type IncrementalEngine} from "../engine/incremental";
import type {EngineInputs, PendingItem, ReductionLookup, WorldData} from "../engine/types";
import {readEntryAddress} from "../engine/views";
import {blockProblem} from "../render/syntax";
import {newReferences, referenceProblem, referencesOf, replaceTempIds, type ReferenceContext} from "./references";
import {countOccurrences} from "./tellings";

/** 宿主提供的、计算要用的东西（project.md 输入与前置条件）。 */
export interface WorldOptions {
    readonly order: ChapterOrder;
    readonly registry: ComponentRegistry;
    readonly reductions: ReductionLookup;
    /** 按章 id 取当前正文；没有这一章返回 undefined。 */
    readonly chapterText: (chapter: string) => string | undefined;
    /** 字符串的 SHA-256（请求摘要用）。 */
    readonly digest: (text: string) => string;
}

export interface Problem {
    readonly code: string;
    readonly ref?: ObjectRef;
    readonly path?: string;
    readonly message: string;
    /** 有细分原因的码带它（`ref-invalid` 的 `entry-missing`、`ref-type-mismatch`……，components.md 输出 18）。 */
    readonly reason?: string;
}

export interface ConflictDetail {
    readonly ref: ObjectRef;
    readonly changed: boolean;
    readonly current: unknown;
}

export type WriteFailure =
    | {readonly code: "validation-failed"; readonly problems: readonly Problem[]}
    | {readonly code: "version-conflict"; readonly objects: readonly ConflictDetail[]}
    | {readonly code: "request-id-reused"}
    | {readonly code: "not-deletable"; readonly ref: ObjectRef};

export type WriteResult =
    | {readonly ok: true; readonly world: World; readonly revision: Revision; readonly ids: Readonly<Record<string, string>>; readonly repeated: boolean}
    | {readonly ok: false; readonly failure: WriteFailure};

const TEMP = "tmp:";
const KIND_OF_PREFIX: Readonly<Record<ObjectKind, string>> = {entry: ID_PREFIX.entry, change: ID_PREFIX.change, check: ID_PREFIX.check, decision: ID_PREFIX.decision, suggestion: ID_PREFIX.suggestion};
const TABLE = {entry: "entries", change: "changes", check: "checks", decision: "decisions", suggestion: "suggestions"} as const;

interface Indexes {
    readonly requests: ReadonlyMap<string, {readonly revision: Revision}>;
    /** 每个对象最后被哪个版本改过（按对象判冲突，输出 7）。 */
    readonly touched: ReadonlyMap<string, number>;
    /** 一条变更最近一次被哪次修订弄得套不上（待处理的根因，model.md 输出 22）。 */
    readonly brokenBy: ReadonlyMap<string, string>;
    readonly allocator: IdAllocator;
    readonly recordedChapters: readonly string[] | null;
}

type Tables = {
    entries: Map<string, Entry>;
    changes: Map<string, StoryChange>;
    checks: Map<string, Check>;
    decisions: Map<string, WorldData["decisions"] extends ReadonlyMap<string, infer V> ? V : never>;
    suggestions: Map<string, WorldData["suggestions"] extends ReadonlyMap<string, infer V> ? V : never>;
};

const refKey = (ref: ObjectRef) => `${ref.kind}:${ref.id}`;

export class World {
    private constructor(
        readonly data: WorldData,
        readonly engine: IncrementalEngine,
        readonly revisions: readonly Revision[],
        private readonly index: Indexes,
        readonly options: WorldOptions,
    ) {}

    /** 空世界。 */
    static empty(options: WorldOptions): World {
        return World.replay([], options);
    }

    /** 重放日志里的修订（已由存储层校验过形状与版本连续）。不做写入时的校验：日志里的就是事实。 */
    static replay(revisions: readonly Revision[], options: WorldOptions): World {
        const tables: Tables = {entries: new Map(), changes: new Map(), checks: new Map(), decisions: new Map(), suggestions: new Map()};
        const createdAt = new Map<string, number>();
        const requests = new Map<string, {revision: Revision}>();
        const touched = new Map<string, number>();
        const brokenBy = new Map<string, string>();
        const allocator = new IdAllocator();
        let recordedChapters: readonly string[] | null = null;
        for (const revision of revisions) {
            allocator.observe(revision.id);
            requests.set(revision.requestId, {revision});
            for (const op of revision.ops) {
                if (op.kind === "chapters") {
                    recordedChapters = op.after;
                    continue;
                }
                observeIds(allocator, op);
                touched.set(refKey(op.ref), revision.version);
                applyOp(tables, op, createdAt, revision.version);
            }
            for (const change of revision.impact.broken) brokenBy.set(change, revision.id);
        }
        const version = revisions.at(-1)?.version ?? 0;
        const data = freeze(tables, createdAt, version);
        const engine = createIncrementalEngine(engineInputs(data, options));
        return new World(data, engine, [...revisions], {requests, touched, brokenBy, allocator, recordedChapters}, options);
    }

    get version(): number {
        return this.data.version;
    }

    /** 最近一次章序调整修订记下的章序；从没记过为 null。 */
    get recordedChapters(): readonly string[] | null {
        return this.index.recordedChapters;
    }

    /** 宿主的输入变了（章序、登记的类型、归纳缓存、正文）：换上新输入重算，版本不变。 */
    withOptions(options: WorldOptions): World {
        const structural = !sameJson(options.order.ids, this.options.order.ids) || options.registry.digest !== this.options.registry.digest || options.reductions !== this.options.reductions;
        const engine = structural ? this.engine.update(engineInputs(this.data, options), {structural: true}) : this.engine;
        return new World(this.data, engine, this.revisions, this.index, options);
    }

    /** 待处理，套不上的按根因合并（model.md 输出 16、22）。 */
    pending(position: ReadPosition): readonly PendingItem[] | "chapter-not-found" {
        const items = this.engine.pending(position);
        if (items === "chapter-not-found") return items;
        const grouped: PendingItem[] = [];
        const groups = new Map<string, {root: string; changes: string[]}>();
        for (const item of items) {
            if (item.kind !== "cannot-apply") {
                grouped.push(item);
                continue;
            }
            const change = item.changes[0]!;
            const root = this.index.brokenBy.get(change) ?? change;
            const group = groups.get(root);
            if (group !== undefined) group.changes.push(change);
            else {
                const created = {root, changes: [change]};
                groups.set(root, created);
                grouped.push({kind: "cannot-apply", root, changes: created.changes});
            }
        }
        return grouped.map((item) => (item.kind === "cannot-apply" ? {...item, changes: [...item.changes].sort(compareIds)} : item));
    }

    /** 预览：做发布的全部计算，不发布（输出 5）。 */
    preview(request: WriteRequest, time: string): WriteResult {
        return this.publish(request, time);
    }

    /** 发布一个写入请求；成功时返回新的世界与修订（本世界不变）。 */
    publish(input: WriteRequest, time: string): WriteResult {
        return this.#publish(input, time, false);
    }

    /**
     * 还原一次修订（revisions.md 输出 11、12）：有依赖时不单独还原，`withDependents` 为真时连同依赖从后往前一起还原，
     * 作为一次补偿修订发布。补偿只恢复被还原的修订改过的东西，不覆盖后面的修改（有依赖的已被拒或一起还原）。
     */
    revert(target: string, withDependents: boolean, meta: {readonly requestId: string; readonly by: WriteRequest["by"]; readonly title?: string}, time: string): WriteResult | {readonly ok: false; readonly failure: RevertFailure} {
        const index = this.revisions.findIndex((revision) => revision.id === target);
        if (index < 0) return {ok: false, failure: {code: "not-found"}};
        const set = this.dependents(target);
        if (set === "not-revertable") return {ok: false, failure: {code: "not-revertable"}};
        const others = set.filter((id) => id !== target);
        if (others.length > 0 && !withDependents) return {ok: false, failure: {code: "has-dependents", dependents: [...others].reverse()}};
        const previous = this.index.requests.get(meta.requestId);
        if (previous !== undefined) return {ok: true, world: this, revision: previous.revision, ids: {}, repeated: true};
        const working = new Map<string, {ref: ObjectRef; value: unknown}>();
        const current = (ref: ObjectRef) => (working.has(refKey(ref)) ? working.get(refKey(ref))!.value : this.object(ref));
        for (const id of [...set].reverse()) {
            const revision = this.revisions.find((candidate) => candidate.id === id)!;
            for (const op of [...revision.ops].reverse()) {
                if (op.kind === "chapters") continue;
                if (op.kind === "create") working.set(refKey(op.ref), {ref: op.ref, value: undefined});
                else if (op.kind === "delete") working.set(refKey(op.ref), {ref: op.ref, value: structuredClone(op.before)});
                else working.set(refKey(op.ref), {ref: op.ref, value: compensate(current(op.ref), op.fields)});
            }
        }
        const puts = [...working.values()].map(({ref, value}) => ({ref, after: value === undefined ? null : value}));
        const request: WriteRequest = {requestId: meta.requestId, by: meta.by, what: "revert", title: meta.title ?? `还原 ${target}`, baseVersion: this.version, puts};
        return this.#publish(request, time, true, {reverts: [...set]});
    }

    /** 还原 `target` 要一起还原的修订（含它自己，按版本从旧到新），或章序调整不能还原（输出 12、13）。 */
    dependents(target: string): string[] | "not-revertable" {
        const start = this.revisions.findIndex((revision) => revision.id === target);
        if (start < 0) return [];
        const root = this.revisions[start]!;
        if (root.ops.some((op) => op.kind === "chapters")) return "not-revertable";
        const set = [root];
        for (const later of this.revisions.slice(start + 1)) {
            if (set.some((earlier) => dependsOn(later, earlier))) {
                if (later.ops.some((op) => op.kind === "chapters")) continue;
                set.push(later);
            }
        }
        return set.map((revision) => revision.id);
    }

    #publish(input: WriteRequest, time: string, compensation: boolean, extra: Pick<Revision, "reverts"> = {}): WriteResult {
        const shape = schemaProblems(WriteRequestSchema, input);
        if (shape !== null) return invalid(shape.map((problem) => ({code: "type-mismatch", path: problem.path, message: problem.message})));
        const {baseVersion: _baseVersion, ...meaning} = input;
        const requestDigest = this.options.digest(stableStringify(meaning));
        const previous = this.index.requests.get(input.requestId);
        if (previous !== undefined) {
            if (previous.revision.requestDigest !== requestDigest) return {ok: false, failure: {code: "request-id-reused"}};
            return {ok: true, world: this, revision: previous.revision, ids: previous.revision.idMap ?? {}, repeated: true};
        }

        // 临时 id 换成正式 id；同一个请求里引用临时 id 的地方一起换。
        const allocator = cloneAllocator(this.index.allocator, []);
        const ids: Record<string, string> = {};
        for (const put of input.puts) {
            if (put.ref.id.startsWith(TEMP) && ids[put.ref.id] === undefined) ids[put.ref.id] = allocator.next(KIND_OF_PREFIX[put.ref.kind]);
        }
        const request = replaceTempIds(input, ids);

        const problems: Problem[] = [];
        const conflicts: ConflictDetail[] = [];
        for (const put of request.puts) {
            const existing = this.object(put.ref);
            const isNew = Object.values(ids).includes(put.ref.id);
            // 补偿修订会按原来的 id 建回被还原删掉的对象（id 不复用，所以不会撞）。
            if (!isNew && existing === undefined && !compensation) problems.push({code: "not-found", ref: put.ref, message: "object does not exist; new objects need a tmp: id"});
            if (!compensation && put.after === null && (put.ref.kind === "entry" || put.ref.kind === "change" || put.ref.kind === "decision")) return {ok: false, failure: {code: "not-deletable", ref: put.ref}};
            if (!compensation && put.after !== null) {
                const known = new Set(tellingsOf(put.ref.kind, existing).map((telling) => telling.id));
                for (const telling of tellingsOf(put.ref.kind, put.after)) {
                    const id = (telling as {id?: unknown}).id;
                    if (id !== undefined && !known.has(id as string)) problems.push({code: "invalid-telling", ref: put.ref, message: `telling id "${String(id)}" is not on this object; new tellings must not carry an id`});
                }
            }
            const lastTouched = this.index.touched.get(refKey(put.ref)) ?? 0;
            if (!isNew && lastTouched > request.baseVersion) conflicts.push({ref: put.ref, changed: true, current: structuredClone(existing)});
        }
        if (conflicts.length > 0) {
            for (const put of request.puts) if (!conflicts.some((conflict) => refKey(conflict.ref) === refKey(put.ref))) conflicts.push({ref: put.ref, changed: false, current: structuredClone(this.object(put.ref) ?? null)});
            return {ok: false, failure: {code: "version-conflict", objects: conflicts}};
        }
        if (problems.length > 0) return invalid(problems);

        const version = this.version + 1;
        const tables = thaw(this.data);
        const createdAt = new Map(this.data.createdAt);
        const ops: Op[] = [];
        const changed: {entries: string[]; changes: string[]; checks: string[]} = {entries: [], changes: [], checks: []};
        for (const put of request.puts) {
            const after = put.after === null ? undefined : fillDefaults(put.ref.kind, structuredClone(put.after), request, this.options, allocator);
            if (after !== undefined) {
                const shapeProblems = schemaProblems(OBJECT_SCHEMAS[put.ref.kind], after);
                if (shapeProblems !== null) {
                    problems.push(...shapeProblems.map((problem) => ({code: "type-mismatch", ref: put.ref, path: problem.path, message: problem.message})));
                    continue;
                }
                if ((after as {id?: unknown}).id !== put.ref.id) problems.push({code: "id-taken", ref: put.ref, message: "object id must match its ref"});
            }
            const before = this.object(put.ref);
            const op: Op | null = before === undefined
                ? {ref: put.ref, kind: "create", after}
                : after === undefined
                  ? {ref: put.ref, kind: "delete", before}
                  : diffValues(before, after, idListsOf(put.ref.kind)).length === 0
                    ? null
                    : {ref: put.ref, kind: "modify", fields: diffValues(before, after, idListsOf(put.ref.kind))};
            if (op === null) continue;
            ops.push(op);
            applyOp(tables, op, createdAt, version);
            if (put.ref.kind === "entry") changed.entries.push(put.ref.id);
            if (put.ref.kind === "change") changed.changes.push(put.ref.id);
            if (put.ref.kind === "check") changed.checks.push(put.ref.id);
        }
        if (problems.length > 0) return invalid(problems);

        const data = freeze(tables, createdAt, version);
        const engine = this.engine.update(engineInputs(data, this.options), changed);
        // 补偿修订只恢复旧值：恢复出来的记录套不上时不拒收，进待处理（输出 11）。
        if (!compensation) problems.push(...validate(this, data, engine, request, changed));
        const refs = writtenReferences(this, data, ops);
        if (!compensation) problems.push(...referenceProblems(data, refs));
        if (problems.length > 0) return invalid(problems);

        const where = whereOf(request.chapter, this.options.order);
        const impact = computeImpact(this, data, engine, where, ops);
        const revision: Revision = {
            id: allocator.next(ID_PREFIX.revision),
            version,
            requestId: request.requestId,
            requestDigest,
            time,
            by: request.by,
            what: request.what,
            title: request.title,
            ...(request.why === undefined ? {} : {why: request.why}),
            ...(request.chapter === undefined ? {} : {chapter: request.chapter}),
            baseVersion: request.baseVersion,
            ops,
            ...(request.notes === undefined ? {} : {notes: request.notes}),
            ...extra,
            impact,
            ...(Object.keys(ids).length === 0 ? {} : {idMap: ids}),
            ...(refs.length === 0 ? {} : {refs: refs.map(({ref, reference}) => ({ref, path: reference.path, target: reference.target}))}),
        };
        return {ok: true, world: this.next(data, engine, revision), revision, ids, repeated: false};
    }

    /** 章序调整（model.md 输出 3，revisions.md 输出 13）：宿主给的章序与记下的不同时，返回发布它的写入结果。 */
    reorder(order: ChapterOrder, time: string, requestId: string): WriteResult | null {
        const recorded = this.index.recordedChapters;
        if (recorded !== null && sameJson(recorded, order.ids)) return null;
        if (recorded === null && order.ids.length === 0 && this.version === 0) return null;
        const options = {...this.options, order};
        const moved = this.withOptions(options);
        const version = this.version + 1;
        const allocator = cloneAllocator(this.index.allocator, []);
        const revision: Revision = {
            id: allocator.next(ID_PREFIX.revision),
            version,
            requestId,
            requestDigest: this.options.digest(stableStringify({chapters: order.ids})),
            time,
            by: {kind: "system"},
            what: "reorder",
            title: "章序调整",
            baseVersion: this.version,
            ops: [{kind: "chapters", before: [...(recorded ?? [])], after: [...order.ids]}],
            impact: computeImpact(this, moved.data, moved.engine, whereOf(undefined, order), []),
        };
        const data: WorldData = {...moved.data, version};
        const engine = moved.engine.update(engineInputs(data, options), {});
        const next = new World(data, engine, [...this.revisions, revision], {...this.index, allocator, recordedChapters: [...order.ids], requests: new Map(this.index.requests).set(requestId, {revision})}, options);
        return {ok: true, world: next, revision, ids: {}, repeated: false};
    }

    /** 这个请求 id 发布出的修订（project.md 输出 16）。 */
    requested(requestId: string): Revision | undefined {
        return this.index.requests.get(requestId)?.revision;
    }

    object(ref: ObjectRef): unknown {
        return (this.data[TABLE[ref.kind]] as ReadonlyMap<string, unknown>).get(ref.id);
    }

    /** 发布另一个进程写的修订（project.md 输出 17）：照重放的规矩套上，不校验。 */
    absorb(revision: Revision): World {
        const tables = thaw(this.data);
        const createdAt = new Map(this.data.createdAt);
        const changed: {entries: string[]; changes: string[]; checks: string[]} = {entries: [], changes: [], checks: []};
        let recordedChapters = this.index.recordedChapters;
        for (const op of revision.ops) {
            if (op.kind === "chapters") {
                recordedChapters = op.after;
                continue;
            }
            applyOp(tables, op, createdAt, revision.version);
            if (op.ref.kind === "entry") changed.entries.push(op.ref.id);
            if (op.ref.kind === "change") changed.changes.push(op.ref.id);
            if (op.ref.kind === "check") changed.checks.push(op.ref.id);
        }
        const data = freeze(tables, createdAt, revision.version);
        const engine = this.engine.update(engineInputs(data, this.options), changed);
        const world = this.next(data, engine, revision);
        return recordedChapters === this.index.recordedChapters ? world : new World(world.data, world.engine, world.revisions, {...world.index, recordedChapters}, world.options);
    }

    private next(data: WorldData, engine: IncrementalEngine, revision: Revision): World {
        const touched = new Map(this.index.touched);
        for (const op of revision.ops) if (op.kind !== "chapters") touched.set(refKey(op.ref), revision.version);
        const brokenBy = new Map(this.index.brokenBy);
        for (const change of revision.impact.broken) brokenBy.set(change, revision.id);
        const allocator = cloneAllocator(this.index.allocator, [revision]);
        for (const op of revision.ops) if (op.kind !== "chapters") observeIds(allocator, op);
        const requests = new Map(this.index.requests).set(revision.requestId, {revision});
        return new World(data, engine, [...this.revisions, revision], {requests, touched, brokenBy, allocator, recordedChapters: this.index.recordedChapters}, this.options);
    }
}

export type RevertFailure = {readonly code: "not-found"} | {readonly code: "not-revertable"} | {readonly code: "has-dependents"; readonly dependents: readonly string[]};

/**
 * 补偿一次修改：每个改过的叶子恢复成改前的值；没有 id 的数组里这次追加的元素（改后以改前为开头），只移除这些元素，
 * 后来别的修订追加的保留（revisions.md 输出 11）。
 */
function compensate(value: unknown, fields: readonly FieldChange[]): unknown {
    const restore: FieldChange[] = [];
    let result = value;
    for (const field of fields) {
        if (isAppend(field)) {
            const added = (field.after as unknown[]).slice((field.before as unknown[]).length);
            const segments = field.path;
            const current = applyChanges(result, [], "after");
            const list = [...((readPath(current, segments) as unknown[] | undefined) ?? [])];
            for (const item of [...added].reverse()) {
                const at = findLastIndex(list, (candidate) => sameJson(candidate, item));
                if (at >= 0) list.splice(at, 1);
            }
            result = applyChanges(result, [{path: segments, after: list}], "after");
            continue;
        }
        restore.push({path: field.path, ...("before" in field ? {after: field.before} : {})});
    }
    return applyChanges(result, restore, "after");
}

function isAppend(field: FieldChange): boolean {
    if (!Array.isArray(field.before) || !Array.isArray(field.after) || field.after.length <= field.before.length) return false;
    if (field.path.endsWith("#order")) return false;
    return field.before.every((item, index) => sameJson(item, (field.after as unknown[])[index]));
}

/**
 * 有 id 的列表的顺序叶子只是在末尾加了新元素（讲述、列表字段的行）：两次这样的追加各加各的元素，互不依赖；
 * 单独还原其中一次时，顺序恢复成改前的，另一次加的元素不在那份顺序里，按 `applyChanges` 的规矩留在末尾。
 */
function isOrderAppend(field: FieldChange): boolean {
    if (!field.path.endsWith("#order") || !Array.isArray(field.before) || !Array.isArray(field.after)) return false;
    return field.after.length > field.before.length && field.before.every((id, index) => (field.after as unknown[])[index] === id);
}

function findLastIndex<T>(list: readonly T[], predicate: (item: T) => boolean): number {
    for (let index = list.length - 1; index >= 0; index -= 1) if (predicate(list[index]!)) return index;
    return -1;
}

function readPath(value: unknown, path: string): unknown {
    let current = value;
    for (const segment of parseSegments(path)) {
        if (segment.kind === "key") current = current !== null && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>)[segment.key] : undefined;
        else current = Array.isArray(current) ? current.find((item) => (item as {id?: string}).id === segment.id) : undefined;
    }
    return current;
}

/**
 * `later` 是否依赖 `earlier`（revisions.md 输出 12）：同一对象上改过的路径重叠（一条是另一条的前缀；两边都只是往
 * 同一个没有 id 的数组追加时不算）；改了 `earlier` 新建的对象；引用了 `earlier` 新建的对象 id；补丁指到 `earlier` 的
 * 补丁加进列表的元素。
 */
function dependsOn(later: Revision, earlier: Revision): boolean {
    const created = new Set<string>();
    const elements: string[] = [];
    const paths = new Map<string, FieldChange[]>();
    for (const op of earlier.ops) {
        if (op.kind === "chapters") continue;
        if (op.kind === "create") created.add(refKey(op.ref));
        if (op.kind === "modify") paths.set(refKey(op.ref), [...op.fields]);
        const value = op.kind === "create" ? op.after : op.kind === "modify" ? undefined : undefined;
        for (const patch of ((value as StoryChange | undefined)?.patches ?? [])) {
            if (patch.op === "listAdd") elements.push(`${patch.at.entry}\u0000${patch.at.path}[${String((patch.value as {id?: unknown}).id)}]`);
        }
    }
    const createdIds = new Set([...created].map((key) => key.slice(key.indexOf(":") + 1)));
    if ((later.refs ?? []).some((reference) => createdIds.has(reference.target.id))) return true;
    for (const op of later.ops) {
        if (op.kind === "chapters") continue;
        const key = refKey(op.ref);
        if (created.has(key)) return true;
        const earlierFields = paths.get(key);
        if (earlierFields !== undefined && op.kind === "modify") {
            for (const field of op.fields) {
                for (const other of earlierFields) {
                    if (!pathsOverlap(field.path, other.path)) continue;
                    if (field.path === other.path && ((isAppend(field) && isAppend(other)) || (isOrderAppend(field) && isOrderAppend(other)))) continue;
                    return true;
                }
            }
        }
        if (earlierFields !== undefined && op.kind !== "modify") return true;
        const patches = op.kind === "create" ? ((op.after as StoryChange).patches ?? []) : op.kind === "modify" ? op.fields.flatMap((field) => (Array.isArray(field.after) ? (field.after as Patch[]) : [])) : [];
        for (const patch of patches) {
            if (patch === null || typeof patch !== "object" || !("at" in patch)) continue;
            const address = `${patch.at.entry}\u0000${patch.at.path}`;
            if (elements.some((element) => address === element || address.startsWith(`${element}.`))) return true;
        }
    }
    return false;
}

/**
 * 两条修订路径是否改到同一处：相同，或一条是另一条的前缀。列表的顺序叶子 `<列表>#order` 只与同一列表的顺序叶子、
 * 列表本身或它上面的路径重叠，不与列表里的单个元素重叠：元素加了、去了，顺序叶子里的 id 对不上的照
 * `applyChanges` 的规矩跳过或留在末尾，不会互相冲掉。
 */
function pathsOverlap(a: string, b: string): boolean {
    const ORDER = "#order";
    const covers = (outer: string, inner: string) => outer === inner || (inner.startsWith(outer) && (inner[outer.length] === "." || inner[outer.length] === "["));
    const aOrder = a.endsWith(ORDER);
    const bOrder = b.endsWith(ORDER);
    if (aOrder && bOrder) return a === b || covers(a.slice(0, -ORDER.length), b.slice(0, -ORDER.length)) || covers(b.slice(0, -ORDER.length), a.slice(0, -ORDER.length));
    if (aOrder) return covers(b, a.slice(0, -ORDER.length));
    if (bOrder) return covers(a, b.slice(0, -ORDER.length));
    return covers(a, b) || covers(b, a);
}

function invalid(problems: readonly Problem[]): WriteResult {
    return {ok: false, failure: {code: "validation-failed", problems}};
}

function engineInputs(data: WorldData, options: WorldOptions): EngineInputs {
    return {world: data, order: options.order, registry: options.registry, reductions: options.reductions};
}

function cloneAllocator(source: IdAllocator, extra: readonly Revision[]): IdAllocator {
    const allocator = source.clone();
    for (const revision of extra) allocator.observe(revision.id);
    return allocator;
}

/**
 * 记下一个操作里出现的全部 id：对象自己的，以及嵌在对象里的（讲述的 id 在剧情变更、核对点、条目里，全局分配、
 * 不复用，model.md 输出 25）。删掉最后一条讲述以后再发号，靠这里记下的最大号才不会重发。块与列表元素的 id 前缀
 * 不归这个分配器发，记下也无害。
 */
function observeIds(allocator: IdAllocator, op: Exclude<Op, {kind: "chapters"}>): void {
    allocator.observe(op.ref.id);
    const walk = (value: unknown): void => {
        if (Array.isArray(value)) for (const item of value) walk(item);
        else if (value !== null && typeof value === "object") {
            for (const [key, item] of Object.entries(value)) {
                if (key === "id" && typeof item === "string") allocator.observe(item);
                else walk(item);
            }
        }
    };
    if (op.kind === "create") walk(op.after);
    else if (op.kind === "delete") walk(op.before);
    else {
        for (const field of op.fields) {
            for (const segment of parseSegments(field.path)) if (segment.kind === "id") allocator.observe(segment.id);
            walk(field.before);
            walk(field.after);
        }
    }
}

function thaw(data: WorldData): Tables {
    return {
        entries: new Map(data.entries),
        changes: new Map(data.changes),
        checks: new Map(data.checks),
        decisions: new Map(data.decisions),
        suggestions: new Map(data.suggestions),
    };
}

function freeze(tables: Tables, createdAt: Map<string, number>, version: number): WorldData {
    return {version, entries: tables.entries, changes: tables.changes, checks: tables.checks, decisions: tables.decisions, suggestions: tables.suggestions, createdAt};
}

function applyOp(tables: Tables, op: Exclude<Op, {kind: "chapters"}>, createdAt: Map<string, number>, version: number): void {
    const table = tables[TABLE[op.ref.kind]] as Map<string, unknown>;
    if (op.kind === "create") {
        table.set(op.ref.id, structuredClone(op.after));
        if (!createdAt.has(op.ref.id)) createdAt.set(op.ref.id, version);
    } else if (op.kind === "delete") table.delete(op.ref.id);
    else table.set(op.ref.id, applyChanges(table.get(op.ref.id), op.fields, "after"));
}

/** 这次修订新写或改过的引用（revisions.md 的“存下来的修订”里的 `refs`），连同它所在的对象。 */
function writtenReferences(before: World, data: WorldData, ops: readonly Op[]): {readonly ref: ObjectRef; readonly reference: ReturnType<typeof referencesOf>[number]}[] {
    const contextOf = (world: WorldData): ReferenceContext => ({registry: before.options.registry, entry: (id) => world.entries.get(id)});
    const old = contextOf(before.data);
    const now = contextOf(data);
    const found: {ref: ObjectRef; reference: ReturnType<typeof referencesOf>[number]}[] = [];
    for (const op of ops) {
        if (op.kind === "chapters" || op.kind === "delete") continue;
        const after = (data[TABLE[op.ref.kind]] as ReadonlyMap<string, unknown>).get(op.ref.id);
        const added = newReferences(referencesOf(op.ref.kind, before.object(op.ref), old), referencesOf(op.ref.kind, after, now));
        for (const reference of added) found.push({ref: op.ref, reference});
    }
    return found;
}

/** 新写或改过的、由引用模块负责校验的引用（components.md 输出 18 的 `ref-invalid`）。 */
function referenceProblems(data: WorldData, refs: ReturnType<typeof writtenReferences>): Problem[] {
    const exists = {
        entry: (id: string) => data.entries.get(id),
        change: (id: string) => data.changes.has(id),
        decision: (id: string) => data.decisions.has(id),
        check: (id: string) => data.checks.has(id),
    };
    const problems: Problem[] = [];
    for (const {ref, reference} of refs) {
        if (!reference.checked) continue;
        const reason = referenceProblem(reference, exists);
        if (reason !== null) problems.push({code: "ref-invalid", ref, path: reference.path, reason, message: `${reference.target.kind} "${reference.target.id}": ${reason}`});
    }
    return problems;
}

/**
 * 写入时补上的缺省值：新讲述的 id（model.md 输出 25）；章内排序键（revisions.md 输出 18）；作者与系统写的数没给依据时记成“作者给的”
 * （Agent 与后台任务必须自己给，输出 3）；对命名空间的补丁记上写入时登记的类型版本（components.md 输出 10）。
 */
function fillDefaults(kind: ObjectKind, after: unknown, request: WriteRequest, options: WorldOptions, allocator: IdAllocator): unknown {
    const authored = request.by.kind === "author" || request.by.kind === "system";
    // 新的讲述不带 id，在这里发（model.md 输出 25）。带了 id 的照留，是不是这个对象原有的由校验查。
    for (const telling of tellingsOf(kind, after)) if ((telling as {id?: unknown}).id === undefined) (telling as {id: string}).id = allocator.next(ID_PREFIX.telling);
    if (kind === "change") {
        const change = after as StoryChange & {at: {key?: number}};
        const at = change.at;
        if (at?.kind === "chapter" && typeof at.key !== "number") {
            const text = options.chapterText(at.chapter) ?? "";
            const quote = change.told?.find((telling) => telling.source === "chapter" && telling.chapter === at.chapter && telling.quote !== undefined)?.quote;
            const index = quote === undefined ? -1 : text.indexOf(quote);
            (change.at as {key: number}).key = index >= 0 ? index : 0;
        }
        if (authored && Array.isArray(change.patches)) for (const patch of change.patches) if (patch.basis === undefined && typeof patch.value === "number") (patch as Patch).basis = {kind: "author"};
        if (Array.isArray(change.patches)) {
            for (const patch of change.patches) {
                const root = /^[^.[]+/u.exec(patch.at?.path ?? "")?.[0];
                if (root === undefined || RESERVED_ROOTS.has(root) || patch.version !== undefined) continue;
                const type = options.registry.byNamespace(root);
                if (type !== undefined) (patch as {version?: number}).version = type.version;
            }
        }
    }
    if (kind === "check") {
        const check = after as Check & {place: {key?: number}};
        if (check.place?.kind === "chapter" && typeof check.place.key !== "number") {
            const text = options.chapterText(check.place.chapter) ?? "";
            const index = text.indexOf(check.told?.quote ?? "\u0000");
            (check.place as {key: number}).key = index >= 0 ? index : 0;
        }
    }
    return after;
}

function whereOf(chapter: string | undefined, order: ChapterOrder): ReadPosition {
    return chapter !== undefined && order.has(chapter) ? chapterEnd(chapter) : defaultPosition(order);
}

/** 一个对象里的讲述：剧情变更与核对点的 `told`、条目的 `retold`。 */
function tellingsOf(kind: ObjectKind, value: unknown): Telling[] {
    if (value === null || typeof value !== "object") return [];
    if (kind === "change") {
        const told = (value as StoryChange).told;
        return Array.isArray(told) ? told : [];
    }
    if (kind === "check") {
        const told = (value as Check).told;
        return told !== null && typeof told === "object" ? [told] : [];
    }
    if (kind === "entry") return Object.values((value as Entry).retold ?? {}).flat();
    return [];
}

/**
 * 一条讲述按来源的必填项与原句（model.md 输入的“讲述”表，revisions.md 输出 3 的 `invalid-telling`、`quote-not-found`）。
 * 原句不含换行，所以在整章里不重叠地数出现次数，与按段数（model.md 输出 24）结果相同。
 */
function tellingProblem(telling: Telling, chapterText: (chapter: string) => string | undefined): Omit<Problem, "ref" | "path"> | null {
    const invalid = (message: string) => ({code: "invalid-telling", message});
    if (telling.nth !== undefined && telling.source !== "chapter") return invalid("nth is only for chapter tellings");
    if (telling.source === "outline" && (telling.chapter === undefined || telling.anchor === undefined)) return invalid("an outline telling needs a chapter and an anchor");
    if ((telling.source === "message" || telling.source === "ui") && telling.anchor === undefined) return invalid(`a ${telling.source} telling needs an anchor`);
    if (telling.source !== "chapter") return null;
    if (telling.chapter === undefined) return invalid("a chapter telling needs a chapter");
    if (telling.quote === undefined || telling.quote === "" || /[\r\n]/u.test(telling.quote)) return invalid("a chapter telling needs a non-empty, single-line quote");
    const count = countOccurrences(chapterText(telling.chapter) ?? "", telling.quote);
    if (count === 0) return {code: "quote-not-found", message: "quote is not in the chapter text"};
    if (telling.nth !== undefined && telling.nth > count) return invalid(`nth ${String(telling.nth)} exceeds the ${String(count)} occurrence(s) of the quote`);
    return null;
}

/** 写入时校验（revisions.md 输出 3、17，model.md 输出 18、23，components.md 输出 3、5、14–16）。 */
function validate(world: World, data: WorldData, engine: IncrementalEngine, request: WriteRequest, changed: {entries: string[]; changes: string[]; checks: string[]}): Problem[] {
    const problems: Problem[] = [];
    const {registry, chapterText} = world.options;
    const strictBasis = request.by.kind === "agent" || request.by.kind === "task";

    /** 新写或改过的讲述的问题（revisions.md 输出 3）；原样留着的不查：正文改过以后失联的讲述照样可以随对象改别的字段。 */
    const tellingProblems = (ref: ObjectRef, path: string, tellings: readonly Telling[], previous: readonly Telling[]): Problem[] => {
        const before = new Map(previous.map((telling) => [telling.id, telling]));
        const found: Problem[] = [];
        for (const telling of tellings) {
            if (sameJson(before.get(telling.id), telling)) continue;
            const problem = tellingProblem(telling, chapterText);
            if (problem !== null) found.push({...problem, ref, path});
        }
        return found;
    };

    for (const id of changed.entries) {
        const entry = data.entries.get(id);
        if (entry === undefined) continue;
        const ref: ObjectRef = {kind: "entry", id};
        if (entry.parent !== null) {
            const seen = new Set<string>([id]);
            let parent: string | null = entry.parent;
            while (parent !== null) {
                const node = data.entries.get(parent);
                if (node === undefined || node.deleted === true || seen.has(parent)) {
                    problems.push({code: "invalid-tree", ref, path: "parent", message: "parent must be an existing, live entry without cycles"});
                    break;
                }
                seen.add(parent);
                parent = node.parent;
            }
        }
        if (entry.sameAs !== undefined) {
            const target = data.entries.get(entry.sameAs);
            if (target === undefined || entry.sameAs === id || target.sameAs !== undefined) problems.push({code: "invalid-tree", ref, path: "sameAs", message: "sameAs must point to another existing entry that has no sameAs"});
        }
        for (const [namespace, nsData] of Object.entries(entry.init.data)) {
            const type = registry.byNamespace(namespace);
            const old = (world.object(ref) as Entry | undefined)?.init.data[namespace];
            if (sameJson(old, nsData)) continue;
            if (type === undefined || type.id !== nsData.type) {
                problems.push({code: "component-unknown", ref, path: `init.data.${namespace}`, message: "component type is not registered"});
                continue;
            }
            if (type.version !== nsData.version) {
                problems.push({code: "component-version-unsupported", ref, path: `init.data.${namespace}`, message: "component version differs from the registered type"});
                continue;
            }
            const declaredProblem = nsData.declared === undefined ? null : fieldsProblem([...type.fields, ...nsData.declared], `init.data.${namespace}.declared`);
            if (declaredProblem !== null) problems.push({code: "type-mismatch", ref, ...declaredProblem});
            for (const field of effectiveFields(type, nsData.declared)) {
                const value = nsData.fields[field.id] ?? null;
                const problem = valueProblem(field, value);
                if (problem !== null) {
                    const redeclared = nsData.declared?.some((declared) => declared.id === field.id) === true && !(old?.declared ?? []).some((declared) => declared.id === field.id) && field.id in (old?.fields ?? {});
                    problems.push({code: redeclared ? "field-redeclare-mismatch" : problem, ref, path: `init.data.${namespace}.fields.${field.id}`, message: `value does not fit field "${field.label}"`});
                    continue;
                }
                if (strictBasis && field.kind === "number" && field.precision !== "semantic" && typeof value === "number" && !sameJson(old?.fields[field.id], value) && entry.initBasis?.[`${namespace}.${field.id}`] === undefined) {
                    problems.push({code: "number-without-basis", ref, path: `initBasis["${namespace}.${field.id}"]`, message: "every number needs a basis (quote, derived, author, or estimate)"});
                }
            }
        }
        const oldBlocks = new Map(((world.object(ref) as Entry | undefined)?.init.text ?? []).map((block) => [block.id, block.source]));
        for (const block of entry.init.text) {
            if (oldBlocks.get(block.id) === block.source) continue;
            const problem = blockProblem(block.source);
            if (problem !== null) problems.push({code: problem.code, ref, path: `init.text[${block.id}]`, message: `${problem.message} (${String(problem.line)}:${String(problem.column)})`});
        }
        const previousRetold = (world.object(ref) as Entry | undefined)?.retold ?? {};
        for (const [path, tellings] of Object.entries(entry.retold ?? {})) problems.push(...tellingProblems(ref, `retold["${path}"]`, tellings, previousRetold[path] ?? []));
    }

    const replacements = new Map<string, string[]>();
    for (const change of data.changes.values()) {
        if (change.kind !== "plan" || change.status !== "active") continue;
        for (const link of change.links) if (link.kind === "replaces") replacements.set(link.plan, [...(replacements.get(link.plan) ?? []), change.id]);
    }

    for (const id of changed.changes) {
        const change = data.changes.get(id);
        if (change === undefined || change.status === "undone") continue;
        const ref: ObjectRef = {kind: "change", id};
        for (const line of change.lines) if (data.entries.get(line)?.type !== "剧情线") problems.push({code: "invalid-line", ref, path: "lines", message: `"${line}" is not a plot line entry`});
        for (const link of change.links) {
            const plan = data.changes.get(link.plan);
            const ok = plan !== undefined && plan.kind === "plan" && link.plan !== id && (link.kind === "fulfills" ? change.kind === "written" : change.kind === "plan");
            if (!ok) problems.push({code: "invalid-link", ref, path: "links", message: `${link.kind} must point from ${link.kind === "fulfills" ? "a written change" : "a plan"} to another plan`});
            if (link.kind === "splitFrom") {
                const by = data.changes.get(link.by);
                if (by === undefined || by.kind !== "written" || !by.links.some((other) => other.kind === "fulfills" && other.plan === link.plan)) problems.push({code: "invalid-link", ref, path: "links", message: "splitFrom.by must be a written change that fulfills the same plan"});
            }
            if (link.kind === "replaces" && change.kind === "plan" && change.status === "active") {
                if ((replacements.get(link.plan) ?? []).length > 1) problems.push({code: "invalid-link", ref, path: "links", message: "a plan can be replaced by at most one active plan"});
                let cursor: string | undefined = link.plan;
                const seen = new Set<string>([id]);
                while (cursor !== undefined) {
                    if (seen.has(cursor)) {
                        problems.push({code: "invalid-link", ref, path: "links", message: "replaces forms a cycle"});
                        break;
                    }
                    seen.add(cursor);
                    const next: StoryChange | undefined = data.changes.get(cursor);
                    cursor = next?.status === "active" ? next.links.find((other) => other.kind === "replaces")?.plan : undefined;
                }
            }
        }
        problems.push(...tellingProblems(ref, "told", change.told, (world.object(ref) as StoryChange | undefined)?.told ?? []));
        for (const [index, patch] of change.patches.entries()) {
            const target = data.entries.get(patch.at.entry);
            if (target === undefined || target.deleted === true) problems.push({code: "entry-missing", ref, path: `patches[${String(index)}]`, message: `entry "${patch.at.entry}" does not exist`});
            if (parsePath(patch.at.path) === null) problems.push({code: "unknown-field", ref, path: `patches[${String(index)}]`, message: `bad address "${patch.at.path}"`});
            const blockSource = patch.op === "addBlock" ? (patch.value as {source?: unknown} | null)?.source : patch.op === "replaceBlock" && patch.at.path.startsWith("text[") ? patch.value : undefined;
            if (typeof blockSource === "string") {
                const problem = blockProblem(blockSource);
                if (problem !== null) problems.push({code: problem.code, ref, path: `patches[${String(index)}]`, message: `${problem.message} (${String(problem.line)}:${String(problem.column)})`});
            }
            if (typeof patch.value === "number" && patch.op !== "note") {
                const basisProblem = checkBasis(patch, change, engine, data, chapterText, strictBasis);
                if (basisProblem !== null) problems.push({...basisProblem, ref, path: `patches[${String(index)}]`});
            }
        }
        if (change.kind !== "written" || change.status !== "active") continue;
        for (const entryId of new Set(change.patches.map((patch) => patch.at.entry))) {
            const target = data.entries.get(entryId);
            if (target?.appears === undefined) continue;
            const appears = target.appears;
            const appearsRank = appears.kind === "chapter" ? world.options.order.index(appears.chapter) : -1;
            const changeRank = change.at.kind === "chapter" ? world.options.order.index(change.at.chapter) : -1;
            if (appearsRank !== undefined && changeRank !== undefined && (changeRank < appearsRank || (changeRank === appearsRank && change.at.kind === "chapter" && appears.kind === "chapter" && change.at.key < appears.key))) {
                problems.push({code: "not-appeared", ref, message: `entry "${entryId}" has not appeared at this placement`});
            }
        }
        const detail = engine.detail(id);
        if (detail === undefined) continue;
        if (!detail.applied) {
            problems.push({code: detail.reason, ref, path: detail.failedPatch >= 0 ? `patches[${String(detail.failedPatch)}]` : "patches", message: `change cannot apply at its placement (${detail.reason})`});
            continue;
        }
        for (const [index, result] of detail.patches.entries()) {
            if (result === "applied") continue;
            const why = result.notApplicable;
            const code = why === "disabled" || why === "removed" ? "component-disabled" : why === "undeclared" ? "unknown-field" : why;
            problems.push({code, ref, path: `patches[${String(index)}]`, message: `patch does not apply (${why})`});
        }
    }

    for (const id of changed.checks) {
        const check = data.checks.get(id);
        if (check === undefined) continue;
        const ref: ObjectRef = {kind: "check", id};
        if (!data.entries.has(check.at.entry)) problems.push({code: "entry-missing", ref, message: "entry does not exist"});
        const previousCheck = world.object(ref) as Check | undefined;
        problems.push(...tellingProblems(ref, "told", [check.told], previousCheck === undefined ? [] : [previousCheck.told]));
        if (check.anchor !== undefined && !data.changes.has(check.anchor.change)) problems.push({code: "invalid-link", ref, path: "anchor", message: "anchor change does not exist"});
    }
    return problems;
}

/** 每个数有依据（revisions.md 输出 3）：原文里读得出这个数（加减取绝对值）、核对点推出的差额复算相等、作者给的或估计。 */
function checkBasis(patch: Patch, change: StoryChange, engine: IncrementalEngine, data: WorldData, chapterText: (chapter: string) => string | undefined, strict: boolean): Omit<Problem, "ref"> | null {
    const value = patch.value as number;
    const basis = patch.basis;
    if (basis === undefined) return strict ? {code: "number-without-basis", message: "every number needs a basis (quote, derived, author, or estimate)"} : null;
    if (basis.kind === "estimate" || basis.kind === "author") return null;
    if (basis.kind === "quote") {
        const wanted = patch.op === "add" ? Math.abs(value) : value;
        if (!readNumbers(basis.quote).includes(wanted)) return {code: "basis-mismatch", message: `quote does not contain ${String(wanted)}`};
        const inText = change.at.kind === "chapter" ? (chapterText(change.at.chapter) ?? "").includes(basis.quote) : false;
        const inTold = change.told.some((telling) => telling.quote?.includes(basis.quote) === true);
        return inText || inTold ? null : {code: "quote-not-found", message: "basis quote is not in the chapter text or the tellings"};
    }
    const check = data.checks.get(basis.check);
    if (check === undefined || check.at.entry !== patch.at.entry || check.at.path !== patch.at.path) return {code: "basis-mismatch", message: "derived basis must name a check on the same address"};
    if (patch.op === "set") return value === check.value ? null : {code: "basis-mismatch", message: "derived value differs from the check"};
    const before = engine.valueBefore(change.id, patch.at);
    return typeof before === "number" && before + value === check.value ? null : {code: "basis-mismatch", message: "derived difference does not recompute"};
}

/** 带来的变化：待处理的增减、相关地址的改前改后、让后面哪些变更套不上（revisions.md 输出 4、6）。 */
function computeImpact(before: World, data: WorldData, engine: IncrementalEngine, where: ReadPosition, ops: readonly Op[]): Revision["impact"] {
    const key = (item: PendingItem) => (item.kind === "check-mismatch" ? `check:${item.check}` : item.kind === "cannot-apply" ? `cannot:${item.changes[0]!}` : item.kind === "held" ? `held:${item.change}` : `deleted:${item.ref.kind}:${item.ref.id}`);
    const was = before.engine.pending(where);
    const now = engine.pending(where);
    const wasKeys = new Set(was === "chapter-not-found" ? [] : was.map(key));
    const nowKeys = new Set(now === "chapter-not-found" ? [] : now.map(key));
    const addresses = new Map<string, Address>();
    for (const op of ops) {
        if (op.kind === "chapters") continue;
        if (op.ref.kind === "change") {
            for (const source of [op.kind === "create" ? op.after : op.kind === "delete" ? op.before : data.changes.get(op.ref.id), before.data.changes.get(op.ref.id)]) {
                for (const patch of (source as StoryChange | undefined)?.patches ?? []) addresses.set(`${patch.at.entry}\u0000${patch.at.path}`, patch.at);
            }
        }
        if (op.ref.kind === "entry" && op.kind === "modify") {
            for (const field of op.fields) {
                // 主文字的块：改了哪一块（源文、增删、换顺序都算那一块或整个列表）就记那一块的源文。
                const block = /^init\.text\[([^\]]+)\]/u.exec(field.path);
                if (block !== null) {
                    const id = block[1]!;
                    addresses.set(`${op.ref.id}\u0000text[${id}]`, {entry: op.ref.id, path: `text[${id}]`});
                    continue;
                }
                const match = /^init\.data\.([^.[\]]+)\.fields\.([^.[\]]+)/u.exec(field.path) ?? /^init\.(name|summary|aliases)/u.exec(field.path);
                if (match === null) continue;
                const path = match.length === 3 ? `${match[1]!}.${match[2]!}` : `entry.${match[1]!}`;
                addresses.set(`${op.ref.id}\u0000${path}`, {entry: op.ref.id, path});
            }
        }
    }
    const read = (target: World["engine"], at: Address) => {
        const view = target.entry(at.entry, where, "actual");
        if (view === null || view === "chapter-not-found" || view.deleted) return undefined;
        const block = /^text\[([^\]]+)\]$/u.exec(at.path);
        if (block !== null) return view.text.find((candidate) => candidate.id === block[1])?.source;
        const namespace = at.path.split(".")[0]!;
        if (namespace === "entry") return readEntryAddress({name: view.name, aliases: [...view.aliases], summary: view.summary, text: [], data: {}}, at.path);
        const field = view.namespaces[namespace]?.fields[at.path.slice(namespace.length + 1).split("[")[0]!];
        // 未归纳的语义档只存起点与事件条数（revisions.md 输出 6）。
        if (field?.unreduced !== undefined) return {notReduced: true, anchor: field.unreduced.anchor, events: field.unreduced.events};
        return field?.value;
    };
    const values: Revision["impact"]["values"] = [];
    for (const at of [...addresses.values()].sort((a, b) => (addressKey(a) < addressKey(b) ? -1 : 1))) {
        const old = read(before.engine, at);
        const fresh = read(engine, at);
        if (sameJson(old, fresh)) continue;
        values.push({at, ...(old === undefined ? {} : {before: old}), ...(fresh === undefined ? {} : {after: fresh})});
    }
    const broken: string[] = [];
    for (const change of data.changes.values()) {
        if (before.engine.outcome(change.id)?.applied === true && engine.outcome(change.id)?.applied === false) broken.push(change.id);
    }
    return {
        where,
        pendingResolved: [...wasKeys].filter((item) => !nowKeys.has(item)).sort(),
        pendingAdded: [...nowKeys].filter((item) => !wasKeys.has(item)).sort(),
        values,
        broken: broken.sort(compareIds),
    };
}

