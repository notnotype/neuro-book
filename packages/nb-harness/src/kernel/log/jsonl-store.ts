/**
 * 会话目录上的 JSONL 存储（docs/specs/harness/session.md）。
 *
 * 批的完整性判定依赖两条：一个会话只有一个写者（操作系统的独占锁，`flock.ts`），以及一批一次写入后同步到盘。
 * 所以只有文件末尾可能有写到一半的批，打开时截掉；写或同步失败后句柄进损坏状态、进程内不重试，
 * 重开以文件为准。大块内容在引用它的批之前写完并同步，所以完整的批引用的内容一定在盘上。
 */

import {join} from "node:path";
import type {LogEvent, LogHandle, LogStore, SessionHeader, SessionIndexEntry, StorageError, StorageNotice, StorageResult} from "../api/index.js";
import {blobRefsOf, encodeBatch, toEvent} from "./codec.js";
import {nodeFiles, type AppendFile, type FilePort} from "./files.js";
import type {FileLock} from "./flock.js";
import {advanceIndex, emptyIndex, parseIndex} from "./index-file.js";
import {sha256, utf8} from "./json.js";
import {isSessionId, parseLog} from "./validate.js";

const LOG = "session.jsonl";
const LOCK = "session.lock";
const OWNER = "session.owner";
const INDEX = "index.json";
const BLOBS = "blobs";

export interface JsonlStoreOptions {
    readonly root: string;
    readonly files?: FilePort;
    readonly now?: () => number;
}

function fail<T>(code: StorageError, detail?: Record<string, string | number>): StorageResult<T> {
    return detail === undefined ? {ok: false, code} : {ok: false, code, detail};
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const errorCode = (error: unknown): string | undefined => (typeof error === "object" && error !== null && "code" in error ? String((error as {code: unknown}).code) : undefined);

class JsonlHandle implements LogHandle {
    readonly notices: StorageNotice[] = [];
    broken = false;
    closed = false;

    constructor(
        readonly header: SessionHeader,
        readonly events: readonly LogEvent[],
        readonly directory: string,
        readonly file: AppendFile,
        readonly lock: FileLock,
        public size: number,
        public lastSeq: number,
        public index: SessionIndexEntry,
        readonly blobs: Set<string>,
    ) {}
}

function internal(handle: LogHandle): JsonlHandle {
    if (!(handle instanceof JsonlHandle)) throw new TypeError("handle was not opened by this JSONL store");
    return handle;
}

export function createJsonlStore(options: JsonlStoreOptions): LogStore {
    const files = options.files ?? nodeFiles;
    const now = options.now ?? Date.now;
    const directoryOf = (id: string) => join(options.root, id);

    /** 索引是缓存：写失败只留通知，不影响日志。 */
    async function writeIndex(handle: JsonlHandle): Promise<void> {
        try {
            await files.writeAtomic(join(handle.directory, INDEX), utf8(JSON.stringify(handle.index)), {sync: false});
        } catch (error) {
            handle.notices.push({code: "index-write-failed", detail: {message: message(error)}});
        }
    }

    async function writeOwner(directory: string): Promise<void> {
        await files.writeAtomic(join(directory, OWNER), utf8(JSON.stringify({pid: process.pid, at: now()})), {sync: false});
    }

    /** 持有者信息只供显示：读不到、读不懂（持有者正在写）就不带，`session-busy` 本身照报。 */
    async function busy(directory: string): Promise<StorageResult<never>> {
        const owner = await readOwner(directory);
        return owner === null ? fail("session-busy") : fail("session-busy", {pid: owner.pid, since: owner.at});
    }

    async function readOwner(directory: string): Promise<{pid: number; at: number} | null> {
        try {
            const bytes = await files.read(join(directory, OWNER));
            const value = bytes === null ? null : (JSON.parse(new TextDecoder().decode(bytes)) as {pid?: unknown; at?: unknown});
            return typeof value?.pid === "number" && typeof value.at === "number" ? {pid: value.pid, at: value.at} : null;
        } catch {
            return null;
        }
    }

    function takeLock(directory: string): FileLock | null | "missing" {
        try {
            return files.lock(join(directory, LOCK));
        } catch (error) {
            if (errorCode(error) === "ENOENT") return "missing";
            throw error;
        }
    }

    /** 读回大块内容，核对哈希与长度；缺失或不符返回问题。 */
    async function readBlobs(directory: string, hashes: ReadonlySet<string>): Promise<{contents: Map<string, string>} | {problem: string}> {
        const contents = new Map<string, string>();
        for (const hash of hashes) {
            const bytes = await files.read(join(directory, BLOBS, hash));
            if (bytes === null) return {problem: `blob ${hash} is missing`};
            if (sha256(bytes) !== hash) return {problem: `blob ${hash} does not match its hash`};
            contents.set(hash, new TextDecoder().decode(bytes));
        }
        return {contents};
    }

    return {
        async create(header) {
            if (!isSessionId(header.id)) return fail("invalid-session-id");
            const directory = directoryOf(header.id);
            let lock: FileLock | null = null;
            try {
                await files.makeDirectories(options.root);
                if (!(await files.makeDirectory(directory))) return fail("session-exists");
                const taken = takeLock(directory);
                if (taken === null || taken === "missing") return taken === null ? busy(directory) : fail("storage-failed", {message: "session directory vanished"});
                lock = taken;
                await writeOwner(directory);
                await files.makeDirectory(join(directory, BLOBS));
                const headerBytes = utf8(`${JSON.stringify(header)}\n`);
                await files.writeAtomic(join(directory, LOG), headerBytes, {sync: true});
                const file = await files.openAppend(join(directory, LOG));
                const handle = new JsonlHandle(header, [], directory, file, lock, headerBytes.length, 0, emptyIndex(header), new Set());
                await writeIndex(handle);
                return {ok: true, value: handle};
            } catch (error) {
                lock?.release();
                return fail("storage-failed", {message: message(error)});
            }
        },

        async open(id) {
            if (!isSessionId(id)) return fail("session-not-found");
            const directory = directoryOf(id);
            let lock: FileLock | null = null;
            try {
                const taken = takeLock(directory);
                if (taken === "missing") return fail("session-not-found");
                if (taken === null) return busy(directory);
                lock = taken;
                const bytes = await files.read(join(directory, LOG));
                if (bytes === null) {
                    lock.release();
                    return fail("session-not-found");
                }
                const parsed = parseLog(bytes, id);
                if (!parsed.ok) {
                    lock.release();
                    return {ok: false, code: parsed.code, detail: {...parsed.detail}};
                }
                const blobs = await readBlobs(directory, blobRefsOf(parsed.records.map((record) => record.data)));
                if ("problem" in blobs) {
                    lock.release();
                    return fail("log-corrupt", {problem: blobs.problem});
                }
                await writeOwner(directory);
                const notices: StorageNotice[] = [];
                const file = await files.openAppend(join(directory, LOG));
                if (parsed.tailBytes > 0) {
                    // 截下的尾部另存一份供查看，再截文件：顺序反了，崩溃会让这段字节两处都没有。
                    const savedAs = `${LOG}.tail-${now()}`;
                    await files.writeAtomic(join(directory, savedAs), bytes.subarray(parsed.keepBytes), {sync: true});
                    await file.truncate(parsed.keepBytes);
                    await file.sync();
                    notices.push({code: "log-tail-truncated", detail: {bytes: parsed.tailBytes, savedAs}});
                }
                const events = parsed.records.map((record) => toEvent(record, blobs.contents));
                const lastSeq = events.at(-1)?.seq ?? 0;
                const handle = new JsonlHandle(parsed.header, events, directory, file, lock, parsed.keepBytes, lastSeq, emptyIndex(parsed.header), new Set(blobs.contents.keys()));
                handle.notices.push(...notices);
                const stored = parseIndex(await files.read(join(directory, INDEX)));
                handle.index = advanceIndex(emptyIndex(parsed.header), events);
                if (stored === null || stored.throughSeq !== lastSeq) {
                    await writeIndex(handle);
                    handle.notices.push({code: "index-rebuilt", detail: {from: stored?.throughSeq ?? -1, to: lastSeq}});
                }
                return {ok: true, value: handle};
            } catch (error) {
                lock?.release();
                return fail("storage-failed", {message: message(error)});
            }
        },

        async append(handle, batch) {
            const state = internal(handle);
            if (state.closed) throw new Error("append on a closed session log");
            if (state.broken) return fail("log-broken");
            if (batch.length === 0) return {ok: true, value: undefined};
            batch.forEach((event, index) => {
                if (event.seq !== state.lastSeq + 1 + index) throw new Error(`append expected seq ${state.lastSeq + 1 + index}, got ${event.seq}`);
            });
            const encoded = encodeBatch(batch, batch[0]!.id);
            try {
                for (const [hash, content] of encoded.blobs) {
                    if (state.blobs.has(hash)) continue;
                    await files.writeAtomic(join(state.directory, BLOBS, hash), utf8(content), {sync: true});
                    state.blobs.add(hash);
                }
                await state.file.write(encoded.bytes, state.size);
                await state.file.sync();
            } catch (error) {
                state.broken = true;
                return fail("log-broken", {message: message(error)});
            }
            state.size += encoded.bytes.length;
            state.lastSeq = batch.at(-1)!.seq;
            state.index = advanceIndex(state.index, batch);
            await writeIndex(state);
            return {ok: true, value: undefined};
        },

        async list(filter) {
            try {
                const entries: SessionIndexEntry[] = [];
                for (const name of await files.list(options.root)) {
                    if (!isSessionId(name)) continue;
                    const index = parseIndex(await files.read(join(directoryOf(name), INDEX)));
                    if (index === null) continue;
                    if (filter?.project !== undefined && index.project !== filter.project) continue;
                    if (filter?.archived !== undefined && index.archived !== filter.archived) continue;
                    entries.push(index);
                }
                return {ok: true, value: entries.sort((a, b) => b.lastActivityAt - a.lastActivityAt)};
            } catch (error) {
                return fail("storage-failed", {message: message(error)});
            }
        },

        async close(handle) {
            const state = internal(handle);
            if (state.closed) return;
            state.closed = true;
            try {
                await state.file.close();
            } finally {
                state.lock.release();
            }
        },
    };
}
