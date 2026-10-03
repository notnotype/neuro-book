/**
 * `nbook.diagnostics` 浏览器入口：每个窗口运行实例一份诊断存储，出口写 console。
 *
 * 不桥接 console.warn、console.error（后端入口会桥接）：浏览器出口本身写 console，桥接会把每条记录再记一次。
 */

import {createDiagnosticsPlugin} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {createConsoleExporterFactory, createConsoleFallback} from "./console-exporter";
import type {DiagnosticsConsole} from "./console-exporter";

export interface BrowserDiagnosticsPluginOptions {
    readonly store: DiagnosticsStore;
    readonly console: DiagnosticsConsole;
}

export function createBrowserDiagnosticsPlugin(options: BrowserDiagnosticsPluginOptions): PluginDefinition {
    return createDiagnosticsPlugin({
        location: "browser",
        store: options.store,
        exporter: createConsoleExporterFactory(options.console),
        fallback: createConsoleFallback(options.console),
    });
}
