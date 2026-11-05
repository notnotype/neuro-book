/**
 * 会话的句柄表（docs/specs/agent/sessions.md 输出 5、6、14 与“状态与转换”）：同一会话同时到达的打开得到同一个打开的
 * 会话；没有引用、没有运行 30 秒后关闭；停止时关门、等进行中的打开、把打开着的会话按 `interrupted` 关闭。
 *
 * 交给调用方的都是视图（`view`）：视图本身不持引用，每次调用时向表里取会话、执行期间持一个引用。所以调用方可以长期
 * 拿着视图，会话照样能空闲关闭，下次调用时重新打开。订阅在取消前、`waitRun` 在完成前持引用。
 *
 * 一条记录只在这里改状态；每次状态检查都在同一个同步段里做完（JavaScript 单线程），不会两次碰会话锁。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {commandErrors} from "@notnotype/nb-harness/kernel/contracts";
import type {AgentHost, CreateSessionOptions, Frame, Issuer, SessionApi, StorageResult} from "@notnotype/nb-harness/kernel/contracts";

/** 空闲多久关闭（sessions.md 输出 6）。 */
export const IDLE_CLOSE_MS = 30_000;

/** 查询类方法打开会话失败时抛它（指令类交回 `{ok: false, code}`）。 */
export class AgentSessionUnavailable extends Error {
    constructor(readonly code: string, readonly sessionId: string) {
        super(`session ${sessionId} is not available: ${code}`);
        this.name = "AgentSessionUnavailable";
    }
}

/** 服务停止后的调用（sessions.md 输出 14）。 */
export class AgentStopping extends Error {
    readonly code = "unavailable";
    constructor() {
        super("nbook.agent is stopping");
        this.name = "AgentStopping";
    }
}

type OpenFailure = {readonly ok: false; readonly code: string; readonly detail?: unknown};

interface Entry {
    readonly id: string;
    state: "opening" | "open" | "closing";
    session: SessionApi | null;
    /** 后台会话不算“正在运行”（sessions.md 的 `running()`）。 */
    background: boolean;
    /** 运行中还是在等用户；活动条目读它（sessions.md 输出 15）。 */
    waiting: boolean;
    /** 打开的结果：同时到达的请求等同一个。 */
    ready: Promise<{readonly ok: true} | OpenFailure>;
    refs: number;
    idle: boolean;
    cancelIdle: (() => void) | null;
    stopWatching: (() => void) | null;
    closed: Promise<void> | null;
}

const COMMANDS = Object.keys(commandErrors) as (keyof typeof commandErrors)[];
const QUERIES = ["snapshot", "log", "rewindTargets", "path", "siblings", "runResult", "preview", "diagnostics"] as const;

export interface SessionTableOptions {
    readonly host: AgentHost;
    readonly clock: RuntimeClock;
    /** 建会话或打开会话之前调：激活扩展的提供方（contributions.md 输出 2）。 */
    readonly beforeOpen: () => Promise<void>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class SessionTable {
    readonly #activityListeners = new Set<() => void>();
    readonly #entries = new Map<string, Entry>();
    /** 已接纳、还没登记进表的操作（建会话与它之后的初始设置）：停止要等它们登记完再关。 */
    readonly #accepted = new Set<Promise<unknown>>();
    #stopping = false;

    constructor(private readonly options: SessionTableOptions) {}

    get stopping(): boolean {
        return this.#stopping;
    }

    /**
     * 把一次已接纳的操作登记成在途，停止等它结束（sessions.md 输出 14：等已接纳的建会话登记完）。关门之后不再接纳。
     * `run` 里建出的会话照常登记进表，停止随后把它关掉。
     */
    accept<T>(run: () => Promise<T>): Promise<T> {
        if (this.#stopping) return Promise.reject(new AgentStopping());
        const work = run();
        this.#accepted.add(work);
        void work.then(() => undefined, () => undefined).finally(() => this.#accepted.delete(work));
        return work;
    }

    /** 建会话：完成后直接是打开的（sessions.md 输出 5）。调用方经 `accept` 调它，停止才等得到。 */
    async create(options: CreateSessionOptions): Promise<Awaited<ReturnType<AgentHost["create"]>>> {
        this.#gate();
        await this.options.beforeOpen();
        const created = await this.options.host.create(options);
        if (!created.ok) return created;
        const session = created.value;
        // 停止在建会话期间开始：照样登记，停止等这次建会话结束后关掉它。
        const entry: Entry = {id: session.id, state: "open", session, background: options.background === true, waiting: false, ready: Promise.resolve({ok: true}), refs: 0, idle: true, cancelIdle: null, stopWatching: null, closed: null};
        this.#entries.set(session.id, entry);
        this.#watch(entry, session);
        this.#maybeIdle(entry);
        return created;
    }

    /** 某个会话的视图（`sessions.get`、`agentKey`、远程层都用它）。 */
    view(id: string, issuer: Issuer = {kind: "user"}): SessionApi {
        const table = this;
        const api: Record<string, unknown> = {
            id,
            issuer,
            as: (next: Issuer) => table.view(id, next),
            subscribe: (listener: (frame: Frame) => void) => table.#subscribe(id, issuer, listener),
            waitRun: (runId: string) => table.#use(id, (session) => session.waitRun(runId), "query"),
        };
        for (const name of COMMANDS) api[name] = (args: unknown) => table.#use(id, (session) => (session.as(issuer)[name] as (args: unknown) => Promise<unknown>)(args), "command");
        for (const name of QUERIES) api[name] = (args?: unknown) => table.#use(id, (session) => (session.as(issuer)[name] as (args?: unknown) => Promise<unknown>)(args), "query");
        return api as unknown as SessionApi;
    }

    /** 运行中与等用户的前台会话（sessions.md 输出 15）。只看打开着的：同步等待不会被空闲关闭，所以打开着的表就够。 */
    activity(): {id: string; state: "running" | "waiting"}[] {
        return [...this.#entries.values()].filter((entry) => entry.state === "open" && !entry.idle && !entry.background).map((entry) => ({id: entry.id, state: entry.waiting ? "waiting" : "running"}));
    }

    onActivityChanged(listener: () => void): () => void {
        this.#activityListeners.add(listener);
        return () => this.#activityListeners.delete(listener);
    }

    #activityChanged(): void {
        for (const listener of this.#activityListeners) listener();
    }

    /** 打开着、正在运行的前台会话（以后禁用前的确认用）。 */
    running(): string[] {
        return [...this.#entries.values()].filter((entry) => entry.state === "open" && !entry.idle && !entry.background).map((entry) => entry.id);
    }

    /**
     * 停止（sessions.md 输出 14 的第 1、3 步）：关门；等进行中的打开登记完；把打开着的会话按 `interrupted` 关闭。某个
     * 会话关闭失败写诊断、照常关其余的。
     */
    async stop(): Promise<void> {
        this.closeGate();
        await Promise.allSettled([...this.#accepted]);
        const entries = [...this.#entries.values()];
        await Promise.all(entries.map(async (entry) => {
            if (entry.state === "opening") await entry.ready;
            if (entry.state === "open") await this.#close(entry, "interrupted");
            else if (entry.closed !== null) await entry.closed;
        }));
    }

    /** 停止的第 1 步：之后的调用都得 `unavailable`，同步生效。 */
    closeGate(): void {
        this.#stopping = true;
    }

    /** 服务的每个入口先过它：停止之后抛码为 `unavailable` 的错误（sessions.md“输入与前置条件”）。 */
    gate(): void {
        this.#gate();
    }

    /**
     * 远程订阅用：等会话真的打开、内核订阅接上再交回；打不开时交回失败码，调用方据此让订阅失败，不会“订阅成功却永远没有帧”。
     * 交回的 `release` 取消内核订阅、放掉引用。
     */
    async subscribeOpened(id: string, issuer: Issuer, listener: (frame: Frame) => void): Promise<{readonly ok: true; release(): void} | OpenFailure> {
        const acquired = await this.#acquire(id);
        if (!acquired.ok) return acquired;
        const unsubscribe = acquired.session.as(issuer).subscribe(listener);
        let released = false;
        return {ok: true, release: () => {
            if (released) return;
            released = true;
            unsubscribe();
            this.#release(acquired.entry);
        }};
    }

    #gate(): void {
        if (this.#stopping) throw new AgentStopping();
    }

    async #use<T>(id: string, run: (session: SessionApi) => Promise<T>, kind: "command" | "query"): Promise<T> {
        const acquired = await this.#acquire(id);
        if (!acquired.ok) {
            if (kind === "command") return {ok: false, code: acquired.code, ...(acquired.detail === undefined ? {} : {detail: acquired.detail})} as T;
            throw new AgentSessionUnavailable(acquired.code, id);
        }
        try {
            return await run(acquired.session);
        } finally {
            this.#release(acquired.entry);
        }
    }

    /** 取会话并持一个引用；会话正在关闭时等它关完再重新打开。 */
    async #acquire(id: string): Promise<{readonly ok: true; readonly entry: Entry; readonly session: SessionApi} | OpenFailure> {
        for (;;) {
            this.#gate();
            let entry = this.#entries.get(id);
            if (entry?.state === "closing") {
                await entry.closed;
                continue;
            }
            if (entry === undefined) {
                entry = {id, state: "opening", session: null, background: false, waiting: false, ready: Promise.resolve({ok: true}), refs: 0, idle: true, cancelIdle: null, stopWatching: null, closed: null};
                entry.ready = this.#open(entry);
                this.#entries.set(id, entry);
            }
            entry.refs += 1;
            entry.cancelIdle?.();
            entry.cancelIdle = null;
            const ready = await entry.ready;
            if (!ready.ok) {
                entry.refs -= 1;
                return ready;
            }
            if (entry.state !== "open" || entry.session === null) {
                // 打开成功后、轮到这里之前它已被停止关掉。
                entry.refs -= 1;
                this.#gate();
                continue;
            }
            return {ok: true, entry, session: entry.session};
        }
    }

    async #open(entry: Entry): Promise<{readonly ok: true} | OpenFailure> {
        try {
            await this.options.beforeOpen();
            const opened: StorageResult<SessionApi> = await this.options.host.open(entry.id);
            if (!opened.ok) {
                this.#entries.delete(entry.id);
                return {ok: false, code: opened.code, ...(opened.detail === undefined ? {} : {detail: opened.detail})};
            }
            entry.background = (await opened.value.snapshot()).header.background === true;
            entry.session = opened.value;
            entry.state = "open";
            this.#watch(entry, opened.value);
            return {ok: true};
        } catch (error) {
            this.#entries.delete(entry.id);
            this.options.report("session-open-failed", `opening session ${entry.id} threw`, {session: entry.id, message: error instanceof Error ? error.message : String(error)});
            return {ok: false, code: "open-failed"};
        }
    }

    /** 跟着运行状态：运行结束（回到空闲）时看能不能开始空闲计时。 */
    #watch(entry: Entry, session: SessionApi): void {
        entry.stopWatching = session.subscribe((frame) => {
            if (frame.type !== "status") return;
            const wasWaiting = entry.waiting;
            const wasIdle = entry.idle;
            entry.idle = frame.status.state === "idle" || frame.status.state === "broken";
            entry.waiting = frame.status.state === "waiting";
            if (entry.idle !== wasIdle || entry.waiting !== wasWaiting) this.#activityChanged();
            if (entry.idle) this.#maybeIdle(entry);
            else {
                entry.cancelIdle?.();
                entry.cancelIdle = null;
            }
        });
    }

    #release(entry: Entry): void {
        entry.refs -= 1;
        this.#maybeIdle(entry);
    }

    #maybeIdle(entry: Entry): void {
        if (entry.state !== "open" || entry.refs > 0 || !entry.idle || entry.cancelIdle !== null || this.#stopping) return;
        entry.cancelIdle = this.options.clock.schedule(() => {
            entry.cancelIdle = null;
            // 到点时在同一个同步段里复查：这期间来了引用或开始了运行就不关。
            if (entry.state === "open" && entry.refs === 0 && entry.idle && !this.#stopping) void this.#close(entry);
        }, IDLE_CLOSE_MS);
    }

    #close(entry: Entry, reason?: "interrupted"): Promise<void> {
        if (entry.closed !== null) return entry.closed;
        entry.state = "closing";
        entry.cancelIdle?.();
        entry.cancelIdle = null;
        entry.stopWatching?.();
        entry.stopWatching = null;
        entry.closed = (async () => {
            try {
                await this.options.host.close(entry.id, reason === undefined ? undefined : {reason});
            } catch (error) {
                this.options.report("session-close-failed", `closing session ${entry.id} threw`, {session: entry.id, message: error instanceof Error ? error.message : String(error)});
            } finally {
                if (this.#entries.get(entry.id) === entry) this.#entries.delete(entry.id);
                entry.session = null;
                this.#activityChanged();
            }
        })();
        return entry.closed;
    }

    /** 订阅持一个引用直到取消；会话打开之前写下的帧不补，调用方用 `log` 补（sessions.md 输出 8）。 */
    #subscribe(id: string, issuer: Issuer, listener: (frame: Frame) => void): () => void {
        let cancelled = false;
        let unsubscribe: (() => void) | null = null;
        let held: Entry | null = null;
        void this.#acquire(id).then((acquired) => {
            if (!acquired.ok) {
                // 同进程的订阅是同步接口，没处交回失败：写诊断；远程层用 `subscribeOpened`，失败会交给调用方。
                this.options.report("session-subscribe-failed", `subscribing to session ${id} failed: ${acquired.code}`, {session: id, code: acquired.code});
                return;
            }
            if (cancelled) {
                this.#release(acquired.entry);
                return;
            }
            held = acquired.entry;
            unsubscribe = acquired.session.as(issuer).subscribe(listener);
        }, (error: unknown) => {
            if (!(error instanceof AgentStopping)) this.options.report("session-subscribe-failed", `subscribing to session ${id} threw`, {session: id, message: error instanceof Error ? error.message : String(error)});
        });
        return () => {
            if (cancelled) return;
            cancelled = true;
            unsubscribe?.();
            if (held !== null) this.#release(held);
        };
    }
}
