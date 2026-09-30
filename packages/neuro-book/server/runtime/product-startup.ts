import {mkdir} from "node:fs/promises";

import {appLogger} from "nbook/server/app-logs/logger";
import {
    AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
    AGENT_SESSION_STORE_LEASE_STALE_MS,
    AgentSessionStoreLeaseCompromisedError,
    isAgentSessionStoreLeaseCompromisedError,
} from "nbook/server/agent/session/agent-session-store-lease";
import {
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
} from "nbook/server/agent/session/agent-session-store";
import {
    observeAgentSessionStoreRuntimeCompromised,
    startAgentSessionStoreRuntime,
} from "nbook/server/agent/session/agent-session-store-runtime";
import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";
import {
    inspectStateRootIntegrity,
    stateRootIntegrityFailed,
} from "nbook/server/runtime/state-root-integrity";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "@notnotype/neuro-book-contracts/product-runtime";

let startup: Promise<void> | null = null;

/**
 * 完成 Product 的异步启动门禁。
 *
 * 顺序是合同的一部分：Workspace Root 必须先存在，migration 必须先于任何
 * Session Store lease，最终 ready 才能表示 Agent HTTP 能力可用。
 */
export async function prepareProductRuntime(): Promise<void> {
    const runtimePaths = runtimePathsFromEnv();
    await mkdir(runtimePaths.workspaceRoot, {recursive: true});

    const stateIntegrity = await inspectStateRootIntegrity({
        installationRoot: runtimePaths.applicationRoot,
        stateRoot: runtimePaths.stateRoot,
    });
    if (stateRootIntegrityFailed(stateIntegrity)) {
        void appLogger.warn(
            "runtime.stateRoot.integrityFailed",
            {stateIntegrity},
            stateIntegrity.kind === "shadow-workspace"
                ? "检测到Installation Root与State Root存在Workspace Root数据分叉；应用不会自动处理用户数据"
                : "无法验证Installation Root与State Root的Workspace Root关系；应用不会自动处理用户数据",
        );
    }

    await assertProductMigrationsReady();
    try {
        await startAgentSessionStoreRuntime(runtimePaths.workspaceRoot);
    } catch (error) {
        if (isAgentSessionStoreLeaseCompromisedError(error)) {
            requestLeaseCompromisedShutdown(error);
            return;
        }
        if (error instanceof AgentSessionMigrationRequiredError
            || error instanceof AgentSessionRecoveryRequiredError
            || error instanceof AgentSessionStoreCorruptError) {
            throw new Error(
                `${error.message}\n非 Manager 启动请先执行：bun run migrate:application-state -- --apply`,
                {cause: error},
            );
        }
        throw error;
    }
    void Promise.resolve()
        .then(() => observeAgentSessionStoreRuntimeCompromised(runtimePaths.workspaceRoot))
        .then((error) => requestLeaseCompromisedShutdown(error))
        .catch((error: unknown) => {
            appLogger.fatalSync(
                "runtime.agentSessionStore.leaseObserverFailed",
                undefined,
                error,
                "Agent Session Store runtime lease失效观察器异常，Product将有序关闭",
            );
            productShutdownController.requestProcessExit(
                PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
            );
        });
}

/** 记录租约失效诊断并请求一次有序的专用退出。 */
function requestLeaseCompromisedShutdown(error: AgentSessionStoreLeaseCompromisedError): void {
    appLogger.fatalSync(
        "runtime.agentSessionStore.leaseCompromised",
        {
            leasePath: error.leasePath,
            kind: error.kind,
            staleMs: AGENT_SESSION_STORE_LEASE_STALE_MS,
            heartbeatMs: AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
        },
        error,
        "Agent Session Store runtime lease失去所有权，Product将有序关闭",
    );
    productShutdownController.requestProcessExit(
        PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    );
}

/**
 * 启动门禁失败时记录原因并请求有序退出。
 *
 * 不能靠抛出未捕获异常终止进程：Nitro node-server 入口的 `trapUnhandledNodeErrors()`
 * 注册的 uncaughtException 处理器只记录不退出，进程会存活并对所有请求返回 500。
 */
export function exitOnProductStartupFailure(error: unknown): void {
    appLogger.fatalSync("runtime.startup.failed", undefined, error, "Product 启动门禁失败，Product将有序关闭");
    productShutdownController.requestProcessExit(1);
}

/**
 * 返回进程级唯一启动结果；Nitro middleware 与并发首批请求共享同一个 Promise。
 */
export function productRuntimeReady(): Promise<void> {
    if (!startup) startup = prepareProductRuntime();
    return startup;
}
