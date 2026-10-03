import {setTimeout as sleep} from "node:timers/promises";
import {resolve} from "node:path";
import {
    acquireReadyAgentSessionStore,
    agentSessionStoreKey,
    type AgentSessionStoreRuntime,
    type ReadyAgentSessionStore,
} from "nbook/server/agent/session/agent-session-store";
import {
    AgentSessionStoreLeaseCompromisedError,
    AgentSessionStoreLeaseHeldError,
    agentSessionStoreLeasePath,
} from "nbook/server/agent/session/agent-session-store-lease";
export const AGENT_SESSION_STORE_LEASE_HANDOFF_TIMEOUT_MS = 45_000;
export const AGENT_SESSION_STORE_LEASE_HANDOFF_POLL_MS = 100;

export type AgentSessionStoreRuntimeStartOptions = {
    /** 开发 worker 交接时等待同进程 runtime owner；生产与 CLI 必须保持立即失败。 */
    readonly waitForSameProcessRuntimeLease?: boolean;
    readonly leaseHandoffTimeoutMs?: number;
    readonly leaseHandoffPollMs?: number;
    readonly signal?: AbortSignal;
};

type AgentSessionStoreRuntimeEntry = {
    rootWorkspace: string;
    active: AgentSessionStoreRuntime | null;
    phase: "idle" | "starting" | "active" | "closing" | "compromised";
    transition: Promise<void>;
};

/** HMR前一版本的runtime entry；旧active没有健康检查和compromised signal。 */
type PreviousAgentSessionStoreRuntimeEntry = {
    rootWorkspace: string;
    active: {
        readonly ready: ReadyAgentSessionStore;
        release(): Promise<void>;
        assertHealthy?: () => void;
        compromised?: Promise<AgentSessionStoreLeaseCompromisedError>;
    } | null;
    phase: "idle" | "starting" | "active" | "closing" | "compromised";
    transition: Promise<void>;
};

type AgentSessionStoreRuntimeGlobals = typeof globalThis & {
    __nbookAgentSessionStoreRuntimesV3?: Map<string, PreviousAgentSessionStoreRuntimeEntry>;
    __nbookAgentSessionStoreRuntimesV4?: Map<string, AgentSessionStoreRuntimeEntry>;
};

const runtimeGlobals = globalThis as AgentSessionStoreRuntimeGlobals;
const runtimes = runtimeGlobals.__nbookAgentSessionStoreRuntimesV4
    ?? migratePreviousRuntimes(runtimeGlobals.__nbookAgentSessionStoreRuntimesV3)
    ?? new Map<string, AgentSessionStoreRuntimeEntry>();
runtimeGlobals.__nbookAgentSessionStoreRuntimesV4 = runtimes;

/** 保留V3的同一Map，但旧active无法恢复失效回调时必须fail closed并要求重启。 */
function migratePreviousRuntimes(
    previous: Map<string, PreviousAgentSessionStoreRuntimeEntry> | undefined,
): Map<string, AgentSessionStoreRuntimeEntry> | null {
    if (!previous) return null;
    for (const entry of previous.values()) {
        normalizeRuntimeEntry(entry as unknown as AgentSessionStoreRuntimeEntry);
    }
    // 原地升级entry；旧模块可能仍在pending transition中，替换Map value会让旧闭包与新模块各持一份状态。
    return previous as unknown as Map<string, AgentSessionStoreRuntimeEntry>;
}

/** 将HMR前的active capability升级为当前运行时需要的fail-closed形状。 */
function normalizeRuntimeEntry(entry: AgentSessionStoreRuntimeEntry): void {
    if (!entry.active) return;
    const active = entry.active as unknown as NonNullable<PreviousAgentSessionStoreRuntimeEntry["active"]>;
    if (typeof active.assertHealthy === "function" && active.compromised) return;
    const compromised = new AgentSessionStoreLeaseCompromisedError(
        agentSessionStoreLeasePath(entry.rootWorkspace),
        "runtime",
        new Error("HMR重载后无法恢复旧版 runtime lease 的失效观察；请重启 NeuroBook。"),
    );
    entry.active = {
        ready: active.ready,
        // 旧proper-lockfile release可能删除新owner的锁；HMR迁移后的清理必须是no-op。
        release: async () => undefined,
        assertHealthy: () => {
            throw compromised;
        },
        compromised: Promise.resolve(compromised),
    } as unknown as AgentSessionStoreRuntime;
    entry.phase = "compromised";
}

/**
 * 启动Workspace Root级Agent Session Store owner。
 *
 * 生产进程只会绑定唯一Workspace Root；注册表按root归一化key登记，使同一进程内的
 * 多个隔离root（测试与工具）各自独立持有capability，而不是互相顶掉。同root的并发
 * 与HMR调用共享同一条transition chain。
 */
export async function startAgentSessionStoreRuntime(
    rootWorkspace: string,
    options: AgentSessionStoreRuntimeStartOptions = {},
): Promise<ReadyAgentSessionStore> {
    const entry = ensureEntry(rootWorkspace);
    return enqueueTransition(entry, async () => {
        normalizeRuntimeEntry(entry);
        if (entry.phase === "closing") {
            throw new Error("Agent Session Store runtime仍在关闭，不能启动。");
        }
        if (entry.phase === "compromised") {
            entry.active?.assertHealthy();
            throw new Error("Agent Session Store runtime lease已失去所有权。");
        }
        if (entry.phase === "active" && entry.active) {
            entry.active.assertHealthy();
            return entry.active.ready;
        }
        entry.phase = "starting";
        try {
            const active = await acquireReadyAgentSessionStoreWithHandoff(entry.rootWorkspace, options);
            entry.active = active;
            entry.phase = "active";
            return active.ready;
        } catch (error) {
            entry.active = null;
            entry.phase = "idle";
            throw error;
        }
    });
}

async function acquireReadyAgentSessionStoreWithHandoff(
    rootWorkspace: string,
    options: AgentSessionStoreRuntimeStartOptions,
): Promise<AgentSessionStoreRuntime> {
    if (!options.waitForSameProcessRuntimeLease) return acquireReadyAgentSessionStore(rootWorkspace);

    const timeoutMs = options.leaseHandoffTimeoutMs ?? AGENT_SESSION_STORE_LEASE_HANDOFF_TIMEOUT_MS;
    const pollMs = options.leaseHandoffPollMs ?? AGENT_SESSION_STORE_LEASE_HANDOFF_POLL_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError(`leaseHandoffTimeoutMs 必须是正整数，收到 ${String(timeoutMs)}`);
    }
    if (!Number.isInteger(pollMs) || pollMs <= 0) {
        throw new TypeError(`leaseHandoffPollMs 必须是正整数，收到 ${String(pollMs)}`);
    }

    const deadline = Date.now() + timeoutMs;
    while (true) {
        options.signal?.throwIfAborted();
        try {
            // 陈旧锁恢复仍由 proper-lockfile 判定；只读等待会让已终止 worker 的残留锁永久阻塞。
            return await acquireReadyAgentSessionStore(rootWorkspace);
        } catch (error) {
            if (!(error instanceof AgentSessionStoreLeaseHeldError)) throw error;
            if (error.owner?.kind !== "runtime" || error.owner.pid !== process.pid) throw error;
            if (Date.now() >= deadline) {
                throw new AgentSessionStoreLeaseHeldError(
                    error.leasePath, error.heartbeatAt, error.owner, error, timeoutMs,
                );
            }
        }
        await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())), undefined, {signal: options.signal});
    }
}

/**
 * 同步取得启动插件已经验证的Session Store capability。
 *
 * 这是session写入面的fail-closed读取点：sentinel未验证、迁移未完成或runtime已关闭时
 * 一律抛错，不允许退回到"没有runtime就放行"的旧行为。
 */
export function requireReadyAgentSessionStore(rootWorkspace: string): ReadyAgentSessionStore {
    const entry = runtimes.get(agentSessionStoreKey(rootWorkspace));
    if (!entry) {
        throw new Error(`Agent Session Store runtime尚未完成启动：${resolve(rootWorkspace)}`);
    }
    normalizeRuntimeEntry(entry);
    if (entry.phase === "compromised" && entry.active) {
        entry.active.assertHealthy();
    }
    if (entry.phase !== "active" || !entry.active) {
        throw new Error(`Agent Session Store runtime尚未完成启动：${resolve(rootWorkspace)}`);
    }
    entry.active.assertHealthy();
    return entry.active.ready;
}

/** 返回runtime lease的一次性失效信号；该Promise只解析，不会产生未处理rejection。 */
export function observeAgentSessionStoreRuntimeCompromised(
    rootWorkspace: string,
): Promise<AgentSessionStoreLeaseCompromisedError> {
    const entry = runtimes.get(agentSessionStoreKey(rootWorkspace));
    if (!entry) {
        throw new Error(`Agent Session Store runtime尚未完成启动：${resolve(rootWorkspace)}`);
    }
    normalizeRuntimeEntry(entry);
    if (entry.phase === "compromised" && entry.active) return entry.active.compromised;
    if (entry.phase !== "active" || !entry.active) {
        throw new Error(`Agent Session Store runtime尚未完成启动：${resolve(rootWorkspace)}`);
    }
    return entry.active.compromised;
}

/**
 * 释放Session Store lease。
 *
 * 省略rootWorkspace表示关闭本进程全部owner（进程退出与测试清理使用）；单个root失败
 * 时保留handle供重试，并把全部失败聚合抛出。
 */
export async function stopAgentSessionStoreRuntime(rootWorkspace?: string): Promise<void> {
    if (rootWorkspace !== undefined) {
        await stopEntry(ensureEntry(rootWorkspace));
        return;
    }
    const failures: unknown[] = [];
    for (const entry of [...runtimes.values()]) {
        try {
            await stopEntry(entry);
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures.map(asError), "部分Agent Session Store runtime未能释放。");
    }
}

/**
 * 在单个owner的transition chain内线性化关闭。
 *
 * 关闭后保留idle注册项而不从Map删除：start-stop-start会把三次操作排到同一条chain上，
 * 删除会让随后的start落在一个已经不在注册表里的entry上，requireReady将查不到它。
 */
async function stopEntry(entry: AgentSessionStoreRuntimeEntry): Promise<void> {
    await enqueueTransition(entry, async () => {
        normalizeRuntimeEntry(entry);
        if (entry.phase === "compromised") return;
        const active = entry.active;
        if (!active) {
            entry.phase = "idle";
            return;
        }
        entry.phase = "closing";
        // release失败时保留handle供下一次stop重试；closing态不得再提供ready capability。
        await active.release();
        entry.active = null;
        entry.phase = "idle";
    });
}

/** 取得或登记指定Workspace Root的owner状态。 */
function ensureEntry(rootWorkspace: string): AgentSessionStoreRuntimeEntry {
    const resolvedRoot = resolve(rootWorkspace);
    const key = agentSessionStoreKey(resolvedRoot);
    const existing = runtimes.get(key);
    if (existing) {
        normalizeRuntimeEntry(existing);
        return existing;
    }
    const created: AgentSessionStoreRuntimeEntry = {
        rootWorkspace: resolvedRoot,
        active: null,
        phase: "idle",
        transition: Promise.resolve(),
    };
    runtimes.set(key, created);
    return created;
}

/** 将单个owner的start/stop线性化，失败不会破坏后续恢复操作。 */
function enqueueTransition<T>(
    entry: AgentSessionStoreRuntimeEntry,
    operation: () => Promise<T>,
): Promise<T> {
    const result = entry.transition.then(operation, operation);
    entry.transition = result.then(() => undefined, () => undefined);
    return result;
}

function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}
