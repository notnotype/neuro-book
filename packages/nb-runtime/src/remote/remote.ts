/**
 * runtime 远程服务：跨运行实例的插件通信（合同、协议、节点与路由）的唯一公开入口。
 *
 * Owner 为 runtime。本模块只允许同目录相对导入、`../lifecycle/lifecycle`、`../services/services`、
 * `../plugins/plugins` 与 TypeBox；不依赖 UI、HTTP 框架或任何产品领域。传输由宿主经链路接口交入，
 * 模块顶层没有 I/O 与计时器。行为合同见 docs/specs/runtime/plugin-channel.md。
 */

export type * from "./contract";
export {defineRemoteService} from "./contract";
export type * from "./protocol";
export {checkHello, failureFor, parseFrame, REMOTE_FAILURE_CODES, reservedKeys, validationProblems, WIRE_PROTOCOL_VERSION} from "./protocol";
