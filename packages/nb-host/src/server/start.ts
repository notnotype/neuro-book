/**
 * 服务端进程的启动与停止（docs/specs/runtime/server-host.md）：建立诊断存储、HTTP 准入、服务端的远程节点与路由，监听内核
 * RPC 端口，建好两个宿主插件（诊断出口与 HTTP），交应用装配其余插件，启动宿主适配器，并把启动与停止的结果换算成退出码。
 * 应用只给名字、插件、能力与扩展钩子；回环与来源的判定、准入、排空与退出码都在这里，应用换不掉。
 *
 * RPC 监听先于插件装配：引导接口要告诉浏览器实际端口。停止时先在同一个同步段里关闭 HTTP、RPC 与各扩展的接纳，再并行
 * 排空 HTTP 与 RPC；内核停止时按依赖逆序关闭插件；插件全部关闭后才关闭 RPC 链路与监听，插件关闭期间客户端看到的是
 * 服务不可用而不是断线。
 *
 * 致命诊断走两条路：同步写到致命通道（缺省是标准错误），进程马上退出也看得见；同时记入诊断存储，出口可用时随后落盘。
 */

import {writeSync} from "node:fs";

import type {Application, ApplicationManifest, StartupFailure, StartupResult, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency, serializeDiagnosticError} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition, PluginPlatform} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {RemoteRouter, RemoteRouterOptions} from "@notnotype/nb-runtime/remote";
import type {TProperties} from "typebox";

import {HTTP_DRAIN_LIMIT_MS, HttpAdmission, HttpAdmissionRejected} from "../http/admission";
import type {DrainClock} from "../http/admission";
import {createHttpPlugin} from "../http/plugin";
import type {HostRoute} from "../http/plugin";
import {RPC_PATH} from "../shared/socket";
import type {StateRootClaim} from "./claim";
import {createServerDiagnosticsPlugin} from "./diagnostics/plugin";
import {startServerHost} from "./host";
import type {FatalKind, ProcessEvents} from "./host";
import {assertLoopbackHost, assertLoopbackOrigins, loopbackOrigins} from "./loopback";
import {isAddressInUse, listenWithShift, PORT_SHIFT_ATTEMPTS} from "./ports";
import {startRpcListener} from "./rpc-listener";
import type {RpcGateResult, RpcListener} from "./rpc-listener";

export type ExitCode = 0 | 1;
type ExtraInfo<E extends TProperties> = Parameters<StateRootClaim<E>["publish"]>[0]["extra"];

/** 服务端进程的实例 id。 */
export const SERVER_INSTANCE_ID = "server";
/** 内核自带的诊断插件的 id。 */
const DIAGNOSTICS_PLUGIN_ID = "runtime.diagnostics";
/** RPC 排空的上限与 HTTP 相同：两者并行，停止序列的这一步最多等这么久。 */
const RPC_DRAIN_LIMIT_MS = HTTP_DRAIN_LIMIT_MS;

export interface HostListen {
    /** 只许回环地址；应用读配置时已校验，这里在任何监听之前再核一次。 */
    readonly host: string;
    /** 0 表示由系统分配。 */
    readonly port: number;
    readonly rpcPort: number;
    /** 两个端口都取缺省时为 true：被占用就成组顺延。 */
    readonly shiftPorts: boolean;
    /** 额外放行的页面来源（已规范化，只能在回环上）。 */
    readonly allowedOrigins: ReadonlyArray<string>;
}

/** 交给应用装配插件、能力与宿主接口的上下文；此时 RPC 已在监听，运行实例还没建。 */
export interface HostPluginContext {
    readonly store: DiagnosticsStore;
    /** 内核 RPC 端口（已在监听）；引导接口据此告知浏览器。 */
    readonly rpc: {readonly port: number; readonly path: string};
    /** 顺延之后的实际端口。HTTP 端口为 0 时实际地址要等 HTTP 插件监听后才知道（`HostServer.url`）。 */
    readonly listen: {readonly host: string; readonly port: number; readonly rpcPort: number};
    /**
     * 宿主建好的两个宿主插件：`runtime.diagnostics`（JSONL 出口）与 HTTP（id 取 `options.http.id`）。应用交回的插件表必须含它们，
     * 可以经包装并上描述的贡献，但入口不能换掉或删掉：宿主按入口元素核对。
     */
    readonly hostPlugins: {readonly diagnostics: PluginDefinition; readonly http: PluginDefinition};
}

/** 运行实例建立之后交给扩展的上下文。 */
export interface HostAttachContext {
    readonly application: Application;
    readonly router: RemoteRouter;
    readonly store: DiagnosticsStore;
    readonly instanceId: string;
}

/**
 * 应用挂进启动与停止序列的步骤（项目管理、开发任务这类）。时序：
 * - `attach`：运行实例建立之后、同一个同步段里调用，此时运行实例、路由与诊断存储都已就绪；
 * - `ready`：运行实例可用、等待中的请求已放行、认领已发布之后调用；停止已开始时不调用；
 * - `stopping`：停止开头的同步段里按传入顺序调用，先于两路排空开始；返回的 Promise 与排空并行等待，失败计为
 *   “停止步骤失败：排空”、退出码 1；
 * - `problems`：停止结算后读，非空即停止不完整、退出码 1。
 */
export interface HostServerExtension {
    attach?(context: HostAttachContext): void;
    ready?(): void;
    stopping?(): void | Promise<void>;
    problems?(): ReadonlyArray<string>;
}

export interface HostServerOptions<E extends TProperties> {
    /** 进 503 文字（“<产品名> 正在关闭。”）。 */
    readonly product: {readonly name: string};
    /** 必填：漏传时内置插件的跨命名空间贡献被拒，界面少东西却没有类型错误。 */
    readonly platform: PluginPlatform;
    readonly listen: HostListen;
    /** 诊断出口的日志目录。 */
    readonly logDirectory: string;
    /**
     * 已认领的状态根。本函数接管它：就绪时发布地址与应用字段，停止开始时标记，停止结算后或装配失败时放下。没有认领就
     * 起不了服务端，一个状态根只跑一个实例由此保证。
     */
    readonly claim: StateRootClaim<E>;
    readonly http: {
        readonly id: string;
        /** `vite build` 的输出目录；null 时不提供页面。 */
        readonly staticRoot: string | null;
        /** 宿主自有接口（挂在 `/api/runtime/`）；要用诊断存储或实际 RPC 端口的，等它们建好再给。 */
        readonly hostRoutes?: (context: {readonly store: DiagnosticsStore; readonly rpc: HostPluginContext["rpc"]}) => ReadonlyArray<HostRoute>;
    };
    /** 本进程的插件表，必须含 `context.hostPlugins` 的两个。 */
    readonly plugins: (context: HostPluginContext) => ReadonlyArray<PluginDefinition>;
    /** 宿主能力；在插件装配之后、运行实例建立之前调用一次。 */
    readonly capabilities?: (context: HostPluginContext) => ApplicationManifest["capabilities"];
    /** 启动必需的插件 id；缺省全部。两个宿主插件总是必需。 */
    readonly requiredPlugins?: (plugins: ReadonlyArray<PluginDefinition>) => ReadonlyArray<string>;
    readonly backgroundStartupPlugins?: ReadonlyArray<string>;
    readonly satisfies?: ApplicationManifest["satisfies"];
    /** 路由的项目绑定与无租约访问；不给时带绑定的 hello 一律 `project-unavailable`。 */
    readonly router?: Pick<RemoteRouterOptions, "bindProject" | "projectAccess">;
    readonly extensions?: ReadonlyArray<HostServerExtension>;
    /** 就绪时随认领发布的应用字段。 */
    readonly readyInfo: () => ExtraInfo<E>;
    readonly process?: ProcessEvents;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly stopInput?: NodeJS.ReadableStream | null;
    /** HTTP 与 RPC 排空的截止计时。 */
    readonly clock?: DrainClock;
    readonly onListening?: (url: string) => void;
    /** RPC 端口开始监听后报告地址（`ws://…/`）。 */
    readonly onRpcListening?: (url: string) => void;
    /** 致命通道，必须同步写完；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
}

export interface HostStopOutcome {
    readonly exitCode: ExitCode;
    /** 停止中失败的步骤（排空、插件关闭、扩展的问题）；为空表示停止完整。 */
    readonly failures: ReadonlyArray<unknown>;
    readonly result: StopResult;
}

export interface HostServer {
    readonly application: Application;
    /** 运行实例可用时完成；启动失败时拒绝（`ServerStartupError`）。 */
    readonly ready: Promise<void>;
    readonly stopped: Promise<HostStopOutcome>;
    /** 监听成功后的页面地址；未监听为 null。 */
    readonly url: string | null;
    /** 内核 RPC 端口的地址（`ws://…/`）；返回时已在监听。 */
    readonly rpcUrl: string;
    /** 此刻已被接纳或在等就绪的请求数（HTTP 请求与 RPC 升级过同一道准入）。只是一次观察。 */
    readonly activeRequests: number;
    requestStop(source: string): void;
}

/**
 * 运行实例没有可用（`HostServer.ready` 的拒绝原因）：`status` 为 `failed` 是启动失败，带内核给出的各失败入口与错误摘要；
 * `stopped` 是启动中被请求停止。
 */
export class ServerStartupError extends Error {
    constructor(message: string, readonly status: Exclude<StartupResult["status"], "available">, readonly failures: ReadonlyArray<StartupFailure>) {
        super(message);
        this.name = "ServerStartupError";
    }
}

/** 运行实例建立之前的装配失败（回环核对、RPC 端口监听、插件装配、宿主插件核对）。抛出前致命诊断已写出、认领已放下，调用方只需以 1 退出。 */
export class ServerAssemblyError extends Error {
    constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = "ServerAssemblyError";
    }
}

function writeStderrSync(line: string): void {
    writeSync(2, line);
}

function fatalLine(event: string, fields: Record<string, unknown>): string {
    return `${JSON.stringify({level: "fatal", event, ...fields})}\n`;
}

export function startHostServer<E extends TProperties>(options: HostServerOptions<E>): HostServer {
    const writeFatal = options.writeFatal ?? writeStderrSync;
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: SERVER_INSTANCE_ID}});
    const admission = new HttpAdmission({productName: options.product.name, clock: options.clock});
    let url: string | null = null;
    let fatalSeen = false;
    let startupFailureReported = false;
    let stopBegun = false;
    const extensions = options.extensions ?? [];

    /** 写到致命通道并记入诊断存储。 */
    const reportFatal = (event: string, message: string, error: unknown): void => {
        writeFatal(fatalLine(event, {message, error: serializeDiagnosticError(error)}));
        store.record({level: "fatal", event, message, error});
    };
    /** 运行实例建立之前失败：没有要关闭的运行实例，写致命诊断、放下认领再抛。 */
    const assemblyFailed = (message: string, error: unknown): never => {
        reportFatal("runtime.startup.failed", message, error);
        void options.claim.release();
        throw new ServerAssemblyError(message, {cause: error});
    };
    // 启动失败会通知两次：内核关闭已取得的资源之前先发紧急报告，关闭完成后才给出启动结果。
    // 在紧急报告时就拒绝等待中的请求，它们才能在监听关闭前拿到 503；启动结果到达时只在还没报告过时补报。
    const reportStartupFailure = (error: unknown): void => {
        admission.failed(error);
        if (startupFailureReported) return;
        startupFailureReported = true;
        reportFatal("runtime.startup.failed", "后端启动失败，将有序关闭", error);
    };

    // 监听之前的第二道回环核对：应用读配置时漏了也监听不到非回环地址上。
    try {
        assertLoopbackHost(options.listen.host, options.listen.host);
        assertLoopbackOrigins(options.listen.allowedOrigins, "allowedOrigins");
    } catch (error) {
        assemblyFailed("listen host or allowed origins are not on loopback", error);
    }

    const node = createRemoteNode({
        instance: {id: SERVER_INSTANCE_ID, kind: "server", role: "hub", project: null, client: null},
        observer: {
            diagnosticRecorded: (diagnostic) => store.record({level: "warn", event: `remote.${diagnostic.reason}`, message: "远程服务诊断", data: diagnostic}),
        },
    });
    const router = createRemoteRouter(node, options.router ?? {});
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
    // 同一个判定交给 HTTP 写请求与 RPC 升级。本页的来源要等 HTTP 插件监听后才知道（端口可能是 0）。
    const allowOrigin = (origin: string): boolean => {
        let normalized: string;
        try {
            normalized = new URL(origin).origin;
        } catch {
            return false;
        }
        return options.listen.allowedOrigins.includes(normalized) || (url !== null && loopbackOrigins(url).includes(normalized));
    };
    let rpc: RpcListener;
    let httpPort: number;
    try {
        const listened = listenWithShift({
            host: options.listen.host,
            httpPort: options.listen.port,
            rpcPort: options.listen.rpcPort,
            shift: options.listen.shiftPorts,
            listenRpc: (port) => startRpcListener({
                productName: options.product.name,
                host: options.listen.host,
                port,
                router,
                admit: admitUpgrade,
                allowOrigin,
                reportError: (error) => store.record({level: "error", event: "rpc.upgrade.failed", message: "处理 RPC 升级时出错", error}),
            }),
        });
        rpc = listened.rpc;
        httpPort = listened.httpPort;
        if (listened.offset > 0) {
            store.record({
                level: "warn",
                event: "server.ports.shifted",
                message: `缺省端口被占用，改用 HTTP ${String(httpPort)}、RPC ${String(rpc.port)}`,
                data: {offset: listened.offset, http: httpPort, rpc: rpc.port},
            });
        }
    } catch (error) {
        const message = options.listen.shiftPorts && isAddressInUse(error)
            ? `缺省的 HTTP 与内核 RPC 端口及顺延的 ${String(PORT_SHIFT_ATTEMPTS - 1)} 组都被占用`
            : "内核 RPC 端口监听失败";
        return assemblyFailed(message, error);
    }
    options.onRpcListening?.(rpc.url);

    const rpcInfo = {port: rpc.port, path: RPC_PATH};
    const hostPlugins = {
        diagnostics: createServerDiagnosticsPlugin({store, exporter: {directory: options.logDirectory}}),
        http: createHttpPlugin({
            id: options.http.id,
            admission,
            host: options.listen.host,
            port: httpPort,
            onListening: (address) => {
                url = address;
                options.onListening?.(address);
            },
            allowOrigin,
            hostRoutes: options.http.hostRoutes?.({store, rpc: rpcInfo}) ?? [],
            staticRoot: options.http.staticRoot,
        }),
    };
    const context: HostPluginContext = {store, rpc: rpcInfo, listen: {host: options.listen.host, port: httpPort, rpcPort: rpc.port}, hostPlugins};
    let plugins: ReadonlyArray<PluginDefinition>;
    let capabilities: ApplicationManifest["capabilities"];
    try {
        plugins = options.plugins(context);
        assertHostPlugins(plugins, hostPlugins);
        capabilities = options.capabilities?.(context);
    } catch (error) {
        // 还没有运行实例；只有已开的 RPC 监听要关。
        rpc.stop();
        return assemblyFailed("后端插件装配失败", error);
    }
    const required = new Set(options.requiredPlugins?.(plugins) ?? plugins.map((plugin) => plugin.id));
    required.add(DIAGNOSTICS_PLUGIN_ID);
    required.add(options.http.id);

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
    const drainBoth = async (): Promise<void> => {
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
    const host = startServerHost({
        instanceId: SERVER_INSTANCE_ID,
        platform: options.platform,
        manifest: {
            ...(capabilities === undefined ? {} : {capabilities}),
            plugins,
            requiredPlugins: [...required],
            ...(options.backgroundStartupPlugins === undefined ? {} : {backgroundStartupPlugins: options.backgroundStartupPlugins}),
            ...(options.satisfies === undefined ? {} : {satisfies: options.satisfies}),
            gates: [],
            observers: mechanismObservers(store),
            remote: node,
        },
        emergency,
        process: options.process,
        signals: options.signals,
        stopInput: options.stopInput,
        beforeStop: async () => {
            stopBegun = true;
            options.claim.stopping();
            // 同一个同步段里：各扩展先停止接纳（并开始自己的收尾），再开始两路排空；三者并行等。
            const stopping: Array<Promise<void>> = [];
            for (const extension of extensions) {
                try {
                    const step = extension.stopping?.();
                    if (step !== undefined) stopping.push(step);
                } catch (error) {
                    stopping.push(Promise.reject(error));
                }
            }
            const drained = drainBoth();
            const results = await Promise.allSettled([drained, ...stopping]);
            const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1) throw new AggregateError(failures, "停止步骤未完成");
        },
        onFatal: (error: unknown, kind: FatalKind) => {
            fatalSeen = true;
            reportFatal(`process.${kind}`, kind === "uncaught-exception" ? "未捕获的异常，后端将有序关闭" : "未处理的 Promise 拒绝，后端将有序关闭", error);
        },
    });
    for (const extension of extensions) extension.attach?.({application: host.application, router, store, instanceId: SERVER_INSTANCE_ID});

    const ready = host.application.startup.then((startup) => {
        if (startup.status === "available") {
            admission.ready();
            options.claim.publish({url, rpcUrl: rpc.url, extra: options.readyInfo()});
            // 运行实例在停止请求之后才报告可用时（启动中请求停止），不再启动扩展的就绪步骤。
            if (!stopBegun) for (const extension of extensions) extension.ready?.();
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

    const stopped = host.stopped.then(async (result): Promise<HostStopOutcome> => {
        // 插件都已关闭：断开客户端链路，停止 RPC 监听。启动失败时同样走到这里。
        router.close();
        rpc.stop();
        // 启动失败时内核先关闭、再给出启动结果，停止可能先于启动结果结束；两者都确定后再算退出码。
        const startup: StartupResult = await host.application.startup;
        const failures: unknown[] = [];
        if (host.beforeStopError !== undefined) failures.push(new Error("停止步骤失败：排空", {cause: host.beforeStopError}));
        if (result.status !== "closed") failures.push(new Error("停止步骤失败：插件关闭未完成", {cause: result.report}));
        for (const extension of extensions) for (const problem of extension.problems?.() ?? []) failures.push(new Error(`停止步骤失败：${problem}`));
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
        ready,
        stopped,
        get url() {
            return url;
        },
        rpcUrl: rpc.url,
        get activeRequests() {
            return admission.active;
        },
        requestStop: (source) => {
            void host.requestStop(source);
        },
    };
}

/**
 * 应用交回的插件表必须含宿主建的两个插件，入口还是宿主签发的那些：应用可以包装定义（并上描述的贡献，包装交回的是新对象），
 * 但不能换掉或删掉入口，否则来源判定、准入或诊断出口就不是宿主的那份了。
 */
function assertHostPlugins(plugins: ReadonlyArray<PluginDefinition>, issued: HostPluginContext["hostPlugins"]): void {
    for (const expected of [issued.diagnostics, issued.http]) {
        const found = plugins.find((plugin) => plugin.id === expected.id);
        if (found === undefined) throw new Error(`host plugin ${expected.id} is missing from the plugin table`);
        const same = found.entries.length === expected.entries.length && found.entries.every((entry, index) => entry === expected.entries[index]);
        if (!same) throw new Error(`entries of host plugin ${expected.id} were replaced`);
    }
}
