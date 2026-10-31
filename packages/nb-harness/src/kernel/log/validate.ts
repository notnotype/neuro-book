/**
 * 读日志文件：切行、找出末尾不完整的批、解析会话头、校验整份日志（docs/specs/harness/session.md 输出 5–8）。
 *
 * 行与偏移都按字节算：截断发生在字节边界，按 Buffer 找换行才能和文件里的内容对上。完整性判定依赖单写者：
 * 一批一次写入，崩溃只可能截在文件末尾那一批里，所以中间的不完整批与坏行是损坏，不是写到一半。
 */

import {kernelEventSpecs, LOG_FORMAT, type LogRecord, type SessionHeader} from "../api/index.js";

const NEWLINE = 0x0a;
const strictUtf8 = new TextDecoder("utf-8", {fatal: true});
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/u;

export const isSessionId = (id: string): boolean => SESSION_ID.test(id);

export type ParsedLog =
    | {readonly ok: true; readonly header: SessionHeader; readonly records: readonly LogRecord[]; readonly keepBytes: number; readonly tailBytes: number}
    | {readonly ok: false; readonly code: "log-corrupt" | "needs-migration"; readonly detail: {readonly line?: number; readonly problem: string}};

interface Line {
    readonly value: unknown;
    /** 这一行（含换行）之后的字节偏移。 */
    readonly end: number;
    readonly bad: string | null;
}

function corrupt(problem: string, line?: number): ParsedLog {
    return {ok: false, code: "log-corrupt", detail: line === undefined ? {problem} : {line, problem}};
}

/** 切出全部以换行结束的行；最后一行没有换行时不在其中（它是写到一半的行，算进尾部的字节）。 */
function splitLines(bytes: Uint8Array): Line[] {
    const lines: Line[] = [];
    let start = 0;
    for (;;) {
        const end = bytes.indexOf(NEWLINE, start);
        if (end < 0) break;
        let value: unknown = null;
        let bad: string | null = null;
        try {
            value = JSON.parse(strictUtf8.decode(bytes.subarray(start, end)));
        } catch (error) {
            bad = error instanceof Error ? error.message : String(error);
        }
        lines.push({value, end: end + 1, bad});
        start = end + 1;
    }
    return lines;
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

/** 解析整份文件。`keepBytes` 是最后一个完整批的末尾；之后的 `tailBytes` 个字节是写到一半的批，调用方截掉另存。 */
export function parseLog(bytes: Uint8Array, expectedId: string): ParsedLog {
    const lines = splitLines(bytes);
    const first = lines[0];
    if (first === undefined || first.bad !== null || !isObject(first.value)) return corrupt("missing or unreadable session header", 1);
    const header = first.value;
    if (header.format !== LOG_FORMAT) return {ok: false, code: "needs-migration", detail: {line: 1, problem: `unknown log format ${String(header.format)}`}};
    const headerIssue = headerProblem(header);
    if (headerIssue !== null) return corrupt(`invalid session header field ${headerIssue}`, 1);
    if (header.id !== expectedId) return corrupt(`session header id ${String(header.id)} does not match ${expectedId}`, 1);

    // 按批分组，找到最后一个完整批所在的行；遇到第一处对不上就停。
    let keepLine = 0;
    let open: {id: string; next: number} | null = null;
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index]!;
        const batch = line.bad === null ? batchOf(line.value) : null;
        if (batch === null || (open === null ? batch.n !== 1 : batch.id !== open.id || batch.n !== open.next)) break;
        open = batch.n === batch.of ? null : {id: batch.id, next: batch.n + 1};
        if (open === null) keepLine = index;
    }
    // 之后到文件末尾只能是同一个批的前几行，加可能写到一半的最后一行；中间的不完整批与坏行都会落进这一段，判为损坏。
    const tail = lines.slice(keepLine + 1);
    for (let offset = 0; offset < tail.length; offset += 1) {
        const line = tail[offset]!;
        const lineNumber = keepLine + 2 + offset;
        if (line.bad !== null) return corrupt(`line is not valid JSON: ${line.bad}`, lineNumber);
        const batch = batchOf(line.value);
        if (batch === null) return corrupt("line has no valid batch mark", lineNumber);
        const firstId = batchOf(tail[0]!.value)!.id;
        if (batch.id !== firstId || batch.n !== offset + 1 || batch.n === batch.of) return corrupt("an incomplete batch is followed by more lines", lineNumber);
    }
    const keepBytes = lines[keepLine]!.end;
    const records = lines.slice(1, keepLine + 1).map((line) => line.value as LogRecord);
    const problem = recordsProblem(records);
    if (problem !== null) return corrupt(problem.problem, problem.index + 2);
    return {ok: true, header: header as unknown as SessionHeader, records, keepBytes, tailBytes: bytes.length - keepBytes};
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

