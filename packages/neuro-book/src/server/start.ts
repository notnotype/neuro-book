/**
 * 后端装配：建立诊断存储与 HTTP 准入，按清单装配插件，启动宿主，并把各种结果汇总成退出码。
 *
 * 退出码：正常停止且全部关闭完成为 0；启动失败、未处理异常、排空超时或任一关闭步骤失败为 1。
 * 启动失败先同步写出致命诊断，再由内核收口已取得的资源；不靠未捕获异常结束进程。插件装配本身失败
 * （清单与工厂不一致、工厂抛错）时还没有运行实例，写出致命诊断后抛 `ServerAssemblyError`，由进程入口以 1 退出。
 */

import {writeSync} from "node:fs";

import type {Application, StopResult} from "@notnotype/nb-runtime/application";
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
    /** 同步的致命输出；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
}

export interface ServerStopOutcome {
    readonly exitCode: ExitCode;
    readonly failures: ReadonlyArray<unknown>;
    readonly result: StopResult;
}

export interface RunningServer {
    readonly application: Application;
    /** 运行实例可用时兑现；启动失败时拒绝。 */
    readonly ready: Promise<void>;
    readonly stopped: Promise<ServerStopOutcome>;
    /** 监听成功后的地址；未监听为 null。 */
    readonly url: string | null;
    requestStop(source: string, exitCode?: ExitCode): void;
}

/** 按清单装配插件失败；致命诊断已同步写出。 */
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

export function startServer(options: StartServerOptions): RunningServer {
    const writeFatal = options.writeFatal ?? writeStderrSync;
    const store = createDiagnosticsStore({identity: {location: "server", instanceId: INSTANCE_ID}});
    const admission = new HttpAdmission({clock: options.clock});
    let url: string | null = null;
    let exitCode: ExitCode = 0;
    let startupDiagnosed = false;

    /** 同步写一行致命诊断到标准错误，并记入诊断存储（出口可用时随后落盘）。 */
    const reportFatal = (event: string, message: string, error: unknown): void => {
        writeFatal(`${JSON.stringify({level: "fatal", event, message, error: serializeDiagnosticError(error)})}\n`);
        store.record({level: "fatal", event, message, error});
    };
    const diagnoseStartup = (error: unknown): void => {
        exitCode = 1;
        admission.failed(error);
        if (startupDiagnosed) return;
        startupDiagnosed = true;
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
        reportFatal("runtime.startup.failed", "后端插件装配失败", error);
        throw new ServerAssemblyError({cause: error});
    }
    const emergency = recordingEmergency(store, (report) => {
        if (report.stage === "startup") diagnoseStartup(new Error(`${report.reason}：${report.detail ?? ""}`));
        else writeFatal(`${JSON.stringify({level: "fatal", event: "runtime.stop.emergency", report})}\n`);
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
            exitCode = 1;
            reportFatal(`process.${kind}`, kind === "uncaught-exception" ? "未捕获的异常，后端将有序关闭" : "未处理的 Promise 拒绝，后端将有序关闭", error);
        },
    });
    const requestStop = (source: string, code: ExitCode = 0): void => {
        if (code === 1) exitCode = 1;
        void host.requestStop(source);
    };

    const ready = host.application.startup.then((result) => {
        if (result.status === "available") {
            admission.ready();
            return;
        }
        // 启动没有成功时内核已自行关闭（"stopped" 是宿主在启动中请求了停止），这里只定结果与退出码。
        const reason = result.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；") || result.status;
        const error = new Error(`后端启动失败（${result.status}）：${reason}`);
        if (result.status === "failed") diagnoseStartup(error);
        else admission.failed(error);
        throw error;
    });
    // 退出码要等启动结果确定后再取，避免内核先停完时丢掉启动失败。
    const startupSettled = ready.then(() => undefined, () => undefined);
    const stopped = host.stopped.then(async (result): Promise<ServerStopOutcome> => {
        await startupSettled;
        const failures: unknown[] = [];
        if (host.beforeStopError !== undefined) failures.push(new Error("停止步骤失败：HTTP 排空", {cause: host.beforeStopError}));
        if (result.status !== "closed") failures.push(new Error("停止步骤失败：插件关闭未完成", {cause: result.report}));
        if (failures.length > 0) {
            exitCode = 1;
            reportFatal("runtime.stop.incomplete", "后端关闭不完整", new AggregateError(failures, "后端关闭不完整"));
        }
        if (result.status !== "closed") {
            // 关闭未完成时诊断插件可能还没收口，它的出口没有补写；进程退出前把已接受的记录写完。
            try {
                await store.flush();
            } catch (error) {
                writeFatal(`${JSON.stringify({level: "fatal", event: "runtime.diagnostics.flushFailed", error: serializeDiagnosticError(error)})}\n`);
            }
        }
        return {exitCode, failures, result};
    });

    return {
        application: host.application,
        ready,
        stopped,
        get url() {
            return url;
        },
        requestStop,
    };
}
