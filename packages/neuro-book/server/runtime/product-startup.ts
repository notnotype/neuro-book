import {mkdir} from "node:fs/promises";

import type {Application, ApplicationManifest} from "nbook/runtime/application/application";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import {defineServiceKey} from "nbook/runtime/services/services";
import {ServerRuntimeHost} from "nbook/server/runtime/foundation/server-host";
import {createWorkspaceFilesPlugin, workspaceFilesKey} from "nbook/server/features/workspace-files/plugin";
import type {WorkspaceFilesBinding, createWorkspaceFilesService} from "nbook/server/features/workspace-files/service";
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
    stopAgentSessionStoreRuntime,
} from "nbook/server/agent/session/agent-session-store-runtime";
import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";
import {
    inspectStateRootIntegrity,
    stateRootIntegrityFailed,
} from "nbook/server/runtime/state-root-integrity";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "@notnotype/neuro-book-contracts/product-runtime";

const sessionStoreKey = defineServiceKey<{readonly workspaceRoot: string}>("product-agent-session-store");

export class ProductRuntimeNotReadyError extends Error {
    readonly code = "PRODUCT_RUNTIME_NOT_READY" as const;

    constructor() {
        super("Product runtime 未就绪，不接纳 Project generation");
        this.name = "ProductRuntimeNotReadyError";
    }
}

export function isProductRuntimeNotReadyError(error: unknown): error is ProductRuntimeNotReadyError {
    return error instanceof ProductRuntimeNotReadyError
        || (typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "PRODUCT_RUNTIME_NOT_READY");
}

type ProductRuntimeState = {
    application: Application;
    startup: Promise<void>;
    workspaceRoot: string;
    readonly filesKey: typeof workspaceFilesKey;
    readonly leaseKey: typeof sessionStoreKey;
    projectOwner?: {readonly root: Scope};
};
const runtimeGlobals = globalThis as typeof globalThis & {__nbookProductApplicationV1?: ProductRuntimeState};

/** Project owner 状态附着于唯一 Application 实例；回调仅在根已可用后创建一次。 */
export function productProjectOwner<T>(create: (root: Scope) => T): T {
    const state = runtimeGlobals.__nbookProductApplicationV1;
    if (!state || state.application.root.phase !== "available") {
        throw new ProductRuntimeNotReadyError();
    }
    if (state.projectOwner === undefined) state.projectOwner = create(state.application.root) as {readonly root: Scope};
    return state.projectOwner as T;
}

/** Product 清单先验证根与迁移，再取得Session lease；Project owner完整关闭后才释放lease。 */
function productManifest(recordStartupError: (error: unknown) => void): ApplicationManifest {
    const runtimePaths = runtimePathsFromEnv();
    let prerequisitesReady = false;
    return {
        keys: [sessionStoreKey, workspaceFilesKey],
        receivers: [],
        plugins: [createWorkspaceFilesPlugin()],
        capabilities: [{
            id: "agent-session-store",
            key: sessionStoreKey,
            create: async () => {
                if (!prerequisitesReady) throw new Error("Product prerequisites 未完成，拒绝取得 Session Store lease");
                try {
                    await startAgentSessionStoreRuntime(runtimePaths.workspaceRoot);
                } catch (error) {
                    if (isAgentSessionStoreLeaseCompromisedError(error)) {
                        requestLeaseCompromisedShutdown(error);
                    }
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
                    .then(() => observeAgentSessionStoreRuntimeCompromised(runtimePaths.workspaceRoot))
                    .then(requestLeaseCompromisedShutdown)
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
                return {workspaceRoot: runtimePaths.workspaceRoot};
            },
            release: async () => {
                const owner = runtimeGlobals.__nbookProductApplicationV1?.projectOwner;
                if (owner) {
                    const result = await (owner.root.phase === "stopping" ? owner.root.recover() : owner.root.close());
                    if (result.status !== "closed") {
                        throw new Error("Project generation尚未完整关闭，Session Store lease必须保留");
                    }
                }
                await stopAgentSessionStoreRuntime(runtimePaths.workspaceRoot);
            },
        }],
        gates: [
            {id: "product-prerequisites", kind: "check", check: async () => {
                try {
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
                    prerequisitesReady = true;
                } catch (error) {
                    recordStartupError(error);
                    throw error;
                }
            }},
            {id: "agent-session-store", kind: "resolve", key: sessionStoreKey},
            {id: "workspace-files", kind: "resolve", key: workspaceFilesKey},
        ],
    };
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

/** 返回进程级唯一启动结果；Nitro middleware 与并发首批请求共享同一个 Promise。 */
export function productRuntimeReady(): Promise<void> {
    let state = runtimeGlobals.__nbookProductApplicationV1;
    if (state && state.workspaceRoot !== runtimePathsFromEnv().workspaceRoot) {
        return Promise.reject(new Error("Product runtime 已绑定另一 Workspace Root"));
    }
    if (state && state.application.root.phase !== "creating" && state.application.root.phase !== "available") {
        return state.startup.then((): never => {
            throw new Error("Product runtime 已停止，不再接纳启动请求");
        });
    }
    if (!state) {
        let startupError: unknown;
        const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
        const manifest = productManifest((error) => {startupError = error;});
        const application = new ServerRuntimeHost().start({instanceId: "product", manifest, signals: []}).application;
        state = {
            application,
            workspaceRoot,
            filesKey: workspaceFilesKey,
            leaseKey: sessionStoreKey,
            startup: application.startup.then((result) => {
                if (result.status !== "available") {
                    throw startupError ?? new Error(`Product runtime 启动失败：${result.status}；${result.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；")}`);
                }
                const declared = application.assembly.declare({id: "product-files-http", location: "server", scope: application.root, dependencies: [{key: workspaceFilesKey}, {key: sessionStoreKey}]});
                if (declared.status !== "accepted") throw new Error(`Files 宿主登记失败：${declared.reason}`);
            }),
        };
        runtimeGlobals.__nbookProductApplicationV1 = state;
    }
    return state.startup;
}

/** HTTP 消费者只借用插件服务；授权和 Project operation 由外层守卫持有。 */
export async function withProductWorkspaceFiles<T>(
    binding: WorkspaceFilesBinding,
    operation: (files: ReturnType<typeof createWorkspaceFilesService>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
    await productRuntimeReady();
    const {application, filesKey, leaseKey} = runtimeGlobals.__nbookProductApplicationV1!;
    const admitted = await application.admit({label: "workspace-files", run: async ({signal}) => {
        const scope = application.root.createChild("files-request");
        scope.open();
        try {
            const access = application.assembly.access("product-files-http", scope);
            const lease = await access.resolve(leaseKey);
            if (lease.status !== "resolved") throw new Error(`Files 宿主不可用：${lease.reason}`);
            const service = await access.resolve(filesKey);
            if (service.status !== "resolved") throw new Error(`Files 服务不可用：${service.reason}`);
            const request = scope.accept({label: "files-consumer", run: () => operation(service.instance.bind(binding), signal)});
            const result = await request.outcome;
            await request.termination;
            if (result.status === "completed") return result.value;
            if (result.status === "failed") throw result.error;
            throw new Error("Files 请求已停止");
        } finally {
            const result = await scope.close();
            if (result.status !== "closed") throw new Error("Files 请求未完整释放");
        }
    }});
    if (admitted.status !== "accepted") throw new Error(`Files 服务不可用：${admitted.reason}`);
    const outcome = await admitted.operation.outcome;
    // 外层 Project guard 必须等真实执行结束，不能因等待方取消提前归还 Index/History。
    await admitted.operation.termination;
    if (outcome.status === "completed") return outcome.value;
    if (outcome.status === "failed") throw outcome.error;
    throw new Error("Files 操作已中断，结果需核对");
}

/** 已经取得的进程资源由同一 Application 关闭；未启动时不得因 shutdown 再触发启动。 */
export async function stopProductRuntime(): Promise<void> {
    const state = runtimeGlobals.__nbookProductApplicationV1;
    if (!state) return;
    const result = await state.application.stop();
    if (result.status !== "closed") {
        throw new Error(`Product runtime 关闭不完整：${result.reason}`, {cause: result.report});
    }
}
