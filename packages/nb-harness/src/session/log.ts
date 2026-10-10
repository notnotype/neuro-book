/**
 * 日志句柄（docs/specs/harness/session.md 输出 1–11、19 与“状态与转换”）。
 *
 * 顺序约定，读 `append` 前先记住：同一句柄的 `append` 与 `repair` 排在一条 Promise 链上依次执行；
 * 一批条目先交存储写入，成功后整批换进 `entries`，再按条目逐个推给订阅者，推完这批 `append` 才 resolve。
 * 推送用的是这批开始时的订阅者快照：监听函数里新加的订阅会自己补发全部条目（含这批），不在快照里，所以不会收到两次；
 * 监听函数里的 `append` 进链尾，自然排在这批推完之后。
 */

import {completeEntry, headerProblem, indexEntry, isValidSessionId, newEntryId, relationProblem, shapeProblem} from "./entries";
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
    readonly header: SessionHeader;
    entries: readonly SessionEntry[];
    damagedTail: {bytes: number} | null;
    private state: LogState;
    private chain: Promise<unknown> = Promise.resolve();
    private subscribers: Subscriber[] = [];
    private lastTimestampMs: number;
    private readonly now: () => Date;
    private readonly context = {ids: new Set<string>(), toolCallsByAssistantEntry: new Map<string, Set<string>>(), interactions: new Map<string, {request: boolean; response: boolean}>()};

    constructor(private readonly store: SessionStore, header: SessionHeader, entries: SessionEntry[], damagedTail: {bytes: number} | null, options: Options) {
        this.header = header;
        this.entries = Object.freeze(entries.map((entry) => deepFreezeEntry(entry)));
        this.damagedTail = damagedTail;
        this.state = damagedTail === null ? "writable" : "damaged-tail";
        this.now = options.now ?? (() => new Date());
        this.lastTimestampMs = entries.length === 0 ? Number.NEGATIVE_INFINITY : Date.parse(entries[entries.length - 1]!.timestamp);
        for (const entry of entries) indexEntry(this.context, entry);
    }

    append(inputs: readonly EntryInput[]): Promise<Result<readonly SessionEntry[]>> {
        return this.enqueue(() => this.appendNow(inputs));
    }

    repair(): Promise<Result<{droppedBytes: number}>> {
        return this.enqueue(async () => {
            const blocked = this.blockedResult<{droppedBytes: number}>();
            if (blocked !== null) return blocked;
            const result = await this.store.repair(this.header.id);
            if (!result.ok) return result;
            this.damagedTail = null;
            this.state = "writable";
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
            if (this.closed) return {release};
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

        const written = await this.store.append(this.header.id, completed);
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
            subscriber.listener({seq, entry});
        } catch {
            this.end(subscriber, "listener-error");
        }
    }

    private end(subscriber: Subscriber, reason: LogEndReason): void {
        if (!subscriber.active) return;
        subscriber.active = false;
        this.subscribers = this.subscribers.filter((item) => item !== subscriber);
        subscriber.onEnd?.(reason);
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
    return {ok: true, value: new Log(store, opened.value.header, opened.value.entries, opened.value.damagedTail, options)};
}
