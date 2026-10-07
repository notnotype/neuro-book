/**
 * `nbook.diagnostics` 后端入口：把 nb-runtime 的诊断存储接到 JSONL 文件出口，
 * 并在激活期间把 `console.warn`、`console.error` 记入诊断（原输出照常保留）。
 *
 * 存储由宿主在建立运行实例前创建，启动初期的事件因此不会丢；本入口只负责出口与桥接的寿命。
 * 进程级的未处理异常由宿主拥有（它决定停止进程），不在这里挂接。
 */

import {createDiagnosticsPlugin, diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticLevel, DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationOutput, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {createJsonlExporterFactory, createStderrFallback} from "./jsonl-exporter";
import type {JsonlExporterOptions} from "./jsonl-exporter";

export interface ServerDiagnosticsPluginOptions {
    readonly store: DiagnosticsStore;
    readonly exporter: JsonlExporterOptions;
    /** 后端入口跑在哪个运行位置：服务端进程或项目子进程，两者都是 Bun 进程、都写 JSONL。缺省 `server`。 */
    readonly location?: "server" | "project";
}

export function createServerDiagnosticsPlugin(options: ServerDiagnosticsPluginOptions): PluginDefinition {
    const base = createDiagnosticsPlugin({
        location: options.location ?? "server",
        store: options.store,
        exporter: createJsonlExporterFactory(options.exporter),
        fallback: createStderrFallback(),
    });
    const [baseEntry] = base.entries;
    if (base.id !== descriptor.id || base.entries.length !== 1 || baseEntry === undefined) {
        throw new Error(`nb-runtime 的诊断插件形状变了，${descriptor.id} 的后端入口需要同步`);
    }
    return {
        ...base,
        entries: [{
            ...baseEntry,
            activate: async (context) => {
                const output = await baseEntry.activate(context);
                const restoreConsole = bridgeConsole(options.store);
                return releaseBridgeWithService(output, restoreConsole);
            },
        }],
    };
}

/** 替换 `console.warn` 与 `console.error`：先照常输出，再记一条诊断；返回恢复函数。 */
function bridgeConsole(store: DiagnosticsStore): () => void {
    const originals = {warn: console.warn, error: console.error};
    const bridge = (level: Extract<DiagnosticLevel, "warn" | "error">, original: (...args: unknown[]) => void) => (...args: unknown[]): void => {
        original.apply(console, args);
        store.record({
            level,
            event: `console.${level}`,
            message: args.map(describeConsoleArgument).join(" "),
            error: args.find((argument) => argument instanceof Error),
            source: {plugin: descriptor.id},
        });
    };
    console.warn = bridge("warn", originals.warn);
    console.error = bridge("error", originals.error);
    let restored = false;
    return () => {
        if (restored) return;
        restored = true;
        console.warn = originals.warn;
        console.error = originals.error;
    };
}

function describeConsoleArgument(argument: unknown): string {
    if (typeof argument === "string") return argument;
    if (argument instanceof Error) return argument.message;
    return typeof argument;
}

/** 桥接与诊断服务同寿命：服务释放（出口补写并关闭）之后恢复原始 console。 */
function releaseBridgeWithService(output: ActivationOutput, restoreConsole: () => void): ActivationOutput {
    const services = output.services?.map((service) => {
        if (service.key !== diagnosticsKey) return service;
        const release = service.release?.bind(service);
        return {
            ...service,
            release: async (instance: unknown) => {
                try {
                    await release?.(instance);
                } finally {
                    restoreConsole();
                }
            },
        };
    });
    return {...output, services};
}
