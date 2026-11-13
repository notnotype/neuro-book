/**
 * 服务端宿主的公开入口（只在 Bun 进程里用）：服务端进程的启动与停止（`startHostServer`，自己建 HTTP 与诊断两个宿主插件、
 * 监听内核 RPC 端口），回环与来源校验、端口顺延、状态根认领，以及项目子进程也用的宿主适配器与诊断出口。
 */

export {assertLoopbackHost, assertLoopbackOrigins, HostConfigError, LOOPBACK_BIND_HOSTS, LOOPBACK_URL_HOSTS, loopbackOrigins, parseAllowedOrigins} from "./loopback";
export type {HostConfigErrorCode} from "./loopback";
export {freeGroupOffset, isAddressInUse, listenWithShift, PORT_SHIFT_ATTEMPTS, PORT_SHIFT_STEP, probePort} from "./ports";
export type {ListenWithShiftOptions, ShiftedListen} from "./ports";
export {claimStateRoot, defineClaimProfile, HELLO_TIMEOUT_MS, instanceAddress, queryInstance, sendRequest} from "./claim";
export type {ClaimOptions, ClaimProfile, ClaimResult, InstanceInfo, InstanceKind, InstanceQuery, InstanceStatus, RequestResult, StateRootClaim} from "./claim";
export type {HostRoute} from "../http/plugin";
export type {DrainClock} from "../http/admission";
export {startServerHost} from "./host";
export type {FatalKind, ProcessEvents, ServerHost, ServerHostOptions} from "./host";
export {createServerDiagnosticsPlugin} from "./diagnostics/plugin";
export type {ServerDiagnosticsPluginOptions} from "./diagnostics/plugin";
export {SERVER_INSTANCE_ID, ServerAssemblyError, ServerStartupError, startHostServer} from "./start";
export type {ExitCode, HostAttachContext, HostListen, HostPluginContext, HostServer, HostServerExtension, HostServerOptions, HostStopOutcome} from "./start";
