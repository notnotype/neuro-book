/**
 * 后端装配：建立诊断存储与 HTTP 准入，按清单装配插件，启动宿主，并把启动与停止的结果换算成退出码
 * （取值规则见 docs/specs/runtime/server-host.md 的“输出与可观察行为”）。
 *
 * 致命诊断走两条路：同步写到致命通道（缺省是标准错误），进程马上退出也看得见；同时记入诊断存储，
 * 出口可用时随后落盘。
 */

import {writeSync} from "node:fs";

import type {Application, StartupResult, StopResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency, serializeDiagnosticError} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {HttpAdmission} from "nbook/plugins/http/server/admission";
import type {DrainClock} from "nbook/plugins/http/server/admission";

import type {ServerConfig} from "./config";
import {startServerHost} from "./host";
import type {FatalKind, ProcessEvents} from "./host";
import {collectServiceKeys, productServerPlugins} from "./plugins";
import type {ServerPluginContext} from "./plugins";

export type ExitCode = 0 | 1;

export interface StartServerOptions {
    readonly config: ServerConfig;
    /** 装配插件；缺省按产品清单。测试经这里加入自己的插件，产品代码不含测试分支。 */
    readonly plugins?: (context: ServerPluginContext) => ReadonlyArray<PluginDefinition>;
    readonly process?: ProcessEvents;
    readonly signals?: ReadonlyArray<NodeJS.Signals>;
    readonly stopInput?: NodeJS.ReadableStream | null;
    readonly clock?: DrainClock;
    readonly onListening?: (url: string) => void;
    /** 致命通道，必须同步写完；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
}

export interface ServerStopOutcome {
    readonly exitCode: ExitCode;
    /** 停止中失败的步骤（HTTP 排空、插件关闭）；为空表示停止完整。 */
    readonly failures: ReadonlyArray<unknown>;
    readonly result: StopResult;
}

export interface RunningServer {
    readonly application: Application;
    /** 运行实例可用时完成；启动失败时拒绝。 */
    readonly ready: Promise<void>;
    readonly stopped: Promise<ServerStopOutcome>;
    /** 监听成功后的地址；未监听为 null。 */
    readonly url: string | null;
    requestStop(source: string): void;
}

/** 按清单装配插件失败。抛出前致命诊断已写出，调用方只需以 1 退出。 */
export class ServerAssemblyError extends Error {
    constructor(options: ErrorOptions) {
        super("后端插件装配失败", options);
        this.name = "ServerAssemblyError";
    }
}

const INSTANCE_ID = "server";

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

    const context: ServerPluginContext = {
        config: options.config,
        store,
        admission,
        onListening: (address) => {
            url = address;
            options.onListening?.(address);
        },
    };
    let plugins: ReadonlyArray<PluginDefinition>;
    try {
        plugins = (options.plugins ?? productServerPlugins)(context);
    } catch (error) {
        // 还没有运行实例，没有要关闭的资源。
        reportFatal("runtime.startup.failed", "后端插件装配失败", error);
        throw new ServerAssemblyError({cause: error});
    }
    const emergency = recordingEmergency(store, (report) => {
        if (report.stage === "startup") {
            reportStartupFailure(new Error(`${report.reason}：${report.detail ?? ""}`));
            return;
        }
        // recordingEmergency 已把报告记入诊断存储；停止阶段出口可能已关闭，这里只补同步的致命通道。
        writeFatal(fatalLine("runtime.stop.emergency", {report}));
    });
    const host = startServerHost({
        instanceId: INSTANCE_ID,
        manifest: {
            keys: collectServiceKeys(plugins),
            plugins,
            requiredPlugins: plugins.map((plugin) => plugin.id),
            gates: [],
            observers: mechanismObservers(store),
        },
        emergency,
        process: options.process,
        signals: options.signals,
        stopInput: options.stopInput,
        beforeStop: () => admission.drain(),
        onFatal: (error: unknown, kind: FatalKind) => {
            fatalSeen = true;
            reportFatal(`process.${kind}`, kind === "uncaught-exception" ? "未捕获的异常，后端将有序关闭" : "未处理的 Promise 拒绝，后端将有序关闭", error);
        },
    });

    const ready = host.application.startup.then((startup) => {
        if (startup.status === "available") {
            admission.ready();
            return;
        }
        // 启动没有成功时内核已自行关闭（"stopped" 表示宿主在启动中请求了停止）。
        const reason = startup.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；") || startup.status;
        const error = new Error(`后端启动失败（${startup.status}）：${reason}`);
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
        // 启动失败时内核先关闭、再给出启动结果，停止可能先于启动结果结束；两者都确定后再算退出码。
        const startup: StartupResult = await host.application.startup;
        const failures: unknown[] = [];
        if (host.beforeStopError !== undefined) failures.push(new Error("停止步骤失败：HTTP 排空", {cause: host.beforeStopError}));
        if (result.status !== "closed") failures.push(new Error("停止步骤失败：插件关闭未完成", {cause: result.report}));
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
        return {exitCode, failures, result};
    });

    return {
        application: host.application,
        ready,
        stopped,
        get url() {
            return url;
        },
        requestStop: (source) => {
            void host.requestStop(source);
        },
    };
}
