/**
 * runtime 远程服务：跨运行实例的插件通信（合同、协议、节点与路由）的唯一公开入口。
 *
 * Owner 为 runtime。本模块只允许同目录相对导入、`../lifecycle/lifecycle`、`../services/services`
 * 与 TypeBox；插件宿主经 `RemoteHostBinding` / `RemoteProviderSource` 两个接口与它相接，插件模块只做
 * 类型导入。不依赖 UI、HTTP 框架或任何产品领域；传输由宿主经链路接口交入，模块顶层没有 I/O 与计时器。
 * 行为合同见 docs/specs/runtime/plugin-channel.md。
 */

export type * from "./contract";
export {defineRemoteService} from "./contract";
export type * from "./protocol";
export {failureFor, parseFrame, REMOTE_FAILURE_CODES, reservedKeys, validationProblems, WIRE_PROTOCOL_VERSION, wireMismatch} from "./protocol";
export {decodeJsonFrame, encodeJsonFrame, FrameEncodingError} from "./json-codec";
export type * from "./node";
export {createRemoteNode, provideRemote} from "./node";
export type * from "./router";
export {createRemoteRouter} from "./router";
export type * from "./transport";
