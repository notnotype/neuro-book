/**
 * 项目宿主：项目子进程里唯一的 `project` 位置运行实例（docs/specs/runtime/projects.md 输出第 4 条）。
 *
 * 先经 IPC 链路连上服务端的路由，再建立运行实例：插件激活时远程服务已可用。运行实例可用之后才向服务端报告
 * `started`，不报半就绪；启动失败报告原因后按停止序列收口。服务端发来 `stop`、或 IPC 断开（服务端已不在）
 * 都请求停止；停止期间链路保持，项目里的插件收口时仍能调用服务端。
 */

import {writeSync} from "node:fs";

import type {StartupResult} from "@notnotype/nb-runtime/application";
import {createDiagnosticsStore, mechanismObservers, recordingEmergency, serializeDiagnosticError} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import type {InstanceDescriptor} from "@notnotype/nb-runtime/remote";

import {delegatingPlugins, productPlugins} from "nbook/manifest";
import type {PluginDescriptor} from "nbook/manifest";
import {startServerHost} from "nbook/server/host";
import type {FatalKind, ProcessEvents, ServerHost} from "nbook/server/host";
import {createEnvelopeLink, parseEnvelope} from "nbook/server/projects/ipc";
import type {EnvelopeChannel} from "nbook/server/projects/ipc";

import type {ProjectConfig} from "./config";
import {currentProjectKey} from "./current-project";
import {manifestProjectPlugins} from "./plugins";
import type {ProjectPluginContext} from "./plugins";

/** 与服务端之间的 IPC 通道（子进程一侧）。 */
export interface ProjectChannel extends EnvelopeChannel {
    onMessage(listener: (value: unknown) => void): void;
    onDisconnect(listener: () => void): void;
}

export interface StartProjectOptions {
    readonly config: ProjectConfig;
    readonly channel: ProjectChannel;
    /** 本进程加载的清单；缺省是产品清单。 */
    readonly manifest?: ReadonlyArray<PluginDescriptor>;
    /** 装配插件；缺省按清单。测试经这里加入自己的插件，产品代码不含测试分支。 */
    readonly plugins?: (context: ProjectPluginContext) => ReadonlyArray<PluginDefinition>;
    readonly process?: ProcessEvents;
    /** 致命通道，必须同步写完；缺省写进程的标准错误描述符。 */
    readonly writeFatal?: (line: string) => void;
}

/** 0：正常停止且全部关闭完成；1：没能连上服务端、启动失败、未处理异常或停止中有步骤失败。 */
export type ProjectExitCode = 0 | 1;

/** 项目实例在路由里的描述；服务端以它作为这条链路的 `expect`，两侧必须一致。 */
export function projectInstance(config: Pick<ProjectConfig, "id" | "generation">): InstanceDescriptor {
    return {id: `project:${config.id}#${String(config.generation)}`, kind: "project", role: "project", project: {id: config.id, generation: config.generation}, client: null};
}

function fatalLine(event: string, fields: Record<string, unknown>): string {
    return `${JSON.stringify({level: "fatal", event, ...fields})}\n`;
}

export async function startProject(options: StartProjectOptions): Promise<ProjectExitCode> {
    const {config, channel} = options;
    const writeFatal = options.writeFatal ?? ((line: string) => void writeSync(2, line));
    const instance = projectInstance(config);
    const store = createDiagnosticsStore({identity: {location: "project", instanceId: instance.id}});
    const reportFatal = (event: string, message: string, error: unknown): void => {
        writeFatal(fatalLine(event, {message, error: serializeDiagnosticError(error)}));
        store.record({level: "fatal", event, message, error});
    };
    let fatalSeen = false;

    // 运行实例建立之前就可能收到停止（服务端在停止中、或已不在）：记下来源，实例一建立就转交。
    let host: ServerHost | null = null;
    let pendingStop: string | null = null;
    const requestStop = (source: string): void => {
        if (host !== null) void host.requestStop(source);
        else pendingStop ??= source;
    };
    const report = (envelope: Parameters<EnvelopeChannel["send"]>[0]): void => {
        try {
            channel.send(envelope);
        } catch (error) {
            // 服务端已不在：断开事件随后到达并请求停止，这里只留诊断。
            store.record({level: "warn", event: "project.ipc.send-failed", message: "向服务端报告失败", error});
        }
    };

    const node = createRemoteNode({
        instance,
        observer: {diagnosticRecorded: (diagnostic) => store.record({level: "warn", event: `remote.${diagnostic.reason}`, message: "远程服务诊断", data: diagnostic})},
    });
    const link = createEnvelopeLink(channel, (error) => store.record({level: "warn", event: "project.ipc.send-failed", message: "IPC 通道已断，帧没有发出", error}));
    channel.onMessage((value) => {
        const envelope = parseEnvelope(value);
        if (envelope === null) {
            store.record({level: "warn", event: "project.ipc.invalid", message: "收到无法识别的 IPC 消息"});
            return;
        }
        if (envelope.t === "frame") link.receive(envelope.d);
        else if (envelope.t === "stop") requestStop("parent:stop");
        else store.record({level: "warn", event: "project.ipc.unexpected", message: `服务端不该发送 ${envelope.t}`});
    });
    channel.onDisconnect(() => {
        link.closed();
        requestStop("parent:gone");
    });

    const connected = await node.connect(link);
    if (!connected.ok) {
        reportFatal("project.connect.failed", "没能连上服务端的路由", new Error(`${connected.reason}：${connected.message}`));
        report({t: "started", status: "failed", detail: `没能连上服务端：${connected.reason}`});
        return 1;
    }

    const context: ProjectPluginContext = {config, manifest: options.manifest ?? productPlugins, store, currentProject: currentProjectKey};
    let plugins: ReadonlyArray<PluginDefinition>;
    try {
        plugins = (options.plugins ?? manifestProjectPlugins)(context);
    } catch (error) {
        reportFatal("project.startup.failed", "项目插件装配失败", error);
        report({t: "started", status: "failed", detail: "项目插件装配失败"});
        return 1;
    }
    const current = Object.freeze({id: config.id, name: config.name, generation: config.generation, root: config.root});
    const running = startServerHost({
        instanceId: instance.id,
        location: "project",
        manifest: {
            capabilities: [{id: "project.current", key: currentProjectKey, create: () => current}],
            plugins,
            requiredPlugins: plugins.map((plugin) => plugin.id),
            gates: [],
            observers: mechanismObservers(store),
            remote: node,
            delegation: (plugin) => delegatingPlugins.includes(plugin),
        },
        emergency: recordingEmergency(store, (emergency) => {
            writeFatal(fatalLine(emergency.stage === "startup" ? "project.startup.failed" : "project.stop.emergency", {report: emergency}));
        }),
        process: options.process,
        // 终端的 Ctrl+C 会发给整个进程组：项目何时停由服务端决定，这里只认 SIGTERM。
        signals: ["SIGTERM"],
        onFatal: (error: unknown, kind: FatalKind) => {
            fatalSeen = true;
            reportFatal(`process.${kind}`, kind === "uncaught-exception" ? "未捕获的异常，项目将有序关闭" : "未处理的 Promise 拒绝，项目将有序关闭", error);
        },
    });
    host = running;
    if (pendingStop !== null) void running.requestStop(pendingStop);

    const startup: StartupResult = await running.application.startup;
    if (startup.status === "available") {
        report({t: "started", status: "available"});
    } else {
        const reason = startup.failures.map((failure) => `${failure.source}:${failure.reason}`).join("；") || startup.status;
        if (startup.status === "failed") reportFatal("project.startup.failed", "项目启动失败", startup.failures);
        report({t: "started", status: "failed", detail: `项目实例启动失败（${startup.status}）：${reason}`});
    }

    const result = await running.stopped;
    if (result.status !== "closed") {
        reportFatal("project.stop.incomplete", "项目关闭不完整", result.report);
        try {
            await store.flush();
        } catch (error) {
            writeFatal(fatalLine("project.diagnostics.flushFailed", {error: serializeDiagnosticError(error)}));
        }
    }
    return startup.status === "failed" || fatalSeen || result.status !== "closed" ? 1 : 0;
}
