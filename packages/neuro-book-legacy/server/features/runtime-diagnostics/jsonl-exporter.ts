/**
 * 诊断文件出口：在宿主获授的日志位置追加逐行 JSONL，按预算轮转与保留，位置冲突或授予失守时降级。
 *
 * 位置授予用 proper-lockfile 锁住目录（锁文件放目录内），与 Project Lock 共用 stale/update 约定：
 * 同一物理位置同时只能有一个存活的出口 owner；拿不到授予的实例不写、不轮转、不回收别人的文件。
 * 出口只管理自己拥有的 `server-*` 文件，不碰 launcher 日志或其它文件，也不发起任何网络调用。
 */

import fs from "node:fs/promises";
import path from "node:path";
import {lock as acquireFileLock, type LockOptions} from "proper-lockfile";

import type {
    DiagnosticExporter,
    DiagnosticExporterFactory,
    DiagnosticFallback,
    DiagnosticRecord,
    DiagnosticsDegraded,
    ExporterOpenOutcome,
} from "nbook/runtime/diagnostics/diagnostics";
import {describeDiagnosticError} from "nbook/runtime/diagnostics/diagnostics";
import {JsonlLogWriter, isNodeErrorCode, isOwnedServerLogFile} from "nbook/server/app-logs/jsonl-log-writer";
import {formatDiagnosticLine} from "nbook/server/app-logs/diagnostic-format";

/** 授予锁文件；放在被授予目录内，跟随目录移动，且不匹配任何 `server-*` 日志归属模式。 */
export const LOG_LOCATION_LOCK_NAME = "server-logs.lock";

/** 所有 NeuroBook 进程必须共享的 proper-lockfile stale 参数（与 Project Lock 一致）。 */
export const LOG_LOCATION_LOCK_STALE_MS = 30_000;

/** 所有 NeuroBook 进程必须共享的 proper-lockfile heartbeat 参数（与 Project Lock 一致）。 */
export const LOG_LOCATION_LOCK_UPDATE_MS = 10_000;

/** 日志位置授予只接受本项目冻结的 proper-lockfile 参数。 */
export interface LogLocationLockOptions {
    readonly lockfilePath: string;
    readonly realpath: false;
    readonly stale: number;
    readonly update: number;
    readonly retries: NonNullable<LockOptions["retries"]>;
    readonly onCompromised: (error: Error) => void;
}

/**
 * 日志位置授予对外部锁依赖的最小适配器；测试可用它注入冲突与授予失守。
 * 释放前发现授予已不属于自己时，适配器经 `onCompromised` 报告失守并跳过删除，而不是抛错。
 */
export type LogLocationLockAdapter = {
    acquire(directory: string, options: LogLocationLockOptions): Promise<() => Promise<void>>;
};

/** 锁目录身份：设备、inode 与创建时间；心跳只改 mtime，被别人接管后身份不同。缺失返回 null。 */
async function readLockIdentity(lockfilePath: string): Promise<string | null> {
    try {
        const stats = await fs.lstat(lockfilePath, {bigint: true});
        return stats.isDirectory() ? `${stats.dev}:${stats.ino}:${stats.birthtimeNs}` : null;
    } catch (error) {
        if (isNodeErrorCode(error, "ENOENT") || isNodeErrorCode(error, "ENOTDIR")) {
            return null;
        }
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
            await release().catch(() => undefined);
            throw error;
        }
        if (identity === null) {
            await release().catch(() => undefined);
            throw new Error(`日志位置授予在取得后不可读：${options.lockfilePath}`);
        }
        return async () => {
            // proper-lockfile 按路径在进程内共用一张锁表、释放只按路径删锁目录：授予被别的参与者接管后
            // 再调用它会删掉接管者的锁。只在锁目录仍是自己的（或已不存在）时交给它释放，停掉心跳；
            // 已被接管就只报告失守，本参与者遗留的心跳会在下一拍发现 mtime 不属于自己而自停。
            const current = await readLockIdentity(options.lockfilePath);
            if (current !== null && current !== identity) {
                options.onCompromised(new Error(`日志位置授予已被其它参与者接管：${options.lockfilePath}`));
                return;
            }
            try {
                await release();
            } catch (error) {
                // 已被 proper-lockfile 判定失守（ERELEASED）或表项已不属于自己：没有可释放的授予。
                if (!isNodeErrorCode(error, "ERELEASED") && !isNodeErrorCode(error, "ENOTACQUIRED")) {
                    throw error;
                }
            }
        };
    },
};

export interface JsonlExporterOptions {
    /** 宿主已解析并获授的日志位置；出口只在这里追加、轮转与回收。 */
    readonly directory: string;
    readonly maxFileBytes?: number;
    readonly retention?: number;
    readonly maxAgeMs?: number;
    readonly maxTotalBytes?: number;
    readonly now?: () => Date;
    readonly lock?: LogLocationLockAdapter;
}

/**
 * 创建诊断文件出口工厂：每次调用尝试取得日志位置授予；拿不到授予或位置不可用时返回降级结果，
 * 由诊断提供者继续用内存记录与紧急输出工作。
 */
export function createJsonlExporterFactory(options: JsonlExporterOptions): DiagnosticExporterFactory {
    return async () => openJsonlExporter(options);
}

async function openJsonlExporter(options: JsonlExporterOptions): Promise<ExporterOpenOutcome> {
    try {
        await fs.mkdir(options.directory, {recursive: true});
    } catch (error) {
        // 位置不可创建（例如父路径被普通文件占据）：不写、不轮转、不回收，直接降级。
        return {status: "degraded", reason: "location-unavailable", detail: describeDiagnosticError(error)};
    }
    let grantLost = false;
    let notifyLost: (degraded: DiagnosticsDegraded) => void = () => undefined;
    const lost = new Promise<DiagnosticsDegraded>((resolve) => {
        notifyLost = resolve;
    });
    let releaseGrant: () => Promise<void>;
    try {
        releaseGrant = await (options.lock ?? properLockfileAdapter).acquire(options.directory, {
            lockfilePath: path.join(options.directory, LOG_LOCATION_LOCK_NAME),
            realpath: false,
            stale: LOG_LOCATION_LOCK_STALE_MS,
            update: LOG_LOCATION_LOCK_UPDATE_MS,
            retries: 0,
            onCompromised: (error) => {
                // 授予失守（锁文件被删除或心跳超时）：标记失守并通知提供者降级，之后不再写、不再回收。
                grantLost = true;
                notifyLost({reason: "location-compromised", detail: describeDiagnosticError(error)});
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
        ownsFile: isOwnedServerLogFile,
        maxFileBytes: options.maxFileBytes,
        retention: options.retention,
        maxAgeMs: options.maxAgeMs,
        maxTotalBytes: options.maxTotalBytes,
        now: options.now,
    });
    return {status: "open", exporter: new JsonlDiagnosticExporter(writer, releaseGrant, () => grantLost), degraded: lost};
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
        if (this.#closed) {
            throw new Error("诊断文件出口已关闭，不再写入");
        }
        if (this.#grantLost()) {
            throw new Error("日志位置授予已失效，不再写入");
        }
        await this.#writer.write(formatDiagnosticLine(record));
    }

    close(): Promise<void> {
        if (this.#closed) {
            return Promise.resolve();
        }
        if (this.#closing !== null) {
            // 在途关闭：观察同一结果，不与它重入。
            return this.#closing;
        }
        this.#closing = this.#runClose().then(
            () => {
                this.#closing = null;
            },
            (error: unknown) => {
                this.#closing = null;
                throw error;
            },
        );
        return this.#closing;
    }

    /** 只重试未完成的那一步：先补写队列，再释放授予；已完成的步骤不重复执行。 */
    async #runClose(): Promise<void> {
        if (!this.#flushed) {
            await this.#writer.close();
            this.#flushed = true;
        }
        if (!this.#released) {
            if (this.#grantLost()) {
                // 授予已失守：锁已被外部删除或取代，释放无意义，也不再回写任何文件。
                this.#released = true;
            } else {
                await this.#releaseGrant();
                this.#released = true;
            }
        }
        this.#closed = true;
    }
}

/**
 * 宿主兜底通道：降级时向 stderr 写一行脱敏 JSON。它本身永不抛错，也不复制完整日志职责。
 */
export function createStderrFallback(): DiagnosticFallback {
    return (record) => {
        try {
            const line = JSON.stringify({
                diagnostic: {
                    timestamp: record.timestamp,
                    level: record.level,
                    event: record.event,
                    message: record.message,
                    origin: record.origin,
                },
            });
            process.stderr.write(`${line}\n`);
        } catch {
            // 兜底通道自身不可用（例如 stderr 已断开）时不再尝试第二次上报。
        }
    };
}
