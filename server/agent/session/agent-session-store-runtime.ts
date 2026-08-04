import {resolve} from "node:path";
import {
    acquireReadyAgentSessionStore,
    agentSessionStoreKey,
    type AgentSessionStoreRuntime,
    type ReadyAgentSessionStore,
} from "nbook/server/agent/session/agent-session-store";
import type {AgentSessionStoreLeaseCompromisedError} from "nbook/server/agent/session/agent-session-store-lease";

type AgentSessionStoreRuntimeEntry = {
    rootWorkspace: string;
    active: AgentSessionStoreRuntime | null;
    phase: "idle" | "starting" | "active" | "closing";
    transition: Promise<void>;
};

type AgentSessionStoreRuntimeGlobals = typeof globalThis & {
    __nbookAgentSessionStoreRuntimesV4?: Map<string, AgentSessionStoreRuntimeEntry>;
};

const runtimeGlobals = globalThis as AgentSessionStoreRuntimeGlobals;
const runtimes = runtimeGlobals.__nbookAgentSessionStoreRuntimesV4
    ?? new Map<string, AgentSessionStoreRuntimeEntry>();
runtimeGlobals.__nbookAgentSessionStoreRuntimesV4 = runtimes;

/**
 * 启动Workspace Root级Agent Session Store owner。
 *
 * 生产进程只会绑定唯一Workspace Root；注册表按root归一化key登记，使同一进程内的
 * 多个隔离root（测试与工具）各自独立持有capability，而不是互相顶掉。同root的并发
 * 与HMR调用共享同一条transition chain。
 */
export async function startAgentSessionStoreRuntime(rootWorkspace: string): Promise<ReadyAgentSessionStore> {
    const entry = ensureEntry(rootWorkspace);
    return enqueueTransition(entry, async () => {
        if (entry.phase === "closing") {
            throw new Error("Agent Session Store runtime仍在关闭，不能启动。");
        }
        if (entry.phase === "active" && entry.active) {
            entry.active.assertHealthy();
            return entry.active.ready;
        }
        entry.phase = "starting";
        try {
            const active = await acquireReadyAgentSessionStore(entry.rootWorkspace);
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

/**
 * 同步取得启动插件已经验证的Session Store capability。
 *
 * 这是session写入面的fail-closed读取点：sentinel未验证、迁移未完成或runtime已关闭时
 * 一律抛错，不允许退回到"没有runtime就放行"的旧行为。
 */
export function requireReadyAgentSessionStore(rootWorkspace: string): ReadyAgentSessionStore {
    const entry = runtimes.get(agentSessionStoreKey(rootWorkspace));
    if (!entry || entry.phase !== "active" || !entry.active) {
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
    if (!entry || entry.phase !== "active" || !entry.active) {
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
    if (existing) return existing;
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
