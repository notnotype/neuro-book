/**
 * 后台任务的清单与规则（docs/specs/workbench/background-tasks.md）：纯逻辑，时钟、id 与诊断由入口注入。
 *
 * 归属：每件任务记下登记它的调用方身份。按调用方门面的工厂与释放回调收到的是同一个冻结的 `ConsumerIdentity` 对象，所以
 * 按引用比就能找到发起方名下的任务。发起方释放后它的 `retry` 属于已停止的那一代，调用必然失败，所以连同已结束的记录一起去掉
 * （输出 5）。
 *
 * 进了清单的每一项都要过远程合同的 schema：远程节点逐份校验推送，整份清单里一件不合格就会让全部窗口收不到推送，所以文字在
 * 登记与更新的入口处校验、截短（“输入与前置条件”）。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {Value} from "typebox/value";

import type {Text} from "@notnotype/nb-ui/text";

import {TextSchema} from "nbook/shared/text";

import type {BackgroundTasks, TaskDetail, TaskFailure, TaskHandle, TaskInput, TaskItem, TaskState} from "../shared/contracts";

/** 结束的任务至多留几件（输出 8）。 */
export const MAX_FINISHED = 50;
const TITLE_MAX = 200;
const MESSAGE_MAX = 500;
/** 文字引用与语言映射序列化后的上限（UTF-8 字节）。 */
const STRUCTURED_TEXT_MAX_BYTES = 1024;
/** 同通知的详情（docs/specs/workbench/notifications.md 输入）。 */
const DETAIL_MAX = 8000;
/** 整份清单序列化后的上限：远程单条消息 1 MiB，留出信封与别的推送的余量（同 Agent 的 `treeChanged`）。 */
export const LIST_MAX_BYTES = 512 * 1024;

export type TasksDiagnostic = (event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;

export interface TasksCoreOptions {
    readonly clock: RuntimeClock;
    readonly newId: () => string;
    readonly report: TasksDiagnostic;
}

type Failure<Code extends string> = {readonly ok: false; readonly code: Code; readonly detail: string};
type Outcome<T, Code extends string> = {readonly ok: true; readonly value: T} | Failure<Code>;

export interface TasksCore {
    facade(consumer: ConsumerIdentity): BackgroundTasks;
    /** 发起方入口停止：它名下在跑的转为已中断，全部记录不再能重试（输出 5）。 */
    release(consumer: ConsumerIdentity): void;
    list(): TaskItem[];
    detail(id: string): Outcome<TaskDetail | null, "unknown-task">;
    cancel(id: string): Outcome<null, "unknown-task" | "not-cancellable" | "not-running">;
    retry(id: string): Outcome<null, "unknown-task" | "not-retryable">;
    remove(id: string): Outcome<null, "unknown-task" | "running">;
    clearFinished(): number;
    /** 清单有任何变化时调用；返回的函数退订。 */
    onChanged(listener: () => void): () => void;
    /** 入口停止：abort 在跑任务的 `signal` 再清空，不推送（整体关停时订阅已先结束，Spec“时序与寿命”）。 */
    close(): void;
}

interface TaskRecord {
    readonly id: string;
    readonly owner: ConsumerIdentity;
    /** 发起方释放后为 true：句柄作废。 */
    released: boolean;
    readonly controller: AbortController;
    readonly cancellable: boolean;
    /** 发起方释放时清掉：之后不能重试，也不再留着已停止那一代的闭包。 */
    retry: (() => void | Promise<void>) | undefined;
    title: Text;
    message: Text | null;
    state: TaskState;
    progress: number | null;
    cancelRequested: boolean;
    detail: TaskDetail | null;
    readonly startedAt: number;
    endedAt: number | null;
}

/** 截到 `max` 个码元，不切开代理对。 */
function truncate(text: string, max: number): {readonly text: string; readonly truncated: boolean} {
    if (text.length <= max) return {text, truncated: false};
    let end = max;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return {text: text.slice(0, end), truncated: true};
}

const utf8 = new TextEncoder();

/** 校验并归一一个文字值；不合格时交回原因。 */
function normalizeText(value: unknown, max: number): {readonly ok: true; readonly text: Text} | {readonly ok: false; readonly reason: string} {
    if (!Value.Check(TextSchema, value)) return {ok: false, reason: "not a text value"};
    if (typeof value === "string") return {ok: true, text: truncate(value, max).text};
    // 语言映射的键是语言标签，不会是 `kind`（四个字母的主标签不合法），所以有 `kind: "text"` 的就是文字引用。
    const reference = value as {readonly kind?: unknown; readonly ns?: unknown};
    if (reference.kind === "text" && reference.ns === undefined) return {ok: false, reason: "a text reference must carry its namespace"};
    if (utf8.encode(JSON.stringify(value)).length > STRUCTURED_TEXT_MAX_BYTES) return {ok: false, reason: `a structured text value is over ${STRUCTURED_TEXT_MAX_BYTES} bytes`};
    return {ok: true, text: value};
}

function normalizeProgress(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value)) return null;
    return Math.min(100, Math.max(0, value));
}

function normalizeDetail(value: string | undefined): TaskDetail | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (trimmed === "") return null;
    return truncate(trimmed, DETAIL_MAX);
}

export function createTasksCore(options: TasksCoreOptions): TasksCore {
    const {clock, report} = options;
    /** 在跑的按登记顺序，结束的按结束顺序（最早的在前，超过上限时先丢）。 */
    const running = new Map<string, TaskRecord>();
    const finished: TaskRecord[] = [];
    const listeners = new Set<() => void>();
    let closed = false;

    const changed = (): void => {
        for (const listener of [...listeners]) listener();
    };

    const find = (id: string): TaskRecord | undefined => running.get(id) ?? finished.find((record) => record.id === id);

    const itemOf = (record: TaskRecord): TaskItem => ({
        id: record.id,
        title: record.title,
        message: record.message,
        state: record.state,
        progress: record.state === "running" ? record.progress : null,
        cancellable: record.cancellable,
        cancelRequested: record.cancelRequested,
        retryable: record.state === "failed" && record.retry !== undefined,
        hasDetail: record.detail !== null,
        startedAt: new Date(record.startedAt).toISOString(),
        endedAt: record.endedAt === null ? null : new Date(record.endedAt).toISOString(),
    });

    /** 转为结束：移进结束的列表，超过上限时丢最早结束的（输出 8）。 */
    const finish = (record: TaskRecord, state: Exclude<TaskState, "running">, message: Text | null): void => {
        record.state = state;
        record.message = message;
        record.endedAt = clock.now();
        running.delete(record.id);
        finished.push(record);
        while (finished.length > MAX_FINISHED) finished.shift();
    };

    const drop = (record: TaskRecord): void => {
        const index = finished.indexOf(record);
        if (index !== -1) finished.splice(index, 1);
    };

    /** 句柄方法共用的前提：任务还在跑、发起方没有释放；不满足时这次调用不起作用。 */
    const live = (record: TaskRecord): boolean => record.state === "running" && !record.released && !closed;

    /** 句柄方法里的文字：不合格时这次调用不起作用，记诊断（“输入与前置条件”）。 */
    const textFor = (record: TaskRecord, method: string, value: unknown, max: number): Text | undefined => {
        const normalized = normalizeText(value, max);
        if (normalized.ok) return normalized.text;
        report("invalid-input", `task ${record.id}: ${method} ignored: ${normalized.reason}`, {task: record.id, method});
        return undefined;
    };

    const handleOf = (record: TaskRecord): TaskHandle => ({
        id: record.id,
        signal: record.controller.signal,
        report(patch) {
            if (!live(record)) return;
            let message = record.message;
            if (patch.message === null) message = null;
            else if (patch.message !== undefined) {
                const text = textFor(record, "report", patch.message, MESSAGE_MAX);
                if (text === undefined) return;
                message = text;
            }
            record.message = message;
            if (patch.progress !== undefined) record.progress = normalizeProgress(patch.progress);
            changed();
        },
        succeed(message) {
            if (!live(record)) return;
            const text = message === undefined ? null : textFor(record, "succeed", message, MESSAGE_MAX);
            if (text === undefined) return;
            finish(record, "succeeded", text);
            changed();
        },
        fail(failure: TaskFailure) {
            if (!live(record)) return;
            const text = textFor(record, "fail", failure.message, MESSAGE_MAX);
            if (text === undefined) return;
            record.detail = normalizeDetail(failure.detail);
            finish(record, "failed", text);
            changed();
        },
        cancelled(message) {
            if (!live(record)) return;
            const text = message === undefined ? null : textFor(record, "cancelled", message, MESSAGE_MAX);
            if (text === undefined) return;
            finish(record, "cancelled", text);
            changed();
        },
    });

    const startFor = (owner: ConsumerIdentity, input: TaskInput): TaskHandle => {
        if (closed) throw new TypeError("background tasks are closed");
        const title = normalizeText(input.title, TITLE_MAX);
        if (!title.ok) throw new TypeError(`invalid task title: ${title.reason}`);
        const message = input.message === undefined ? null : normalizeText(input.message, MESSAGE_MAX);
        if (message !== null && !message.ok) throw new TypeError(`invalid task message: ${message.reason}`);
        const record: TaskRecord = {
            id: `task-${options.newId()}`,
            owner,
            released: false,
            controller: new AbortController(),
            cancellable: input.cancellable === true,
            retry: input.retry,
            title: title.text,
            message: message === null ? null : message.text,
            state: "running",
            progress: normalizeProgress(input.progress),
            cancelRequested: false,
            detail: null,
            startedAt: clock.now(),
            endedAt: null,
        };
        running.set(record.id, record);
        changed();
        return handleOf(record);
    };

    return {
        facade: (consumer) => ({start: (input) => startFor(consumer, input)}),
        release(consumer) {
            let touched = false;
            const interrupted: TaskRecord[] = [];
            for (const record of [...running.values(), ...finished]) {
                if (record.owner !== consumer || record.released) continue;
                record.released = true;
                record.retry = undefined;
                touched = true;
                if (record.state === "running") interrupted.push(record);
            }
            for (const record of interrupted) finish(record, "interrupted", record.message);
            if (touched) changed();
            // 状态先落定、推送先排上，再 abort：发起方的 abort 监听里再调句柄也只会得到“不起作用”。
            for (const record of interrupted) record.controller.abort("interrupted");
        },
        list: () => [...running.values(), ...finished].map(itemOf),
        detail(id) {
            const record = find(id);
            if (record === undefined) return {ok: false, code: "unknown-task", detail: `no task ${id}`};
            return {ok: true, value: record.detail};
        },
        cancel(id) {
            const record = find(id);
            if (record === undefined) return {ok: false, code: "unknown-task", detail: `no task ${id}`};
            if (record.state !== "running") return {ok: false, code: "not-running", detail: `task ${id} has ended`};
            if (!record.cancellable) return {ok: false, code: "not-cancellable", detail: `task ${id} cannot be cancelled`};
            if (record.cancelRequested) return {ok: true, value: null};
            record.cancelRequested = true;
            changed();
            record.controller.abort("cancelled");
            return {ok: true, value: null};
        },
        retry(id) {
            const record = find(id);
            if (record === undefined) return {ok: false, code: "unknown-task", detail: `no task ${id}`};
            const retry = record.retry;
            if (record.state !== "failed" || retry === undefined) return {ok: false, code: "not-retryable", detail: `task ${id} cannot be retried`};
            // 先移出旧行再调用（输出 6）：发起方同步 start 的新任务与旧行的移出落在同一次或相邻两次推送里。
            drop(record);
            changed();
            const failed = (error: unknown): void => report("retry-failed", `task ${id}: retry failed: ${error instanceof Error ? error.message : String(error)}`, {task: id});
            try {
                const result = retry();
                if (result instanceof Promise) result.catch(failed);
            } catch (error) {
                failed(error);
            }
            return {ok: true, value: null};
        },
        remove(id) {
            const record = find(id);
            if (record === undefined) return {ok: false, code: "unknown-task", detail: `no task ${id}`};
            if (record.state === "running") return {ok: false, code: "running", detail: `task ${id} is still running`};
            drop(record);
            changed();
            return {ok: true, value: null};
        },
        clearFinished() {
            const removed = finished.length;
            if (removed === 0) return 0;
            finished.length = 0;
            changed();
            return removed;
        },
        onChanged(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        close() {
            closed = true;
            listeners.clear();
            const records = [...running.values()];
            running.clear();
            finished.length = 0;
            for (const record of records) record.controller.abort("interrupted");
        },
    };
}
