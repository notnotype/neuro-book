/**
 * 浏览器宿主的公开入口：诊断的 console 出口。
 */

export {createBrowserDiagnosticsPlugin} from "./diagnostics/plugin";
export type {BrowserDiagnosticsPluginOptions} from "./diagnostics/plugin";
export {createConsoleExporterFactory, createConsoleFallback} from "./diagnostics/console-exporter";
export type {DiagnosticsConsole} from "./diagnostics/console-exporter";
