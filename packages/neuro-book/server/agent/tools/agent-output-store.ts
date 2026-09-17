import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";

const MARKER_FILE = ".owner.json";
const OUTPUT_FILE = "output.log";

/** Cache Root内一类完整输出的owner、逻辑地址与提示文案。 */
export type AgentOutputStoreSpec = Readonly<{
    /** 模型可见的短名称，用于回收与策略错误文案。 */
    label: string;
    /** 写入marker的owner标识；Store只接管带本owner marker的lease。 */
    owner: string;
    /** 模型可见的逻辑地址前缀，例如bash-output://。 */
    locatorPrefix: string;
    /** RuntimePaths中承载本类完整输出的Cache Root字段。 */
    rootKey: "bashOutputRoot" | "toolOutputRoot";
}>;

/** Bash完整输出的默认Spec。 */
export const BASH_OUTPUT_SPEC: AgentOutputStoreSpec = Object.freeze({
    label: "Bash",
    owner: "neuro-book.agent-bash-output",
    locatorPrefix: "bash-output://",
    rootKey: "bashOutputRoot",
});

/** 通用工具结果完整输出的默认Spec。 */
export const TOOL_OUTPUT_SPEC: AgentOutputStoreSpec = Object.freeze({
    label: "工具结果",
    owner: "neuro-book.agent-tool-output",
    locatorPrefix: "tool-output://",
    rootKey: "toolOutputRoot",
});

const AGENT_OUTPUT_SPECS: readonly AgentOutputStoreSpec[] = [BASH_OUTPUT_SPEC, TOOL_OUTPUT_SPEC];

export type AgentOutputPolicy = Readonly<{
    ttlMs: number;
    maxFiles: number;
    maxBytes: number;
    maxOutputBytes: number;
}>;

/** 完整输出的默认保留与容量合同。 */
export const AGENT_OUTPUT_POLICY: AgentOutputPolicy = Object.freeze({
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    maxFiles: 128,
    maxBytes: 256 * 1024 * 1024,
    maxOutputBytes: 16 * 1024 * 1024,
});

export type AgentOutputReference = Readonly<
    | {
        /** 不含物理Cache Root的稳定逻辑地址。 */
        locator: string;
        /** partial表示输出超过单文件硬上限，只保留此前内容。 */
        state: "available" | "partial";
    }
    | {
        /** 活跃输出占满硬预算，或历史物理文件已经不可用。 */
        state: "reclaimed";
    }
>;

export type AgentOutputAvailableReference = Extract<AgentOutputReference, {locator: string}>;

/** 一次性落盘完成后的稳定引用。 */
export type AgentOutputSpill = Readonly<{
    locator: string;
    /** partial表示只保留了单文件硬上限内的前缀。 */
    state: "available" | "partial";
}>;

type LeaseMarker = {
    schemaVersion: 1;
    owner: string;
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

/** OutputAccumulator与一次性落盘持有的单次写入保留位。 */
export type AgentOutputReservation = Readonly<{
    reference: AgentOutputAvailableReference;
    physicalPath: string;
    maxBytes: number;
    complete(bytes: number, capped: boolean): Promise<void>;
    discard(): Promise<void>;
}>;

/** locator已失效或对应cache被回收。 */
export class AgentOutputReclaimedError extends Error {
    constructor(locator: string, label = "Bash") {
        super(`${label}完整输出已回收：${locator}`);
        this.name = "AgentOutputReclaimedError";
    }
}

/**
 * Cache Root内一类完整输出的唯一owner。
 *
 * Store只接管带有效marker的lease目录；TTL、文件数和字节数在初始化、预留和
 * 完成写入时执行。当前进程仍在写的lease属于活跃集合，不参与回收。
 */
export class AgentOutputStore {
    private readonly activeLeases = new Set<string>();
    private reservedBytes = 0;
    private operation = Promise.resolve();

    constructor(
        private readonly root: AbsoluteFsPath,
        private readonly spec: AgentOutputStoreSpec,
        private readonly policy: AgentOutputPolicy = AGENT_OUTPUT_POLICY,
        private readonly now: () => number = Date.now,
    ) {
        if (policy.ttlMs < 1 || policy.maxFiles < 1 || policy.maxBytes < 1
            || policy.maxOutputBytes < 1 || policy.maxOutputBytes > policy.maxBytes) {
            throw new Error(`${spec.label}完整输出缓存策略非法`);
        }
    }

    /** 为一次可能产生长输出的写入预留lease；预算被活跃项占满时返回null。 */
    async reserve(): Promise<AgentOutputReservation | null> {
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
                owner: this.spec.owner,
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
            const reference: AgentOutputAvailableReference = Object.freeze({
                locator: `${this.spec.locatorPrefix}${leaseId}/${OUTPUT_FILE}`,
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
                            owner: this.spec.owner,
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

    /** 把一次性长文本写入Cache Root；预留失败或写入异常时返回null，绝不让调用方失败。 */
    async spill(text: string): Promise<AgentOutputSpill | null> {
        let reservation: AgentOutputReservation | null = null;
        try {
            reservation = await this.reserve();
            if (!reservation) {
                return null;
            }
            const buffer = Buffer.from(text, "utf-8");
            const retained = buffer.length <= reservation.maxBytes ? buffer : buffer.subarray(0, reservation.maxBytes);
            const capped = retained.length !== buffer.length;
            await fs.writeFile(reservation.physicalPath, retained, {flag: "wx"});
            await reservation.complete(retained.length, capped);
            return {locator: reservation.reference.locator, state: capped ? "partial" : "available"};
        } catch {
            await reservation?.discard().catch(() => undefined);
            return null;
        }
    }

    /** 读取逻辑locator；无效、过期、缺失与被预算驱逐统一返回明确回收错误。 */
    async read(locator: string): Promise<Buffer> {
        await this.exclusive(async () => {
            await this.initialize();
            await this.reclaim();
        });
        const parsed = parseLocator(locator, this.spec);
        if (!parsed) {
            throw new Error(`${this.spec.label}完整输出locator非法：${locator}`);
        }
        const leaseRoot = path.join(this.root, parsed.leaseId);
        const marker = await this.readMarker(leaseRoot);
        if (!marker || marker.leaseId !== parsed.leaseId || marker.state !== "complete") {
            throw new AgentOutputReclaimedError(locator, this.spec.label);
        }
        try {
            return await fs.readFile(path.join(leaseRoot, OUTPUT_FILE));
        } catch (error) {
            if (isMissing(error)) {
                throw new AgentOutputReclaimedError(locator, this.spec.label);
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
            return isMarker(value, this.spec) ? value : null;
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

const agentOutputStores = new Map<string, Promise<AgentOutputStore | null>>();

/** 判断read工具输入是否属于任一Agent完整输出cache逻辑地址。 */
export function isAgentOutputLocator(value: string): boolean {
    return AGENT_OUTPUT_SPECS.some((spec) => value.startsWith(spec.locatorPrefix));
}

/** Cache Root由生产RuntimePaths注入；纯Repository测试不允许隐式回退到Workspace。 */
export async function agentOutputStoreFor(spec: AgentOutputStoreSpec, paths: RuntimePaths | undefined): Promise<AgentOutputStore | null> {
    const root = paths?.[spec.rootKey];
    if (!root) {
        return null;
    }
    const cacheKey = `${spec.owner}:${root}`;
    let store = agentOutputStores.get(cacheKey);
    if (!store) {
        const created = (async () => {
            const instantiated = new AgentOutputStore(root, spec);
            await instantiated.collect();
            return instantiated;
        })();
        store = created.catch(() => {
            agentOutputStores.delete(cacheKey);
            return null;
        });
        agentOutputStores.set(cacheKey, store);
    }
    return store;
}

/** 按locator前缀归属Store；未知前缀返回null。 */
export async function agentOutputStoreForLocator(locator: string, paths: RuntimePaths | undefined): Promise<AgentOutputStore | null> {
    const spec = AGENT_OUTPUT_SPECS.find((candidate) => locator.startsWith(candidate.locatorPrefix));
    return spec ? agentOutputStoreFor(spec, paths) : null;
}

function parseLocator(locator: string, spec: AgentOutputStoreSpec): {leaseId: string} | null {
    const prefix = spec.locatorPrefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`^${prefix}([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/output\\.log$`, "iu");
    const match = pattern.exec(locator);
    return match?.[1] ? {leaseId: match[1]} : null;
}

function isMarker(value: unknown, spec: AgentOutputStoreSpec): value is LeaseMarker {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const marker = value as Partial<LeaseMarker>;
    return marker.schemaVersion === 1
        && marker.owner === spec.owner
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
