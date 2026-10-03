/**
 * 诊断文件出口：在宿主授予的日志位置追加逐行 JSONL，按预算轮转与保留，位置冲突或授予失守时降级。
 *
 * 位置授予用 proper-lockfile 锁住目录（锁文件放目录内）：同一物理位置同时只有一个存活的出口 owner，
 * 拿不到授予的实例不写、不轮转、不回收别人的文件。出口只管理自己拥有的 `server-*` 文件，不发起网络调用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock} from "proper-lockfile";
import type {LockOptions} from "proper-lockfile";

import {describeDiagnosticError} from "@notnotype/nb-runtime/diagnostics";
import type {
    DiagnosticExporter,
    DiagnosticExporterFactory,
    DiagnosticFallback,
    DiagnosticOrigin,
    DiagnosticRecord,
    DiagnosticsDegraded,
    ExporterOpenOutcome,
} from "@notnotype/nb-runtime/diagnostics";

import {isNodeErrorCode, isOwnedLogFile, JsonlLogWriter} from "./log-writer";

/** 授予锁文件；放在被授予目录内，不匹配任何 `server-*` 日志归属模式。 */
export const LOG_LOCATION_LOCK_NAME = "server-logs.lock";

/** proper-lockfile 的过期与心跳参数；所有 NeuroBook 进程必须一致，否则会误判对方的锁过期。 */
export const LOG_LOCATION_LOCK_STALE_MS = 30_000;
export const LOG_LOCATION_LOCK_UPDATE_MS = 10_000;

export interface LogLocationLockOptions {
    readonly lockfilePath: string;
    readonly realpath: false;
    readonly stale: number;
    readonly update: number;
    readonly retries: NonNullable<LockOptions["retries"]>;
    readonly onCompromised: (error: Error) => void;
}

/**
 * 日志位置授予对外部锁的最小适配器；测试用它注入冲突与授予失守。
 * 释放前发现授予已不属于自己时，经 `onCompromised` 报告失守并跳过删除，而不是抛错。
 */
export interface LogLocationLockAdapter {
    acquire(directory: string, options: LogLocationLockOptions): Promise<() => Promise<void>>;
}

/** 锁目录身份：设备、inode 与创建时间；心跳只改 mtime，被别人接管后身份不同。缺失返回 null。 */
async function readLockIdentity(lockfilePath: string): Promise<string | null> {
    try {
        const stats = await fs.lstat(lockfilePath, {bigint: true});
        return stats.isDirectory() ? `${String(stats.dev)}:${String(stats.ino)}:${String(stats.birthtimeNs)}` : null;
    } catch (error) {
        if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) return null;
        throw error;
    }
}

const properLockfileAdapter: LogLocationLockAdapter = {
    acquire: async (directory, options) => {
        const release = await acquireFileLock(directory, options);
        let identity: string | null;
        try {
            identity = await readLockIdentity(options.lockfilePath);
        } catch (error) {
            await releaseQuietly(release);
            throw error;
        }
        if (identity === null) {
            await releaseQuietly(release);
            throw new Error(`日志位置授予在取得后不可读：${options.lockfilePath}`);
        }
        return async () => {
            // proper-lockfile 在进程内按路径共用锁表、释放只按路径删锁目录：授予被别的参与者接管后再调用它
            // 会删掉接管者的锁。只在锁目录仍是自己的（或已不存在）时交给它释放；已被接管就只报告失守。
            const current = await readLockIdentity(options.lockfilePath);
            if (current !== null && current !== identity) {
                options.onCompromised(new Error(`日志位置授予已被其它参与者接管：${options.lockfilePath}`));
                return;
            }
            try {
                await release();
            } catch (error) {
                // 已被判定失守（ERELEASED）或表项已不属于自己：没有可释放的授予。
                if (!isNodeErrorCode(error, "ERELEASED") && !isNodeErrorCode(error, "ENOTACQUIRED")) throw error;
            }
        };
    },
};

/** 取得授予后的后续步骤失败时退还授予；退还失败不能掩盖原始错误，写一行到 stderr 留痕。 */
async function releaseQuietly(release: () => Promise<void>): Promise<void> {
    try {
        await release();
    } catch (error) {
        process.stderr.write(`${JSON.stringify({diagnostic: {event: "diagnostics.lock.releaseFailed", detail: describeDiagnosticError(error)}})}\n`);
    }
}

export interface JsonlExporterOptions {
    /** 宿主已解析并授予的日志位置；出口只在这里追加、轮转与回收。 */
    readonly directory: string;
    readonly maxFileBytes?: number;
    readonly retention?: number;
    readonly maxAgeMs?: number;
    readonly maxTotalBytes?: number;
    readonly now?: () => Date;
    readonly lock?: LogLocationLockAdapter;
}

/** 每次调用尝试取得日志位置授予；拿不到授予或位置不可用时返回降级结果。 */
export function createJsonlExporterFactory(options: JsonlExporterOptions): DiagnosticExporterFactory {
    return () => openJsonlExporter(options);
}

async function openJsonlExporter(options: JsonlExporterOptions): Promise<ExporterOpenOutcome> {
    try {
        await fs.mkdir(options.directory, {recursive: true});
    } catch (error) {
        // 位置不可创建（例如父路径被普通文件占据）：不写、不轮转、不回收，直接降级。
        return {status: "degraded", reason: "location-unavailable", detail: describeDiagnosticError(error)};
    }
    let grantLost = false;
    const lost = Promise.withResolvers<DiagnosticsDegraded>();
    let releaseGrant: () => Promise<void>;
    try {
        releaseGrant = await (options.lock ?? properLockfileAdapter).acquire(options.directory, {
            lockfilePath: path.join(options.directory, LOG_LOCATION_LOCK_NAME),
            realpath: false,
            stale: LOG_LOCATION_LOCK_STALE_MS,
            update: LOG_LOCATION_LOCK_UPDATE_MS,
            retries: 0,
            onCompromised: (error) => {
                // 授予失守（锁文件被删除或心跳超时）：之后不再写、不再回收，并通知提供者降级。
                grantLost = true;
                lost.resolve({reason: "location-compromised", detail: describeDiagnosticError(error)});
            },
        });
    } catch (error) {
        return {
            status: "degraded",
            reason: isNodeErrorCode(error, "ELOCKED") ? "location-conflict" : "location-unavailable",
            detail: describeDiagnosticError(error),
        };
    }
    const writer = new JsonlLogWriter({
        directory: options.directory,
        ownsFile: isOwnedLogFile,
        maxFileBytes: options.maxFileBytes,
        retention: options.retention,
        maxAgeMs: options.maxAgeMs,
        maxTotalBytes: options.maxTotalBytes,
        now: options.now,
    });
    return {status: "open", exporter: new JsonlDiagnosticExporter(writer, releaseGrant, () => grantLost), degraded: lost.promise};
}

/** 逐行布局：来源身份放进 `data.$source`，不改外层字段含义。 */
export function formatDiagnosticLine(record: DiagnosticRecord): string {
    const entry: Record<string, unknown> = {
        timestamp: record.timestamp,
        level: record.level,
        event: record.event,
        message: record.message,
        data: attachSource(record.data, record.origin),
    };
    if (record.error !== null) entry.error = record.error;
    return `${JSON.stringify(entry)}\n`;
}

function attachSource(data: unknown, origin: DiagnosticOrigin): Record<string, unknown> {
    if (data === null) return {$source: origin};
    if (typeof data === "object" && !Array.isArray(data)) {
        const prototype: unknown = Object.getPrototypeOf(data);
        if (prototype === Object.prototype || prototype === null) return {...data, $source: origin};
    }
    return {value: data, $source: origin};
}

class JsonlDiagnosticExporter implements DiagnosticExporter {
    readonly kind = "jsonl";
    readonly #writer: JsonlLogWriter;
    readonly #releaseGrant: () => Promise<void>;
    readonly #grantLost: () => boolean;
    #flushed = false;
    #released = false;
    #closed = false;
    #closing: Promise<void> | null = null;

    constructor(writer: JsonlLogWriter, releaseGrant: () => Promise<void>, grantLost: () => boolean) {
        this.#writer = writer;
        this.#releaseGrant = releaseGrant;
        this.#grantLost = grantLost;
    }

    async write(record: DiagnosticRecord): Promise<void> {
        if (this.#closed) throw new Error("诊断文件出口已关闭，不再写入");
        if (this.#grantLost()) throw new Error("日志位置授予已失效，不再写入");
        await this.#writer.write(formatDiagnosticLine(record));
    }

    /** 重复关闭观察同一次在途结果；失败后再次调用只重试未完成的步骤。 */
    close(): Promise<void> {
        if (this.#closed) return Promise.resolve();
        if (this.#closing !== null) return this.#closing;
        this.#closing = this.#runClose().finally(() => {
            this.#closing = null;
        });
        return this.#closing;
    }

    async #runClose(): Promise<void> {
        if (!this.#flushed) {
            await this.#writer.close();
            this.#flushed = true;
        }
        if (!this.#released) {
            // 授予已失守时锁已被外部删除或取代，不再释放。
            if (!this.#grantLost()) await this.#releaseGrant();
            this.#released = true;
        }
        this.#closed = true;
    }
}

/** 宿主兜底通道：降级时向 stderr 写一行脱敏 JSON；它自身不抛错。 */
export function createStderrFallback(): DiagnosticFallback {
    return (record) => {
        try {
            process.stderr.write(`${JSON.stringify({diagnostic: {
                timestamp: record.timestamp,
                level: record.level,
                event: record.event,
                message: record.message,
                origin: record.origin,
            }})}\n`);
        } catch {
            // stderr 已断开时没有更低一级的出口；兜底通道按合同不抛错。
        }
    };
}
