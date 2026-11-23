/**
 * 宿主合同测试用的工具：连内核 RPC 端口的原始客户端、能掐断连接的 TCP 转发、记录请求的 HTTP 代理，以及单独测路由时要的 HTTP 准入与分发层。
 * 只由测试引用，产品代码不引用。
 */

export {helloFrame, openRawRpcSocket, upgradeStatus} from "./rpc-client";
export type {RawRpcSocket} from "./rpc-client";
export {startTcpProxy} from "./tcp-proxy";
export {startHttpProxy} from "./http-proxy";
export type {HttpProxy, HttpProxyOptions, ProxiedRequest} from "./http-proxy";
export type {TcpProxy} from "./tcp-proxy";
export {HttpAdmission} from "../http/admission";
export {createDispatcher, errorResponse, RouteTable, validateRouteContribution} from "../http/dispatch";
