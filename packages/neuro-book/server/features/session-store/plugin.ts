import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "@notnotype/neuro-book-contracts/product-runtime";
import {provide} from "nbook/runtime/plugins/plugins";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";
import {appLogger} from "nbook/server/app-logs/logger";
import {
    AGENT_SESSION_STORE_LEASE_HEARTBEAT_MS,
    AGENT_SESSION_STORE_LEASE_STALE_MS,
    isAgentSessionStoreLeaseCompromisedError,
} from "nbook/server/agent/session/agent-session-store-lease";
import type {AgentSessionStoreLeaseCompromisedError} from "nbook/server/agent/session/agent-session-store-lease";
import {
    AgentSessionMigrationRequiredError,
    AgentSessionRecoveryRequiredError,
    AgentSessionStoreCorruptError,
} from "nbook/server/agent/session/agent-session-store";
import {
    observeAgentSessionStoreRuntimeCompromised,
    startAgentSessionStoreRuntime,
    stopAgentSessionStoreRuntime,
} from "nbook/server/agent/session/agent-session-store-runtime";
import {appStateKey} from "nbook/server/features/app-state/plugin";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import type {AgentSessionStoreRuntimeStartOptions} from "nbook/server/agent/session/agent-session-store-runtime";
import type {ProductStopPort} from "nbook/server/host/stop-port";

export const sessionStoreKey = defineServiceKey<{readonly workspaceRoot: string}>("nbook.session-store/runtime");

export type SessionStorePluginOptions = Pick<
    AgentSessionStoreRuntimeStartOptions,
    "waitForSameProcessRuntimeLease" | "leaseHandoffTimeoutMs" | "leaseHandoffPollMs"
>;

export function createSessionStorePlugin(
    recordStartupError: (error: unknown) => void,
    stop: ProductStopPort,
    options: SessionStorePluginOptions = {},
): PluginDefinition {
    return {
        id: "nbook.session-store",
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: appStateKey}],
            provides: [sessionStoreKey],
            activate: async (context) => {
                const {workspaceRoot} = runtimePathsFromEnv();
                const startOptions = options.waitForSameProcessRuntimeLease
                    ? {...options, signal: context.signal}
                    : undefined;
                try {
                    if (startOptions) await startAgentSessionStoreRuntime(workspaceRoot, startOptions);
                    else await startAgentSessionStoreRuntime(workspaceRoot);
                } catch (error) {
                    if (isAgentSessionStoreLeaseCompromisedError(error)) requestLeaseCompromisedShutdown(error, stop);
                    if (error instanceof AgentSessionMigrationRequiredError
                        || error instanceof AgentSessionRecoveryRequiredError
                        || error instanceof AgentSessionStoreCorruptError) {
                        const migrationError = new Error(
                            `${error.message}\n非 Manager 启动请先执行：bun run migrate:application-state -- --apply`,
                            {cause: error},
                        );
                        recordStartupError(migrationError);
                        throw migrationError;
                    }
                    recordStartupError(error);
                    throw error;
                }
                void Promise.resolve()
                    .then(() => observeAgentSessionStoreRuntimeCompromised(workspaceRoot))
                    .then((error) => requestLeaseCompromisedShutdown(error, stop))
                    .catch((error: unknown) => {
                        appLogger.fatalSync(
                            "runtime.agentSessionStore.leaseObserverFailed",
                            undefined,
                            error,
                            "Agent Session Store runtime lease失效观察器异常，Product将有序关闭",
                        );
                        stop.requestStop("session-store:lease-observer-failed", PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
                    });
                return {services: [provide(sessionStoreKey, {workspaceRoot}, () => stopAgentSessionStoreRuntime(workspaceRoot))]};
            },
        }],
    };
}

/** 租约失效只报告原因；宿主统一排空并保留专用退出码。 */
function requestLeaseCompromisedShutdown(error: AgentSessionStoreLeaseCompromisedError, stop: ProductStopPort): void {
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
    stop.requestStop("session-store:lease-compromised", PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
}
