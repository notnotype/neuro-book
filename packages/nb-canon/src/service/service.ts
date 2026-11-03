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

import type {ComponentRegistry} from "../components/registry";
import {compareIds} from "../core/ids";
import {ChapterOrder, compareRanks, defaultPosition, placementRank} from "../core/position";
import type {ReadPosition, Revision, WriteRequest} from "../core/schema";
import {stableStringify} from "../core/stable-json";
import type {Mode, PendingItem, ReductionInput} from "../engine/types";
import type {LogFiles} from "../node/files";
import {appendRevision, openLog, readNew, type LogDiagnostic, type LogLock, type Tail} from "../node/log";
import {appendReduction, loadReductions} from "../node/cache";
import {renderEntryForAgent, renderEntryForAuthor} from "../render/entry";
import {writeBack, type WriteBackInput, type WriteBackResult} from "../render/writeback";
import {editInPlace, recordDelta, type EditResult, type InPlaceEdit} from "../world/edits";
import {World, type WriteResult} from "../world/world";

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
    /** 小模型：没有时语义档一直是“未归纳”的写法（输入与前置条件）。 */
    readonly reducer?: {readonly version: string; readonly reduce: (input: ReductionInput) => Promise<string>};
}

export type ServiceEvent =
    | {readonly kind: "changed"; readonly version: number; readonly revision: string; readonly by: Revision["by"]; readonly what: string; readonly title: string}
    | {readonly kind: "exclusive"; readonly holder: string | null}
    | {readonly kind: "reduced"};

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

    /** 打开世界（输出 4）；章序与登记的类型由宿主给。打开后章序与记下的不同就发布章序调整（输出 9）。 */
    static async open(ports: ServicePorts, initial: {readonly chapters: readonly string[]; readonly registry: ComponentRegistry}): Promise<WorldService | {readonly code: "world-locked"}> {
        const opened = await openLog(ports.files, ports.logDir, {lock: ports.lock, sideDir: ports.sideDir, now: ports.now});
        if ("code" in opened) return opened;
        const cache = await loadReductions(ports.files, ports.cachePath);
        let service!: WorldService;
        const reductions = cache.entries;
        const options = {
            order: new ChapterOrder(initial.chapters),
            registry: initial.registry,
            reductions: (input: ReductionInput) => service.#lookup(input),
            chapterText: ports.chapterText,
            digest: ports.digest,
        };
        const world = World.replay(opened.revisions, options);
        const readOnly = opened.readOnly === null ? null : `${opened.readOnly.segment}:${String(opened.readOnly.line)} ${opened.readOnly.message}`;
        const diagnostics: ServiceDiagnostic[] = [...opened.diagnostics, ...cache.badLines.map((line) => ({code: "reduction-cache-bad-line" as const, line}))];
        service = new WorldService(ports, world, opened.tail, readOnly, diagnostics, reductions);
        await service.setChapters(initial.chapters);
        return service;
    }

    get world(): World {
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
            version: this.#world.version,
            state: this.#state,
            ...(this.#readOnlyReason === null ? {} : {reason: this.#readOnlyReason}),
            exclusive: this.#lease === null ? null : {label: this.#lease.label, since: this.#lease.since},
            diagnostics: [...this.diagnostics, ...this.#world.options.registry.diagnostics],
            recomputed: this.#world.engine.recomputed,
        };
    }

    entry(id: string, position: ReadPosition, mode: Mode, withOrigins = false) {
        const world = this.#world;
        const view = world.engine.entry(id, position, mode);
        if (view === "chapter-not-found" || view === null || !withOrigins) return view === "chapter-not-found" ? view : {version: world.version, view};
        const origins: Record<string, unknown> = {};
        for (const [namespace, data] of Object.entries(view.namespaces)) {
            for (const field of Object.keys(data.fields)) origins[`${namespace}.${field}`] = world.engine.origins({entry: id, path: `${namespace}.${field}`}, position, mode);
        }
        return {version: world.version, view, origins};
    }

    pending(position?: ReadPosition): {version: number; items: readonly PendingItem[]} | "chapter-not-found" {
        const world = this.#world;
        const items = world.pending(position ?? defaultPosition(world.options.order));
        return items === "chapter-not-found" ? items : {version: world.version, items};
    }

    /** 条目树的一层：父条目（null 是根）下按顺序的条目（输出：`tree`）。 */
    tree(parent: string | null, cursor?: string, limit = 50) {
        const world = this.#world;
        const children = [...world.data.entries.values()].filter((entry) => entry.parent === parent).sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
        const page = this.#page(world.version, children, cursor, limit);
        if (page === "cursor-stale") return page;
        return {
            version: world.version,
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
        return {version: world.version, found};
    }

    /** 剧情变更的列表，按全序；每条带生效状态与这次套没套上（输出：`changes`）。 */
    changes(filter: {readonly chapter?: string; readonly entry?: string; readonly line?: string; readonly kind?: "written" | "plan"; readonly status?: "active" | "held" | "undone"} = {}, cursor?: string, limit = 50) {
        const world = this.#world;
        const order = world.options.order;
        const matching = [...world.data.changes.values()].filter((change) =>
            (filter.chapter === undefined || (change.at.kind === "chapter" && change.at.chapter === filter.chapter)) &&
            (filter.entry === undefined || change.involves.includes(filter.entry) || change.patches.some((patch) => patch.at.entry === filter.entry)) &&
            (filter.line === undefined || change.lines.includes(filter.line)) &&
            (filter.kind === undefined || change.kind === filter.kind) &&
            (filter.status === undefined || change.status === filter.status),
        );
        matching.sort((a, b) => {
            const left = placementRank(order, a.at);
            const right = placementRank(order, b.at);
            if (left === null || right === null) return left === right ? compareIds(a.id, b.id) : left === null ? 1 : -1;
            return compareRanks(left, right) || compareIds(a.id, b.id);
        });
        const page = this.#page(world.version, matching, cursor, limit);
        if (page === "cursor-stale") return page;
        return {version: world.version, items: page.items.map((change) => ({change, outcome: world.engine.outcome(change.id) ?? null})), ...(page.next === undefined ? {} : {cursor: page.next})};
    }

    questions(status?: "open" | "answered" | "dropped") {
        const world = this.#world;
        return {version: world.version, items: [...world.data.questions.values()].filter((item) => status === undefined || item.status === status).sort((a, b) => compareIds(a.id, b.id))};
    }

    suggestions(status?: "open" | "applied" | "declined") {
        const world = this.#world;
        return {version: world.version, items: [...world.data.suggestions.values()].filter((item) => status === undefined || item.status === status).sort((a, b) => compareIds(a.id, b.id))};
    }

    /** 改动记录，按版本从新到旧，带能不能还原（revisions.md 输出 14）。 */
    revisions(filter: {readonly chapter?: string; readonly entry?: string; readonly by?: Revision["by"]["kind"]} = {}, cursor?: string, limit = 20) {
        const world = this.#world;
        const matching = [...world.revisions].reverse().filter((revision) =>
            (filter.chapter === undefined || revision.chapter === filter.chapter) &&
            (filter.by === undefined || revision.by.kind === filter.by) &&
            (filter.entry === undefined || revision.ops.some((op) => op.kind !== "chapters" && (op.ref.id === filter.entry || JSON.stringify(op).includes(`"${filter.entry}"`)))),
        );
        const page = this.#page(world.version, matching, cursor, limit);
        if (page === "cursor-stale") return page;
        return {
            version: world.version,
            items: page.items.map((revision) => {
                const set = world.dependents(revision.id);
                const revertable = set === "not-revertable" ? {ok: false, reason: "not-revertable"} : set.length > 1 ? {ok: false, reason: "has-dependents", dependents: set.slice(1)} : {ok: true};
                return {id: revision.id, version: revision.version, by: revision.by, what: revision.what, title: revision.title, time: revision.time, chapter: revision.chapter, impact: revision.impact, revertable};
            }),
            ...(page.next === undefined ? {} : {cursor: page.next}),
        };
    }

    render(entry: string, position: ReadPosition, mode: Mode, audience: "author" | "agent") {
        return audience === "author" ? renderEntryForAuthor(this.#world, entry, position, mode) : renderEntryForAgent(this.#world, entry, position, mode);
    }

    preview(request: WriteRequest): WriteResult {
        return this.#world.preview(request, this.#ports.now());
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

    revert(target: string, withDependents: boolean, meta: {readonly requestId: string; readonly by: WriteRequest["by"]; readonly title?: string}, token?: string) {
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
            if (lease !== null && lease.token === token) lease.expires = this.#ports.clock() + LEASE_MS;
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

    /** 宿主给出新章序（输出 9）：与记下的不同就发布章序调整；`invalid` 时保持原章序并写诊断（输出 23）。 */
    async setChapters(chapters: readonly string[] | "invalid"): Promise<void> {
        if (chapters === "invalid") {
            this.diagnostics.push({code: "binder-invalid"});
            return;
        }
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

    /** 登记的 Component 类型变了（插件启停）：换上新登记整本重算，版本不变。 */
    setRegistry(registry: ComponentRegistry): void {
        this.#world = this.#world.withOptions({...this.#world.options, registry});
    }

    /* ---------- 独占写入（输出 10） ---------- */

    acquireExclusive(label: string): {readonly token: string; readonly expires: number} | {readonly code: "busy"; readonly holder: string; readonly since: number} {
        this.#expireLease();
        if (this.#lease !== null) return {code: "busy", holder: this.#lease.label, since: this.#lease.since};
        const now = this.#ports.clock();
        const token = `lease-${String(++this.#tokens)}-${String(now)}`;
        this.#lease = {token, label, since: now, expires: now + LEASE_MS};
        this.#emit({kind: "exclusive", holder: label});
        return {token, expires: this.#lease.expires};
    }

    renewExclusive(token: string): {readonly expires: number} | {readonly code: "exclusive-lost"} {
        this.#expireLease();
        if (this.#lease?.token !== token) return {code: "exclusive-lost"};
        this.#lease.expires = this.#ports.clock() + LEASE_MS;
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

    #endLease(): void {
        this.#lease = null;
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
                    this.#reductions.set(key, text);
                    await appendReduction(this.#ports.files, this.#ports.cachePath, key, text);
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

    /* ---------- 游标（输出 19） ---------- */

    #page<T>(version: number, items: readonly T[], cursor: string | undefined, limit: number): {items: readonly T[]; next?: string} | "cursor-stale" {
        let offset = 0;
        if (cursor !== undefined) {
            const [cursorVersion, cursorOffset] = cursor.split(":").map(Number) as [number, number];
            if (cursorVersion !== version) return "cursor-stale";
            offset = cursorOffset;
        }
        const slice = items.slice(offset, offset + limit);
        const next = offset + limit < items.length ? `${String(version)}:${String(offset + limit)}` : undefined;
        return {items: slice, ...(next === undefined ? {} : {next})};
    }
}
