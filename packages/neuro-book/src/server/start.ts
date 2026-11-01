/**
 * 后端装配：建立诊断存储、HTTP 准入、服务端的远程节点与路由，监听内核 RPC 端口，按清单装配插件，启动宿主与
 * 项目管理器，并把启动与停止的结果换算成退出码（取值规则见 docs/specs/runtime/server-host.md 的“输出与可观察行为”）。
 *
 * RPC 监听先于插件装配：引导接口要告诉浏览器实际端口。停止时先在同一个同步段里关闭 HTTP、RPC 与项目三处接纳，
 * 再并行排空 HTTP 与 RPC；内核停止时先停完项目子进程（子实例的停止阶段），再按依赖逆序关闭插件；插件全部关闭后
 * 才关闭 RPC 链路与监听，插件关闭期间客户端看到的是服务不可用而不是断线。
 *
 * 致命诊断走两条路：同步写到致命通道（缺省是标准错误），进程马上退出也看得见；同时记入诊断存储，
 * 出口可用时随后落盘。
 */

import {writeSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

import type {Application, StartupFailure, StartupResult, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency, serializeDiagnosticError} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";

import {createPluginInventory, pluginInventoryKey} from "nbook/plugin-platform/backend/inventory";
import {installedPlugins, NO_PREPARED_PLUGINS} from "nbook/plugin-platform/backend/startup";
import {pluginProblems} from "nbook/plugin-platform/shared/problems";
import type {PluginsPreparation} from "nbook/plugin-platform/backend/startup";
import {productPlugins} from "nbook/manifest";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import type {PluginDescriptor} from "nbook/manifest";
import {HTTP_DRAIN_LIMIT_MS, HttpAdmission, HttpAdmissionRejected} from "nbook/plugins/http/backend/admission";
import type {DrainClock} from "nbook/plugins/http/backend/admission";
import {clockKey, startupEnvKey, stateRootKey, userDirectoriesKey} from "nbook/shared/host";
import {projectsKey} from "nbook/shared/projects";
import {RPC_PATH} from "nbook/shared/rpc-socket";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";

import {loopbackOrigins} from "./config";
import type {ServerConfig} from "./config";
import {startServerHost} from "./host";
import type {StateRootClaim} from "./instance";
import {startupEnv} from "./startup-env";
import {resolveUserDirectories} from "./user-directories";
import type {FatalKind, ProcessEvents} from "./host";
import {manifestServerPlugins} from "./plugins";
import {isAddressInUse, listenWithShift, PORT_SHIFT_ATTEMPTS} from "./ports";
import type {ServerPluginContext} from "./plugins";
import {createProjectManager} from "./projects/manager";
import type {ProjectManager} from "./projects/manager";
import {createProjectRegistry} from "./projects/registry";
import type {ProjectRegistry} from "./projects/registry";
import {startRpcListener} from "./rpc/listener";
import type {RpcGateResult, RpcListener} from "./rpc/listener";

export type ExitCode = 0 | 1;

export interface StartServerOptions {
    readonly config: ServerConfig;
    /**
     * 已认领的状态根（`claimStateRoot`，必须就是 `config.stateRoot`）。本函数接管它：就绪时发布地址，停止开始时标记，
     * 停止结算后或装配失败时放下。没有认领就起不了服务端，一个状态根只跑一个实例由此保证。
     */
    readonly claim: StateRootClaim;
    /** 本进程加载的清单；缺省是产品清单，开发入口另加开发清单。 */
    readonly manifest?: ReadonlyArray<PluginDescriptor>;
    /** 装配插件；缺省按清单。测试经这里加入自己的插件，产品代码不含测试分支。 */
    readonly plugins?: (context: ServerPluginContext) => ReadonlyArray<PluginDefinition>;
    /**
     * 本次启动的第三方插件，由进程入口在启动之前用 `prepareInstalledPlugins` 得出（它要取跨进程的锁，是异步的）。
     * 缺省没有第三方插件。
     */
    readonly prepared?: PluginsPreparation;
    readonly process?: ProcessEvents;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly stopInput?: NodeJS.ReadableStream | null;
    /** HTTP 与 RPC 排空的截止计时。 */
    readonly clock?: DrainClock;
    /** 项目宽限期与子进程启动、停止截止的计时；缺省系统时钟。 */
    readonly projectClock?: RuntimeClock;
    /** 项目宿主入口脚本；缺省是产品入口（见 `productProjectEntry`），开发入口与测试另给。 */
    readonly projectEntry?: string;
    /** 项目子进程的基础环境变量；缺省继承本进程。 */
    readonly projectEnv?: Readonly<Record<string, string | undefined>>;
    /** 项目子进程输出的去处（每行已加前缀与换行）；缺省本进程的标准输出与标准错误。 */
    readonly projectOutput?: {readonly stdout: (text: string) => void; readonly stderr: (text: string) => void};
    readonly onListening?: (url: string) => void;
    /** RPC 端口开始监听后报告地址（`ws://…/`）。 */
    readonly onRpcListening?: (url: string) => void;
    /** 致命通道，必须同步写完；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
    /**
     * 运行实例可用之后在后台做的开发任务，只由开发入口给出（样例作品，见 `dev/sample.ts`）。它拿到的是项目管理器用的同一个
     * 登记表实例，登记表仍只有一个写者。启动失败、或在可用之前已开始停止时不启动；停止序列开头 abort 它，与排空并行等它结束。
     */
    readonly devTask?: (context: {readonly registry: ProjectRegistry; readonly stateRoot: string}) => DevTask;
}

/** 后台开发任务的停止：abort 并等它结束（截止由任务自己定），完成后不再写任何东西。 */
export interface DevTask {
    stop(): Promise<void>;
}

export interface ServerStopOutcome {
    readonly exitCode: ExitCode;
    /** 停止中失败的步骤（HTTP 或 RPC 排空、插件关闭）；为空表示停止完整。 */
    readonly failures: ReadonlyArray<unknown>;
    readonly result: StopResult;
}

export interface RunningServer {
    readonly application: Application;
    readonly projects: ProjectManager;
    /** 运行实例可用时完成；启动失败时拒绝。 */
    readonly ready: Promise<void>;
    readonly stopped: Promise<ServerStopOutcome>;
    /** 监听成功后的地址；未监听为 null。 */
    readonly url: string | null;
    /** 内核 RPC 端口的地址（`ws://…/`）；返回时已在监听。 */
    readonly rpcUrl: string;
    requestStop(source: string): void;
}

/**
 * 运行实例没有可用（`RunningServer.ready` 的拒绝原因）：`status` 为 `failed` 是启动失败，带内核给出的各失败入口与错误摘要；
 * `stopped` 是启动中被请求停止。
 */
export class ServerStartupError extends Error {
    constructor(message: string, readonly status: Exclude<StartupResult["status"], "available">, readonly failures: ReadonlyArray<StartupFailure>) {
        super(message);
        this.name = "ServerStartupError";
    }
}

/** 运行实例建立之前的装配失败（RPC 端口监听、按清单装配插件）。抛出前致命诊断已写出，调用方只需以 1 退出。 */
export class ServerAssemblyError extends Error {
    constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = "ServerAssemblyError";
    }
}

const INSTANCE_ID = "server";
/** RPC 排空的上限与 HTTP 相同：两者并行，停止序列的这一步最多等这么久。 */
const RPC_DRAIN_LIMIT_MS = HTTP_DRAIN_LIMIT_MS;

/** 产品的项目宿主入口：打包产物里是与本文件同目录的 `project.js`（同一次 `build:server` 产出），源码里是 `src/project/main.ts`。 */
function productProjectEntry(): string {
    return import.meta.path.endsWith(".js") ? join(import.meta.dir, "project.js") : join(import.meta.dir, "..", "project", "main.ts");
}

function writeStderrSync(line: string): void {
    writeSync(2, line);
}

function fatalLine(event: string, fields: Record<string, unknown>): string {
    return `${JSON.stringify({level: "fatal", event, ...fields})}\n`;
}

export function startServer(options: StartServerOptions): RunningServer {
    const writeFatal = options.writeFatal ?? writeStderrSync;
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: INSTANCE_ID}});
    const admission = new HttpAdmission({clock: options.clock});
    let url: string | null = null;
    let fatalSeen = false;
    let startupFailureReported = false;

    /** 写到致命通道并记入诊断存储。 */
    const reportFatal = (event: string, message: string, error: unknown): void => {
        writeFatal(fatalLine(event, {message, error: serializeDiagnosticError(error)}));
        store.record({level: "fatal", event, message, error});
    };
    // 启动失败会通知两次：内核关闭已取得的资源之前先发紧急报告，关闭完成后才给出启动结果。
    // 在紧急报告时就拒绝等待中的请求，它们才能在监听关闭前拿到 503；启动结果到达时只在还没报告过时补报。
    const reportStartupFailure = (error: unknown): void => {
        admission.failed(error);
        if (startupFailureReported) return;
        startupFailureReported = true;
        reportFatal("runtime.startup.failed", "后端启动失败，将有序关闭", error);
    };

    const node = createRemoteNode({
        instance: {id: INSTANCE_ID, kind: "server", role: "hub", project: null, client: null},
        observer: {
            diagnosticRecorded: (diagnostic) => store.record({level: "warn", event: `remote.${diagnostic.reason}`, message: "远程服务诊断", data: diagnostic}),
        },
    });
    // 项目管理器要等运行实例建立后才有（项目实例是它的子实例）；路由的回调与停止都只会在那之后用到它。
    // 宿主能力不同：内核在建立运行实例的同步段里就开始启动激活，插件可能在那时解析它，所以它等管理器建好。
    let projects: ProjectManager | null = null;
    const projectsReady = Promise.withResolvers<ProjectManager>();
    const router = createRemoteRouter(node, {
        bindProject: (request, client) => projects === null ? Promise.resolve({ok: false, reason: "project-unavailable", message: "服务端还没有就绪"}) : projects.bind(request, client),
        projectAccess: (caller, id, generation) => projects?.access(caller, id, generation) ?? "denied",
    });
    const admitUpgrade = async (): Promise<RpcGateResult> => {
        try {
            // 升级与页面资源过同一道门；升级本身瞬间完成，取得票据后立即归还，排空只等路由里的在途请求。
            (await admission.admit()).release();
            return {ok: true};
        } catch (error) {
            if (error instanceof HttpAdmissionRejected) return {ok: false, code: error.code};
            throw error;
        }
    };
    const allowOrigin = (origin: string): boolean => {
        let normalized: string;
        try {
            normalized = new URL(origin).origin;
        } catch {
            return false;
        }
        return options.config.allowedOrigins.includes(normalized) || (url !== null && loopbackOrigins(url).includes(normalized));
    };
    let rpc: RpcListener;
    let config: ServerConfig;
    try {
        const listened = listenWithShift({
            host: options.config.host,
            httpPort: options.config.port,
            rpcPort: options.config.rpcPort,
            shift: options.config.shiftPorts,
            listenRpc: (port) => startRpcListener({
                host: options.config.host,
                port,
                router,
                admit: admitUpgrade,
                allowOrigin,
                reportError: (error) => store.record({level: "error", event: "rpc.upgrade.failed", message: "处理 RPC 升级时出错", error}),
            }),
        });
        rpc = listened.rpc;
        config = {...options.config, port: listened.httpPort, rpcPort: rpc.port};
        if (listened.offset > 0) {
            store.record({
                level: "warn",
                event: "server.ports.shifted",
                message: `缺省端口被占用，改用 HTTP ${String(config.port)}、RPC ${String(config.rpcPort)}`,
                data: {offset: listened.offset, http: config.port, rpc: config.rpcPort},
            });
        }
    } catch (error) {
        // 还没有运行实例，没有要关闭的资源。
        const message = options.config.shiftPorts && isAddressInUse(error)
            ? `缺省的 HTTP 与内核 RPC 端口及顺延的 ${String(PORT_SHIFT_ATTEMPTS - 1)} 组都被占用`
            : "内核 RPC 端口监听失败";
        reportFatal("runtime.startup.failed", message, error);
        void options.claim.release();
        throw new ServerAssemblyError(message, {cause: error});
    }
    options.onRpcListening?.(rpc.url);

    const builtinManifest = options.manifest ?? productPlugins;
    // 第三方插件集合在启动前已确定，进程生命期内不变（docs/specs/runtime/plugin-install.md）。
    const prepared = options.prepared ?? NO_PREPARED_PLUGINS;
    prepared.connectDiagnostics((record) => void store.record(record));
    const installed = installedPlugins(prepared.startup);
    const thirdPartyIds = new Set(installed.map((plugin) => plugin.id));
    const context: ServerPluginContext = {
        config,
        manifest: builtinManifest,
        installed,
        store,
        admission,
        onListening: (address) => {
            url = address;
            options.onListening?.(address);
        },
        rpc: {port: rpc.port, path: RPC_PATH},
        allowOrigin,
        projectTitle: (reference) => (projects === null ? Promise.resolve(null) : projects.displayTitle(reference)),
    };
    let plugins: ReadonlyArray<PluginDefinition>;
    try {
        plugins = (options.plugins ?? manifestServerPlugins)(context);
    } catch (error) {
        // 还没有运行实例；只有已开的 RPC 监听要关。
        rpc.stop();
        reportFatal("runtime.startup.failed", "后端插件装配失败", error);
        void options.claim.release();
        throw new ServerAssemblyError("后端插件装配失败", {cause: error});
    }
    const clock: DrainClock = options.clock ?? {schedule: (task, milliseconds) => {
        const timer = setTimeout(task, milliseconds);
        return () => clearTimeout(timer);
    }};
    const drainRpc = async (): Promise<void> => {
        router.stopAdmission();
        const deadline = new AbortController();
        const cancel = clock.schedule(() => deadline.abort(), RPC_DRAIN_LIMIT_MS);
        try {
            if ((await router.drain(deadline.signal)) === "deadline") throw new Error(`RPC 排空超过 ${String(RPC_DRAIN_LIMIT_MS)}ms`);
        } finally {
            cancel();
        }
    };
    let devTask: DevTask | null = null;
    // 停止一开始就置位：运行实例在停止请求之后才报告可用时（启动中请求停止），不再启动开发任务。
    let devTaskClosed = false;
    const stopDevTask = (): Promise<void> => {
        devTaskClosed = true;
        return devTask?.stop() ?? Promise.resolve();
    };
    const drainBoth = async (): Promise<void> => {
        // 与下面两处排空开头的停止接纳在同一个同步段里：排空期间不会再有项目被打开。
        projects?.stopAdmission();
        const [http, remote] = await Promise.allSettled([admission.drain(), drainRpc()]);
        const failures: Error[] = [];
        if (http.status === "rejected") failures.push(new Error("HTTP 排空未完成", {cause: http.reason}));
        if (remote.status === "rejected") failures.push(new Error("RPC 排空未完成", {cause: remote.reason}));
        if (failures.length > 0) throw new AggregateError(failures, "排空未完成");
    };
    const emergency = recordingEmergency(store, (report) => {
        if (report.stage === "startup") {
            reportStartupFailure(new Error(`${report.reason}：${report.detail ?? ""}`));
            return;
        }
        // recordingEmergency 已把报告记入诊断存储；停止阶段出口可能已关闭，这里只补同步的致命通道。
        writeFatal(fatalLine("runtime.stop.emergency", {report}));
    });
    const stateRoot = Object.freeze({path: options.config.stateRoot});
    // 文档目录要查文件系统，能力建立时才等它；主目录同步可得。
    const home = homedir();
    const userDirectories = resolveUserDirectories({platform: process.platform, env: process.env, home});
    const host = startServerHost({
        instanceId: INSTANCE_ID,
        manifest: {
            capabilities: [
                {id: "host.state-root", key: stateRootKey, create: () => stateRoot},
                {id: "host.startup-env", key: startupEnvKey, create: () => ({env: startupEnv})},
                {id: "host.user-directories", key: userDirectoriesKey, create: () => userDirectories},
                {id: "host.clock", key: clockKey, create: () => systemClock},
                {
                    id: "host.plugin-inventory",
                    key: pluginInventoryKey,
                    create: () => createPluginInventory({
                        root: join(options.config.stateRoot, "plugins"),
                        profile: NEUROBOOK_PROFILE,
                        builtin: builtinManifest.map(({id, version}) => ({id, version})),
                        startup: prepared.startup,
                        record: (record) => void store.record(record),
                        // 插件页列表时才调用，那时 `host` 已经建好：本实例（服务端）此刻的入口失败、受阻与被拒的贡献。
                        problems: () => pluginProblems(host.application.plugins.catalog(), "server"),
                    }),
                },
                {
                    id: "host.projects",
                    key: projectsKey,
                    create: async () => (await projectsReady.promise).provision(),
                },
            ],
            plugins,
            // 第三方插件不是启动必需：它们失败只影响自己（docs/specs/runtime/plugin-manifest.md 的“失败与恢复”）；启动也不等
            // 它们的 onStartup 入口，插件代码挂住时服务端照常就绪（runtime/application.md）。
            requiredPlugins: plugins.filter((plugin) => !thirdPartyIds.has(plugin.id)).map((plugin) => plugin.id),
            backgroundStartupPlugins: [...thirdPartyIds],
            satisfies: pluginVersionSatisfies,
            gates: [],
            observers: mechanismObservers(store),
            remote: node,
        },
        emergency,
        process: options.process,
        signals: options.signals,
        stopInput: options.stopInput,
        beforeStop: async () => {
            options.claim.stopping();
            // 先 abort 开发任务（同步），再在同一个同步段里开始排空，两者并行。
            const devTaskStopped = stopDevTask();
            try {
                await drainBoth();
            } finally {
                await devTaskStopped;
            }
        },
        onFatal: (error: unknown, kind: FatalKind) => {
            fatalSeen = true;
            reportFatal(`process.${kind}`, kind === "uncaught-exception" ? "未捕获的异常，后端将有序关闭" : "未处理的 Promise 拒绝，后端将有序关闭", error);
        },
    });

    const registry = createProjectRegistry({stateRoot: options.config.stateRoot, cwd: process.cwd(), home});
    const projectManager = createProjectManager({
        application: host.application,
        serverInstanceId: INSTANCE_ID,
        router,
        registry,
        stateRoot: options.config.stateRoot,
        cwd: process.cwd(),
        entry: options.projectEntry ?? productProjectEntry(),
        ...options.config.projects,
        clock: options.projectClock,
        env: options.projectEnv,
        output: options.projectOutput,
        record: (record) => void store.record(record),
        installed,
    });
    projects = projectManager;
    projectsReady.resolve(projectManager);

    const ready = host.application.startup.then((startup) => {
        if (startup.status === "available") {
            admission.ready();
            options.claim.publish({
                url,
                rpcUrl: rpc.url,
                plugins: {safeMode: prepared.startup.safeMode, items: prepared.startup.plugins.map(({id, version, state, notLoaded}) => ({id, version, state, notLoaded}))},
            });
            if (options.devTask !== undefined && !devTaskClosed) devTask = options.devTask({registry, stateRoot: options.config.stateRoot});
            return;
        }
        // 启动没有成功时内核已自行关闭（"stopped" 表示宿主在启动中请求了停止）。
        const reason = startup.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；") || startup.status;
        const error = new ServerStartupError(`后端启动失败（${startup.status}）：${reason}`, startup.status, startup.failures);
        if (startup.status === "failed") {
            reportStartupFailure(error);
            // 紧急报告只带失败的入口与代号（内核不让错误正文进紧急通道），具体原因只在启动结果里：另写一行。
            reportFatal("runtime.startup.causes", "启动失败的原因", startup.failures);
        } else {
            admission.failed(error);
        }
        throw error;
    });

    const stopped = host.stopped.then(async (result): Promise<ServerStopOutcome> => {
        // 插件都已关闭：断开客户端链路，停止 RPC 监听。启动失败时同样走到这里。
        router.close();
        rpc.stop();
        // 启动失败时内核先关闭、再给出启动结果，停止可能先于启动结果结束；两者都确定后再算退出码。
        const startup: StartupResult = await host.application.startup;
        const failures: unknown[] = [];
        if (host.beforeStopError !== undefined) failures.push(new Error("停止步骤失败：排空", {cause: host.beforeStopError}));
        if (result.status !== "closed") failures.push(new Error("停止步骤失败：插件关闭未完成", {cause: result.report}));
        for (const problem of projectManager.shutdownProblems()) failures.push(new Error(`停止步骤失败：${problem}`));
        if (failures.length > 0) reportFatal("runtime.stop.incomplete", "后端关闭不完整", new AggregateError(failures, "后端关闭不完整"));
        if (result.status !== "closed") {
            // 关闭未完成时诊断插件可能还没关闭出口，记录没有补写；进程退出前把已接受的记录写完。
            try {
                await store.flush();
            } catch (error) {
                writeFatal(fatalLine("runtime.diagnostics.flushFailed", {error: serializeDiagnosticError(error)}));
            }
        }
        const exitCode: ExitCode = startup.status === "failed" || fatalSeen || failures.length > 0 ? 1 : 0;
        // 最后放下认领：此后同一状态根上的下一次启动不会再看到本实例。
        await options.claim.release();
        return {exitCode, failures, result};
    });

    return {
        application: host.application,
        projects: projectManager,
        ready,
        stopped,
        get url() {
            return url;
        },
        rpcUrl: rpc.url,
        requestStop: (source) => {
            void host.requestStop(source);
        },
    };
}
