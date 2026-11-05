/**
 * 分段的世界日志（docs/specs/canon/project.md 输出 2、3、4、7、8、17、20、21、22）。
 *
 * - 一行一次修订，`"format": 2`（格式 1 的行按不认识的格式处理，只读、不迁移），以换行结尾；段文件名是这一段第一行的版本号（左补零到至少 6 位）；当前一段已有
 *   256 KiB 或更多时新开一段，一行最大 4 MiB。
 * - 打开：整个过程持锁（别的进程不会在读到一半时追加或开新段）。只有最后一段末尾没有换行结尾的那一截算“写了一半”，
 *   另存、截掉；任何以换行结尾却解析不了、版本不连续、格式不认识的行都让世界只读，不改写文件。
 * - 追加：持锁，核对尾部（最后一段的文件名与长度）还是本实例上次读写后的样子，不是就交给调用方先读进新增的行；
 *   写入失败能截回就报确定失败，截不回就报结局不确定。
 *
 * 锁由宿主注入（产品用应用的 `holdLock`），本模块只要求“拿到锁之前不读写尾部、用完释放”。
 */

import {join} from "node:path";

import {RevisionSchema, schemaProblems, type Revision} from "../core/schema";
import type {LogFiles} from "./files";

export const SEGMENT_LIMIT = 256 * 1024;
export const LINE_LIMIT = 4 * 1024 * 1024;
/** 日志行的格式版本（project.md 输出 2）。 */
export const LOG_FORMAT = 2;

const SEGMENT_NAME = /^(\d{6,})\.jsonl$/u;

/** 跨进程锁：`acquire` 在约 3 秒内拿不到时返回 "locked"（project.md 输出 22）。 */
export interface LogLock {
    acquire(): Promise<{readonly release: () => Promise<void>} | "locked">;
}

/** 本实例上次读写后日志尾部的样子。 */
export interface Tail {
    readonly segment: string | null;
    readonly length: number;
    readonly version: number;
}

export type LogDiagnostic =
    | {readonly code: "torn-tail"; readonly segment: string; readonly savedAs: string; readonly bytes: number}
    | {readonly code: "foreign-file"; readonly name: string}
    | {readonly code: "bad-line"; readonly segment: string; readonly line: number; readonly message: string};

export interface Opened {
    readonly revisions: Revision[];
    readonly tail: Tail;
    /** 有坏行、版本不连续或格式不认识时只读（输出 4）。 */
    readonly readOnly: {readonly segment: string; readonly line: number; readonly message: string} | null;
    readonly diagnostics: LogDiagnostic[];
}

export type AppendFailure =
    | {readonly code: "too-large"}
    | {readonly code: "world-locked"}
    /** 尾部变了：别的进程写过。调用方先 `readNew`，再按版本判冲突后重试。 */
    | {readonly code: "tail-moved"}
    | {readonly code: "write-failed"; readonly message: string}
    | {readonly code: "write-unknown"; readonly message: string}
    | {readonly code: "duplicate-version"};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", {fatal: false});

export function segmentName(version: number): string {
    return `${String(version).padStart(6, "0")}.jsonl`;
}

async function segments(files: LogFiles, dir: string): Promise<{names: string[]; foreign: string[]}> {
    const all = await files.list(dir);
    const names = all.filter((name) => SEGMENT_NAME.test(name)).sort((a, b) => Number(SEGMENT_NAME.exec(a)![1]) - Number(SEGMENT_NAME.exec(b)![1]));
    const foreign = all.filter((name) => !SEGMENT_NAME.test(name));
    return {names, foreign};
}

/**
 * 打开日志：持锁列段、读段、处理写了一半的末尾（另存到 `sideDir`、截掉）、逐行校验（project.md 输出 4）；拿不到锁时
 * 返回 `world-locked`。
 */
export async function openLog(files: LogFiles, dir: string, options: {readonly lock: LogLock; readonly sideDir: string; readonly now: () => string}): Promise<Opened | {readonly code: "world-locked"}> {
    const held = await options.lock.acquire();
    if (held === "locked") return {code: "world-locked"};
    try {
        return await openLocked(files, dir, options);
    } finally {
        await held.release();
    }
}

async function openLocked(files: LogFiles, dir: string, options: {readonly sideDir: string; readonly now: () => string}): Promise<Opened> {
    const {names, foreign} = await segments(files, dir);
    const diagnostics: LogDiagnostic[] = foreign.map((name) => ({code: "foreign-file", name}));
    const revisions: Revision[] = [];
    let readOnly: Opened["readOnly"] = null;
    let tail: Tail = {segment: null, length: 0, version: 0};
    for (const [segmentIndex, name] of names.entries()) {
        const path = join(dir, name);
        const bytes = await files.read(path);
        const last = segmentIndex === names.length - 1;
        let end = bytes.length;
        if (last && end > 0 && bytes[end - 1] !== 0x0a) {
            // 最后一段末尾没有换行结尾：写了一半（持锁时没有别的进程在写）。另存、截掉。
            const cut = bytes.lastIndexOf(0x0a) + 1;
            const savedAs = join(options.sideDir, `torn-${name}-${options.now().replace(/[:.]/gu, "-")}`);
            await files.mkdirp(options.sideDir);
            await files.create(savedAs, bytes.slice(cut));
            await files.truncate(path, cut);
            diagnostics.push({code: "torn-tail", segment: name, savedAs, bytes: end - cut});
            end = cut;
        }
        const text = decoder.decode(bytes.subarray(0, end));
        const lines = text.split("\n");
        lines.pop();
        const first = Number(SEGMENT_NAME.exec(name)![1]);
        for (const [lineIndex, line] of lines.entries()) {
            const problem = lineProblem(line, revisions.at(-1)?.version ?? 0, lineIndex === 0 ? first : null);
            if (typeof problem === "string") {
                readOnly = {segment: name, line: lineIndex + 1, message: problem};
                diagnostics.push({code: "bad-line", segment: name, line: lineIndex + 1, message: problem});
                break;
            }
            revisions.push(problem);
        }
        if (readOnly !== null) break;
        tail = {segment: name, length: end, version: revisions.at(-1)?.version ?? tail.version};
    }
    return {revisions, tail, readOnly, diagnostics};
}

/** 一行合格返回修订，否则返回说明。 */
function lineProblem(line: string, previous: number, segmentFirst: number | null): Revision | string {
    let value: unknown;
    try {
        value = JSON.parse(line);
    } catch {
        return "line is not valid JSON";
    }
    if (value === null || typeof value !== "object") return "line is not an object";
    const {format, ...revision} = value as {format?: unknown};
    if (format !== LOG_FORMAT) return `unknown format ${JSON.stringify(format)}`;
    const problems = schemaProblems(RevisionSchema, revision);
    if (problems !== null) return `revision shape: ${problems.map((problem) => `${problem.path} ${problem.message}`).join("; ")}`;
    const parsed = revision as Revision;
    if (parsed.version !== previous + 1) return `version ${String(parsed.version)} does not follow ${String(previous)}`;
    if (segmentFirst !== null && parsed.version !== segmentFirst) return `segment starts at ${String(segmentFirst)} but first line is version ${String(parsed.version)}`;
    return parsed;
}

/** 日志的尾部现在的样子（持锁时调用）。 */
async function currentTail(files: LogFiles, dir: string): Promise<{segment: string | null; length: number}> {
    const {names} = await segments(files, dir);
    const segment = names.at(-1) ?? null;
    return {segment, length: segment === null ? 0 : ((await files.size(join(dir, segment))) ?? 0)};
}

/**
 * 追加一次修订。成功返回新的尾部；尾部与 `tail` 不同时返回 `tail-moved`，调用方 `readNew` 后再按版本判冲突。
 * 第一次写入前建好日志目录与锁目录（输出 21，锁目录由锁的实现建）。
 */
export async function appendRevision(files: LogFiles, dir: string, tail: Tail, revision: Revision, lock: LogLock): Promise<{readonly tail: Tail} | AppendFailure> {
    const line = encoder.encode(`${JSON.stringify({format: LOG_FORMAT, ...revision})}\n`);
    if (line.length > LINE_LIMIT) return {code: "too-large"};
    await files.mkdirp(dir);
    const held = await lock.acquire();
    if (held === "locked") return {code: "world-locked"};
    try {
        const now = await currentTail(files, dir);
        if (now.segment !== tail.segment || now.length !== tail.length) return {code: "tail-moved"};
        // 当前一段写满了，或这一行本身超过一段的上限（它独占一段），就开新段（输出 3）。
        const fresh = tail.segment === null || tail.length >= SEGMENT_LIMIT || (line.length > SEGMENT_LIMIT && tail.length > 0);
        const segment = fresh ? segmentName(revision.version) : tail.segment!;
        const path = join(dir, segment);
        try {
            if (fresh) await files.create(path, line);
            else await files.append(path, line);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 写进去了多少不确定：截回原来的长度（新段就截成空再删不掉，截成 0 也算没写进去）。截不回就报结局不确定。
            try {
                const size = await files.size(path);
                if (size !== null && size !== (fresh ? 0 : tail.length)) await files.truncate(path, fresh ? 0 : tail.length);
                return {code: "write-failed", message};
            } catch {
                return {code: "write-unknown", message};
            }
        }
        // 写完再核对一次尾部：锁被判残留、别的进程接管时可能有人同时写，长度对不上就转只读（输出 8）。
        const after = await currentTail(files, dir);
        const expected = (fresh ? 0 : tail.length) + line.length;
        if (after.segment !== segment || after.length !== expected) return {code: "duplicate-version"};
        return {tail: {segment, length: expected, version: revision.version}};
    } finally {
        await held.release();
    }
}

/** 读进别的进程追加的完整行（持锁，输出 17）。尾部比记下的短时返回 `external-change`。 */
export async function readNew(files: LogFiles, dir: string, tail: Tail, lock: LogLock): Promise<{readonly revisions: Revision[]; readonly tail: Tail} | {readonly code: "world-locked" | "external-change"; readonly message?: string}> {
    const held = await lock.acquire();
    if (held === "locked") return {code: "world-locked"};
    try {
        const {names} = await segments(files, dir);
        const start = tail.segment === null ? 0 : names.indexOf(tail.segment);
        if (tail.segment !== null && start < 0) return {code: "external-change", message: `segment ${tail.segment} is gone`};
        const revisions: Revision[] = [];
        let current = tail;
        for (const name of names.slice(start)) {
            const path = join(dir, name);
            const bytes = await files.read(path);
            const from = name === tail.segment ? tail.length : 0;
            if (bytes.length < from) return {code: "external-change", message: `segment ${name} became shorter`};
            const end = bytes.lastIndexOf(0x0a) + 1;
            if (end <= from) {
                current = {segment: name, length: from, version: current.version};
                continue;
            }
            const lines = decoder.decode(bytes.subarray(from, end)).split("\n");
            lines.pop();
            for (const line of lines) {
                const parsed = lineProblem(line, current.version, null);
                if (typeof parsed === "string") return {code: "external-change", message: parsed};
                revisions.push(parsed);
                current = {segment: name, length: current.length, version: parsed.version};
            }
            current = {segment: name, length: end, version: current.version};
        }
        return {revisions, tail: current};
    } finally {
        await held.release();
    }
}
