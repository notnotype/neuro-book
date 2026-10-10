/**
 * 日志句柄（docs/specs/harness/session.md 输出 1–11、19 与“状态与转换”）。
 *
 * 顺序约定，读 `append` 前先记住：同一句柄的 `append` 与 `repair` 排在一条 Promise 链上依次执行；
 * 一批条目先交存储写入，成功后整批换进 `entries`，再按条目逐个推给订阅者，推完这批 `append` 才 resolve。
 * 推送用的是这批开始时的订阅者快照：监听函数里新加的订阅会自己补发全部条目（含这批），不在快照里，所以不会收到两次；
 * 监听函数里的 `append` 进链尾，自然排在这批推完之后。
 *
 * `close` 不进链、立即生效：已经交给存储的 `append`、`repair` 照常完成，完成后条目仍进入 `entries`（数据已落盘，不能当作没写）、
 * 返回成功，只是没有订阅者可推；`repair` 不会把已关闭的句柄改回可写。关闭后再调用的操作才是 `log-closed`。
 */

import {completeEntry, deepFreeze, headerProblem, indexEntry, isValidSessionId, newEntryId, relationProblem, sequenceProblem, shapeProblem} from "./entries";
import type {EntryInput, LogEndReason, Result, SessionEntry, SessionHeader, SessionLog, SessionStore} from "./types";

type LogState = "writable" | "damaged-tail" | "broken" | "closed";

interface Subscriber {
    listener: (event: {seq: number; entry: SessionEntry}) => void;
    onEnd?: (reason: LogEndReason) => void;
    active: boolean;
}

interface Options {
    now?: () => Date;
}

class Log implements SessionLog {
    readonly header: Readonly<SessionHeader>;
    /** 存储操作一律用这个 id：公开的 header 已冻结，但身份不该依赖调用方拿到的对象。 */
    private readonly id: string;
    entries: readonly SessionEntry[];
    damagedTail: {bytes: number} | null;
    private state: LogState;
    private chain: Promise<unknown> = Promise.resolve();
    private subscribers: Subscriber[] = [];
    private lastTimestampMs: number;
    private readonly now: () => Date;
    private readonly context = {ids: new Set<string>(), toolCallsByAssistantEntry: new Map<string, Set<string>>(), interactions: new Map<string, {request: boolean; response: boolean}>()};

    constructor(private readonly store: SessionStore, header: SessionHeader, entries: SessionEntry[], damagedTail: {bytes: number} | null, options: Options) {
        this.header = deepFreeze(structuredClone(header));
        this.id = header.id;
        this.entries = Object.freeze(entries.map((entry) => deepFreezeEntry(entry)));
        this.damagedTail = damagedTail;
        this.state = damagedTail === null ? "writable" : "damaged-tail";
        this.now = options.now ?? (() => new Date());
        this.lastTimestampMs = entries.length === 0 ? Number.NEGATIVE_INFINITY : Date.parse(entries[entries.length - 1]!.timestamp);
        for (const entry of entries) indexEntry(this.context, entry);
    }

    append(inputs: readonly EntryInput[]): Promise<Result<readonly SessionEntry[]>> {
        // 入队时就取副本：排队期间调用方再改传入的对象，不能改变将要落盘的内容。不能克隆的值（函数等）原样传下去，由校验报出。
        const snapshot = inputs.map((input) => {
            try {
                return structuredClone(input);
            } catch {
                return input;
            }
        });
        return this.enqueue(() => this.appendNow(snapshot));
    }

    repair(): Promise<Result<{droppedBytes: number}>> {
        return this.enqueue(async () => {
            const blocked = this.blockedResult<{droppedBytes: number}>();
            if (blocked !== null) return blocked;
            const result = await this.store.repair(this.id);
            if (!result.ok) return result;
            this.damagedTail = null;
            // 等待存储期间可能被 close 或因并行的失败变成 broken；文件修好了，句柄的状态不回退。
            if (this.state === "damaged-tail") this.state = "writable";
            return result;
        });
    }

    subscribe(listener: Subscriber["listener"], options: {afterSeq?: number; onEnd?(reason: LogEndReason): void} = {}): {release(): void} {
        const subscriber: Subscriber = {listener, active: true, ...(options.onEnd === undefined ? {} : {onEnd: options.onEnd})};
        if (this.state === "closed" || this.state === "broken") {
            this.end(subscriber, this.state);
            return {release: () => undefined};
        }
        const release = (): void => {
            subscriber.active = false;
        };
        // 补发与推送走同一条路径，监听函数抛错、补发中 release 的处理才一致（输出 9.1、9.6）。
        const snapshot = this.entries;
        for (let seq = (options.afterSeq ?? 0) + 1; seq <= snapshot.length && subscriber.active; seq += 1) {
            this.deliver(subscriber, seq, snapshot[seq - 1]!);
            if (this.closed) break;
        }
        // 补发途中监听函数 close 了日志：这个订阅还没登记，endAll 轮不到它，这里补上它的结束通知（输出 9.4 的“所有订阅”）。
        const terminal = this.terminal;
        if (terminal !== null) {
            this.end(subscriber, terminal);
            return {release};
        }
        if (subscriber.active) this.subscribers.push(subscriber);
        return {release};
    }

    close(): void {
        if (this.state === "closed") return;
        this.state = "closed";
        this.endAll("closed");
    }

    /** 监听函数可以在推送途中同步 `close()`；经 getter 读状态，TypeScript 才不会把前面检查过的状态当成不变。 */
    private get closed(): boolean {
        return this.state === "closed";
    }

    private get terminal(): "closed" | "broken" | null {
        return this.state === "closed" || this.state === "broken" ? this.state : null;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.chain.then(task, task);
        this.chain = run.then(() => undefined, () => undefined);
        return run;
    }

    private blockedResult<T>(): Result<T> | null {
        if (this.state === "closed") return {ok: false, code: "log-closed", detail: "句柄已关闭"};
        if (this.state === "broken") return {ok: false, code: "log-broken", detail: "句柄已因写入失败损坏，请重新打开会话"};
        return null;
    }

    private async appendNow(inputs: readonly EntryInput[]): Promise<Result<readonly SessionEntry[]>> {
        const blocked = this.blockedResult<readonly SessionEntry[]>();
        if (blocked !== null) return blocked;
        if (this.state === "damaged-tail") return {ok: false, code: "damaged-tail", detail: `文件末尾有 ${this.damagedTail?.bytes ?? 0} 字节的中断尾，先 repair`};
        if (inputs.length === 0) return {ok: true, value: []};

        // 校验要看“这批之前的条目 + 这批前面的输入”，所以在上下文的副本上边补全边登记；整批失败时丢掉副本。
        const context = {
            ids: new Set(this.context.ids),
            toolCallsByAssistantEntry: new Map(this.context.toolCallsByAssistantEntry),
            interactions: new Map(this.context.interactions),
        };
        const completed: SessionEntry[] = [];
        let parentId = this.entries.length === 0 ? null : this.entries[this.entries.length - 1]!.id;
        let lastMs = this.lastTimestampMs;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index]!;
            const problem = shapeProblem(input) ?? relationProblem(input, context);
            if (problem !== null) return {ok: false, code: "invalid-entry", detail: problem, index};
            const nowMs = this.now().getTime();
            lastMs = Number.isFinite(nowMs) && nowMs >= lastMs ? nowMs : lastMs === Number.NEGATIVE_INFINITY ? nowMs : lastMs;
            const id = newEntryId(context.ids);
            const entry = completeEntry(input, {id, parentId, timestamp: new Date(lastMs).toISOString()});
            indexEntry(context, entry);
            completed.push(entry);
            parentId = id;
        }

        const written = await this.store.append(this.id, completed);
        if (!written.ok) {
            this.state = "broken";
            this.endAll("broken");
            return {ok: false, code: "store-failed", detail: written.detail};
        }

        this.entries = Object.freeze([...this.entries, ...completed]);
        this.lastTimestampMs = lastMs;
        for (const entry of completed) indexEntry(this.context, entry);
        const firstSeq = this.entries.length - completed.length + 1;
        const audience = [...this.subscribers];
        for (let offset = 0; offset < completed.length && !this.closed; offset += 1) {
            for (const subscriber of audience) {
                if (!subscriber.active) continue;
                this.deliver(subscriber, firstSeq + offset, completed[offset]!);
                if (this.closed) break;
            }
        }
        return {ok: true, value: completed};
    }

    private deliver(subscriber: Subscriber, seq: number, entry: SessionEntry): void {
        try {
            const returned: unknown = subscriber.listener({seq, entry});
            // 监听函数按合同是同步的；调用方传了 async 函数时，它的 rejection 没人接会变成进程级的未处理拒绝，这里接住并照样结束订阅。
            if (typeof returned === "object" && returned !== null && typeof (returned as PromiseLike<unknown>).then === "function") {
                (returned as PromiseLike<unknown>).then(undefined, () => this.end(subscriber, "listener-error"));
            }
        } catch {
            this.end(subscriber, "listener-error");
        }
    }

    private end(subscriber: Subscriber, reason: LogEndReason): void {
        if (!subscriber.active) return;
        subscriber.active = false;
        this.subscribers = this.subscribers.filter((item) => item !== subscriber);
        try {
            const returned: unknown = subscriber.onEnd?.(reason);
            // onEnd 是订阅者自己的收尾；它抛错（同步或 async 的 rejection）不能让 close 或 append 中途失败，也不能挡住其它订阅的结束通知。
            if (typeof returned === "object" && returned !== null && typeof (returned as PromiseLike<unknown>).then === "function") {
                (returned as PromiseLike<unknown>).then(undefined, () => undefined);
            }
        } catch {
            // 同上。
        }
    }

    private endAll(reason: LogEndReason): void {
        for (const subscriber of [...this.subscribers]) this.end(subscriber, reason);
    }
}

function deepFreezeEntry(entry: SessionEntry): SessionEntry {
    return completeEntry(entry, {id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp});
}

export async function createSession(
    store: SessionStore,
    options: {id?: string; parentSession?: string; now?: () => Date} = {},
): Promise<Result<SessionLog>> {
    const id = options.id ?? crypto.randomUUID();
    if (!isValidSessionId(id)) return {ok: false, code: "invalid-session-id", detail: `会话 id 不合规则：${id}`};
    const now = options.now ?? (() => new Date());
    const header: SessionHeader = {type: "session", version: 1, id, createdAt: now().toISOString(), ...(options.parentSession === undefined ? {} : {parentSession: options.parentSession})};
    const created = await store.create(header);
    if (!created.ok) return created;
    return {ok: true, value: new Log(store, header, [], null, {now})};
}

export async function openSession(store: SessionStore, id: string, options: {now?: () => Date} = {}): Promise<Result<SessionLog>> {
    if (!isValidSessionId(id)) return {ok: false, code: "invalid-session-id", detail: `会话 id 不合规则：${id}`};
    const opened = await store.open(id);
    if (!opened.ok) return opened;
    const problem = headerProblem(opened.value.header);
    if (problem !== null) return {ok: false, code: "corrupt-session", detail: `会话头无效：${problem}`, line: 1};
    if (opened.value.header.id !== id) return {ok: false, code: "corrupt-session", detail: `会话头的 id 是 ${opened.value.header.id}，不是 ${id}`, line: 1};
    // 存储接口允许使用方自己实现，读回的序列在这里再查一遍（JSONL 存储自己也查，为的是给出行号）。
    const sequence = sequenceProblem(opened.value.entries);
    if (sequence !== null) return {ok: false, code: "corrupt-session", detail: `第 ${sequence.index + 1} 个条目与前面的不一致：${sequence.problem}`, index: sequence.index};
    return {ok: true, value: new Log(store, opened.value.header, opened.value.entries, opened.value.damagedTail, options)};
}
