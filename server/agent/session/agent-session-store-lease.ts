import {randomUUID} from "node:crypto";
import {
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import {mkdir, open, readFile, stat, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {lock, lockSync} from "proper-lockfile";

export const AGENT_SESSION_STORE_LEASE_RELATIVE_PATH = ".nbook/agent/migrations/runtime.lease";
export const AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA = "nbook.agent-session-store-lease-owner/v1";
export const AGENT_SESSION_STORE_LEASE_STALE_MS = 30_000;
export const AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS = 15_000;

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type AgentSessionStoreLeaseKind = "runtime" | "migration";

/** `runtime.lease` 中仅供本机排障使用的最小 owner 信息。 */
export type AgentSessionStoreLeaseOwner = {
    schema: typeof AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA;
    leaseId: string;
    kind: AgentSessionStoreLeaseKind;
    pid: number;
    acquiredAt: string;
    runtime: "bun" | "node";
    runtimeVersion: string;
};

/** Runtime lease 已失去所有权；该错误只用于诊断与有序关闭，不用于抢锁。 */
export class AgentSessionStoreLeaseCompromisedError extends Error {
    readonly code = "AGENT_SESSION_STORE_LEASE_COMPROMISED" as const;

    constructor(
        readonly leasePath: string,
        readonly kind: AgentSessionStoreLeaseKind,
        cause: unknown,
    ) {
        super(
            `Agent Session Store ${kind} lease已失去所有权：${leasePath}；`
            + "可能存在另一个 NeuroBook 实例或迁移程序，或当前进程/系统曾长时间暂停。"
            + "不要手动删除 runtime.lease.lock。",
            {cause},
        );
        this.name = "AgentSessionStoreLeaseCompromisedError";
    }
}

/** HMR 与进程级关闭使用的 runtime lease handle。 */
export type AgentSessionStoreLeaseHandle = {
    readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>;
    assertHealthy(): void;
    release(): Promise<void>;
};

/** 保留历史可调用 release API，同时暴露一次性失效信号与同步健康检查。 */
export type AgentSessionStoreLeaseRelease = (() => Promise<void>) & {
    readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>;
    assertHealthy(): void;
};

/** 同步启动调用方使用的可调用 release API。 */
export type AgentSessionStoreLeaseSyncRelease = (() => void) & {
    readonly compromised: Promise<AgentSessionStoreLeaseCompromisedError>;
    assertHealthy(): void;
};

/** 判断错误是否表示 Session Store lease 已失去所有权。 */
export function isAgentSessionStoreLeaseCompromisedError(
    error: unknown,
): error is AgentSessionStoreLeaseCompromisedError {
    return error instanceof AgentSessionStoreLeaseCompromisedError
        || typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "AGENT_SESSION_STORE_LEASE_COMPROMISED";
}

/** Session Store 已被另一进程占用；owner 只用于诊断，不授予终止或抢锁权限。 */
export class AgentSessionStoreLeaseHeldError extends Error {
    readonly code = "ELOCKED" as const;

    constructor(
        readonly leasePath: string,
        readonly heartbeatAt: string | null,
        readonly owner: AgentSessionStoreLeaseOwner | null,
        cause: unknown,
    ) {
        const ownerText = owner
            ? `报告 owner：pid=${String(owner.pid)} kind=${owner.kind} acquiredAt=${owner.acquiredAt} runtime=${owner.runtime}@${owner.runtimeVersion}`
            : "报告 owner：未知（旧版或损坏的诊断 metadata）";
        const heartbeatText = heartbeatAt ? `；heartbeat=${heartbeatAt}` : "";
        const holderText = owner?.kind === "migration"
            ? "迁移程序"
            : owner?.kind === "runtime" ? "NeuroBook 运行实例" : "NeuroBook 实例或迁移程序";
        super(
            `Agent Session Store 正被另一${holderText}使用：${leasePath}；${ownerText}${heartbeatText}。`
            + "请先正常关闭该实例；owner 仍存活时不要删除 runtime.lease.lock。",
            {cause},
        );
        this.name = "AgentSessionStoreLeaseHeldError";
    }
}

/** 返回 Workspace Root 对应的 Session Store lease 绝对路径。 */
export function agentSessionStoreLeasePath(rootWorkspace: string): string {
    return resolve(rootWorkspace, AGENT_SESSION_STORE_LEASE_RELATIVE_PATH);
}

/** 获取带 heartbeat 和 owner metadata 的异步 Session Store lease。 */
export async function acquireAgentSessionStoreLease(
    rootWorkspace: string,
    kind: AgentSessionStoreLeaseKind,
): Promise<AgentSessionStoreLeaseRelease> {
    const lease = await acquireAgentSessionStoreLeaseHandle(rootWorkspace, kind);
    return decorateRelease(lease);
}

/** 获取带失效信号的 Session Store lease；runtime 与 migration 共用这一物理实现。 */
async function acquireAgentSessionStoreLeaseHandle(
    rootWorkspace: string,
    kind: AgentSessionStoreLeaseKind,
): Promise<AgentSessionStoreLeaseHandle> {
    const path = await ensureLeaseFile(rootWorkspace);
    const signal = compromiseSignal(path, kind);
    let releaseLock: () => Promise<void>;
    try {
        releaseLock = await lock(path, {
            realpath: false,
            stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
            update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
            onCompromised: signal.notify,
        });
    } catch (error) {
        if (!isLockContention(error)) throw error;
        throw await leaseHeldError(path, error);
    }
    const lease = leaseHandle(releaseLock, signal);
    await writeLeaseOwner(path, kind, lease.release);
    return lease;
}

/** 获取运行时专用 lease；compromised 只通过一次性信号传播，不异步抛错。 */
export async function acquireAgentSessionStoreRuntimeLease(
    rootWorkspace: string,
): Promise<AgentSessionStoreLeaseHandle> {
    return acquireAgentSessionStoreLeaseHandle(rootWorkspace, "runtime");
}

/** 获取启动构造路径使用的同步 Session Store lease。 */
export function acquireAgentSessionStoreLeaseSync(
    rootWorkspace: string,
    kind: AgentSessionStoreLeaseKind,
): AgentSessionStoreLeaseSyncRelease {
    const path = agentSessionStoreLeasePath(rootWorkspace);
    mkdirSync(dirname(path), {recursive: true});
    const handle = openSync(path, "a");
    closeSync(handle);

    const signal = compromiseSignal(path, kind);
    let releaseLock: () => void;
    try {
        releaseLock = lockSync(path, {
            realpath: false,
            stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
            update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
            onCompromised: signal.notify,
        });
    } catch (error) {
        if (!isLockContention(error)) throw error;
        throw leaseHeldErrorSync(path, error);
    }
    const release = syncLeaseHandle(releaseLock, signal);
    try {
        writeFileSync(path, `${JSON.stringify(currentOwner(kind), null, 2)}\n`, "utf8");
    } catch (error) {
        try {
            release();
        } catch (releaseError) {
            throw new AggregateError(
                [asError(error), asError(releaseError)],
                "Session Store lease owner写入失败且锁未能释放。",
            );
        }
        throw error;
    }
    return release;
}

/** 构造不含 argv/env/cwd/token 的当前 owner。 */
function currentOwner(kind: AgentSessionStoreLeaseKind): AgentSessionStoreLeaseOwner {
    const bunVersion = process.versions.bun;
    return {
        schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
        leaseId: randomUUID(),
        kind,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
        runtime: bunVersion ? "bun" : "node",
        runtimeVersion: bunVersion ?? process.versions.node,
    };
}

/** 创建 lease 文件但不写入 owner metadata。 */
async function ensureLeaseFile(rootWorkspace: string): Promise<string> {
    const path = agentSessionStoreLeasePath(rootWorkspace);
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "a");
    await handle.close();
    return path;
}

/** 写入 owner metadata；写入失败时保留原始错误与 release 错误。 */
async function writeLeaseOwner(
    path: string,
    kind: AgentSessionStoreLeaseKind,
    release: () => Promise<void>,
): Promise<void> {
    try {
        await writeFile(path, `${JSON.stringify(currentOwner(kind), null, 2)}\n`, "utf8");
    } catch (error) {
        try {
            await release();
        } catch (releaseError) {
            throw new AggregateError(
                [asError(error), asError(releaseError)],
                "Session Store lease owner写入失败且锁未能释放。",
            );
        }
        throw error;
    }
}

type LeaseCompromiseSignal = {
    readonly promise: Promise<AgentSessionStoreLeaseCompromisedError>;
    readonly notify: (error: Error) => void;
    readonly failure: () => AgentSessionStoreLeaseCompromisedError | null;
};

/** 建立只解析一次的 compromised 信号，避免 proper-lockfile 的默认异步 throw。 */
function compromiseSignal(path: string, kind: AgentSessionStoreLeaseKind): LeaseCompromiseSignal {
    let resolvePromise: (error: AgentSessionStoreLeaseCompromisedError) => void = () => undefined;
    let failure: AgentSessionStoreLeaseCompromisedError | null = null;
    const promise = new Promise<AgentSessionStoreLeaseCompromisedError>((resolvePromiseValue) => {
        resolvePromise = resolvePromiseValue;
    });
    return {
        promise,
        notify: (error) => {
            if (failure) return;
            failure = new AgentSessionStoreLeaseCompromisedError(path, kind, error);
            resolvePromise(failure);
        },
        failure: () => failure,
    };
}

/** 将 proper-lockfile release 包装为可观察、compromised 后不再触碰旧锁的 handle。 */
function leaseHandle(
    releaseLock: () => Promise<void>,
    signal: LeaseCompromiseSignal,
): AgentSessionStoreLeaseHandle {
    let released = false;
    let releasePromise: Promise<void> | null = null;
    return {
        compromised: signal.promise,
        assertHealthy: () => {
            const failure = signal.failure();
            if (failure) throw failure;
        },
        release: () => {
            if (released) return Promise.resolve();
            if (signal.failure()) {
                released = true;
                return Promise.resolve();
            }
            if (!releasePromise) {
                releasePromise = (async () => {
                    try {
                        if (signal.failure()) {
                            released = true;
                            return;
                        }
                        await releaseLock();
                        released = true;
                    } catch (error) {
                        if (signal.failure()) {
                            released = true;
                            return;
                        }
                        throw error;
                    }
                })().finally(() => {
                    if (!released) releasePromise = null;
                });
            }
            return releasePromise;
        },
    };
}

/** 把可观察 handle 转成仍可直接调用的历史 release closure。 */
function decorateRelease(handle: AgentSessionStoreLeaseHandle): AgentSessionStoreLeaseRelease {
    return Object.assign(handle.release, {
        compromised: handle.compromised,
        assertHealthy: handle.assertHealthy,
    });
}

/** 同步 release 在失效后终态 no-op，并保留原有同步调用签名。 */
function syncLeaseHandle(
    releaseLock: () => void,
    signal: LeaseCompromiseSignal,
): AgentSessionStoreLeaseSyncRelease {
    let released = false;
    const release = (): void => {
        if (released) return;
        if (signal.failure()) {
            released = true;
            return;
        }
        try {
            releaseLock();
            released = true;
        } catch (error) {
            if (signal.failure()) {
                released = true;
                return;
            }
            throw error;
        }
    };
    return Object.assign(release, {
        compromised: signal.promise,
        assertHealthy: () => {
            const failure = signal.failure();
            if (failure) throw failure;
        },
    });
}

/** 读取活跃 `.lock` 的 heartbeat 与持有者声明；诊断读取失败降级为未知。 */
async function leaseHeldError(path: string, cause: unknown): Promise<AgentSessionStoreLeaseHeldError> {
    const [owner, heartbeatAt] = await Promise.all([
        readFile(path, "utf8").then(parseOwner, () => null),
        stat(`${path}.lock`).then((value) => value.mtime.toISOString(), () => null),
    ]);
    return new AgentSessionStoreLeaseHeldError(path, heartbeatAt, owner, cause);
}

/** 同步调用方使用相同诊断结构。 */
function leaseHeldErrorSync(path: string, cause: unknown): AgentSessionStoreLeaseHeldError {
    let owner: AgentSessionStoreLeaseOwner | null = null;
    let heartbeatAt: string | null = null;
    try {
        owner = parseOwner(readFileSync(path, "utf8"));
    } catch {
        owner = null;
    }
    try {
        heartbeatAt = statSync(`${path}.lock`).mtime.toISOString();
    } catch {
        heartbeatAt = null;
    }
    return new AgentSessionStoreLeaseHeldError(path, heartbeatAt, owner, cause);
}

/** 严格解析外部持久化 owner；旧空文件和未知字段都只视为未知诊断。 */
function parseOwner(text: string): AgentSessionStoreLeaseOwner | null {
    let value: unknown;
    try {
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    // JSON 属于外部持久化输入，必须从 unknown 收窄后再读取字段。
    const owner = value as Record<string, unknown>;
    const keys = Object.keys(owner).sort();
    const expected = ["acquiredAt", "kind", "leaseId", "pid", "runtime", "runtimeVersion", "schema"].sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)
        || owner.schema !== AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA
        || typeof owner.leaseId !== "string"
        || !CANONICAL_UUID_PATTERN.test(owner.leaseId)
        || owner.kind !== "runtime" && owner.kind !== "migration"
        || typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
        || typeof owner.acquiredAt !== "string" || Number.isNaN(Date.parse(owner.acquiredAt))
        || owner.runtime !== "bun" && owner.runtime !== "node"
        || typeof owner.runtimeVersion !== "string" || owner.runtimeVersion.length === 0) {
        return null;
    }
    return {
        schema: AGENT_SESSION_STORE_LEASE_OWNER_SCHEMA,
        leaseId: owner.leaseId,
        kind: owner.kind,
        pid: owner.pid,
        acquiredAt: owner.acquiredAt,
        runtime: owner.runtime,
        runtimeVersion: owner.runtimeVersion,
    };
}

/** proper-lockfile 在其他 owner 持有 lease 时使用 ELOCKED。 */
function isLockContention(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ELOCKED";
}

/** 将未知失败收窄为可聚合 Error。 */
function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}
