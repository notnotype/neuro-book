/**
 * 码表：内核用到的全部码在这里登记，按拥有者分组。程序按码分支，不按文字；界面按“拥有者 + 码”取本地化文案（ADR 0034）。
 * 码一经发布只加不改；Spec 里用到的码与这里一致。
 */

/**
 * 每个指令可能返回的业务失败码，也是远程方法 `errors` 的来源。界面里“手快会撞上”的指令（`abort`、`remove` 已被取走的）
 * 要么幂等、要么给出可以区分的码。各指令共有的 `session-closed`、`read-only`、`log-broken` 也逐个列出，表即合同。
 */
export const commandErrors = {
    send: ["empty-input", "input-too-large", "input-rejected", "no-model", "no-credentials", "profile-invalid", "read-only", "session-closed", "log-broken"],
    enqueue: ["empty-input", "input-too-large", "input-rejected", "read-only", "session-closed", "log-broken"],
    edit: ["empty-input", "input-too-large", "input-rejected", "input-not-found", "input-consumed", "session-closed", "log-broken"],
    remove: ["input-not-found", "input-consumed", "session-closed", "log-broken"],
    resolve: ["unknown-interaction", "already-answered", "not-allowed", "invalid-answer", "input-rejected", "session-closed", "log-broken"],
    start: ["already-running", "nothing-to-continue", "no-model", "no-credentials", "profile-invalid", "read-only", "session-closed", "log-broken"],
    abort: ["session-closed"],
    rewind: ["running", "unknown-node", "invalid-target", "empty-input", "input-rejected", "session-closed", "log-broken"],
    switchBranch: ["running", "unknown-node", "session-closed", "log-broken"],
    fork: ["running", "unknown-node", "session-closed", "log-broken"],
    compact: ["nothing-to-compact", "no-compaction-model", "read-only", "session-closed", "log-broken"],
    changeSettings: ["unknown-extension", "unknown-key", "invalid-value", "session-closed", "log-broken"],
    changeProfile: ["running", "unknown-profile", "extension-missing", "dependency-missing", "dependency-cycle", "profile-invalid", "session-closed", "log-broken"],
    setTitle: ["empty-title", "session-closed", "log-broken"],
    archive: ["session-closed", "log-broken"],
} as const;

/** 存储与打开会话的失败码（`createSession`、`openSession`、`LogStore`）。 */
export const storageErrors = [
    /** 日志校验不过、中间有不完整的批、引用的大块内容缺失或不符。 */
    "log-corrupt",
    /** 会话头的 `format` 不认识：要先跑迁移脚本，不是损坏。 */
    "needs-migration",
    /** 会话已被另一个进程（或同进程的另一次打开）持有。 */
    "session-busy",
    /** 这个句柄写失败过；之后的写入都得这个码，重开以文件为准。 */
    "log-broken",
    "session-not-found",
    "session-exists",
    "invalid-session-id",
    /** 读写文件出错（权限、磁盘满）；`detail.message` 是英文的原因。 */
    "storage-failed",
    /** 会话头里的 Profile 解析不到：会话以只读打开。 */
    "unknown-profile",
] as const;

/** 内核造的工具结果的码（`toolResult.code`）。 */
export const toolResultCodes = [
    /** 收尾工具与别的工具混在一条回复里、或一条回复里有两个收尾工具：收尾工具都不执行。 */
    "finish-not-alone",
    "unknown-tool",
    "invalid-arguments",
    /** 中止宽限期过后还没完成：`status: "unknown"`。 */
    "aborted",
    /** 进程中断后恢复时，开始执行但没有结果：`status: "unknown"`。 */
    "interrupted",
    /** 进程中断时还在等审批，没执行：`status: "denied"`。 */
    "interrupted-before-approval",
    /** 工具被卸载。 */
    "tool-unavailable",
    /** 工具拦截出错，缺省拒绝这次调用。 */
    "intercept-failed",
    /** 只读模式下的写或执行。 */
    "read-only",
] as const;

/** 运行以 `error` 结束时 `runEnded.error.code` 的内核码（模型失败另按 `ModelErrorKind`）。 */
export const runErrorCodes = [
    /** 必需的工具缺失：运行收口、会话进只读。 */
    "tools-missing",
    /** Profile 的 `prompt`、`system`、`turn` 出错，算不出请求。 */
    "profile-failed",
    /** 请求校验不过（工具调用与结果不成对、角色顺序）。 */
    "request-invalid",
    /** 适配器不支持请求里的内容（例如某服务商不收图片），发请求前失败。 */
    "unsupported-content",
    /** 强制结构化的运行没有交回结果。 */
    "result-missing",
    /** 运行开始后模型端口解析不到模型或凭据。 */
    "no-model",
    "no-credentials",
    "unknown-model",
    "log-broken",
    /** 内核自己的错（原因进诊断）。 */
    "internal",
] as const;

/** 诊断码：键是码，值是缺省级别。 */
export const diagnosticCodes = {
    // 存储
    "log-tail-truncated": "warn",
    "index-write-failed": "warn",
    "event-version-unsupported": "warn",
    "index-rebuilt": "info",
    // 归约
    "reduce-threw": "error",
    "state-not-plain": "error",
    // 处理函数
    "handler-threw": "error",
    "handler-timeout": "error",
    "handler-invalid-output": "error",
    "emit-after-settle": "error",
    "reaction-depth-limit": "warn",
    "continue-limit": "warn",
    "late-result-dropped": "info",
    // 视图
    "slot-unplaced": "warn",
    "slot-collision": "error",
    "slot-volatile-in-system": "warn",
    "turn-node-count": "error",
    "prefix-unstable": "warn",
    "commit-differs": "warn",
    "commit-threw": "error",
    "render-threw": "error",
    "contribute-threw": "error",
    "request-invalid": "error",
    // 拦截
    "intercept-threw": "error",
    "input-rejected": "info",
    // 装配与生命周期
    "unknown-event-handler": "error",
    "event-never-fires": "info",
    "unknown-slice": "error",
    "setting-missing-default": "error",
    "bad-extension-id": "error",
    "duplicate-extension-id": "error",
    "dependency-missing": "error",
    "dependency-cycle": "error",
    "render-foreign-event": "error",
    "reminder-without-trigger": "error",
    "bad-slot-name": "error",
    "mount-failed": "error",
    "mount-timeout": "error",
    "extension-revoked": "warn",
    "unknown-profile": "error",
    "profile-code-updated": "info",
    // 宿主面
    "outbound-filter-threw": "error",
} as const;

export type CommandErrorTable = typeof commandErrors;
export type StorageError = (typeof storageErrors)[number];
export type ToolResultCode = (typeof toolResultCodes)[number];
export type RunErrorCode = (typeof runErrorCodes)[number];
export type DiagnosticCode = keyof typeof diagnosticCodes;
export type DiagnosticLevel = (typeof diagnosticCodes)[DiagnosticCode];
