/**
 * 浏览器宿主的公开入口：浏览器一侧的内核实例、远程服务链路的首连与退避重连、RPC 端口的 WebSocket、客户端身份与诊断的
 * console 出口。
 */

export {BrowserRuntimeHost} from "./browser-host";
export type {BrowserHost, BrowserHostOptions, PageLifecycleTarget} from "./browser-host";
export {createRemoteSession} from "./remote-session";
export type {EndpointRefresh, FirstConnectResult, RemoteSession, RemoteSessionOptions, RemoteSessionState} from "./remote-session";
export {openRpcSocket, rpcSocketUrl} from "./rpc-socket";
export type {RpcEndpoint} from "./rpc-socket";
export {ConnectionError} from "./connection-error";
export {readClientIdentity} from "./client-identity";
export type {ClientIdentity, IdentityStorage} from "./client-identity";
export {createBrowserDiagnosticsPlugin} from "./diagnostics/plugin";
export type {BrowserDiagnosticsPluginOptions} from "./diagnostics/plugin";
export {createConsoleExporterFactory, createConsoleFallback} from "./diagnostics/console-exporter";
export type {DiagnosticsConsole} from "./diagnostics/console-exporter";
