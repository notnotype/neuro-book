import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

const OWNER = "neuro-book.agent-bash-output";
const MARKER_FILE = ".owner.json";
const OUTPUT_FILE = "output.log";
const LOCATOR_PREFIX = "bash-output://";

export type BashOutputPolicy = Readonly<{
    ttlMs: number;
    maxFiles: number;
    maxBytes: number;
    maxOutputBytes: number;
}>;

/** Bash完整输出的默认保留与容量合同。 */
export const BASH_OUTPUT_POLICY: BashOutputPolicy = Object.freeze({
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxFiles: 128,
    maxBytes: 256 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
});

export type BashOutputReference = Readonly<
    | {
        /** 不含物理Cache Root的稳定逻辑地址。 */
        locator: string;
        /** partial表示命令输出超过单文件硬上限，只保留此前内容。 */
        state: "available" | "partial";
    }
    | {
        /** 活跃输出占满硬预算，或历史物理文件已经不可用。 */
        state: "reclaimed";
    }
>;

export type BashOutputAvailableReference = Extract<BashOutputReference, {locator: string}>;

type LeaseMarker = {
    schemaVersion: 1;
    owner: typeof OWNER;
    leaseId: string;
    state: "active" | "complete";
    createdAt: string;
    completedAt?: string;
    expiresAt: string;
    bytes: number;
    capped: boolean;
};

type InventoryEntry = {
    leaseId: string;
    leaseRoot: string;
    marker: LeaseMarker;
    bytes: number;
    completedAt: number;
};

/** OutputAccumulator持有的单次写入保留位。 */
export type BashOutputReservation = Readonly<{
    reference: BashOutputAvailableReference;
    physicalPath: string;
    maxBytes: number;
    complete(bytes: number, capped: boolean): Promise<void>;
    discard(): Promise<void>;
}>;

/** locator已失效或对应cache被回收。 */
export class BashOutputReclaimedError extends Error {
    constructor(locator: string) {
        super(`Bash完整输出已回收：${locator}`);
        this.name = "BashOutputReclaimedError";
    }
}

/**
 * Cache Root内Bash完整输出的唯一owner。
 *
 * Store只接管带有效marker的lease目录；TTL、文件数和字节数在初始化、预留和
 * 完成写入时执行。当前进程仍在写的lease属于活跃集合，不参与回收。
 */
export class BashOutputStore {
    private readonly activeLeases = new Set<string>();
    private reservedBytes = 0;
    private operation = Promise.resolve();

    constructor(
        private readonly root: AbsoluteFsPath,
        private readonly policy: BashOutputPolicy = BASH_OUTPUT_POLICY,
        private readonly now: () => number = Date.now,
    ) {
        if (policy.ttlMs < 1 || policy.maxFiles < 1 || policy.maxBytes < 1
            || policy.maxOutputBytes < 1 || policy.maxOutputBytes > policy.maxBytes) {
            throw new Error("Bash完整输出缓存策略非法");
        }
    }

    /** 为一次可能产生长输出的命令预留lease；预算被活跃项占满时返回null。 */
    async reserve(): Promise<BashOutputReservation | null> {
        return this.exclusive(async () => {
            await this.initialize();
            await this.reclaim(this.reservedBytes + this.policy.maxOutputBytes, 1);
            const inventory = await this.inventory();
            const retainedBytes = inventory
                .filter((entry) => !this.activeLeases.has(entry.leaseId))
                .reduce((sum, entry) => sum + entry.bytes, 0);
            if (inventory.length >= this.policy.maxFiles
                || retainedBytes + this.reservedBytes + this.policy.maxOutputBytes > this.policy.maxBytes) {
                return null;
            }

            const leaseId = randomUUID();
            const leaseRoot = path.join(this.root, leaseId);
            const physicalPath = path.join(leaseRoot, OUTPUT_FILE);
            const createdAt = this.now();
            await fs.mkdir(leaseRoot);
            await this.writeMarker(leaseRoot, {
                schemaVersion: 1,
                owner: OWNER,
                leaseId,
                state: "active",
                createdAt: new Date(createdAt).toISOString(),
                expiresAt: new Date(createdAt + this.policy.ttlMs).toISOString(),
                bytes: 0,
                capped: false,
            });
            this.activeLeases.add(leaseId);
            this.reservedBytes += this.policy.maxOutputBytes;
            let settled = false;
            const reference: BashOutputAvailableReference = Object.freeze({
                locator: `${LOCATOR_PREFIX}${leaseId}/${OUTPUT_FILE}`,
                state: "available",
            });
            return Object.freeze({
                reference,
                physicalPath,
                maxBytes: this.policy.maxOutputBytes,
                complete: async (bytes: number, capped: boolean) => {
                    if (settled) return;
                    settled = true;
                    await this.exclusive(async () => {
                        const completedAt = this.now();
                        this.activeLeases.delete(leaseId);
                        this.reservedBytes -= this.policy.maxOutputBytes;
                        const outputStat = await fs.stat(physicalPath).catch(() => null);
                        const physicalBytes = outputStat?.isFile() ? outputStat.size : 0;
                        const retainedBytes = Math.min(physicalBytes, this.policy.maxOutputBytes);
                        const outputCapped = capped || physicalBytes > retainedBytes;
                        if (physicalBytes > retainedBytes) {
                            await fs.truncate(physicalPath, retainedBytes);
                        }
                        await this.writeMarker(leaseRoot, {
                            schemaVersion: 1,
                            owner: OWNER,
                            leaseId,
                            state: "complete",
                            createdAt: new Date(createdAt).toISOString(),
                            completedAt: new Date(completedAt).toISOString(),
                            expiresAt: new Date(completedAt + this.policy.ttlMs).toISOString(),
                            bytes: Math.min(bytes, retainedBytes),
                            capped: outputCapped,
                        });
                        await this.reclaim(this.reservedBytes);
                    });
                },
                discard: async () => {
                    if (settled) return;
                    settled = true;
                    await this.exclusive(async () => {
                        this.activeLeases.delete(leaseId);
                        this.reservedBytes -= this.policy.maxOutputBytes;
                        await fs.rm(leaseRoot, {recursive: true, force: true});
                    });
                },
            });
        });
    }

    /** 读取逻辑locator；无效、过期、缺失与被预算驱逐统一返回明确回收错误。 */
    async read(locator: string): Promise<Buffer> {
        await this.exclusive(async () => {
            await this.initialize();
            await this.reclaim();
        });
        const parsed = parseLocator(locator);
        if (!parsed) {
            throw new Error(`Bash完整输出locator非法：${locator}`);
        }
        const leaseRoot = path.join(this.root, parsed.leaseId);
        const marker = await this.readMarker(leaseRoot);
        if (!marker || marker.leaseId !== parsed.leaseId || marker.state !== "complete") {
            throw new BashOutputReclaimedError(locator);
        }
        try {
            return await fs.readFile(path.join(leaseRoot, OUTPUT_FILE));
        } catch (error) {
            if (isMissing(error)) {
                throw new BashOutputReclaimedError(locator);
            }
            throw error;
        }
    }

    /** 测试与进程启动使用：立即执行一次TTL和硬预算回收。 */
    async collect(): Promise<void> {
        await this.exclusive(async () => {
            await this.initialize();
            await this.reclaim();
        });
    }

    private async initialize(): Promise<void> {
        await fs.mkdir(this.root, {recursive: true});
    }

    /** 回收过期项，再按完成时间从旧到新收紧文件与字节预算。 */
    private async reclaim(reservedBytes = this.reservedBytes, reservedFiles = 0): Promise<void> {
        const now = this.now();
        let entries = await this.inventory();
        for (const entry of entries) {
            if (!this.activeLeases.has(entry.leaseId) && Date.parse(entry.marker.expiresAt) <= now) {
                await fs.rm(entry.leaseRoot, {recursive: true, force: true});
            }
        }
        entries = (await this.inventory())
            .filter((entry) => !this.activeLeases.has(entry.leaseId))
            .sort((left, right) => left.completedAt - right.completedAt || left.leaseId.localeCompare(right.leaseId));
        let all = await this.inventory();
        let totalBytes = all
            .filter((entry) => !this.activeLeases.has(entry.leaseId))
            .reduce((sum, entry) => sum + entry.bytes, reservedBytes);
        let totalFiles = all.length;
        for (const entry of entries) {
            if (totalFiles + reservedFiles <= this.policy.maxFiles
                && totalBytes + reservedBytes <= this.policy.maxBytes) break;
            await fs.rm(entry.leaseRoot, {recursive: true, force: true});
            totalFiles -= 1;
            totalBytes -= entry.bytes;
        }
    }

    /** 只枚举带本Module有效owner marker的lease，未知目录永不删除。 */
    private async inventory(): Promise<InventoryEntry[]> {
        const entries: InventoryEntry[] = [];
        const names = await fs.readdir(this.root).catch((error: unknown) => {
            if (isMissing(error)) return [];
            throw error;
        });
        for (const name of names) {
            const leaseRoot = path.join(this.root, name);
            const marker = await this.readMarker(leaseRoot);
            if (!marker || marker.leaseId !== name) continue;
            const outputStat = await fs.stat(path.join(leaseRoot, OUTPUT_FILE)).catch(() => null);
            const bytes = outputStat?.isFile() ? outputStat.size : 0;
            entries.push({
                leaseId: name,
                leaseRoot,
                marker,
                bytes,
                completedAt: Date.parse(marker.completedAt ?? marker.createdAt),
            });
        }
        return entries;
    }

    private async readMarker(leaseRoot: string): Promise<LeaseMarker | null> {
        try {
            const value: unknown = JSON.parse(await fs.readFile(path.join(leaseRoot, MARKER_FILE), "utf8"));
            return isMarker(value) ? value : null;
        } catch {
            return null;
        }
    }

    private async writeMarker(leaseRoot: string, marker: LeaseMarker): Promise<void> {
        const temporary = path.join(leaseRoot, `${MARKER_FILE}.${randomUUID()}.tmp`);
        await fs.writeFile(temporary, `${JSON.stringify(marker, null, 4)}\n`, "utf8");
        await fs.rename(temporary, path.join(leaseRoot, MARKER_FILE));
    }

    private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.operation;
        let release!: () => void;
        this.operation = new Promise<void>((resolve) => release = resolve);
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }
}

/** 判断read工具输入是否属于Bash cache逻辑地址。 */
export function isBashOutputLocator(value: string): boolean {
    return value.startsWith(LOCATOR_PREFIX);
}

function parseLocator(locator: string): {leaseId: string} | null {
    const match = /^bash-output:\/\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/output\.log$/iu.exec(locator);
    return match?.[1] ? {leaseId: match[1]} : null;
}

function isMarker(value: unknown): value is LeaseMarker {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const marker = value as Partial<LeaseMarker>;
    return marker.schemaVersion === 1
        && marker.owner === OWNER
        && typeof marker.leaseId === "string"
        && (marker.state === "active" || marker.state === "complete")
        && typeof marker.createdAt === "string"
        && typeof marker.expiresAt === "string"
        && Number.isFinite(Date.parse(marker.createdAt))
        && Number.isFinite(Date.parse(marker.expiresAt))
        && typeof marker.bytes === "number"
        && Number.isInteger(marker.bytes)
        && marker.bytes >= 0
        && typeof marker.capped === "boolean";
}

function isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
