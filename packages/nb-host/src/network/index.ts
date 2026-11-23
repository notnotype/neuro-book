/**
 * 网络出口（只在 Bun 进程里用）：按设置给每个对外请求选路，读环境变量与操作系统的代理设置。应用持有设置项与页面，这里只管
 * 规则；行为合同见 docs/specs/network/egress.md。
 */

export {createEgress, EGRESS_LIMITS, EGRESS_TEST_URL, EgressError} from "./egress";
export type {Egress, EgressFailureCode, EgressOptions, EgressRoute, EgressRouter, EgressSource, EgressSummary, EgressTestResult, ProxyMode, ProxySetting} from "./egress";
export {bypassMatches, isLocalHost, parseProxy} from "./rules";
export type {SystemSource} from "./system";
