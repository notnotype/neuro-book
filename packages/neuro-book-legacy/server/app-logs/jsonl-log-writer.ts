/**
 * JSONL 日志写入器：追加、按预算轮转、按归属回收历史文件。
 *
 * 产品基线日志（server/app-logs）与诊断文件出口共用它：目录、预算与归属谓词全部由调用方显式给出，
 * 不读环境变量、不推导 cwd、不认领不属于自己的文件。`write` 返回的 Promise 在写入失败时 reject
 * （调用方决定吞掉还是降级），队列本身不因单次失败中断；`close()` 等待队列清空并使随后写入明确
 * 失败，不静默重建文件。
 */

import {randomUUID} from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** 产品基线的当前日志文件名；轮转产物命名见 `serverRotatedLogName`。 */
export const SERVER_LOG_CURRENT_NAME = "server-current.jsonl";

export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RETENTION = 8;
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export interface LogFileSummary {
    readonly path: string;
    readonly name: string;
    readonly size: number;
    readonly mtimeMs: number;
}

/** 日志文件名的本地时间戳片段；产品既有布局用它拼接轮转名。 */
export function formatLogTimestamp(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}${second}`;
}

/** 轮转产物命名：可排序前缀 + 同秒内多次轮转靠 token 区分的后缀。 */
export function serverRotatedLogName(date: Date, pid: number, token: string): string {
    return `server-${formatLogTimestamp(date)}-${pid}-${token}.jsonl`;
}

/** 诊断文件出口拥有的日志：server current 与其轮转产物；launcher 日志与其它文件都不在内。 */
export function isOwnedServerLogFile(name: string): boolean {
    return name === SERVER_LOG_CURRENT_NAME || /^server-\d{8}-\d{6}-\d+-[a-f0-9]+\.jsonl$/iu.test(name);
}

/** 列出目录里判为归属的日志文件，按最近修改排序；目录不存在视为空。 */
export async function listLogFiles(directory: string, ownsFile: (name: string) => boolean): Promise<LogFileSummary[]> {
    const entries = await fs.readdir(directory, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    });
    const files: LogFileSummary[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !ownsFile(entry.name)) {
            continue;
        }
        const filePath = path.join(directory, entry.name);
        const stat = await fs.stat(filePath);
        files.push({path: filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs});
    }
    return files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
}

export interface JsonlLogWriterOptions {
    /** 显式日志目录；不从环境变量或 cwd 推导。 */
    readonly directory: string;
    /** 归属判定：只有判为 true 的文件参与轮转与回收，其它文件绝不删除。 */
    readonly ownsFile: (name: string) => boolean;
    readonly currentFileName?: string;
    readonly rotatedFileName?: (date: Date) => string;
    readonly maxFileBytes?: number;
    readonly retention?: number;
    readonly maxAgeMs?: number;
    readonly maxTotalBytes?: number;
    readonly now?: () => Date;
}

export class JsonlLogWriter {
    readonly #directory: string;
    readonly #ownsFile: (name: string) => boolean;
    readonly #currentFileName: string;
    readonly #rotatedFileName: (date: Date) => string;
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
        this.#currentFileName = options.currentFileName ?? SERVER_LOG_CURRENT_NAME;
        this.#rotatedFileName = options.rotatedFileName ?? ((date) => serverRotatedLogName(date, process.pid, randomUUID().slice(0, 8)));
        this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
        this.#retention = options.retention ?? DEFAULT_RETENTION;
        this.#maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
        this.#maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
        this.#now = options.now ?? (() => new Date());
    }

    get directory(): string {
        return this.#directory;
    }

    get currentFilePath(): string {
        return path.join(this.#directory, this.#currentFileName);
    }

    /** 追加一行并等待本次写入结算；写失败只让本次 Promise reject，队列继续服务后续写入。 */
    write(line: string): Promise<void> {
        if (this.#closed) {
            return Promise.reject(new Error(`日志写入器已关闭：${this.#directory}`));
        }
        const task = this.#queue.then(() => this.#append(line));
        this.#queue = task.then(() => undefined, () => undefined);
        return task;
    }

    /** 崩溃路径的同步追加；失败直接交给调用方决定如何收口。 */
    writeSync(line: string): void {
        if (this.#closed) {
            throw new Error(`日志写入器已关闭：${this.#directory}`);
        }
        this.#appendSync(line);
    }

    /** 等待当前队列清空；不关闭写入器。 */
    async flush(): Promise<void> {
        await this.#queue;
    }

    /** 等待队列清空并关闭；重复关闭共享同一结果，之后写入明确失败。 */
    async close(): Promise<void> {
        this.#closed = true;
        await this.#queue;
    }

    async #append(line: string): Promise<void> {
        await fs.mkdir(this.#directory, {recursive: true});
        const nextBytes = Buffer.byteLength(line, "utf8");
        if (!this.#initialPruneComplete) {
            const currentBytes = await this.#currentLogBytes();
            await this.#prune(this.#retention - 1, this.#maxTotalBytes - currentBytes - nextBytes, this.#now().getTime() - this.#maxAgeMs, this.currentFilePath);
            this.#initialPruneComplete = true;
        }
        await this.#rotateIfNeeded(nextBytes);
        await fs.appendFile(this.currentFilePath, line, "utf8");
    }

    #appendSync(line: string): void {
        fsSync.mkdirSync(this.#directory, {recursive: true});
        const nextBytes = Buffer.byteLength(line, "utf8");
        if (!this.#initialPruneComplete) {
            const currentBytes = this.#currentLogBytesSync();
            this.#pruneSync(this.#retention - 1, this.#maxTotalBytes - currentBytes - nextBytes, this.#now().getTime() - this.#maxAgeMs, this.currentFilePath);
            this.#initialPruneComplete = true;
        }
        this.#rotateIfNeededSync(nextBytes);
        fsSync.appendFileSync(this.currentFilePath, line, "utf8");
    }

    async #currentLogBytes(): Promise<number> {
        return await fs.stat(this.currentFilePath).then((stat) => stat.size).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return 0;
            }
            throw error;
        });
    }

    #currentLogBytesSync(): number {
        try {
            return fsSync.statSync(this.currentFilePath).size;
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return 0;
            }
            throw error;
        }
    }

    async #rotateIfNeeded(nextBytes: number): Promise<void> {
        const stat = await fs.stat(this.currentFilePath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") {
                return null;
            }
            throw error;
        });
        if (!stat || stat.size + nextBytes <= this.#maxFileBytes) {
            return;
        }
        const rotatedPath = path.join(this.#directory, this.#rotatedFileName(this.#now()));
        await fs.rename(this.currentFilePath, rotatedPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") {
                throw error;
            }
        });
        await this.#prune(this.#retention - 1, this.#maxTotalBytes - nextBytes, this.#now().getTime() - this.#maxAgeMs, this.currentFilePath);
    }

    #rotateIfNeededSync(nextBytes: number): void {
        let size = 0;
        try {
            size = fsSync.statSync(this.currentFilePath).size;
        } catch (error) {
            if (!isNodeErrorCode(error, "ENOENT")) {
                throw error;
            }
            return;
        }
        if (size + nextBytes <= this.#maxFileBytes) {
            return;
        }
        const rotatedPath = path.join(this.#directory, this.#rotatedFileName(this.#now()));
        try {
            fsSync.renameSync(this.currentFilePath, rotatedPath);
        } catch (error) {
            if (!isNodeErrorCode(error, "ENOENT")) {
                throw error;
            }
        }
        this.#pruneSync(this.#retention - 1, this.#maxTotalBytes - nextBytes, this.#now().getTime() - this.#maxAgeMs, this.currentFilePath);
    }

    /** 回收非 current 的归属日志，同时满足文件数、总字节与保留期预算。 */
    async #prune(historicalRetention: number, historicalByteBudget: number, oldestMtimeMs: number, protectedPath: string): Promise<void> {
        const files = (await listLogFiles(this.#directory, this.#ownsFile)).filter((file) => file.path !== protectedPath);
        let keptFiles = 0;
        let keptBytes = 0;
        for (const file of files) {
            const exceedsBudget = keptFiles >= Math.max(0, historicalRetention)
                || keptBytes + file.size > Math.max(0, historicalByteBudget);
            if (exceedsBudget || file.mtimeMs < oldestMtimeMs) {
                await fs.rm(file.path, {force: true});
                continue;
            }
            keptFiles += 1;
            keptBytes += file.size;
        }
    }

    #pruneSync(historicalRetention: number, historicalByteBudget: number, oldestMtimeMs: number, protectedPath: string): void {
        const files = this.#listOwnedFilesSync().filter((file) => file.path !== protectedPath);
        let keptFiles = 0;
        let keptBytes = 0;
        for (const file of files) {
            const exceedsBudget = keptFiles >= Math.max(0, historicalRetention)
                || keptBytes + file.size > Math.max(0, historicalByteBudget);
            if (exceedsBudget || file.mtimeMs < oldestMtimeMs) {
                fsSync.rmSync(file.path, {force: true});
                continue;
            }
            keptFiles += 1;
            keptBytes += file.size;
        }
    }

    #listOwnedFilesSync(): LogFileSummary[] {
        return fsSync.readdirSync(this.#directory, {withFileTypes: true})
            .filter((entry) => entry.isFile() && this.#ownsFile(entry.name))
            .map((entry) => {
                const filePath = path.join(this.#directory, entry.name);
                const stat = fsSync.statSync(filePath);
                return {path: filePath, name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs};
            })
            .sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
    }
}

/** 判定宿主错误的 code（例如 ENOENT、ELOCKED）；调用方按 code 分支，不按文案分支。 */
export function isNodeErrorCode(error: unknown, code: string): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
