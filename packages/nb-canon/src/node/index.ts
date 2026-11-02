/**
 * `@notnotype/nb-canon/node`：只在 Bun 里用的世界日志存储与归纳缓存文件（docs/specs/canon/project.md）。
 */

export {nodeFiles, type LogFiles} from "./files";
export {appendRevision, LINE_LIMIT, openLog, readNew, SEGMENT_LIMIT, segmentName, type AppendFailure, type LogDiagnostic, type LogLock, type Opened, type Tail} from "./log";
export {appendReduction, loadReductions, type ReductionCache} from "./cache";
