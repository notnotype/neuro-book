/**
 * 宿主合同测试用的工具：连内核 RPC 端口的原始客户端、能掐断连接的 TCP 转发。只由测试引用，产品代码不引用。
 */

export {helloFrame, openRawRpcSocket, upgradeStatus} from "./rpc-client";
export type {RawRpcSocket} from "./rpc-client";
export {startTcpProxy} from "./tcp-proxy";
export type {TcpProxy} from "./tcp-proxy";
