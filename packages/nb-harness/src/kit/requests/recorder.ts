/**
 * 模型请求记录器（docs/specs/agent/request-trace.md）。宿主进程里只有一个，它是记录目录唯一的写者。
 *
 * 写入：全部写盘经一个串行队列。一条记录的内容文件、原始请求体与引用它们的那一行在同一个任务里，先内容后行（目录布局与
 * 崩溃时的保证见 `store.ts`）。内存里的折叠结果只在那一行写成之后更新，随后发变更事件；所以 `list` 交回的序号以前的事件，
 * 都已经反映在那一页里。清空与清理也在这个队列里，所以不会删掉一条正在写的记录要引用的内容。
 *
 * 索引行 `{v: 1, seq, id, kind, …}`，`kind` 是 `start`、`attempt`、`end`、`pruned`（原始请求体因总量上限删掉了）。
 * 一条记录的行都写进它 `start` 所在那天的文件；读时按 `id` 折叠。`seq` 跨文件单调，变更事件用同一个序号。
 */

import {randomUUID} from "node:crypto";
import type {JsonValue, ModelCallMeta, ModelRequest, ModelResponse, ModelWireAttempt, ModelWireObserver, RequestPurpose, StopReason, Usage} from "../../kernel/contracts.js";
import {blockOutline, messageOutline, previewOf, replyOutline, toolOutline} from "./outline.js";
import {maskHeaders, maskUrl, sha256, stripBlocks, stripMessage, stripPayloadImages} from "./sanitize.js";
import {dayOf, FORMAT_VERSION, isRecordId, RequestFiles} from "./store.js";
import type {BlockOutline, MessageOutline, PayloadState, RequestAttempt, RequestChange, RequestDetail, RequestPage, RequestQuery, RequestRow, RequestStatus, RequestUsage, ToolOutline} from "./types.js";

/** 设置在每次请求开始时读（Spec 的设置表）：改了从下一次请求生效。 */
export interface RequestTraceSettings {
    readonly enabled: boolean;
    readonly payload: boolean;
    readonly headers: boolean;
}

export interface RequestRecorderOptions {
    /** 记录目录（状态根下的 `agent/requests/`）。 */
    readonly root: string;
    readonly settings: () => RequestTraceSettings;
    /** 码是 `requests.write-failed`、`requests.unreadable`、`requests.listener-failed`；宿主加自己的前缀（应用里是 `agent.`）。 */
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    readonly now?: () => number;
    /** 原始请求体合计的上限（压缩后的字节）；缺省 1 GB（Spec 输出 6）。 */
    readonly payloadLimit?: number;
}

/** 能记的调用：内核给了会话、请求序号与哈希。`complete()` 与不经内核的调用没有，不记。 */
export type TracedCallMeta = ModelCallMeta & {readonly session: string; readonly request: number; readonly hash: string};

/** 一条进行中的记录。`finish`、`fail` 只算第一次；都不等写盘。 */
export interface RequestHandle {
    readonly id: string;
    /** 交给适配器的观察者；回调从不抛错。 */
    readonly observer: ModelWireObserver;
    finish(response: ModelResponse): void;
    /** 适配器抛错（而不是交回失败的回复）。 */
    fail(error: unknown, aborted: boolean): void;
}

/** 记录目录整个读不了：`reason` 是 `newer-format`（更新的版本写的，不动它）或 `unreadable`。 */
export class RequestTraceUnavailable extends Error {
    readonly code = "trace-unavailable";

    constructor(readonly reason: "newer-format" | "unreadable", message: string) {
        super(message);
        this.name = "RequestTraceUnavailable";
    }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAYLOAD_LIMIT = 1024 ** 3;
/** 大纲缓存的条数上限：满了整个丢掉重来（大纲按内容不变，重算只是多读一次文件）。 */
const OUTLINE_CACHE = 20_000;

type Settled = Exclude<RequestStatus, "running">;

interface LineBase {
    readonly v: typeof FORMAT_VERSION;
    readonly seq: number;
    readonly id: string;
}

interface StartLine extends LineBase {
    readonly kind: "start";
    readonly at: number;
    readonly session: string;
    readonly request: number;
    readonly hash: string;
    readonly purpose: RequestPurpose;
    readonly model: string;
    readonly effort?: string;
    readonly turn?: RequestRow["turn"];
    readonly modifiedBy?: RequestDetail["modifiedBy"];
    readonly params: Readonly<Record<string, JsonValue>>;
    readonly system: readonly string[];
    readonly messages: readonly string[];
    readonly tools: readonly string[];
    readonly resend?: number;
    readonly toolsChanged: boolean;
    /** 开始时“存原始请求体”关着。 */
    readonly payloadOff?: true;
}

interface AttemptLine extends LineBase, RequestAttempt {
    readonly kind: "attempt";
}

interface EndLine extends LineBase {
    readonly kind: "end";
    readonly at: number;
    readonly status: Settled;
    readonly firstContentAt?: number;
    readonly stopReason?: StopReason;
    readonly usage?: Usage;
    readonly answeredBy?: string;
    readonly error?: RequestRow["error"];
    readonly errorMessage?: string;
    /** 回复（内容块与工具调用）的内容哈希；没有任何内容时没有。 */
    readonly reply?: string;
    /** 存下的原始请求体压缩后的字节数；没存时没有。 */
    readonly payload?: number;
}

interface PrunedLine extends LineBase {
    readonly kind: "pruned";
}

type IndexLine = StartLine | AttemptLine | EndLine | PrunedLine;

interface Entry {
    readonly day: string;
    readonly start: StartLine;
    readonly attempts: AttemptLine[];
    end?: EndLine;
    pruned?: PrunedLine;
    row: RequestRow;
}

const LINE_KINDS = new Set(["start", "attempt", "end", "pruned"]);

function isLine(value: unknown): value is IndexLine {
    const line = value as Partial<LineBase & {kind: string}> | null;
    return typeof line === "object" && line !== null && line.v === FORMAT_VERSION && typeof line.seq === "number" && typeof line.id === "string" && isRecordId(line.id) && typeof line.kind === "string" && LINE_KINDS.has(line.kind);
}

function rowOf(entry: Pick<Entry, "start" | "attempts" | "end">): RequestRow {
    const {start, end, attempts} = entry;
    return {
        id: start.id,
        session: start.session,
        request: start.request,
        hash: start.hash,
        purpose: start.purpose,
        model: start.model,
        effort: start.effort,
        turn: start.turn,
        startedAt: start.at,
        firstContentAt: end?.firstContentAt,
        endedAt: end?.at,
        status: end?.status ?? "running",
        stopReason: end?.stopReason,
        usage: end?.usage,
        answeredBy: end?.answeredBy,
        error: end?.error,
        resend: start.resend,
        toolsChanged: start.toolsChanged,
        http: attempts.at(-1)?.status,
        attempts: attempts.length,
    };
}

function payloadOf(entry: Entry): PayloadState {
    if (entry.start.payloadOff === true) return {state: "disabled"};
    if (entry.pruned !== undefined) return {state: "pruned"};
    if (entry.end?.payload !== undefined) return {state: "present", bytes: entry.end.payload};
    return {state: "unavailable"};
}

function attemptOf(line: AttemptLine): RequestAttempt {
    const {v: _v, seq: _seq, id: _id, kind: _kind, ...attempt} = line;
    return attempt;
}

const STATUS_TESTS: Readonly<Record<NonNullable<RequestQuery["statuses"]>[number], (row: RequestRow) => boolean>> = {
    running: (row) => row.status === "running",
    ok: (row) => row.status === "ok",
    error: (row) => row.status === "error",
    aborted: (row) => row.status === "aborted",
    interrupted: (row) => row.status === "interrupted",
    resend: (row) => row.resend !== undefined,
    "cache-miss": (row) => row.status === "ok" && (row.usage?.cacheRead ?? 0) === 0,
};

const chosen = <T>(values: readonly T[] | undefined): values is readonly T[] => values !== undefined && values.length > 0;

/** 一条是否符合筛选；`except` 是算那一项的筛选候选时不看的那一项。 */
function matches(row: RequestRow, query: RequestQuery, except?: "sessions" | "models"): boolean {
    if (except !== "sessions" && chosen(query.sessions) && !query.sessions.includes(row.session)) return false;
    if (except !== "models" && chosen(query.models) && !query.models.includes(row.model)) return false;
    if (chosen(query.purposes) && !query.purposes.includes(row.purpose)) return false;
    if (chosen(query.statuses) && !query.statuses.some((status) => STATUS_TESTS[status](row))) return false;
    return query.since === undefined || row.startedAt >= query.since;
}

/** 排序键：排序值（没有值的排最后）、开始时间、`start` 的序号，都是大的在前。游标就是上一页最后一条的键。 */
type SortKey = readonly [number | null, number, number];

function sortKey(entry: Entry, sort: NonNullable<RequestQuery["sort"]>): SortKey {
    const row = entry.row;
    const value = sort === "time" ? row.startedAt
        : sort === "duration" ? (row.endedAt === undefined ? null : row.endedAt - row.startedAt)
        : sort === "input" ? (row.usage?.input ?? null)
        : (row.usage?.cost ?? null);
    return [value, row.startedAt, entry.start.seq];
}

/** 负数表示 `a` 排在前面。 */
function compareKeys(a: SortKey, b: SortKey): number {
    if (a[0] !== b[0]) {
        if (a[0] === null) return 1;
        if (b[0] === null) return -1;
        return b[0] - a[0];
    }
    return b[1] - a[1] || b[2] - a[2];
}

const encodeCursor = (key: SortKey): string => Buffer.from(JSON.stringify(key)).toString("base64url");

function decodeCursor(cursor: string): SortKey {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
        parsed = null;
    }
    const valid = Array.isArray(parsed) && parsed.length === 3 && (parsed[0] === null || typeof parsed[0] === "number") && typeof parsed[1] === "number" && typeof parsed[2] === "number";
    // 游标只来自上一页；认不出说明调用方传错了，从头再给一遍会让列表出现重复的行。
    if (!valid) throw new TypeError(`invalid request list cursor: ${cursor}`);
    return parsed as unknown as SortKey;
}

function facet(rows: readonly RequestRow[], pick: (row: RequestRow) => string): {readonly id: string; readonly count: number}[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const id = pick(row);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts].map(([id, count]) => ({id, count})).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface Outlines {
    readonly block: BlockOutline;
    readonly message: MessageOutline;
    readonly reply: MessageOutline;
    readonly tool: ToolOutline;
}

function missingOutline<K extends keyof Outlines>(kind: K, hash: string): Outlines[K] {
    const outline: Outlines[keyof Outlines] = kind === "block" ? {hash, preview: "", tokens: 0, missing: true}
        : kind === "tool" ? {hash, id: "", description: "", missing: true}
        : {hash, role: kind === "reply" ? "assistant" : "user", preview: "", tokens: 0, images: 0, missing: true};
    return outline as Outlines[K];
}

function computeOutline<K extends keyof Outlines>(kind: K, hash: string, value: unknown): Outlines[K] {
    // 内容文件是这个记录器自己按这几种形状写的（`start`、`#settle`）。
    const outline: Outlines[keyof Outlines] = kind === "block" ? blockOutline(hash, value as Parameters<typeof blockOutline>[1])
        : kind === "tool" ? toolOutline(hash, value as Parameters<typeof toolOutline>[1])
        : kind === "reply" ? replyOutline(hash, value as Parameters<typeof replyOutline>[1])
        : messageOutline(hash, value as Parameters<typeof messageOutline>[1]);
    return outline as Outlines[K];
}

export class RequestRecorder {
    readonly #files: RequestFiles;
    readonly #options: RequestRecorderOptions;
    readonly #now: () => number;
    readonly #payloadLimit: number;

    readonly #entries = new Map<string, Entry>();
    /** 存着原始请求体的记录与压缩后的字节数，按写入的先后：超出上限时从头删。 */
    readonly #payloads = new Map<string, number>();
    #payloadTotal = 0;
    /** 每个会话、每种用途最近一次请求：判重发与工具声明变没变。 */
    readonly #last = new Map<string, {readonly hash: string; readonly sends: number; readonly tools: string}>();
    /** 有不认识版本的行的天文件：不显示、不改写、不清理；有它们时也不回收内容（不知道它们引用了什么）。 */
    readonly #foreignDays = new Set<string>();
    /** 哈希字符串只留一份：同一会话的请求一次比一次多几条消息，每条记录都列全部消息的哈希。 */
    #hashes = new Map<string, string>();
    /** 冻结的内容对象（内核的提交缓存跨请求是同一个对象）的哈希：每次请求只序列化新出现的内容。 */
    readonly #contentHashes = new WeakMap<object, string>();
    readonly #outlines = new Map<string, Outlines[keyof Outlines]>();
    readonly #listeners = new Set<(change: RequestChange) => void>();

    #opening: Promise<void> | null = null;
    #unavailable: RequestTraceUnavailable | null = null;
    #closed = false;
    #tail: Promise<void> = Promise.resolve();
    /** 下一行的序号，与已经反映在内存里的最大序号。 */
    #nextSeq = 1;
    #committed = 0;

    constructor(options: RequestRecorderOptions) {
        this.#options = options;
        this.#files = new RequestFiles(options.root);
        this.#now = options.now ?? Date.now;
        this.#payloadLimit = options.payloadLimit ?? DEFAULT_PAYLOAD_LIMIT;
    }

    /** 读目录、把上次没结束的记录记成已中断。只读一次；之后的调用交回同一个 Promise。 */
    open(): Promise<void> {
        this.#opening ??= this.#load();
        return this.#opening;
    }

    /** 这次请求要不要记：设置开着、目录可写、没关。 */
    enabled(): boolean {
        return this.#options.settings().enabled && this.#unavailable === null && !this.#closed;
    }

    onChange(listener: (change: RequestChange) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /**
     * 写好这条记录的开始再交回（Spec“时序与寿命”：记录写好之后请求才发给适配器）。不记或写不进去时交回 null，
     * 调用方照常发请求。
     */
    async start(meta: TracedCallMeta, request: ModelRequest): Promise<RequestHandle | null> {
        // 复制一份：宿主可能交回同一个会变的对象，而这次请求要始终按开始时的设置记。
        const settings = {...this.#options.settings()};
        if (!settings.enabled || this.#closed) return null;
        await this.open();
        if (this.#unavailable !== null) return null;
        const id = randomUUID();
        const at = this.#now();
        try {
            return await this.#enqueue(async () => {
                const [system, messages, tools] = await Promise.all([
                    Promise.all(request.system.map((block) => this.#store(block, () => stripBlocks([block])[0]))),
                    Promise.all(request.messages.map((message) => this.#store(message, () => stripMessage(message)))),
                    Promise.all(request.tools.map((tool) => this.#store(tool, () => tool))),
                ]);
                const key = `${meta.session}\u0000${request.purpose}`;
                const previous = this.#last.get(key);
                const toolsKey = tools.join(",");
                const input = meta.turn?.input;
                const line: StartLine = {
                    v: FORMAT_VERSION,
                    seq: this.#nextSeq++,
                    id,
                    kind: "start",
                    at,
                    session: meta.session,
                    request: meta.request,
                    hash: meta.hash,
                    purpose: request.purpose,
                    model: request.model,
                    ...(request.effort === undefined ? {} : {effort: request.effort}),
                    ...(meta.turn === undefined ? {} : {turn: {id: meta.turn.id, index: meta.turn.index, ...(input === undefined ? {} : {input: previewOf(input)})}}),
                    ...(meta.modifiedBy === undefined || meta.modifiedBy.length === 0 ? {} : {modifiedBy: meta.modifiedBy}),
                    params: paramsOf(request),
                    system,
                    messages,
                    tools,
                    ...(previous?.hash === meta.hash ? {resend: previous.sends + 1} : {}),
                    toolsChanged: previous !== undefined && previous.tools !== toolsKey,
                    ...(settings.payload ? {} : {payloadOff: true as const}),
                };
                const day = dayOf(at);
                await this.#files.appendLine(day, line);
                const entry = this.#applyStart(day, line);
                this.#emit({seq: line.seq, kind: "added", row: entry.row});
                return this.#handle(entry, settings);
            });
        } catch (error) {
            this.#options.report("requests.write-failed", `Could not record a model request: ${errorText(error)}`, {session: meta.session, request: meta.request});
            return null;
        }
    }

    async list(query: RequestQuery = {}): Promise<RequestPage> {
        await this.#ready();
        const sort = query.sort ?? "time";
        const rows = [...this.#entries.values()];
        const filtered = rows.filter((entry) => matches(entry.row, query));
        const keyed = filtered.map((entry) => ({entry, key: sortKey(entry, sort)})).sort((a, b) => compareKeys(a.key, b.key));
        const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
        const from = after === null ? 0 : keyed.findIndex((item) => compareKeys(item.key, after) > 0);
        const limit = Math.min(Math.max(1, query.limit ?? PAGE_SIZE), MAX_PAGE_SIZE);
        const page = from < 0 ? [] : keyed.slice(from, from + limit);
        const last = page.at(-1);
        const more = from >= 0 && from + limit < keyed.length;
        const priced = filtered.flatMap((entry) => {
            const cost = entry.row.usage?.cost;
            return cost === undefined || cost === null ? [] : [cost];
        });
        return {
            rows: page.map((item) => item.entry.row),
            ...(more && last !== undefined ? {next: encodeCursor(last.key)} : {}),
            seq: this.#committed,
            totals: {
                count: filtered.length,
                input: filtered.reduce((sum, entry) => sum + (entry.row.usage?.input ?? 0), 0),
                cacheRead: filtered.reduce((sum, entry) => sum + (entry.row.usage?.cacheRead ?? 0), 0),
                cost: priced.length === 0 ? null : priced.reduce((sum, cost) => sum + cost, 0),
            },
            facets: {
                sessions: facet(rows.filter((entry) => matches(entry.row, query, "sessions")).map((entry) => entry.row), (row) => row.session),
                models: facet(rows.filter((entry) => matches(entry.row, query, "models")).map((entry) => entry.row), (row) => row.model),
            },
        };
    }

    /** 大纲级详情；没有这条记录时交回 null（`request-not-found`）。 */
    async read(id: string): Promise<RequestDetail | null> {
        await this.#ready();
        const entry = this.#entries.get(id);
        if (entry === undefined) return null;
        const {start, end} = entry;
        const [system, messages, tools, reply] = await Promise.all([
            Promise.all(start.system.map((hash) => this.#outline("block", hash))),
            Promise.all(start.messages.map((hash) => this.#outline("message", hash))),
            Promise.all(start.tools.map((hash) => this.#outline("tool", hash))),
            end?.reply === undefined ? undefined : this.#outline("reply", end.reply),
        ]);
        return {
            ...entry.row,
            modifiedBy: start.modifiedBy ?? [],
            params: start.params,
            system,
            messages,
            tools,
            ...(reply === undefined ? {} : {reply}),
            ...(end?.errorMessage === undefined ? {} : {errorMessage: end.errorMessage}),
            attemptList: entry.attempts.map(attemptOf),
            payload: payloadOf(entry),
        };
    }

    /** 一段内容的全文（存下的 JSON 文本，远程层按字节分段交出）；已经清掉时交回 null（`content-not-found`）。 */
    async content(hash: string): Promise<string | null> {
        await this.#ready();
        return this.#files.readBlob(hash);
    }

    /** 会话里第几次请求的记录（“查看这次请求”）；没有记录时交回 null。 */
    async find(session: string, request: number): Promise<RequestRow | null> {
        await this.#ready();
        let found: Entry | null = null;
        for (const entry of this.#entries.values()) {
            if (entry.start.session === session && entry.start.request === request && (found === null || entry.start.seq > found.start.seq)) found = entry;
        }
        return found?.row ?? null;
    }

    /** 原始请求体；没有时交回 null（`payload-not-found`，原因看详情的 `payload`）。 */
    async payload(id: string): Promise<string | null> {
        await this.#ready();
        const entry = this.#entries.get(id);
        if (entry === undefined || payloadOf(entry).state !== "present") return null;
        return this.#files.readPayload(id);
    }

    async usage(): Promise<RequestUsage> {
        await this.#ready();
        return this.#files.usage();
    }

    /** 清空一个会话或全部的记录（进行中的不清），交回清掉了几条。 */
    async clear(options: {readonly session?: string} = {}): Promise<number> {
        await this.#ready();
        return this.#enqueue(async () => {
            const removed = await this.#remove((entry) => options.session === undefined || entry.start.session === options.session);
            // 清掉的会话下一次请求不再和看不见的那一次比重发。
            for (const key of [...this.#last.keys()]) if (options.session === undefined || key.startsWith(`${options.session}\u0000`)) this.#last.delete(key);
            await this.#collect();
            return removed;
        });
    }

    /** 删开始于 `days` 天以前的记录，再按总量上限删原始请求体、回收没有记录引用的文件；交回删了几条记录。 */
    async sweep(days: number): Promise<number> {
        await this.#ready();
        const cutoff = dayOf(this.#now() - Math.max(1, Math.floor(days)) * DAY_MS);
        return this.#enqueue(async () => {
            const removed = await this.#remove((entry) => entry.day < cutoff);
            await this.#enforcePayloadLimit();
            await this.#collect();
            return removed;
        });
    }

    /** 等已排队的写入完成；之后不再记新的请求，进行中的记录结束时也不再写（下次打开记为已中断）。 */
    async close(): Promise<void> {
        this.#closed = true;
        await this.#tail;
    }

    async #load(): Promise<void> {
        try {
            if (!(await this.#files.prepare())) {
                this.#unavailable = new RequestTraceUnavailable("newer-format", "The request trace directory was written by a newer version");
                this.#options.report("requests.unreadable", "The request trace directory was written by a newer version; it is left untouched", {root: this.#files.root});
                return;
            }
            for (const day of await this.#files.days()) {
                let bad = 0;
                const {lines, partial} = await this.#files.readDay(day, () => {
                    bad += 1;
                });
                if (lines.some((line) => (line as {v?: unknown} | null)?.v !== FORMAT_VERSION)) {
                    this.#foreignDays.add(day);
                    this.#options.report("requests.unreadable", "A request trace day file has lines of an unknown version; it is skipped", {day});
                    continue;
                }
                if (partial !== null) await this.#files.repairDay(day, partial);
                for (const line of lines) {
                    if (isLine(line)) this.#apply(day, line);
                    else bad += 1;
                }
                if (bad > 0) this.#options.report("requests.unreadable", "Skipped unreadable request trace lines", {day, lines: bad});
            }
            this.#nextSeq = this.#committed + 1;
            const unfinished = [...this.#entries.values()].filter((entry) => entry.end === undefined);
            await this.#enqueue(async () => {
                for (const entry of unfinished) await this.#writeEnd(entry, this.#now(), {status: "interrupted"});
            });
        } catch (error) {
            this.#unavailable = new RequestTraceUnavailable("unreadable", errorText(error));
            this.#options.report("requests.unreadable", `Could not open the request trace directory: ${errorText(error)}`, {root: this.#files.root});
        }
    }

    async #ready(): Promise<void> {
        await this.open();
        if (this.#unavailable !== null) throw this.#unavailable;
    }

    #enqueue<T>(job: () => Promise<T>): Promise<T> {
        const run = this.#tail.then(job);
        this.#tail = run.then(() => undefined, () => undefined);
        return run;
    }

    /** 内容写盘，交回哈希。`strip` 只在没算过这个对象时调（去图、序列化是热路径上最贵的一步）。 */
    async #store(value: object, strip: () => unknown): Promise<string> {
        const known = this.#contentHashes.get(value);
        if (known !== undefined && this.#files.hasBlob(known)) return known;
        const json = JSON.stringify(strip());
        const hash = this.#intern(sha256(json));
        await this.#files.writeBlob(hash, json);
        // 只记冻结的对象：没冻结的之后还可能被改，按身份记的哈希会过时。
        if (Object.isFrozen(value)) this.#contentHashes.set(value, hash);
        return hash;
    }

    #intern(hash: string): string {
        const known = this.#hashes.get(hash);
        if (known !== undefined) return known;
        this.#hashes.set(hash, hash);
        return hash;
    }

    #applyStart(day: string, line: StartLine): Entry {
        this.#committed = Math.max(this.#committed, line.seq);
        const start: StartLine = {...line, system: line.system.map((hash) => this.#intern(hash)), messages: line.messages.map((hash) => this.#intern(hash)), tools: line.tools.map((hash) => this.#intern(hash))};
        const entry: Entry = {day, start, attempts: [], row: rowOf({start, attempts: []})};
        this.#entries.set(line.id, entry);
        this.#last.set(`${start.session}\u0000${start.purpose}`, {hash: start.hash, sends: start.resend ?? 1, tools: start.tools.join(",")});
        return entry;
    }

    /** 把一行折进内存；交回它所属的记录（找不到 `start` 的行丢掉）。 */
    #apply(day: string, line: IndexLine): Entry | undefined {
        if (line.kind === "start") return this.#applyStart(day, line);
        this.#committed = Math.max(this.#committed, line.seq);
        const entry = this.#entries.get(line.id);
        if (entry === undefined) return undefined;
        if (line.kind === "attempt") entry.attempts.push(line);
        else if (line.kind === "end") {
            entry.end = line;
            if (line.payload !== undefined && entry.pruned === undefined) {
                this.#payloads.set(line.id, line.payload);
                this.#payloadTotal += line.payload;
            }
        } else {
            entry.pruned = line;
            this.#dropPayload(line.id);
        }
        entry.row = rowOf(entry);
        return entry;
    }

    #dropPayload(id: string): void {
        const bytes = this.#payloads.get(id);
        if (bytes === undefined) return;
        this.#payloads.delete(id);
        this.#payloadTotal -= bytes;
    }

    #emit(change: RequestChange): void {
        for (const listener of this.#listeners) {
            try {
                listener(change);
            } catch (error) {
                // 监听方是宿主的远程层；它出错不能让已经写成的记录被报成写入失败。
                this.#options.report("requests.listener-failed", `A request trace listener threw: ${errorText(error)}`);
            }
        }
    }

    #handle(entry: Entry, settings: RequestTraceSettings): RequestHandle {
        const {id} = entry.start;
        const {day} = entry;
        let body: string | null = null;
        let firstContentAt: number | undefined;
        let settled = false;
        const guard = (what: string, job: () => Promise<void>): void => {
            if (this.#closed) return;
            this.#enqueue(job).catch((error: unknown) => {
                this.#options.report("requests.write-failed", `Could not record the ${what} of a model request: ${errorText(error)}`, {id});
            });
        };
        const observer: ModelWireObserver = {
            attempt: (wire: ModelWireAttempt) => {
                // 只存最后一次尝试发出的（Spec 输出 6）：最后一次的体不是字符串时就没有可存的，不退回更早的那次。
                body = wire.body;
                guard("attempt", async () => {
                    const line: AttemptLine = {
                        v: FORMAT_VERSION,
                        seq: this.#nextSeq++,
                        id,
                        kind: "attempt",
                        url: maskUrl(wire.url),
                        startedAt: wire.startedAt,
                        endedAt: wire.endedAt,
                        ...(wire.response === undefined ? {} : {status: wire.response.status, responseHeaders: maskHeaders(wire.response.headers)}),
                        ...(wire.error === undefined ? {} : {error: wire.error}),
                        ...(settings.headers ? {requestHeaders: maskHeaders(wire.headers)} : {}),
                    };
                    await this.#files.appendLine(day, line);
                    this.#apply(day, line);
                });
            },
            payload: (payload: string) => {
                body = payload;
            },
            firstContent: () => {
                firstContentAt ??= this.#now();
            },
        };
        const settle = (outcome: Omit<EndFields, "firstContentAt">, reply?: {readonly content: ModelResponse["content"]; readonly toolCalls: ModelResponse["toolCalls"]}): void => {
            if (settled) return;
            settled = true;
            // 结束时刻取在交回的这一刻：写盘排在队列里，可能晚得多。
            const at = this.#now();
            guard("result", async () => {
                const replyHash = reply === undefined || (reply.content.length === 0 && reply.toolCalls.length === 0)
                    ? undefined
                    : await this.#store(reply, () => ({content: stripBlocks(reply.content), toolCalls: reply.toolCalls}));
                const payload = settings.payload && body !== null ? await this.#writePayload(id, body) : undefined;
                await this.#writeEnd(entry, at, {
                    ...outcome,
                    ...(firstContentAt === undefined ? {} : {firstContentAt}),
                    ...(replyHash === undefined ? {} : {reply: replyHash}),
                    ...(payload === undefined ? {} : {payload}),
                });
                await this.#enforcePayloadLimit();
            });
        };
        return {
            id,
            observer,
            finish: (response) => {
                const status: Settled = response.stopReason === "error" ? "error" : response.stopReason === "aborted" ? "aborted" : "ok";
                const failure = response.error;
                settle({
                    status,
                    stopReason: response.stopReason,
                    usage: response.usage,
                    answeredBy: response.model,
                    ...(failure === undefined ? {} : {
                        error: {kind: failure.kind, ...(failure.code === undefined ? {} : {code: failure.code}), ...(failure.status === undefined ? {} : {status: failure.status})},
                        errorMessage: failure.message,
                    }),
                }, response);
            },
            fail: (error, aborted) => {
                settle(aborted ? {status: "aborted", errorMessage: errorText(error)} : {status: "error", error: {kind: "local"}, errorMessage: errorText(error)});
            },
        };
    }

    /** 请求体写盘，交回压缩后的字节数；写不进去时交回 undefined（记录照写，请求体记为拿不到）。 */
    async #writePayload(id: string, body: string): Promise<number | undefined> {
        try {
            return await this.#files.writePayload(id, stripPayloadImages(body));
        } catch (error) {
            this.#options.report("requests.write-failed", `Could not store the raw request body: ${errorText(error)}`, {id});
            return undefined;
        }
    }

    async #writeEnd(entry: Entry, at: number, fields: EndFields): Promise<void> {
        const line: EndLine = {v: FORMAT_VERSION, seq: this.#nextSeq++, id: entry.start.id, kind: "end", at, ...fields};
        await this.#files.appendLine(entry.day, line);
        this.#apply(entry.day, line);
        this.#emit({seq: line.seq, kind: "settled", row: entry.row});
    }

    /** 原始请求体合计超出上限时从最早存的删起；先写 `pruned` 行再删文件，中途退出只会剩下没人引用的文件（清理时回收）。 */
    async #enforcePayloadLimit(): Promise<void> {
        while (this.#payloadTotal > this.#payloadLimit) {
            const oldest = this.#payloads.keys().next();
            if (oldest.done === true) return;
            const entry = this.#entries.get(oldest.value);
            if (entry === undefined) {
                this.#dropPayload(oldest.value);
                continue;
            }
            const line: PrunedLine = {v: FORMAT_VERSION, seq: this.#nextSeq++, id: oldest.value, kind: "pruned"};
            await this.#files.appendLine(entry.day, line);
            this.#apply(entry.day, line);
            await this.#files.deletePayload(oldest.value);
        }
    }

    /**
     * 删符合条件的已结束记录：先整天重写索引（记录从此不出现），再删它们的请求体。只在队列里调。
     * 有不认识版本的行的天文件不动。
     */
    async #remove(predicate: (entry: Entry) => boolean): Promise<number> {
        const removed = [...this.#entries.values()].filter((entry) => entry.end !== undefined && !this.#foreignDays.has(entry.day) && predicate(entry));
        if (removed.length === 0) return 0;
        const gone = new Set(removed.map((entry) => entry.start.id));
        for (const day of new Set(removed.map((entry) => entry.day))) {
            const kept = [...this.#entries.values()].filter((entry) => entry.day === day && !gone.has(entry.start.id));
            const lines = kept.flatMap((entry): IndexLine[] => [entry.start, ...entry.attempts, ...(entry.end === undefined ? [] : [entry.end]), ...(entry.pruned === undefined ? [] : [entry.pruned])]).sort((a, b) => a.seq - b.seq);
            await this.#files.rewriteDay(day, lines);
        }
        for (const entry of removed) {
            this.#entries.delete(entry.start.id);
            this.#dropPayload(entry.start.id);
        }
        this.#committed = this.#nextSeq++;
        this.#emit({seq: this.#committed, kind: "removed", ids: [...gone]});
        for (const entry of removed) await this.#files.deletePayload(entry.start.id);
        return removed.length;
    }

    /** 回收没有记录引用的内容与请求体文件。有不认识的天文件时不回收内容：不知道它们引用了什么。 */
    async #collect(): Promise<void> {
        await this.#files.collectPayloads(new Set(this.#payloads.keys()));
        if (this.#foreignDays.size > 0) return;
        const referenced = new Set<string>();
        for (const {start, end} of this.#entries.values()) {
            for (const hash of start.system) referenced.add(hash);
            for (const hash of start.messages) referenced.add(hash);
            for (const hash of start.tools) referenced.add(hash);
            if (end?.reply !== undefined) referenced.add(end.reply);
        }
        await this.#files.collectBlobs(referenced);
        this.#hashes = new Map([...referenced].map((hash) => [hash, hash]));
        for (const hash of [...this.#outlines.keys()]) if (!referenced.has(hash.slice(hash.indexOf(":") + 1))) this.#outlines.delete(hash);
    }

    async #outline<K extends keyof Outlines>(kind: K, hash: string): Promise<Outlines[K]> {
        const key = `${kind}:${hash}`;
        const cached = this.#outlines.get(key);
        if (cached !== undefined) return cached as Outlines[K];
        let text: string | null;
        try {
            text = await this.#files.readBlob(hash);
        } catch (error) {
            this.#options.report("requests.unreadable", `Could not read recorded content: ${errorText(error)}`, {hash});
            return missingOutline(kind, hash);
        }
        if (text === null) return missingOutline(kind, hash);
        let outline: Outlines[K];
        try {
            outline = computeOutline(kind, hash, JSON.parse(text));
        } catch (error) {
            this.#options.report("requests.unreadable", `Recorded content is damaged: ${errorText(error)}`, {hash});
            return missingOutline(kind, hash);
        }
        if (this.#outlines.size >= OUTLINE_CACHE) this.#outlines.clear();
        this.#outlines.set(key, outline);
        return outline;
    }
}

type EndFields = Omit<EndLine, keyof LineBase | "kind" | "at">;

/**
 * 请求的参数：采样参数、工具选择、请求自带的头（遮过）与透传给适配器的选项的名字。选项的值不记：它们原样交给服务商，记录器
 * 拿不到配置密钥原值来遮；要看值就看原始请求体（适配器遮过）。
 */
function paramsOf(request: ModelRequest): Record<string, JsonValue> {
    const params: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(request.params)) if (value !== undefined) params[key] = value;
    if (request.toolChoice !== undefined) params.toolChoice = request.toolChoice;
    if (Object.keys(request.headers).length > 0) params.headers = maskHeaders(request.headers);
    if (request.providerOptions !== undefined) params.providerOptions = Object.keys(request.providerOptions);
    return params;
}
