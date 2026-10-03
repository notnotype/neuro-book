/**
 * runtime.diagnostics：诊断记录、查询与出口合同的唯一公开入口。
 *
 * Owner 为 runtime。本模块及同目录实现只允许同目录相对导入与 `../lifecycle/lifecycle`、
 * `../services/services`、`../plugins/plugins`、`../application/application`（仅类型）：
 * 不依赖 Vue、Nuxt、Nitro、文件、数据库或任何产品领域，也不依赖运行位置专有 API，
 * 以便在浏览器、后端进程与受管 Worker 上复用。模块顶层没有 I/O、没有单例、没有计时器。
 *
 * 数据边界：只在内存里维护有界记录、查询与降级状态；出口由宿主注入并只写它自己获授的位置，
 * 记录能力不扫描共享目录重建历史，也不删除任何持久数据。
 *
 * 行为合同见 docs/specs/runtime/diagnostics.md。
 */

export type * from "./contracts";
export {DiagnosticsError} from "./contracts";

export {createDiagnosticsStore, mechanismObservers, recordingEmergency} from "./store";
export {createDiagnosticsPlugin, diagnosticsKey} from "./plugin";
export type {DiagnosticsPluginOptions} from "./plugin";

export {
    MAX_STRING_LENGTH,
    UNREADABLE_PLACEHOLDER,
    describeDiagnosticError,
    redactSensitiveText,
    redactText,
    sanitizeDiagnosticValue,
    serializeDiagnosticError,
} from "./redaction";
