/**
 * `SessionCore`：一个打开的会话的共享对象，持有日志句柄、全部事件、各节点的状态、队列与装配结果。
 * `run/`、`view/`、`session/` 只经它读写。
 *
 * 写入的顺序固定为“先落盘、再归约、再推帧”（session.md 输出 12）：`write` 先在临时状态上给每条事件分配 id、seq、
 * 父节点与位置章，交给存储；存储成功之后才把事件与状态提交进内存、推出 `log` 帧。存储失败时句柄进损坏状态，
 * 这一批不归约、不推帧，之后的写入都得 `LogBrokenError`。`write` 只能在队列的一项里调用。
 *
 * 状态：path 一侧每个节点存一份“这条事件之后”的快照（没变的片共享对象），回退与切分支只换叶子；
 * session 一侧只有当前一份（session 事件线性、不随回退）。
 */

import {randomBytes} from "node:crypto";
import type {Clock, Frame, JsonValue, LogEvent, LogHandle, LogStore, Position, SessionHeader} from "../api/index.js";
import type {Assembly} from "../extension/assemble.js";
import type {StateAt} from "../extension/ctx.js";
import {deepFreeze} from "../state/freeze.js";
import {initialPathKernel, initialSessionKernel, reducePathKernel, reduceSessionKernel, type PathKernelState, type SessionKernelState} from "../state/kernel-state.js";
import {initialSnapshot, reduceSnapshot, type ReduceProblem, type Snapshot} from "../state/snapshot.js";
import type {EventDraft} from "../state/draft.js";
import {Diagnostics} from "./diagnostics.js";

export type {EventDraft};
import {WriteQueue} from "./queue.js";

export interface PathState {
    readonly kernel: PathKernelState;
    readonly extensions: Snapshot;
}
export interface SessionState {
    readonly kernel: SessionKernelState;
    readonly extensions: Snapshot;
}

export class LogBrokenError extends Error {
    constructor(readonly detail: unknown) {
        super("the session log is broken: a write failed earlier");
        this.name = "LogBrokenError";
    }
}

/** 位置章：进行中的轮还没有回复时是附带内容，有了回复就是最后一步之后，没有进行中的轮是“等下一轮”。 */
function positionFor(state: PathKernelState): Position {
    const current = state.history.current;
    if (current === null) return {kind: "next-turn"};
    const last = current.steps.at(-1);
    return last === undefined ? {kind: "attachment", turn: current.id} : {kind: "after-step", turn: current.id, step: last.reply.id};
}
/** 回复与工具结果的位置由轮的结构决定，不盖章。 */
const STRUCTURAL = new Set(["assistant", "toolResult"]);

export interface CoreOptions {
    readonly header: SessionHeader;
    readonly store: LogStore;
    readonly handle: LogHandle;
    readonly assembly: Assembly;
    readonly clock: Clock;
    /** 开发模式：冻结状态与事件，改了就抛错。 */
    readonly freeze: boolean;
}

export class SessionCore {
    readonly header: SessionHeader;
    readonly store: LogStore;
    readonly handle: LogHandle;
    readonly clock: Clock;
    readonly freeze: boolean;
    readonly queue = new WriteQueue();
    readonly diagnostics = new Diagnostics();
    readonly events: LogEvent[] = [];
    readonly byId = new Map<string, LogEvent>();
    /** 受理过的指令：`commandId` → 第一次的结果。由 `commandAccepted` 建，重开时从日志重建。 */
    readonly commands = new Map<string, {name: string; value: JsonValue; seq: number}>();
    assembly: Assembly;
    leaf: string | null = null;
    /** 会话内单调增加的模型请求序号（跨分支不重复）。 */
    requestCounter = 0;
    broken = false;
    /** `mount` 超时或抛错的扩展：不再派发给它，归约照常。 */
    readonly failedExtensions = new Set<string>();
    /** 运行中到达的外部事实：到下一个边界按到达顺序写入（每项一个写入批）。 */
    readonly inbox: EventDraft[][] = [];
    /** 幂等键：`来源\0键`。 */
    readonly #keys = new Set<string>();
    /** 刚写下的这一批里每条事件之后的状态：反应要读“这条事件写入之后”的状态。下一次写入时清空。 */
    #batchStates = new Map<string, StateAt>();
    #pathStates = new Map<string, PathState>();
    #initialPath: PathState;
    #session: SessionState;
    #listeners = new Set<(frame: Frame) => void>();
    #brokenListeners = new Set<() => void>();
    #noticesSeen = 0;

    constructor(options: CoreOptions) {
        this.header = options.header;
        this.store = options.store;
        this.handle = options.handle;
        this.clock = options.clock;
        this.freeze = options.freeze;
        this.assembly = options.assembly;
        this.#initialPath = {kernel: initialPathKernel, extensions: initialSnapshot(options.assembly.reducers, "path", options.freeze)};
        this.#session = {kernel: initialSessionKernel(), extensions: initialSnapshot(options.assembly.reducers, "session", options.freeze)};
        this.diagnostics.subscribe((diagnostic) => this.#emit({type: "diagnostic", diagnostic}));
    }

    get head(): number {
        return this.events.at(-1)?.seq ?? 0;
    }

    get session(): SessionState {
        return this.#session;
    }

    pathState(id: string | null): PathState {
        if (id === null) return this.#initialPath;
        const state = this.#pathStates.get(id);
        if (state === undefined) throw new Error(`no state for node ${id}`);
        return state;
    }

    get leafState(): PathState {
        return this.pathState(this.leaf);
    }

    /** 某个叶子上扩展看到的全部状态。 */
    stateAt(leaf: string | null = this.leaf): StateAt {
        const path = this.pathState(leaf);
        return {path: path.extensions, session: this.#session.extensions, history: path.kernel.history, settings: this.#session.kernel.settings};
    }

    /** 从根到 `leaf` 的路径上的事件。 */
    pathTo(leaf: string | null = this.leaf): LogEvent[] {
        const out: LogEvent[] = [];
        for (let event = leaf === null ? undefined : this.byId.get(leaf); event !== undefined; event = event.parent === null ? undefined : this.byId.get(event.parent)) out.push(event);
        return out.reverse();
    }

    newId(): string {
        for (;;) {
            const id = randomBytes(6).toString("hex");
            if (!this.byId.has(id)) return id;
        }
    }

    // ---------- 归约 ----------

    #reduceProblem = (problem: ReduceProblem): void => {
        const event = problem.event;
        this.diagnostics.add({code: "reduce-threw", extension: problem.extension, entry: "reduce", event: {id: event.id, type: event.type, seq: event.seq}, message: `reduce of ${problem.extension} threw on ${event.type}; the patch is ignored`, cause: problem.error}, event.seq);
    };

    /** 在给定状态上归约一条事件（纯计算，不改内存里的会话）。 */
    #reduce(path: PathState, session: SessionState, event: LogEvent): {path: PathState; session: SessionState} {
        // 扩展事件的版本高于拥有者现在声明的（插件降级后打开新日志）：留在日志里，扩展不归约它（session.md 输出 14）。
        const declared = this.assembly.eventVersions.get(event.type);
        const reducers = declared !== undefined && event.version > declared ? [] : this.assembly.reducers;
        if (reducers.length === 0 && declared !== undefined) {
            this.diagnostics.add({code: "event-version-unsupported", extension: event.source, entry: "reduce", event: {id: event.id, type: event.type, seq: event.seq}, params: {version: event.version, declared}, message: `${event.type} has version ${event.version} but ${event.source} declares ${declared}; the event is not reduced`}, event.seq);
        }
        const options = {freeze: this.freeze, onProblem: this.#reduceProblem};
        if (event.scope === "path") {
            return {path: {kernel: reducePathKernel(path.kernel, event), extensions: reduceSnapshot(reducers, path.extensions, event, "path", options)}, session};
        }
        return {path, session: {kernel: reduceSessionKernel(session.kernel, event), extensions: reduceSnapshot(reducers, session.extensions, event, "session", options)}};
    }

    /** 把一条已经在盘上的事件放进内存：事件表、索引、叶子与状态。 */
    #commit(event: LogEvent, path: PathState, session: SessionState): void {
        this.events.push(event);
        this.byId.set(event.id, event);
        if (event.scope === "path") {
            this.#pathStates.set(event.id, path);
            this.leaf = event.id;
        } else if (event.type === "leafChanged") {
            this.leaf = (event.data as {leaf: string | null}).leaf;
        }
        this.#session = session;
        if (event.type === "commandAccepted") {
            const data = event.data as {commandId: string; name: string; value: JsonValue};
            this.commands.set(data.commandId, {name: data.name, value: data.value, seq: event.seq});
        }
        if (event.key !== undefined) this.#keys.add(`${event.source}\u0000${event.key}`);
        if (event.type === "modelStarted") this.requestCounter = Math.max(this.requestCounter, (event.data as {request: number}).request);
    }

    /** 打开会话时照日志归约，不跑反应。 */
    load(events: readonly LogEvent[]): void {
        for (const event of events) {
            const base = event.scope === "path" ? this.pathState(event.parent) : this.leafState;
            const next = this.#reduce(base, this.#session, event);
            this.#commit(this.freeze ? deepFreeze(event) : event, next.path, next.session);
        }
    }

    // ---------- 写入 ----------

    /**
     * 写一个批。只能在队列的一项里调用。返回写下的事件（带 id 与 seq）。
     * 批里的 path 事件依次接在上一条下面；conv 事件按写入时的轮盖位置章。
     */
    async write(drafts: readonly EventDraft[]): Promise<LogEvent[]> {
        if (this.broken) throw new LogBrokenError(null);
        if (drafts.length === 0) return [];
        let leaf = this.leaf;
        let path = this.leafState;
        let session = this.#session;
        let seq = this.head;
        const at = this.clock.now();
        const staged: {event: LogEvent; path: PathState; session: SessionState}[] = [];
        for (const draft of drafts) {
            seq += 1;
            const event: LogEvent = {
                id: this.newId(),
                seq,
                at,
                parent: draft.scope === "path" ? leaf : null,
                scope: draft.scope,
                kind: draft.kind,
                type: draft.type,
                version: draft.version ?? 1,
                source: draft.source ?? "kernel",
                ...(draft.cause === undefined ? {} : {cause: draft.cause}),
                ...(draft.depth === undefined ? {} : {depth: draft.depth}),
                ...(draft.key === undefined ? {} : {key: draft.key}),
                ...(draft.kind === "conv" && !STRUCTURAL.has(draft.type) ? {position: positionFor(path.kernel)} : {}),
                data: draft.data,
            };
            const next = this.#reduce(path, session, event);
            if (event.scope === "path") leaf = event.id;
            else if (event.type === "leafChanged") {
                leaf = (event.data as {leaf: string | null}).leaf;
                next.path = this.pathState(leaf);
            }
            path = next.path;
            session = next.session;
            staged.push({event, path: next.path, session: next.session});
        }
        const stored = await this.store.append(this.handle, staged.map((item) => item.event));
        this.#drainNotices();
        if (!stored.ok) {
            this.broken = true;
            for (const listener of this.#brokenListeners) listener();
            throw new LogBrokenError(stored);
        }
        this.#batchStates = new Map();
        for (const item of staged) {
            this.#commit(this.freeze ? deepFreeze(item.event) : item.event, item.path, item.session);
            this.#batchStates.set(item.event.id, {path: item.path.extensions, session: item.session.extensions, history: item.path.kernel.history, settings: item.session.kernel.settings});
            this.#emit({type: "log", event: item.event});
        }
        return staged.map((item) => item.event);
    }

    /** 刚写下的那一批里某条事件之后的状态（只在下一次写入之前有效）。 */
    stateAfter(eventId: string): StateAt {
        const state = this.#batchStates.get(eventId);
        if (state === undefined) throw new Error(`no state recorded for ${eventId}; read it right after the write`);
        return state;
    }

    hasKey(source: string, key: string): boolean {
        return this.#keys.has(`${source}\u0000${key}`);
    }

    /** 存储层累积的通知转成诊断。 */
    #drainNotices(): void {
        const notices = this.handle.notices;
        for (; this.#noticesSeen < notices.length; this.#noticesSeen += 1) {
            const notice = notices[this.#noticesSeen]!;
            const params = Object.fromEntries(Object.entries(notice.detail).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1])));
            this.diagnostics.add({code: notice.code, entry: "storage", params, message: `storage: ${notice.code}`}, this.head);
        }
    }

    /** 打开会话之后把存储层在打开时留下的通知报出来。 */
    reportOpenNotices(): void {
        this.#drainNotices();
    }

    // ---------- 帧 ----------

    #emit(frame: Frame): void {
        for (const listener of [...this.#listeners]) listener(frame);
    }

    emit(frame: Frame): void {
        this.#emit(frame);
    }

    subscribe(listener: (frame: Frame) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    onBroken(listener: () => void): () => void {
        this.#brokenListeners.add(listener);
        return () => this.#brokenListeners.delete(listener);
    }
}
