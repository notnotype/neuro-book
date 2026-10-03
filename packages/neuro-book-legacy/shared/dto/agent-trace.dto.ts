/**
 * Pi 请求 trace 查看器 DTO。
 *
 * 字段镜像 `server/agent/observability/pi-request-recorder.ts` 的
 * `PiTraceRecord` / `PiTraceIndexEntry`（shared 不能 import server 模块，否则
 * node:fs 会进前端 bundle）；traces route handler 的返回值同时标注两侧类型，
 * 靠 typecheck 防两份定义漂移。
 */

/** trace 来源分类。turn = 主 ReAct 轮次；compaction = 压缩摘要；health-check 保留备用（当前无调用方）。 */
export type AgentTraceKindDto = "turn" | "compaction" | "health-check";

export type AgentTraceStatusDto = "ok" | "error" | "aborted";

/** 领域关联字段。除 kind 外都可选（compaction 可能缺 turnIndex，手动 /compact 缺 mode）。 */
export type AgentTraceCorrelationDto = {
    kind: AgentTraceKindDto;
    sessionId?: number;
    invocationId?: string;
    profileKey?: string;
    turnIndex?: number;
    mode?: string;
};

/** Prompt 分区种类。前五种对齐 Profile DSL 分区合同，system/tools 是 messages 之外的开销面。 */
export type AgentTraceSegmentKindDto =
    | "system"
    | "tools"
    | "historySet"
    | "conversation"
    | "modelContext"
    | "appending"
    | "currentInput";

/** 一个 prompt 分区。同一 kind 可出现多段，消费方按 kind 求和。 */
export type AgentTraceSegmentDto = {
    kind: AgentTraceSegmentKindDto;
    /** messages 下标区间 [start, end)；system / tools 为 null。 */
    range: {start: number; end: number} | null;
    /** 与区间内消息一一对应的来源名；无来源位置为 null，整段无来源时缺省。 */
    labels?: (readonly string[] | null)[];
    /** 纯估算（chars/4）。展示真实值时由前端按 provider usage 比例校准。 */
    estimatedTokens: number;
};

/** 请求侧。context = pi 规范化上下文（跨 provider 统一），payload = provider 原生请求体。 */
export type AgentTraceRequestDto = {
    provider: string;
    api: string;
    model: string;
    baseUrl?: string;
    reasoning?: string;
    /** pi 规范化 {systemPrompt, messages, tools}；内容是任意 JSON，前端只透传给渲染层。 */
    context?: unknown;
    /** 上下文分区归因；无 profile prepare 的调用（compaction / health-check）缺省。 */
    segments?: AgentTraceSegmentDto[];
    /** 归因来源。缺省等同 full；legacy 表示分区由位置推断，HistorySet 与首轮提醒未分开。 */
    attribution?: "full" | "legacy";
    /** 工具集指纹，用于跨请求检测工具变化导致的缓存断点前移。 */
    toolsHash?: string;
    /** provider 原生请求体；capturePayload 关闭或 faux provider 时缺省。任意 JSON，透传 JsonViewer。 */
    payload?: unknown;
    /** 原生 payload 因附件安全边界被省略时为 attachment。 */
    payloadOmittedReason?: "attachment";
};

/** 响应侧健康度。失败请求 httpStatus/headers 可能缺（provider 错误路径跳过 onResponse）。 */
export type AgentTraceResponseDto = {
    httpStatus?: number;
    headers?: Record<string, string>;
    stopReason?: string;
    usage?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        /** 仅当 Provider 提供 1h cache write 拆分时存在。 */
        cacheWrite1h?: number;
        /** 仅当 Provider 提供 reasoning token 拆分时存在。 */
        reasoning?: number;
        totalTokens: number;
    };
    errorMessage?: string;
};

/** 时序。ttftMs 仅主 turn 有效；compaction 只 await result() 不迭代流，无 TTFT。 */
export type AgentTraceTimingDto = {
    startedAt: string;
    ttftMs?: number;
    durationMs?: number;
};

/** 单条完整 trace 记录（详情接口返回）。 */
export type AgentTraceRecordDto = {
    id: string;
    ts: string;
    status: AgentTraceStatusDto;
    correlation: AgentTraceCorrelationDto;
    request: AgentTraceRequestDto;
    response: AgentTraceResponseDto;
    timing: AgentTraceTimingDto;
};

/** index.jsonl 汇总行（列表接口返回，不含 payload）。 */
export type AgentTraceIndexEntryDto = {
    id: string;
    ts: string;
    status: AgentTraceStatusDto;
    kind: AgentTraceKindDto;
    invocationId?: string;
    turnIndex?: number;
    provider: string;
    model: string;
    stopReason?: string;
    totalTokens?: number;
    /** 缓存拆分。缓存时间轴只读 index，不为这四个数去读完整记录。provider 无 usage 时缺省。 */
    usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
    /** 工具集指纹，跨请求比对即可发现工具变化导致的缓存失效。 */
    toolsHash?: string;
    ttftMs?: number;
    durationMs?: number;
    bytes: number;
};

/** bucket 汇总（sessionId 或 _system）。 */
export type AgentTraceBucketDto = {
    bucket: string;
    count: number;
    lastTs?: string;
};

export type AgentTraceBucketListDto = {
    buckets: AgentTraceBucketDto[];
};

export type AgentTraceIndexListDto = {
    entries: AgentTraceIndexEntryDto[];
};

/** 「最近请求」聚合条目：index 行 + 来源 bucket（目录名，不落盘）。 */
export type AgentTraceRecentEntryDto = AgentTraceIndexEntryDto & {bucket: string};

export type AgentTraceRecentListDto = {
    entries: AgentTraceRecentEntryDto[];
};

/** 清空 bucket 的结果（DELETE /api/agent/traces/[bucket]）。 */
export type AgentTraceClearResultDto = {
    ok: boolean;
};
