/**
 * 一个 Storage 分区：一个 SQLite 库（docs/specs/storage/persistence.md 的“副作用与数据”）。
 *
 * 接口是同步的（`bun:sqlite` 是同步 API）：同一进程里的操作天然串行，订阅“先取当前快照再登记”在同一段
 * 同步代码里完成，不会漏掉中间的写入。两个进程打开同一个库时，条件写入在 `BEGIN IMMEDIATE` 事务里读
 * revision、比较、写入，由 SQLite 的锁保证同一 revision 至多一次成功；不另加目录锁。
 *
 * 描述登记只在内存里：分区拥有者重启后以新代码的定义为准，库里旧版本的值按读取分类处理。
 */

import {Database} from "bun:sqlite";
import {mkdirSync} from "node:fs";
import {dirname} from "node:path";

import {encodeJsonValue} from "@notnotype/nb-runtime/remote";
import {Value} from "typebox/value";

import {recordFingerprint} from "nbook/shared/storage";
import type {RecordDescriptor, RecordSnapshot, StorageFailed, StorageFailure, WriteResult} from "nbook/shared/storage";

import type {WriteOperation} from "../shared/facade";

/** 库格式版本；遇到别的版本时分区不可用，也不改写这个库。 */
export const PARTITION_FORMAT = 1;
export const DEFAULT_BUSY_TIMEOUT_MS = 2000;
/** 原件区上限：每个分区最多这么多份、合计这么多字节；满了拒绝重置，不清旧原件。 */
export const ORIGINALS_MAX_COUNT = 64;
export const ORIGINALS_MAX_BYTES = 4 * 1024 * 1024;

/** 一条记录在分区里的地址；`resource` 与 `client` 不适用时为空串。 */
export interface RecordAddress {
    readonly owner: string;
    readonly key: string;
    readonly resource: string;
    readonly client: string;
}

export interface PartitionOptions {
    /** 库文件路径；所在目录不存在时创建。 */
    readonly path: string;
    /** 等库锁的上限（毫秒），等不到为 `busy`。 */
    readonly busyTimeoutMs?: number;
    readonly now?: () => number;
    /** 订阅监听抛错：不影响写入结果与其它监听，交给调用方记诊断。 */
    readonly onListenerError?: (error: unknown) => void;
}

export interface Partition {
    /** 登记或核对描述：同一 owner 同名键的描述与已登记的不同为 `definition-conflict`。 */
    register(owner: string, descriptor: RecordDescriptor): {readonly ok: true} | StorageFailed;
    read(address: RecordAddress, descriptor: RecordDescriptor): RecordSnapshot<unknown>;
    write(address: RecordAddress, descriptor: RecordDescriptor, operation: WriteOperation): WriteResult;
    /** 取当前快照并登记监听；之后本进程对这条记录的每次成功写入都推送新快照。 */
    watch(address: RecordAddress, descriptor: RecordDescriptor, listener: (snapshot: RecordSnapshot<unknown>) => void): {readonly initial: RecordSnapshot<unknown>; stop(): void};
    /** 关闭库；之后的操作为 `unavailable`。幂等。 */
    close(): void;
}

interface Row {
    readonly revision: number;
    readonly version: number;
    readonly value: unknown;
}

class PartitionError extends Error {
    constructor(readonly code: StorageFailure, detail: string) {
        super(detail);
    }
}

export function createPartition(options: PartitionOptions): Partition {
    return new SqlitePartition(options);
}

class SqlitePartition implements Partition {
    readonly #path: string;
    readonly #busyTimeoutMs: number;
    readonly #now: () => number;
    readonly #onListenerError: (error: unknown) => void;
    readonly #registered = new Map<string, string>();
    readonly #watchers = new Map<string, Set<(snapshot: RecordSnapshot<unknown>) => void>>();
    #db: Database | null = null;
    #closed = false;

    constructor(options: PartitionOptions) {
        this.#path = options.path;
        this.#busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
        this.#now = options.now ?? Date.now;
        this.#onListenerError = options.onListenerError ?? (() => undefined);
    }

    register(owner: string, descriptor: RecordDescriptor): {readonly ok: true} | StorageFailed {
        if (this.#closed) return failed("unavailable", "分区已关闭");
        const name = `${owner}\u0000${descriptor.key}`;
        const fingerprint = recordFingerprint(descriptor);
        const known = this.#registered.get(name);
        if (known === undefined) {
            this.#registered.set(name, fingerprint);
            return {ok: true};
        }
        return known === fingerprint ? {ok: true} : failed("definition-conflict", `插件 ${owner} 的记录 ${descriptor.key} 与已登记的定义不同；客户端可能比服务端旧，请刷新`);
    }

    read(address: RecordAddress, descriptor: RecordDescriptor): RecordSnapshot<unknown> {
        try {
            this.#checkRegistered(address.owner, descriptor);
            return classify(this.#select(this.#open(), address), descriptor);
        } catch (error) {
            const failure = failureOf(error);
            return {status: "error", code: failure.code, detail: failure.detail};
        }
    }

    write(address: RecordAddress, descriptor: RecordDescriptor, operation: WriteOperation): WriteResult {
        let written: {readonly revision: string; readonly snapshot: RecordSnapshot<unknown>};
        try {
            this.#checkRegistered(address.owner, descriptor);
            const text = operation.kind === "remove" ? null : encodeValue(descriptor, operation.value);
            const db = this.#open();
            written = this.#transaction(db, () => {
                const row = this.#select(db, address);
                const current = classify(row, descriptor);
                const currentRevision = row === null ? null : String(row.revision);
                if (operation.expect !== currentRevision) {
                    throw new PartitionError("conflict", `revision 已变：期望 ${String(operation.expect)}，当前 ${String(currentRevision)}`);
                }
                const isProtected = current.status === "corrupt" || current.status === "unsupported-version";
                if (isProtected && operation.kind !== "reset") {
                    throw new PartitionError("protected", `记录是 ${current.status}，只能用 reset 替换`);
                }
                if (isProtected && row !== null) this.#keepOriginal(db, address, row);
                const next = this.#nextRevision(db);
                db.query("INSERT INTO records (owner, key, resource, client, revision, version, value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (owner, key, resource, client) DO UPDATE SET revision = excluded.revision, version = excluded.version, value = excluded.value, updated_at = excluded.updated_at")
                    .run(address.owner, address.key, address.resource, address.client, next, descriptor.version, text, this.#now());
                const revision = String(next);
                return {revision, snapshot: text === null ? {status: "missing", revision} : {status: "ok", value: JSON.parse(text) as unknown, revision}};
            });
        } catch (error) {
            return failureOf(error);
        }
        this.#notify(address, written.snapshot);
        return {ok: true, revision: written.revision};
    }

    watch(address: RecordAddress, descriptor: RecordDescriptor, listener: (snapshot: RecordSnapshot<unknown>) => void): {readonly initial: RecordSnapshot<unknown>; stop(): void} {
        const initial = this.read(address, descriptor);
        const name = addressKey(address);
        let listeners = this.#watchers.get(name);
        if (listeners === undefined) {
            listeners = new Set();
            this.#watchers.set(name, listeners);
        }
        listeners.add(listener);
        return {
            initial,
            stop: () => {
                listeners.delete(listener);
                if (listeners.size === 0 && this.#watchers.get(name) === listeners) this.#watchers.delete(name);
            },
        };
    }

    close(): void {
        if (this.#closed) return;
        this.#closed = true;
        this.#watchers.clear();
        this.#db?.close();
        this.#db = null;
    }

    #checkRegistered(owner: string, descriptor: RecordDescriptor): void {
        const registered = this.register(owner, descriptor);
        if (!registered.ok) throw new PartitionError(registered.code, registered.detail);
    }

    /**
     * 第一次使用时打开库。先只读地核对格式版本，再建表与切到 WAL：遇到不是 SQLite 的文件或别的格式版本时，
     * 打开失败而不改写它。打开失败不缓存，下一次操作再试。
     */
    #open(): Database {
        if (this.#closed) throw new PartitionError("unavailable", "分区已关闭");
        if (this.#db !== null) return this.#db;
        let db: Database | null = null;
        try {
            mkdirSync(dirname(this.#path), {recursive: true});
            db = new Database(this.#path, {create: true});
            db.run(`PRAGMA busy_timeout = ${String(this.#busyTimeoutMs)}`);
            const hasMeta = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== null;
            if (hasMeta) {
                const format = db.query<{value: string}, []>("SELECT value FROM meta WHERE name = 'format'").get();
                if (format?.value !== String(PARTITION_FORMAT)) {
                    throw new PartitionError("io-error", `库格式版本 ${format?.value ?? "（缺失）"} 不受支持`);
                }
            }
            db.run("PRAGMA journal_mode = WAL");
            this.#transaction(db, () => {
                db!.run("CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
                db!.run("CREATE TABLE IF NOT EXISTS records (owner TEXT NOT NULL, key TEXT NOT NULL, resource TEXT NOT NULL, client TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL, value TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (owner, key, resource, client))");
                db!.run("CREATE TABLE IF NOT EXISTS originals (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, key TEXT NOT NULL, resource TEXT NOT NULL, client TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL, value TEXT, bytes INTEGER NOT NULL, saved_at INTEGER NOT NULL)");
                db!.query("INSERT OR IGNORE INTO meta (name, value) VALUES ('format', ?1), ('next_revision', '1')").run(String(PARTITION_FORMAT));
            });
        } catch (error) {
            db?.close();
            throw error;
        }
        this.#db = db;
        return db;
    }

    #select(db: Database, address: RecordAddress): Row | null {
        return db
            .query<Row, [string, string, string, string]>("SELECT revision, version, value FROM records WHERE owner = ?1 AND key = ?2 AND resource = ?3 AND client = ?4")
            .get(address.owner, address.key, address.resource, address.client);
    }

    #nextRevision(db: Database): number {
        const row = db.query<{value: string}, []>("SELECT value FROM meta WHERE name = 'next_revision'").get();
        const next = Number(row?.value);
        if (!Number.isSafeInteger(next) || next < 1) throw new PartitionError("io-error", "库里的 revision 计数已损坏");
        db.query("UPDATE meta SET value = ?1 WHERE name = 'next_revision'").run(String(next + 1));
        return next;
    }

    #keepOriginal(db: Database, address: RecordAddress, row: Row): void {
        const text = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
        const bytes = Buffer.byteLength(text ?? "", "utf8");
        const usage = db.query<{count: number; total: number | null}, []>("SELECT COUNT(*) AS count, SUM(bytes) AS total FROM originals").get();
        if ((usage?.count ?? 0) >= ORIGINALS_MAX_COUNT || (usage?.total ?? 0) + bytes > ORIGINALS_MAX_BYTES) {
            throw new PartitionError("originals-full", `原件区已满（最多 ${String(ORIGINALS_MAX_COUNT)} 份、${String(ORIGINALS_MAX_BYTES)} 字节），拒绝重置`);
        }
        db.query("INSERT INTO originals (owner, key, resource, client, revision, version, value, bytes, saved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
            .run(address.owner, address.key, address.resource, address.client, row.revision, row.version, text, bytes, this.#now());
    }

    /** `BEGIN IMMEDIATE` 先取写锁：读 revision 与写入之间别的进程插不进来。 */
    #transaction<T>(db: Database, body: () => T): T {
        db.run("BEGIN IMMEDIATE");
        try {
            const result = body();
            db.run("COMMIT");
            return result;
        } catch (error) {
            if (db.inTransaction) db.run("ROLLBACK");
            throw error;
        }
    }

    #notify(address: RecordAddress, snapshot: RecordSnapshot<unknown>): void {
        for (const listener of [...(this.#watchers.get(addressKey(address)) ?? [])]) {
            try {
                listener(snapshot);
            } catch (error) {
                this.#onListenerError(error);
            }
        }
    }
}

function addressKey(address: RecordAddress): string {
    return JSON.stringify([address.owner, address.key, address.resource, address.client]);
}

/** 按 docs/specs/storage/persistence.md 输出第 3 条分类；值都先校验再交出。 */
function classify(row: Row | null, descriptor: RecordDescriptor): RecordSnapshot<unknown> {
    if (row === null) return {status: "missing", revision: null};
    const revision = String(row.revision);
    if (row.value === null) return {status: "missing", revision};
    if (row.version !== descriptor.version) {
        return {status: "unsupported-version", revision, detail: `库里的版本 ${String(row.version)} 与定义的版本 ${String(descriptor.version)} 不同`};
    }
    if (typeof row.value !== "string") return {status: "corrupt", revision, detail: "值不是 JSON 文本"};
    let value: unknown;
    try {
        value = JSON.parse(row.value);
    } catch {
        return {status: "corrupt", revision, detail: "值无法解析为 JSON"};
    }
    if (!Value.Check(descriptor.schema, value)) return {status: "corrupt", revision, detail: `值不符合 schema：${schemaProblems(descriptor, value)}`};
    return {status: "ok", value, revision};
}

/** 写入前的校验与编码：不符合 schema 或无法如实编码为 JSON 为 `invalid-value`，超过上限为 `too-large`。 */
function encodeValue(descriptor: RecordDescriptor, value: unknown): string {
    if (!Value.Check(descriptor.schema, value)) throw new PartitionError("invalid-value", `值不符合 schema：${schemaProblems(descriptor, value)}`);
    let text: string;
    try {
        text = encodeJsonValue(value);
    } catch (error) {
        throw new PartitionError("invalid-value", `值无法编码为 JSON：${error instanceof Error ? error.message : String(error)}`);
    }
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > descriptor.maxBytes) throw new PartitionError("too-large", `值 ${String(bytes)} 字节，超过上限 ${String(descriptor.maxBytes)}`);
    return text;
}

function schemaProblems(descriptor: RecordDescriptor, value: unknown): string {
    return [...Value.Errors(descriptor.schema, value)]
        .slice(0, 3)
        .map((problem) => `${problem.instancePath === "" ? "/" : problem.instancePath} ${problem.message}`)
        .join("；");
}

function failed(code: StorageFailure, detail: string): StorageFailed {
    return {ok: false, code, detail};
}

/**
 * 已知的失败按码报告；SQLite 的锁等待（`SQLITE_BUSY` 及其扩展码，例如 `SQLITE_BUSY_SNAPSHOT`）为 `busy`，
 * 其余数据库与文件错误为 `io-error`。
 */
function failureOf(error: unknown): StorageFailed {
    if (error instanceof PartitionError) return failed(error.code, error.message);
    const code = typeof error === "object" && error !== null && "code" in error ? (error as {code: unknown}).code : null;
    const message = error instanceof Error ? error.message : String(error);
    if (typeof code === "string" && code.startsWith("SQLITE_BUSY")) return failed("busy", `库被别的进程占用：${message}`);
    return failed("io-error", message);
}
