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
        super(
            `Agent Session Store 正被另一 NeuroBook 进程使用：${leasePath}；${ownerText}${heartbeatText}。`
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
): Promise<() => Promise<void>> {
    const path = agentSessionStoreLeasePath(rootWorkspace);
    await mkdir(dirname(path), {recursive: true});
    const handle = await open(path, "a");
    await handle.close();

    let release: () => Promise<void>;
    try {
        release = await lock(path, {
            realpath: false,
            stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
            update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
        });
    } catch (error) {
        if (!isLockContention(error)) throw error;
        throw await leaseHeldError(path, error);
    }
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
    return release;
}

/** 获取启动构造路径使用的同步 Session Store lease。 */
export function acquireAgentSessionStoreLeaseSync(
    rootWorkspace: string,
    kind: AgentSessionStoreLeaseKind,
): () => void {
    const path = agentSessionStoreLeasePath(rootWorkspace);
    mkdirSync(dirname(path), {recursive: true});
    const handle = openSync(path, "a");
    closeSync(handle);

    let release: () => void;
    try {
        release = lockSync(path, {
            realpath: false,
            stale: AGENT_SESSION_STORE_LEASE_STALE_MS,
            update: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
        });
    } catch (error) {
        if (!isLockContention(error)) throw error;
        throw leaseHeldErrorSync(path, error);
    }
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
