/**
 * `@notnotype/nb-canon/node`：只在 Bun 里用的世界日志存储、归纳缓存文件，以及编排它们的世界服务（docs/specs/canon/project.md）。
 * 世界服务在项目进程里跑；浏览器经远程服务调用它，不导入本子路径。
 */

export {nodeFiles, type LogFiles} from "./files";
export {appendRevision, LINE_LIMIT, openLog, readNew, SEGMENT_LIMIT, segmentName, type AppendFailure, type LogDiagnostic, type LogLock, type Opened, type Tail} from "./log";
export {appendReduction, loadReductions, type ReductionCache} from "./cache";
export {LEASE_MS, WorldService, type MarkHint, type ServiceDiagnostic, type ServiceEvent, type ServiceFailure, type ServicePorts, type ServiceState, type WorldSnapshot} from "../service/service";
export type {DiagnosticCompute, Finding, FindingAt} from "../service/diagnostics";
export type {CanonHint, GroupItem, PendingPage} from "../service/pending-groups";
export {createReadView, type CanonReadView, type ChangeFilter, type DecisionFilter, type PresenceFilter, type TellingFilter, type TellingHint, type TellingItem} from "../service/reads";
