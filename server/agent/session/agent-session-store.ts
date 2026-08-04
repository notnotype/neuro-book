import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    acquireAgentSessionStoreLease,
    acquireAgentSessionStoreRuntimeLease,
    AGENT_SESSION_STORE_LEASE_RELATIVE_PATH,
    agentSessionStoreLeasePath,
    isAgentSessionStoreLeaseCompromisedError,
    type AgentSessionStoreLeaseCompromisedError,
    type AgentSessionStoreLeaseHandle,
    type AgentSessionStoreLeaseRelease,
} from "nbook/server/agent/session/agent-session-store-lease";

/** 当前Agent Session JSONL持久化schema。 */
export const AGENT_SESSION_SCHEMA_VERSION = 2 as const;

/** Session Store sentinel自身的格式版本。 */
export const AGENT_SESSION_STORE_SENTINEL_VERSION = 1 as const;

/** Runtime与offline migration唯一互斥锁；物理路径沿用Attachment迁移时期的既有路径。 */
export {AGENT_SESSION_STORE_LEASE_RELATIVE_PATH};

/** Session schema与崩溃恢复状态的唯一sentinel。 */
export const AGENT_SESSION_STORE_SENTINEL_RELATIVE_PATH = ".nbook/agent/migrations/session-store.json";

/** Session Store迁移状态；非complete状态都禁止runtime启动。 */
export type AgentSessionStoreState = "pending" | "applying" | "complete" | "rollback_required";

/**
 * Session Store sentinel。
 *
 * backup、stage与逐Session checksum由migration manifest拥有；sentinel只保存恢复入口和checkpoint。
 */
export type AgentSessionStoreSentinel = {
    sentinelVersion: typeof AGENT_SESSION_STORE_SENTINEL_VERSION;
    state: AgentSessionStoreState;
    sourceSchemaVersion: number;
    targetSchemaVersion: number;
    runId: string;
    manifestPath: string;
    manifestHash: string;
    checkpointCursor: number;
};

/** Sentinel缺失或schema落后时抛出的稳定错误。 */
export class AgentSessionMigrationRequiredError extends Error {
    readonly code = "AGENT_SESSION_MIGRATION_REQUIRED" as const;

    constructor(
        readonly expectedSchemaVersion: number,
        readonly actualSchemaVersion: number | null,
    ) {
        super(actualSchemaVersion === null
            ? `Agent Session Store尚未初始化schema ${expectedSchemaVersion}。`
            : `Agent Session Store schema ${actualSchemaVersion}必须迁移到${expectedSchemaVersion}。`);
        this.name = "AgentSessionMigrationRequiredError";
    }
}

/** Sentinel处于未闭合迁移状态时抛出的稳定错误。 */
export class AgentSessionRecoveryRequiredError extends Error {
    readonly code = "AGENT_SESSION_RECOVERY_REQUIRED" as const;

    constructor(readonly sentinel: AgentSessionStoreSentinel) {
        super(`Agent Session迁移${sentinel.runId}处于${sentinel.state}，必须先resume或rollback。`);
        this.name = "AgentSessionRecoveryRequiredError";
    }
}

/** Sentinel无法严格解析时抛出的稳定错误。 */
export class AgentSessionStoreCorruptError extends Error {
    readonly code = "AGENT_SESSION_STORE_CORRUPT" as const;

    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "AgentSessionStoreCorruptError";
    }
}

const readyAgentSessionStoreBrand: unique symbol = Symbol("ReadyAgentSessionStore");

/** 已取得runtime lease且确认目标schema complete的nominal capability。 */
export type ReadyAgentSessionStore = {
    readonly schemaVersion: typeof AGENT_SESSION_SCHEMA_VERSION;
    readonly rootWorkspace: AbsoluteFsPath;
    readonly [readyAgentSessionStoreBrand]: true;
};

/** Runtime持有的Session Store capability与幂等释放句柄。 */
export class AgentSessionStoreRuntime {
    private released = false;
    private releasePromise: Promise<void> | null = null;

    constructor(
        readonly ready: ReadyAgentSessionStore,
        private readonly releaseLease: () => Promise<void>,
        private readonly assertLeaseHealthy: () => void,
        readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>,
    ) {}

    /** 在复用已有runtime capability前同步确认物理lease仍由本进程持有。 */
    assertHealthy(): void {
        this.assertLeaseHealthy();
    }

    /** 最后一个runtime owner关闭后释放唯一store lease。 */
    async release(): Promise<void> {
        if (this.released) return;
        if (!this.releasePromise) {
            this.releasePromise = this.releaseLease()
                .then(() => {
                    this.released = true;
                })
                .finally(() => {
                    if (!this.released) this.releasePromise = null;
                });
        }
        await this.releasePromise;
    }
}

type SharedRuntimeLease = {
    refs: number;
    physicalLease: Promise<AgentSessionStoreLeaseHandle>;
    phase: "open" | "releasing" | "release_failed" | "compromised";
    releasePromise: Promise<void> | null;
    compromisedError: AgentSessionStoreLeaseCompromisedError | null;
};

/** HMR前一版本的物理lease形状；迁移时保留同一个Map对象，避免旧模块自持锁被当成外部锁。 */
type LegacySharedRuntimeLease = {
    refs: number;
    physicalLease: Promise<() => Promise<void>>;
    phase: "open" | "releasing" | "release_failed";
    releasePromise: Promise<void> | null;
};

type AgentSessionStoreGlobals = typeof globalThis & {
    __nbookAgentSessionStoreRuntimeLeasesV1?: Map<string, LegacySharedRuntimeLease>;
    __nbookAgentSessionStoreRuntimeLeasesV2?: Map<string, SharedRuntimeLease>;
};

const storeGlobals = globalThis as AgentSessionStoreGlobals;
const sharedRuntimeLeases = storeGlobals.__nbookAgentSessionStoreRuntimeLeasesV2
    ?? migrateLegacyRuntimeLeases(storeGlobals.__nbookAgentSessionStoreRuntimeLeasesV1)
    ?? new Map<string, SharedRuntimeLease>();
storeGlobals.__nbookAgentSessionStoreRuntimeLeasesV2 = sharedRuntimeLeases;

const NEVER_COMPROMISED = new Promise<AgentSessionStoreLeaseCompromisedError>(() => undefined);

/** 把V1物理release包装成同时兼容旧函数调用和新handle调用的同一对象。 */
function migrateLegacyRuntimeLeases(
    legacy: Map<string, LegacySharedRuntimeLease> | undefined,
): Map<string, SharedRuntimeLease> | null {
    if (!legacy) return null;
    for (const [key, entry] of legacy) {
        const migrated: SharedRuntimeLease = {
            refs: entry.refs,
            physicalLease: entry.physicalLease.then(legacyPhysicalLease),
            phase: entry.phase,
            releasePromise: entry.releasePromise,
            compromisedError: null,
        };
        // globalThis上的Map来自旧HMR模块；这里保留同一个Map对象，不能创建第二份锁注册表。
        legacy.set(key, migrated as unknown as LegacySharedRuntimeLease);
    }
    return legacy as unknown as Map<string, SharedRuntimeLease>;
}

/** 旧模块只保存可调用release，新模块同时需要handle方法；两者指向同一个release。 */
function legacyPhysicalLease(release: () => Promise<void>): AgentSessionStoreLeaseHandle {
    const releaseHandle = async (): Promise<void> => release();
    return Object.assign(releaseHandle, {
        release: releaseHandle,
        compromised: NEVER_COMPROMISED,
        assertHealthy: () => undefined,
    });
}

/**
 * 返回Workspace Root在进程内注册表中的canonical key。
 *
 * lease引用计数与runtime owner共用这一个归一化实现，避免同一物理root因大小写
 * 或未resolve的相对路径被登记成两份状态。
 */
export function agentSessionStoreKey(rootWorkspace: string): string {
    const resolvedRoot = resolve(rootWorkspace);
    return process.platform === "win32" ? resolvedRoot.toLocaleLowerCase("en-US") : resolvedRoot;
}

/** 返回Workspace Root对应的runtime lease绝对路径。 */
export {agentSessionStoreLeasePath};

/** 返回Workspace Root对应的schema sentinel绝对路径。 */
export function agentSessionStoreSentinelPath(rootWorkspace: string): string {
    return resolve(rootWorkspace, AGENT_SESSION_STORE_SENTINEL_RELATIVE_PATH);
}

/**
 * 获取runtime全生命周期共享lease并验证schema ready。
 *
 * 相同进程/HMR内同root调用共享物理锁；只有最后一个owner释放后offline migration才能进入。
 */
export async function acquireReadyAgentSessionStore(rootWorkspace: string): Promise<AgentSessionStoreRuntime> {
    const runtimeLease = await acquireSharedRuntimeLease(rootWorkspace);
    try {
        const sentinel = await readAgentSessionStoreSentinel(rootWorkspace);
        if (sentinel.state !== "complete") {
            throw new AgentSessionRecoveryRequiredError(sentinel);
        }
        if (sentinel.targetSchemaVersion !== AGENT_SESSION_SCHEMA_VERSION) {
            throw new AgentSessionMigrationRequiredError(
                AGENT_SESSION_SCHEMA_VERSION,
                sentinel.targetSchemaVersion,
            );
        }
        await assertCompleteSentinelManifest(rootWorkspace, sentinel);
        const runtime = new AgentSessionStoreRuntime(
            createReadyAgentSessionStore(rootWorkspace),
            runtimeLease.release,
            runtimeLease.assertHealthy,
            runtimeLease.compromised,
        );
        // Sentinel校验期间可能刚好发生heartbeat失效；ready发布前再检查一次，避免把已失效capability交给调用方。
        runtime.assertHealthy();
        return runtime;
    } catch (error) {
        try {
            await runtimeLease.release();
        } catch (releaseError) {
            throw new AggregateError(
                [asError(error), asError(releaseError)],
                "Agent Session Store启动失败且lease清理不完整。",
            );
        }
        throw error;
    }
}

/**
 * 获取offline migration使用的独占lease。
 *
 * 此入口不共享进程内runtime引用，也不读取sentinel；调用方必须在锁内完成rescan与状态机推进。
 */
export async function acquireAgentSessionStoreExclusiveLease(rootWorkspace: string): Promise<AgentSessionStoreLeaseRelease> {
    return acquirePhysicalLease(rootWorkspace, "migration");
}

/** 在lease保护下读取并严格解析Session Store sentinel。 */
export async function readAgentSessionStoreSentinel(rootWorkspace: string): Promise<AgentSessionStoreSentinel> {
    const path = agentSessionStoreSentinelPath(rootWorkspace);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            throw new AgentSessionMigrationRequiredError(AGENT_SESSION_SCHEMA_VERSION, null);
        }
        throw error;
    }
    try {
        // JSON.parse的结果属于外部持久化输入，必须从unknown开始严格收窄。
        return parseAgentSessionStoreSentinel(JSON.parse(text) as unknown);
    } catch (error) {
        if (error instanceof AgentSessionStoreCorruptError) throw error;
        throw new AgentSessionStoreCorruptError(`Agent Session Store sentinel无法解析：${path}`, {
            cause: error,
        });
    }
}

/** 严格解析sentinel，拒绝未知字段、宽松数字和非portable manifest路径。 */
export function parseAgentSessionStoreSentinel(value: unknown): AgentSessionStoreSentinel {
    if (!isJsonObject(value)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store sentinel必须是JSON object。");
    }
    assertExactKeys(value, [
        "sentinelVersion",
        "state",
        "sourceSchemaVersion",
        "targetSchemaVersion",
        "runId",
        "manifestPath",
        "manifestHash",
        "checkpointCursor",
    ]);
    const sentinelVersion = value.sentinelVersion;
    const state = value.state;
    const sourceSchemaVersion = value.sourceSchemaVersion;
    const targetSchemaVersion = value.targetSchemaVersion;
    const runId = value.runId;
    const manifestPath = value.manifestPath;
    const manifestHash = value.manifestHash;
    const checkpointCursor = value.checkpointCursor;

    if (sentinelVersion !== AGENT_SESSION_STORE_SENTINEL_VERSION) {
        throw new AgentSessionStoreCorruptError("Agent Session Store sentinelVersion不受支持。");
    }
    if (state !== "pending" && state !== "applying" && state !== "complete" && state !== "rollback_required") {
        throw new AgentSessionStoreCorruptError("Agent Session Store state非法。");
    }
    if (!isNonNegativeInteger(sourceSchemaVersion) || !isPositiveInteger(targetSchemaVersion)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store schema version非法。");
    }
    if (typeof runId !== "string" || !/^[A-Za-z0-9_-]+$/u.test(runId)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store runId非法。");
    }
    if (typeof manifestPath !== "string" || !isPortableManifestPath(manifestPath)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store manifestPath非法。");
    }
    if (typeof manifestHash !== "string" || !/^[a-f0-9]{64}$/u.test(manifestHash)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store manifestHash非法。");
    }
    if (!isNonNegativeInteger(checkpointCursor)) {
        throw new AgentSessionStoreCorruptError("Agent Session Store checkpointCursor非法。");
    }
    return {
        sentinelVersion,
        state,
        sourceSchemaVersion,
        targetSchemaVersion,
        runId,
        manifestPath,
        manifestHash,
        checkpointCursor,
    };
}

/** 获取相同进程内按Workspace Root引用计数的runtime lease。 */
async function acquireSharedRuntimeLease(rootWorkspace: string): Promise<SharedRuntimeLeaseReference> {
    const resolvedRoot = resolve(rootWorkspace);
    const key = agentSessionStoreKey(resolvedRoot);
    let shared: SharedRuntimeLease;
    while (true) {
        const existing = sharedRuntimeLeases.get(key);
        if (!existing) {
            shared = {
                refs: 0,
                physicalLease: acquireAgentSessionStoreRuntimeLease(resolvedRoot),
                phase: "open",
                releasePromise: null,
                compromisedError: null,
            };
            sharedRuntimeLeases.set(key, shared);
            trackSharedCompromise(key, shared);
            break;
        }
        if (existing.phase === "open") {
            const physicalLease = await existing.physicalLease;
            try {
                physicalLease.assertHealthy();
                shared = existing;
                break;
            } catch (error) {
                if (!isAgentSessionStoreLeaseCompromisedError(error)) throw error;
                existing.compromisedError = error;
                existing.phase = "compromised";
                throw error;
            }
        }
        if (existing.phase === "compromised") {
            throw existing.compromisedError ?? new Error("Agent Session Store runtime lease已失去所有权。");
        }
        if (existing.phase === "release_failed") {
            throw new Error("Agent Session Store runtime lease上次释放失败，必须由原owner重试关闭。");
        }
        await releaseSharedPhysicalLease(key, existing);
    }
    shared.refs += 1;
    try {
        const physicalLease = await shared.physicalLease;
        let released = false;
        let releasePromise: Promise<void> | null = null;
            return {
                compromised: physicalLease.compromised,
                assertHealthy: physicalLease.assertHealthy,
                release: async () => {
                if (released) return;
                if (!releasePromise) {
                    releasePromise = releaseSharedRuntimeReference(key, shared)
                        .then(() => {
                            released = true;
                        })
                        .finally(() => {
                            if (!released) releasePromise = null;
                        });
                }
                await releasePromise;
            },
        };
    } catch (error) {
        shared.refs -= 1;
        if (shared.refs === 0 && sharedRuntimeLeases.get(key) === shared) {
            sharedRuntimeLeases.delete(key);
        }
        throw error;
    }
}

type SharedRuntimeLeaseReference = {
    readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>;
    readonly assertHealthy: () => void;
    readonly release: () => Promise<void>;
};

/** 将物理 lease 的一次性 compromised 信号提升到共享 runtime 状态。 */
function trackSharedCompromise(key: string, shared: SharedRuntimeLease): void {
    void shared.physicalLease.then(
        (physicalLease) => {
            void physicalLease.compromised.then((error) => {
                if (sharedRuntimeLeases.get(key) !== shared) return;
                shared.compromisedError = error;
                shared.phase = "compromised";
            });
        },
        () => undefined,
    );
}

/** 释放一个进程内runtime引用；最后一个引用必须等待物理解锁完成。 */
async function releaseSharedRuntimeReference(key: string, shared: SharedRuntimeLease): Promise<void> {
    if (shared.refs <= 0) {
        await releaseSharedPhysicalLease(key, shared);
        return;
    }
    shared.refs -= 1;
    if (shared.refs > 0) return;
    try {
        await releaseSharedPhysicalLease(key, shared);
    } catch (error) {
        shared.refs = 1;
        throw error;
    }
}

/** 串行并可重试地释放共享物理lease；成功前不从全局Map移除。 */
async function releaseSharedPhysicalLease(key: string, shared: SharedRuntimeLease): Promise<void> {
    if (shared.releasePromise) {
        await shared.releasePromise;
        return;
    }
    shared.phase = "releasing";
    shared.releasePromise = (async () => {
        const releasePhysical = await shared.physicalLease;
        let compromised = shared.compromisedError;
        try {
            releasePhysical.assertHealthy();
        } catch (error) {
            if (!isAgentSessionStoreLeaseCompromisedError(error)) throw error;
            compromised = error;
        }
        if (!compromised) {
            try {
                await releasePhysical.release();
            } catch (error) {
                try {
                    releasePhysical.assertHealthy();
                } catch (compromisedError) {
                    if (!isAgentSessionStoreLeaseCompromisedError(compromisedError)) throw error;
                    compromised = compromisedError;
                }
                if (!compromised) throw error;
            }
            if (!compromised) {
                try {
                    releasePhysical.assertHealthy();
                } catch (compromisedError) {
                    if (!isAgentSessionStoreLeaseCompromisedError(compromisedError)) throw compromisedError;
                    compromised = compromisedError;
                }
            }
        }
        if (compromised) {
            shared.compromisedError = compromised;
            shared.phase = "compromised";
            return;
        }
        if (sharedRuntimeLeases.get(key) === shared) {
            sharedRuntimeLeases.delete(key);
        }
    })();
    try {
        await shared.releasePromise;
    } catch (error) {
        shared.phase = "release_failed";
        shared.releasePromise = null;
        throw error;
    }
}

/** 创建lease文件并取得proper-lockfile物理锁。 */
async function acquirePhysicalLease(
    rootWorkspace: string,
    kind: "runtime" | "migration" = "runtime",
): Promise<AgentSessionStoreLeaseRelease> {
    return acquireAgentSessionStoreLease(rootWorkspace, kind);
}

/** complete sentinel必须绑定真实、未篡改且checkpoint一致的migration manifest。 */
async function assertCompleteSentinelManifest(
    rootWorkspace: string,
    sentinel: AgentSessionStoreSentinel,
): Promise<void> {
    const path = resolve(rootWorkspace, ...sentinel.manifestPath.split("/"));
    let bytes: Uint8Array;
    try {
        bytes = await readFile(path);
    } catch (error) {
        throw new AgentSessionStoreCorruptError(`Agent Session Store manifest不可读：${path}`, {cause: error});
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== sentinel.manifestHash) {
        throw new AgentSessionStoreCorruptError("Agent Session Store manifestHash与sentinel不一致。");
    }
    let manifest: unknown;
    try {
        manifest = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    } catch (error) {
        throw new AgentSessionStoreCorruptError("Agent Session Store manifest不是合法JSON。", {cause: error});
    }
    if (!isJsonObject(manifest)
        || manifest.runId !== sentinel.runId
        || manifest.appliedSeq !== sentinel.checkpointCursor) {
        throw new AgentSessionStoreCorruptError("Agent Session Store manifest与sentinel checkpoint不一致。");
    }
}

/** 仅在lease内完成sentinel校验后构造nominal ready capability。 */
function createReadyAgentSessionStore(rootWorkspace: string): ReadyAgentSessionStore {
    return {
        schemaVersion: AGENT_SESSION_SCHEMA_VERSION,
        rootWorkspace: absoluteFsPath(resolve(rootWorkspace)),
        [readyAgentSessionStoreBrand]: true,
    };
}

/** 判断JSON.parse外部输入是否为普通object。 */
function isJsonObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sentinel必须只包含显式schema字段。 */
function assertExactKeys(value: {[key: string]: unknown}, expected: readonly string[]): void {
    const actual = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
        throw new AgentSessionStoreCorruptError("Agent Session Store sentinel包含未知或缺失字段。");
    }
}

/** 判断数字是否为非负整数。 */
function isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** 判断数字是否为正整数。 */
function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Sentinel只接受migration目录中的portable相对manifest路径。 */
function isPortableManifestPath(value: string): boolean {
    if (!value.startsWith(".nbook/agent/migrations/") || value.includes("\\")) return false;
    const segments = value.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** 收窄Node filesystem错误码。 */
function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
}

/** 将cleanup聚合中的非Error异常收敛为Error。 */
function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
