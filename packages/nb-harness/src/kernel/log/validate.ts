/**
 * 读日志文件：切行、找出末尾不完整的批、解析会话头、校验整份日志（docs/specs/harness/session.md 输出 5–8）。
 *
 * 行与偏移都按字节算：截断发生在字节边界，按 Buffer 找换行才能和文件里的内容对上。完整性判定依赖单写者：
 * 一批一次写入，崩溃只可能截在文件末尾那一批里，所以中间的不完整批与坏行是损坏，不是写到一半。
 */

import {kernelEventSpecs, LOG_FORMAT, type LogRecord, type SessionHeader} from "../api/index.js";

export const NEWLINE = 0x0a;
const strictUtf8 = new TextDecoder("utf-8", {fatal: true});
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/u;

export const isSessionId = (id: string): boolean => SESSION_ID.test(id);

export type ParsedLog =
    | {readonly ok: true; readonly header: SessionHeader; readonly records: readonly LogRecord[]; readonly keepBytes: number; readonly tailBytes: number}
    | {readonly ok: false; readonly code: "log-corrupt" | "needs-migration"; readonly detail: {readonly line?: number; readonly problem: string}};

type Failure = Extract<ParsedLog, {ok: false}>;

function corrupt(problem: string, line?: number): Failure {
    return {ok: false, code: "log-corrupt", detail: line === undefined ? {problem} : {line, problem}};
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function headerProblem(value: Record<string, unknown>): string | null {
    if (typeof value.id !== "string" || !isSessionId(value.id)) return "id";
    if (typeof value.createdAt !== "number") return "createdAt";
    if (typeof value.profile !== "string" || value.profile === "") return "profile";
    if (value.questions !== "caller" && value.questions !== "user") return "questions";
    return null;
}

function batchOf(value: unknown): {id: string; n: number; of: number} | null {
    if (!isObject(value) || !isObject(value.batch)) return null;
    const {id, n, of} = value.batch;
    return typeof id === "string" && Number.isInteger(n) && Number.isInteger(of) && (n as number) >= 1 && (n as number) <= (of as number) ? {id, n: n as number, of: of as number} : null;
}

/**
 * 逐行读日志：每一行（不含换行）连同它之后的字节偏移交给 `line`，读完调用 `finish`。不需要整个文件在内存里：
 * 只留解析好的记录，加上最后一个还没写完的批。最后一行没有换行时它不交进来，算进尾部的字节。
 *
 * 任何一整行不是合法 JSON、没有批标记或批标记接不上，都是损坏：只有文件末尾那一个批可以不完整，
 * 而那一批的行必须是同一批的前几行。
 */
export class LogReader {
    #header: SessionHeader | null = null;
    #lineNumber = 0;
    #failure: Failure | null = null;
    readonly #kept: LogRecord[] = [];
    #open: {id: string; next: number; of: number; records: LogRecord[]} | null = null;
    #keepBytes = 0;

    constructor(private readonly expectedId: string) {}

    /** 交一行；之前已经判为损坏时忽略。 */
    line(bytes: Uint8Array, end: number): void {
        if (this.#failure !== null) return;
        this.#lineNumber += 1;
        let value: unknown;
        try {
            value = JSON.parse(strictUtf8.decode(bytes));
        } catch (error) {
            this.#failure = this.#lineNumber === 1 ? corrupt("missing or unreadable session header", 1) : corrupt(`line is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, this.#lineNumber);
            return;
        }
        if (this.#lineNumber === 1) return this.#readHeader(value, end);
        const batch = batchOf(value);
        if (batch === null) {
            this.#failure = corrupt("line has no valid batch mark", this.#lineNumber);
            return;
        }
        const open = this.#open;
        if (open === null ? batch.n !== 1 : batch.id !== open.id || batch.n !== open.next) {
            this.#failure = corrupt(open === null ? "batch does not start at its first line" : "an incomplete batch is followed by more lines", this.#lineNumber);
            return;
        }
        const records = open?.records ?? [];
        records.push(value as LogRecord);
        if (batch.n === batch.of) {
            for (const record of records) this.#kept.push(record);
            this.#open = null;
            this.#keepBytes = end;
        } else {
            this.#open = {id: batch.id, next: batch.n + 1, of: batch.of, records};
        }
    }

    #readHeader(value: unknown, end: number): void {
        if (!isObject(value)) {
            this.#failure = corrupt("missing or unreadable session header", 1);
            return;
        }
        if (value.format !== LOG_FORMAT) {
            this.#failure = {ok: false, code: "needs-migration", detail: {line: 1, problem: `unknown log format ${String(value.format)}`}};
            return;
        }
        const issue = headerProblem(value);
        if (issue !== null) this.#failure = corrupt(`invalid session header field ${issue}`, 1);
        else if (value.id !== this.expectedId) this.#failure = corrupt(`session header id ${String(value.id)} does not match ${this.expectedId}`, 1);
        else {
            this.#header = value as unknown as SessionHeader;
            this.#keepBytes = end;
        }
    }

    /** `totalBytes` 是文件长度；最后一个完整批之后的字节都是尾部。 */
    finish(totalBytes: number): ParsedLog {
        if (this.#failure !== null) return this.#failure;
        if (this.#header === null) return corrupt("missing or unreadable session header", 1);
        const problem = recordsProblem(this.#kept);
        if (problem !== null) return corrupt(problem.problem, problem.index + 2);
        return {ok: true, header: this.#header, records: this.#kept, keepBytes: this.#keepBytes, tailBytes: totalBytes - this.#keepBytes};
    }
}

/** 整份文件已在内存里时的便利写法（测试与小文件）。 */
export function parseLog(bytes: Uint8Array, expectedId: string): ParsedLog {
    const reader = new LogReader(expectedId);
    let start = 0;
    for (;;) {
        const end = bytes.indexOf(NEWLINE, start);
        if (end < 0) break;
        reader.line(bytes.subarray(start, end), end + 1);
        start = end + 1;
    }
    return reader.finish(bytes.length);
}

const KERNEL_SOURCE = "kernel";

/** 校验保留下来的记录（输出 7）；返回第一处问题与它在记录里的下标。 */
export function recordsProblem(records: readonly LogRecord[]): {index: number; problem: string} | null {
    const ids = new Set<string>();
    const pathIds = new Set<string>();
    const keys = new Set<string>();
    let lastSeq = 0;
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index] as LogRecord & Record<string, unknown>;
        const fail = (problem: string) => ({index, problem});
        if (typeof record.id !== "string" || record.id === "") return fail("event id");
        if (ids.has(record.id)) return fail(`duplicate event id ${record.id}`);
        if (typeof record.seq !== "number" || !Number.isInteger(record.seq) || record.seq <= lastSeq) return fail(`seq ${String(record.seq)} is not increasing`);
        if (typeof record.at !== "number" || typeof record.version !== "number" || typeof record.type !== "string" || typeof record.source !== "string") return fail("event fields");
        if (record.scope !== "path" && record.scope !== "session") return fail(`scope ${String(record.scope)}`);
        const slash = record.type.lastIndexOf("/");
        if (slash < 0) {
            const spec = (kernelEventSpecs as Record<string, {scope: string; kind: string} | undefined>)[record.type];
            if (spec === undefined) return fail(`unknown kernel event ${record.type}`);
            if (spec.scope !== record.scope || spec.kind !== record.kind) return fail(`${record.type} has the wrong scope or kind`);
            if (record.source !== KERNEL_SOURCE) return fail(`${record.type} must be written by the kernel`);
        } else {
            const owner = record.type.slice(0, slash);
            if (owner !== record.source) return fail(`${record.type} is written by ${record.source}, not by its owner`);
            if (record.kind !== "conv" && record.kind !== "ext") return fail(`extension event ${record.type} has kind ${String(record.kind)}`);
            if (record.kind === "conv" && record.scope !== "path") return fail(`conv event ${record.type} must be a path event`);
        }
        if (record.scope === "session" && record.parent !== null) return fail("session event with a parent");
        if (record.scope === "path" && record.parent !== null && !pathIds.has(record.parent as string)) return fail(`parent ${String(record.parent)} does not appear before`);
        if (record.key !== undefined) {
            const key = `${record.source}\u0000${String(record.key)}`;
            if (keys.has(key)) return fail(`duplicate idempotency key ${String(record.key)} for ${record.source}`);
            keys.add(key);
        }
        ids.add(record.id);
        if (record.scope === "path") pathIds.add(record.id);
        lastSeq = record.seq;
    }
    return null;
}

