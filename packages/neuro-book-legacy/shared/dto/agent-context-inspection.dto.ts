/**
 * 上下文检查面板 DTO（Task 126 批次 D）。
 *
 * 端点只返回**聚合量与诊断**，不返回消息正文——正文体积大且已有 `/api/agent/traces/[bucket]/[id]`
 * 可按需拉取（面板展开某条消息时才取）。
 */
import type {AgentTraceKindDto, AgentTraceSegmentDto, AgentTraceSegmentKindDto} from "nbook/shared/dto/agent-trace.dto";

/** 诊断严重度。info = 观察说明，warning = 会影响下一步的状态，danger = 配置问题。 */
export type AgentContextDiagnosticSeverityDto = "info" | "warning" | "danger";

/**
 * 一条诊断。判别联合，与 `server/agent/observability/context-diagnostics.ts` 的
 * `ContextDiagnostic` 一一对应；靠 typecheck 防两份定义漂移。
 *
 * 带 `traceId` 的是逐请求诊断（挂在缓存时间轴的对应柱下），其余是面板级诊断。
 */
export type AgentContextDiagnosticDto =
    | {code: "fixedOverhead"; severity: AgentContextDiagnosticSeverityDto; tokens: number; percent: number}
    | {code: "dominantSource"; severity: "info"; label: string; percent: number}
    | {code: "toolSchemaCost"; severity: "info"; percent: number}
    | {code: "nearCompaction"; severity: "warning"; percent: number; estimatedTurnsLeft: number | null}
    | {code: "contextWindowUnset"; severity: "danger"}
    | {code: "dynamicContextRewrite"; severity: "info"; tokens: number}
    | {code: "cacheRetention"; severity: "info"; retention: "none" | "short" | "long"; seconds: number}
    | {code: "cacheAutoPrefix"; severity: "info"; provider: string}
    | {code: "cacheNotReported"; severity: "info"; provider: string}
    | {code: "cacheExpired"; severity: "warning"; traceId: string; gapSeconds: number; retentionSeconds: number}
    | {code: "cacheCompactionRebuild"; severity: "info"; traceId: string}
    | {code: "cacheToolsChanged"; severity: "warning"; traceId: string}
    | {code: "cacheModelChanged"; severity: "info"; traceId: string; from: string; to: string};

/** 请求选择器条目。 */
export type AgentContextRequestRefDto = {
    id: string;
    ts: string;
    turnIndex?: number;
    invocationId?: string;
    /** provider 上报的真实 prompt 总量（input + cacheRead + cacheWrite）；未上报时 null。 */
    promptTokens: number | null;
};

/** 单个来源在某分区内的估算占用。 */
export type AgentContextLabelBreakdownDto = {
    kind: AgentTraceSegmentKindDto;
    label: string;
    estimatedTokens: number;
};

/** 缓存时间轴上的一次请求。 */
export type AgentContextTimelineEntryDto = {
    id: string;
    ts: string;
    kind: AgentTraceKindDto;
    model: string;
    toolsHash?: string;
    usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
};

/** 当前选中请求的组成。 */
export type AgentContextSelectedRequestDto = {
    traceId: string;
    ts: string;
    provider: string;
    model: string;
    segments: AgentTraceSegmentDto[];
    labelBreakdown: AgentContextLabelBreakdownDto[];
    usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
    /**
     * 缺省 = 逐条读落盘归因。
     * `legacy` = session 建于归因功能之前，分区由位置推断，HistorySet 与首轮提醒未分开。
     * `none` = 该记录早于本功能，完全没有分区数据。
     */
    attribution?: "legacy" | "none";
};

/** 面板需要的运行事实。 */
export type AgentContextFactsDto = {
    /** 模型上下文窗口；null = 未配置（此时百分比无法计算）。 */
    contextWindowTokens: number | null;
    /** 自动压缩触发线；null = 未启用或无法解析。 */
    compactionTriggerTokens: number | null;
    /** 显式缓存断点的保留期；null = 该 provider 走自动前缀缓存，断点不由我们控制。 */
    cacheRetention: {kind: "none" | "short" | "long"; seconds: number} | null;
};

export type AgentContextInspectionDto = {
    /** disabled = piTrace 已关闭；empty = 该 session 尚无 turn 记录。 */
    state: "ok" | "disabled" | "empty";
    /** 请求选择器数据源，只含 turn，按时间升序。 */
    requests: AgentContextRequestRefDto[];
    selected?: AgentContextSelectedRequestDto;
    timeline: AgentContextTimelineEntryDto[];
    facts: AgentContextFactsDto;
    diagnostics: AgentContextDiagnosticDto[];
};
