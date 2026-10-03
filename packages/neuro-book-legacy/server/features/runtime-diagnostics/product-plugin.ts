import type {DiagnosticRecord, DiagnosticsStore} from "nbook/runtime/diagnostics/diagnostics";
import {createDiagnosticsPlugin, diagnosticsKey} from "nbook/runtime/diagnostics/diagnostics";
import type {ActivationOutput, PluginDefinition} from "nbook/runtime/plugins/plugins";
import {appLogger} from "nbook/server/app-logs/logger";
import {createStderrFallback} from "nbook/server/features/runtime-diagnostics/jsonl-exporter";
import {installAppLogBridge} from "./app-log-bridge";
import type {AppLogBridge} from "./app-log-bridge";

/** 产品出口直接调用 appLogger 的 writer；诊断插件不另建同目录 JSONL writer。 */
export function createProductDiagnosticsPlugin(store: DiagnosticsStore): PluginDefinition {
    const base = createDiagnosticsPlugin({
        location: "server",
        store,
        exporter: async () => {
            let closed = false;
            return {
                status: "open" as const,
                exporter: {
                    kind: "jsonl",
                    write(record: DiagnosticRecord): Promise<void> {
                        if (closed) throw new Error("产品诊断出口已关闭");
                        return appLogger.writeDiagnostic(record);
                    },
                    async close(): Promise<void> {
                        // store 已等完其写队列；这里只关闭借用出口，writer 由宿主最终 flush/close。
                        closed = true;
                    },
                },
            };
        },
        fallback: createStderrFallback(),
    });
    const baseEntry = base.entries[0];
    if (baseEntry === undefined) throw new Error("nbook.diagnostics 缺少主入口");

    return {
        ...base,
        entries: [{
            ...baseEntry,
            activate: async (context) => {
                const output = await baseEntry.activate(context);
                let bridge: AppLogBridge | undefined;
                try {
                    bridge = installAppLogBridge();
                    try {
                        await appLogger.info("app.logs.ready", {
                            directory: appLogger.logDirectory,
                            currentFile: appLogger.currentFilePath,
                            nodeEnv: process.env.NODE_ENV ?? null,
                        });
                    } catch (error) {
                        appLogger.fatalSync("app.logs.bridgeFailed", undefined, error, "进程日志桥接就绪事件写入失败");
                    }
                    return wrapDiagnosticsRelease(output, bridge);
                } catch (error) {
                    bridge?.close();
                    await store.shutdown();
                    throw error;
                }
            },
        }],
    };
}

function wrapDiagnosticsRelease(output: ActivationOutput, bridge: AppLogBridge): ActivationOutput {
    const services = output.services?.map((service) => {
        if (service.key !== diagnosticsKey || service.release === undefined) return service;
        const release = service.release.bind(service);
        return {
            ...service,
            release: async (instance: unknown) => {
                try {
                    await release(instance);
                } finally {
                    bridge.close();
                }
            },
        };
    });
    return services === undefined ? output : {...output, services};
}
