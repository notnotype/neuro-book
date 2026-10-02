import {ProductRuntimeNotReadyError} from "nbook/server/host/product-runtime-errors";
export {ProductRuntimeNotReadyError, isProductRuntimeNotReadyError} from "nbook/server/host/product-runtime-errors";
// Project facade 的循环模块 namespace 会立即读取错误类；纯合同先于插件装配依赖求值。
import type {Application, ApplicationManifest, StopResult} from "nbook/runtime/application/application";
import type {Scope} from "nbook/runtime/lifecycle/lifecycle";
import {createAppStatePlugin, appStateKey} from "nbook/server/features/app-state/plugin";
import {createStoragePlugin, storageKey} from "nbook/server/features/storage/plugin";
import {createSessionStorePlugin, sessionStoreKey} from "nbook/server/features/session-store/plugin";
import type {SessionStorePluginOptions} from "nbook/server/features/session-store/plugin";
import {createProjectPlugin, projectKey} from "nbook/server/features/project/plugin";
import type {ProductProjectOwnerSlot} from "nbook/server/features/project/plugin";
import {createAgentPlugin, agentKey} from "nbook/server/features/agent/plugin";
import {ServerRuntimeHost} from "nbook/server/runtime/foundation/server-host";
import type {ServerHost, SignalSource} from "nbook/server/runtime/foundation/server-host";
import {createHttpPlugin, httpKey} from "nbook/server/features/http/plugin";
import type {ProductHttpListener} from "nbook/server/features/http/plugin";
import {ProductHttpAdmission} from "nbook/server/features/http/admission";
import type {DrainClock} from "nbook/server/features/http/admission";
import type {ProductStopPort, ProductExitCode} from "nbook/server/host/stop-port";
import {createWorkspaceFilesPlugin, workspaceFilesKey} from "nbook/server/features/workspace-files/plugin";
import type {WorkspaceFilesBinding, createWorkspaceFilesService} from "nbook/server/features/workspace-files/service";
import {appLogger} from "nbook/server/app-logs/logger";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {reportProductStartupFailure} from "nbook/server/host/startup-diagnostic";

export interface ProductRuntime extends ProductStopPort {
    readonly application: Application;
    readonly host: ServerHost;
    readonly http: ProductHttpAdmission;
    readonly ready: Promise<void>;
    readonly stopped: Promise<{exitCode: ProductExitCode; failures: readonly unknown[]; result: StopResult}>;
    /** 不退出调用进程；关闭不完整时拒绝，生产退出动作由入口注入。 */
    stop(): Promise<void>;
}

export interface ProductStartOptions {
    readonly mode?: "production" | "development" | "cli";
    readonly http?: ProductHttpListener;
    readonly process?: SignalSource;
    readonly clock?: DrainClock;
    readonly exit?: (code: ProductExitCode) => void;
}

type ProductRuntimeState = ProductRuntime & {
    readonly workspaceRoot: string;
    readonly projectOwner: ProductProjectOwnerSlot;
};
let current: ProductRuntimeState | undefined;

/** 只取得本模块图已经建立的实例；请求消费者不拥有启动。 */
export function currentProductRuntime(): ProductRuntime {
    if (!current) throw new ProductRuntimeNotReadyError();
    return current;
}

/** Project owner 状态附着于 nbook.project 的当前代次；回调仅在代次可用后创建一次。 */
export function productProjectOwner<T>(create: (root: Scope) => T): T {
    const state = current;
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
function productManifest(
    recordStartupError: (error: unknown) => void,
    projectOwner: ProductProjectOwnerSlot,
    stop: ProductStopPort,
    http: ProductHttpAdmission,
    listener: ProductHttpListener | undefined,
    sessionStoreOptions: SessionStorePluginOptions,
): ApplicationManifest {
    const plugins = [
        createHttpPlugin(http, listener, recordStartupError),
        createAppStatePlugin(recordStartupError),
        createStoragePlugin(),
        createSessionStorePlugin(recordStartupError, stop, sessionStoreOptions),
        createProjectPlugin(projectOwner),
        createAgentPlugin(),
        createWorkspaceFilesPlugin(),
    ];
    let catalogRecorded = false;
    return {
        keys: [httpKey, appStateKey, storageKey, sessionStoreKey, projectKey, agentKey, workspaceFilesKey],
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

/** 生产、开发与 CLI 共用的唯一装配入口；CLI 和开发模式不自行监听。 */
export function startProductRuntime(options: ProductStartOptions = {}): ProductRuntime {
    const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
    if (current) {
        if (current.workspaceRoot !== workspaceRoot) throw new Error("Product runtime 已绑定另一 Workspace Root");
        if (current.host.stopSource !== null || current.application.root.phase === "closed" || current.application.root.phase === "stopping") {
            throw new Error("Product runtime 已停止，不再接纳启动请求");
        }
        return current;
    }
    const http = new ProductHttpAdmission({clock: options.clock});
    const projectOwner: ProductProjectOwnerSlot = {current: null};
    let startupError: unknown;
    let startupDiagnosed = false;
    let exitCode: ProductExitCode = 0;
    const requestCode = (code: ProductExitCode): void => {
        if (code === 75 || (exitCode !== 75 && code === 1)) exitCode = code;
    };
    const recordStartupError = (error: unknown): void => {
        startupError ??= error;
        diagnoseStartup(startupError);
    };
    const diagnoseStartup = (error: unknown): void => {
        requestCode(1);
        http.failed(error);
        if (startupDiagnosed) return;
        startupDiagnosed = true;
        reportProductStartupFailure(error);
    };
    let host: ServerHost;
    const stopPort: ProductStopPort = {
        requestStop(source, code = 0) {
            requestCode(code);
            void host.requestStop(source);
        },
    };
    const manifest = productManifest(
        recordStartupError,
        projectOwner,
        stopPort,
        http,
        options.mode === "production" ? options.http : undefined,
        options.mode === "development" ? {waitForSameProcessRuntimeLease: true} : {},
    );
    host = new ServerRuntimeHost().start({
        instanceId: "product",
        manifest,
        signals: options.mode === "production" ? undefined : [],
        process: options.process,
        beforeStop: () => http.drain(),
        emergency: (report) => {
            if (report.stage === "startup") diagnoseStartup(startupError ?? new Error(`${report.reason}：${report.detail ?? ""}`));
            else appLogger.fatalSync("product.shutdown.failed", {report}, undefined, "Product 关闭不完整");
        },
    });
    const application = host.application;
    const ready = application.startup.then((result) => {
        if (result.status !== "available") {
            const error = startupError ?? new Error(`Product runtime 启动失败：${result.status}；${result.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；")}`);
            if (result.status === "failed" || startupError !== undefined) diagnoseStartup(error);
            else http.failed(error);
            stopPort.requestStop("startup:failed", exitCode);
            throw error;
        }
        const declared = application.assembly.declare({id: "product-files-http", location: "server", scope: application.root, dependencies: [{key: workspaceFilesKey}, {key: sessionStoreKey}]});
        if (declared.status !== "accepted") {
            const error = new Error(`Files 宿主登记失败：${declared.reason}`);
            diagnoseStartup(error);
            stopPort.requestStop("startup:failed", 1);
            throw error;
        }
        http.ready();
    });
    // 内部观察失败，保留 ready 的拒绝给调用方；结算必须等启动原因确定，避免内核先停完时丢掉失败码。
    const startupSettled = ready.then(() => undefined, () => undefined);
    const stopped = host.stopped.then(async (result) => {
        await startupSettled;
        const failures: unknown[] = [];
        if (host.beforeStopError !== undefined) failures.push(new Error("Product shutdown step 失败：http-drain", {cause: host.beforeStopError}));
        if (result.status !== "closed") failures.push(new Error("Product shutdown step 失败：product-runtime", {cause: result.report}));
        if (failures.length > 0) {
            requestCode(1);
            appLogger.fatalSync("product.shutdown.failed", undefined, new AggregateError(failures, "Product runtime 关闭不完整"), "Product 关闭不完整");
        }
        try {
            await appLogger.flush();
        } catch (error) {
            failures.push(new Error("Product shutdown step 失败：app-logger", {cause: error}));
            requestCode(1);
            appLogger.fatalSync("product.shutdown.failed", undefined, error, "Product 日志刷写失败");
        }
        options.exit?.(exitCode);
        return {exitCode, failures, result};
    });
    let stop: Promise<void> | undefined;
    current = {
        application, host, http, ready, stopped, workspaceRoot, projectOwner,
        requestStop: stopPort.requestStop,
        stop() {
            if (!stop) {
                stopPort.requestStop("caller:stop");
                stop = stopped.then(({failures}) => {
                    if (failures.length > 0) throw new AggregateError(failures, "Product runtime 关闭不完整");
                });
            }
            return stop;
        },
    };
    return current;
}

/** HTTP 消费者只借用插件服务；授权和 Project operation 由外层守卫持有。 */
export async function withProductWorkspaceFiles<T>(
    binding: WorkspaceFilesBinding,
    operation: (files: ReturnType<typeof createWorkspaceFilesService>, signal: AbortSignal) => Promise<T>,
): Promise<T> {
    const {application, ready} = currentProductRuntime();
    await ready;
    const filesKey = workspaceFilesKey;
    const leaseKey = sessionStoreKey;
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
