/**
 * 服务端宿主的公开入口（只在 Bun 进程里用）：回环与来源校验、端口顺延、状态根认领、HTTP 插件。
 */

export {assertLoopbackHost, assertLoopbackOrigins, HostConfigError, LOOPBACK_BIND_HOSTS, LOOPBACK_URL_HOSTS, loopbackOrigins, parseAllowedOrigins} from "./loopback";
export type {HostConfigErrorCode} from "./loopback";
export {freeGroupOffset, isAddressInUse, listenWithShift, PORT_SHIFT_ATTEMPTS, PORT_SHIFT_STEP, probePort} from "./ports";
export type {ListenWithShiftOptions, ShiftedListen} from "./ports";
export {claimStateRoot, defineClaimProfile, HELLO_TIMEOUT_MS, instanceAddress, queryInstance} from "./claim";
export type {ClaimOptions, ClaimProfile, ClaimResult, InstanceInfo, InstanceKind, InstanceQuery, InstanceStatus, StateRootClaim} from "./claim";
export type {HostRoute} from "../http/plugin";
// 过渡导出：启动流程还在应用里，应用要自己建 HTTP 插件与准入；启动流程搬进本包后删去。
export {HTTP_DRAIN_LIMIT_MS, HttpAdmission, HttpAdmissionRejected} from "../http/admission";
export type {DrainClock} from "../http/admission";
export {createHttpPlugin} from "../http/plugin";
export type {HttpPluginOptions} from "../http/plugin";
