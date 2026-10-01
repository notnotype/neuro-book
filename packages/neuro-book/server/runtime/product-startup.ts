import type {Application, ApplicationManifest} from "nbook/runtime/application/application";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import {createAppStatePlugin, appStateKey} from "nbook/server/features/app-state/plugin";
import {createStoragePlugin, storageKey} from "nbook/server/features/storage/plugin";
import {createSessionStorePlugin, sessionStoreKey} from "nbook/server/features/session-store/plugin";
import {createProjectPlugin, projectKey} from "nbook/server/features/project/plugin";
import type {ProductProjectOwnerSlot} from "nbook/server/features/project/plugin";
import {createAgentPlugin, agentKey} from "nbook/server/features/agent/plugin";
import {ServerRuntimeHost} from "nbook/server/runtime/foundation/server-host";
import {createWorkspaceFilesPlugin, workspaceFilesKey} from "nbook/server/features/workspace-files/plugin";
import type {WorkspaceFilesBinding, createWorkspaceFilesService} from "nbook/server/features/workspace-files/service";
import {appLogger} from "nbook/server/app-logs/logger";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {productShutdownController} from "nbook/server/runtime/shutdown/product-shutdown";

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
    readonly projectOwner: ProductProjectOwnerSlot;
};
const runtimeGlobals = globalThis as typeof globalThis & {__nbookProductApplicationV1?: ProductRuntimeState};

/** Project owner 状态附着于 nbook.project 的当前代次；回调仅在代次可用后创建一次。 */
export function productProjectOwner<T>(create: (root: Scope) => T): T {
    const state = runtimeGlobals.__nbookProductApplicationV1;
    const generation = state?.projectOwner.current;
    if (!state || !generation || generation.root.phase !== "available") {
        throw new ProductRuntimeNotReadyError();
    }
    // Agent 先排空、Project 后关闭；停止期间仅返回已有 owner，不创建新的 owner。
    if (generation.owner !== undefined) return generation.owner as T;
    if (state.application.root.phase !== "available" || generation.scope.phase !== "available") {
        throw new ProductRuntimeNotReadyError();
    }
    generation.owner = create(generation.root);
    return generation.owner as T;
}

/** 必需插件按服务依赖激活；目录在登记结束后的首条激活诊断中写出。 */
function productManifest(recordStartupError: (error: unknown) => void, projectOwner: ProductProjectOwnerSlot): ApplicationManifest {
    const plugins = [
        createAppStatePlugin(recordStartupError),
        createStoragePlugin(),
        createSessionStorePlugin(recordStartupError),
        createProjectPlugin(projectOwner),
        createAgentPlugin(),
        createWorkspaceFilesPlugin(),
    ];
    let catalogRecorded = false;
    return {
        keys: [appStateKey, storageKey, sessionStoreKey, projectKey, agentKey, workspaceFilesKey],
        plugins,
        requiredPlugins: plugins.map((plugin) => plugin.id),
        gates: [],
        observers: {plugins: {diagnosticRecorded: (diagnostic) => {
            if (!catalogRecorded && diagnostic.reason === "activation-started") {
                catalogRecorded = true;
                void appLogger.info("runtime.plugins.catalog", {
                    entries: plugins.flatMap((plugin) => plugin.entries
                        .filter((entry) => entry.location === "server")
                        .map((entry) => ({
                            plugin: plugin.id,
                            entry: entry.id,
                            dependencies: (entry.dependencies ?? []).map((dependency) => dependency.key.name),
                            provides: (entry.provides ?? []).map((key) => key.name),
                        }))),
                });
            }
            const {sequence, plugin, entry, generation, stage, reason, capability, contribution, error} = diagnostic;
            void appLogger.info("runtime.plugins.diagnostic", {sequence, plugin, entry, generation, stage, reason, capability, contribution, error});
        }}},
    };
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
        const projectOwner: ProductProjectOwnerSlot = {current: null};
        const manifest = productManifest((error) => {startupError = error;}, projectOwner);
        const application = new ServerRuntimeHost().start({instanceId: "product", manifest, signals: []}).application;
        state = {
            application,
            workspaceRoot,
            filesKey: workspaceFilesKey,
            leaseKey: sessionStoreKey,
            projectOwner,
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
