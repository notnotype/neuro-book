/**
 * JSONL 日志写入器：追加、按预算轮转、按归属回收历史文件。
 *
 * 目录、预算与归属谓词都由调用方给出，不读环境变量、不推导 cwd、不认领不属于自己的文件。
 * `write` 在写入失败时拒绝（调用方决定降级还是忽略），队列不因单次失败中断；`close()` 等队列
 * 清空后让随后的写入明确失败，不静默重建文件。
 */

import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** 当前日志文件名；轮转产物命名见 `rotatedLogName`。 */
export const CURRENT_LOG_NAME = "server-current.jsonl";

export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RETENTION = 8;
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

interface LogFileSummary {
    readonly path: string;
    readonly name: string;
    readonly size: number;
    readonly mtimeMs: number;
}

/** 本地时间戳片段，用于可排序的轮转文件名。 */
function formatLogTimestamp(date: Date): string {
    const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
    return `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 轮转产物：可排序前缀，加上区分同秒多次轮转的进程号与随机片段。 */
export function rotatedLogName(date: Date, pid: number, token: string): string {
    return `server-${formatLogTimestamp(date)}-${String(pid)}-${token}.jsonl`;
}

/** 诊断文件出口拥有的日志：当前文件与它的轮转产物；位置内的其它文件不归它管。 */
export function isOwnedLogFile(name: string): boolean {
    return name === CURRENT_LOG_NAME || /^server-\d{8}-\d{6}-\d+-[a-f0-9]+\.jsonl$/iu.test(name);
}

/** 宿主错误的 code（例如 ENOENT、ELOCKED）；按 code 分支，不按文案。 */
export function isNodeErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export interface JsonlLogWriterOptions {
    readonly directory: string;
    /** 只有判为归属的文件参与轮转与回收，其它文件绝不删除。 */
    readonly ownsFile: (name: string) => boolean;
    readonly maxFileBytes?: number;
    readonly retention?: number;
    readonly maxAgeMs?: number;
    readonly maxTotalBytes?: number;
    readonly now?: () => Date;
}

export class JsonlLogWriter {
    readonly #directory: string;
    readonly #ownsFile: (name: string) => boolean;
    readonly #maxFileBytes: number;
    readonly #retention: number;
    readonly #maxAgeMs: number;
    readonly #maxTotalBytes: number;
    readonly #now: () => Date;
    #queue: Promise<void> = Promise.resolve();
    #initialPruneComplete = false;
    #closed = false;

    constructor(options: JsonlLogWriterOptions) {
        this.#directory = options.directory;
        this.#ownsFile = options.ownsFile;
        this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
        this.#retention = options.retention ?? DEFAULT_RETENTION;
        this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
        this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
        this.#now = options.now ?? (() => new Date());
    }

    get currentFilePath(): string {
        return path.join(this.#directory, CURRENT_LOG_NAME);
    }

    /** 追加一行并等待本次写入结算。 */
    write(line: string): Promise<void> {
        if (this.#closed) return Promise.reject(new Error(`日志写入器已关闭：${this.#directory}`));
        const task = this.#queue.then(() => this.#append(line));
        this.#queue = task.then(() => undefined, () => undefined);
        return task;
    }

    /** 等队列清空并关闭；重复关闭共享同一结果。 */
    async close(): Promise<void> {
        this.#closed = true;
        await this.#queue;
    }

    async #append(line: string): Promise<void> {
        await fs.mkdir(this.#directory, {recursive: true});
        const nextBytes = Buffer.byteLength(line, "utf8");
        if (!this.#initialPruneComplete) {
            const currentBytes = await this.#currentLogBytes();
            await this.#prune(this.#maxTotalBytes - currentBytes - nextBytes);
            this.#initialPruneComplete = true;
        }
        await this.#rotateIfNeeded(nextBytes);
        await fs.appendFile(this.currentFilePath, line, "utf8");
    }

    async #currentLogBytes(): Promise<number> {
        try {
            return (await fs.stat(this.currentFilePath)).size;
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) return 0;
            throw error;
        }
    }

    async #rotateIfNeeded(nextBytes: number): Promise<void> {
        const currentBytes = await this.#currentLogBytes();
        if (currentBytes === 0 || currentBytes + nextBytes <= this.#maxFileBytes) return;
        const token = randomUUID().slice(0, 8);
        const rotatedPath = path.join(this.#directory, rotatedLogName(this.#now(), process.pid, token));
        try {
            await fs.rename(this.currentFilePath, rotatedPath);
        } catch (error) {
            if (!isNodeErrorCode(error, "ENOENT")) throw error;
        }
        await this.#prune(this.#maxTotalBytes - nextBytes);
    }

    /** 回收当前文件以外的归属日志，同时满足文件数、总字节与保留期预算。 */
    async #prune(historicalByteBudget: number): Promise<void> {
        const oldestMtimeMs = this.#now().getTime() - this.#maxAgeMs;
        const historicalRetention = this.#retention - 1;
        let keptFiles = 0;
        let keptBytes = 0;
        for (const file of await this.#listHistoricalFiles()) {
            const exceedsBudget = keptFiles >= Math.max(0, historicalRetention) || keptBytes + file.size > Math.max(0, historicalByteBudget);
            if (exceedsBudget || file.mtimeMs < oldestMtimeMs) {
                await fs.rm(file.path, {force: true});
                continue;
            }
            keptFiles += 1;
            keptBytes += file.size;
        }
    }

    /** 当前文件以外的归属日志，按最近修改排序；目录不存在视为空。 */
    async #listHistoricalFiles(): Promise<LogFileSummary[]> {
        let entries;
        try {
            entries = await fs.readdir(this.#directory, {withFileTypes: true});
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) return [];
            throw error;
        }
        const files: LogFileSummary[] = [];
        for (const entry of entries) {
            if (!entry.isFile() || entry.name === CURRENT_LOG_NAME || !this.#ownsFile(entry.name)) continue;
            const filePath = path.join(this.#directory, entry.name);
            const stat = await fs.stat(filePath);
            files.push({path: filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs});
        }
        return files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    }
}
