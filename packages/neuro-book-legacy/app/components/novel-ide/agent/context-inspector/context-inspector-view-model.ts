/**
 * 上下文检查面板的纯视图模型（Task 126 批次 D）。
 *
 * 只依赖 DTO 类型，不碰 store / API / i18n——与 trace-viewer 的 view-model 同样定位为
 * 「可分离核心」，组件保持纯展示。
 *
 * 边界：**均摊规则不在这里**。分区内按条数、按来源数的均摊由 server 的
 * `aggregateSegmentLabels` 统一持有并随 `labelBreakdown` 下发，前端再实现一遍必然漂移。
 */
import type {
    AgentContextDiagnosticDto,
    AgentContextTimelineEntryDto,
} from "nbook/shared/dto/agent-context-inspection.dto";
import type {AgentTraceSegmentDto, AgentTraceSegmentKindDto} from "nbook/shared/dto/agent-trace.dto";

/** 分区表的一行。同一 kind 的多个 segment 已合并。 */
export type CompositionRow = {
    kind: AgentTraceSegmentKindDto;
    /** 该分区的消息条数；system / tools 不在 messages 里，为 null。 */
    messageCount: number | null;
    estimatedTokens: number;
    /**
     * 按 provider 真实用量分摊后的 token；无法校准时为 null（UI 只显示估算并标注）。
     */
    calibratedTokens: number | null;
    /** 占本次请求的比例（0-100），以校准值优先、缺失时用估算值。 */
    percent: number;
};

/** 分区展示顺序：按它们在 prompt 里的实际位置排，让表格读起来就是上下文的样子。 */
const KIND_ORDER: readonly AgentTraceSegmentKindDto[] = [
    "system",
    "tools",
    "historySet",
    "conversation",
    "modelContext",
    "appending",
    "currentInput",
];

/**
 * 把分区按 kind 合并成表格行。
 *
 * 同一 kind 出现多段是正常的——历史里沉淀的旧 AppendingSet 提醒和本轮提醒之间隔着对话，
 * 会被切成不连续的区间，这里按 kind 求和还原成一行。
 */
export function aggregateByKind(segments: readonly AgentTraceSegmentDto[]): CompositionRow[] {
    const byKind = new Map<AgentTraceSegmentKindDto, {estimatedTokens: number; messageCount: number | null}>();
    for (const segment of segments) {
        const existing = byKind.get(segment.kind);
        const count = segment.range ? segment.range.end - segment.range.start : null;
        if (!existing) {
            byKind.set(segment.kind, {estimatedTokens: segment.estimatedTokens, messageCount: count});
            continue;
        }
        existing.estimatedTokens += segment.estimatedTokens;
        if (count !== null) {
            existing.messageCount = (existing.messageCount ?? 0) + count;
        }
    }
    return KIND_ORDER
        .filter((kind) => byKind.has(kind))
        .map((kind) => {
            const value = byKind.get(kind)!;
            return {kind, messageCount: value.messageCount, estimatedTokens: value.estimatedTokens, calibratedTokens: null, percent: 0};
        });
}

/**
 * 用 provider 上报的真实 prompt 总量校准各分区。
 *
 * 逐分区的真实 token 无从得知（provider 只给总量），因此按估算值比例分摊——
 * 构造上保证校准值之和等于 `promptTokens`。`promptTokens` 缺失（provider 未上报 usage）
 * 或估算总量为 0 时不编数字，返回 null 校准值，由 UI 标注「仅估算」。
 */
export function calibrate(rows: readonly CompositionRow[], promptTokens: number | null): CompositionRow[] {
    const estimatedTotal = rows.reduce((total, row) => total + row.estimatedTokens, 0);
    if (estimatedTotal <= 0) {
        return rows.map((row) => ({...row, calibratedTokens: null, percent: 0}));
    }
    if (promptTokens === null || promptTokens <= 0) {
        return rows.map((row) => ({...row, calibratedTokens: null, percent: row.estimatedTokens / estimatedTotal * 100}));
    }
    return rows.map((row) => ({
        ...row,
        calibratedTokens: row.estimatedTokens / estimatedTotal * promptTokens,
        percent: row.estimatedTokens / estimatedTotal * 100,
    }));
}

/** 一次请求在缓存柱状图里的三段构成。 */
export type CacheBar =
    | {state: "unreported"}
    | {
        state: "measured";
        /** 三段占比之和为 100。 */
        cacheReadPercent: number;
        cacheWritePercent: number;
        freshInputPercent: number;
        /** 命中率（0-100），与 `app/utils/prompt-cache.ts` 同口径。 */
        hitRate: number;
        promptTokens: number;
    };

/**
 * 单次请求拆成 cacheRead / cacheWrite / 未缓存 input 三段。
 *
 * 三者皆 0 视为「provider 未上报」而不是 0% 命中——这两件事在诊断上完全不同，
 * 混在一起会让用户以为缓存彻底失效。
 */
export function cacheBar(entry: AgentContextTimelineEntryDto): CacheBar {
    const usage = entry.usage;
    if (!usage) {
        return {state: "unreported"};
    }
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
    if (promptTokens <= 0) {
        return {state: "unreported"};
    }
    return {
        state: "measured",
        cacheReadPercent: usage.cacheRead / promptTokens * 100,
        cacheWritePercent: usage.cacheWrite / promptTokens * 100,
        freshInputPercent: usage.input / promptTokens * 100,
        hitRate: usage.cacheRead / promptTokens * 100,
        promptTokens,
    };
}

/** 属于「组成」Tab 的诊断 code；其余归「缓存」Tab。 */
const COMPOSITION_CODES = new Set<AgentContextDiagnosticDto["code"]>([
    "fixedOverhead",
    "dominantSource",
    "toolSchemaCost",
    "nearCompaction",
    "contextWindowUnset",
    "dynamicContextRewrite",
]);

/**
 * 诊断按去处分三组。
 *
 * `composition` 与 `cachePanel` 分挂两个 Tab——把全部诊断塞进两边会让用户在缓存页
 * 看到一堆与缓存无关的观察，反而找不到重点。`byTraceId` 挂到时间轴对应的柱下。
 */
export type GroupedDiagnostics = {
    composition: AgentContextDiagnosticDto[];
    cachePanel: AgentContextDiagnosticDto[];
    byTraceId: Map<string, AgentContextDiagnosticDto[]>;
};

export function groupDiagnostics(diagnostics: readonly AgentContextDiagnosticDto[]): GroupedDiagnostics {
    const composition: AgentContextDiagnosticDto[] = [];
    const cachePanel: AgentContextDiagnosticDto[] = [];
    const byTraceId = new Map<string, AgentContextDiagnosticDto[]>();
    for (const diagnostic of diagnostics) {
        if ("traceId" in diagnostic) {
            const existing = byTraceId.get(diagnostic.traceId);
            if (existing) {
                existing.push(diagnostic);
            } else {
                byTraceId.set(diagnostic.traceId, [diagnostic]);
            }
            continue;
        }
        (COMPOSITION_CODES.has(diagnostic.code) ? composition : cachePanel).push(diagnostic);
    }
    return {composition, cachePanel, byTraceId};
}

/** severity → 主题状态变量。禁止在组件里另写一套色。 */
export function diagnosticDotClass(severity: AgentContextDiagnosticDto["severity"]): string {
    if (severity === "danger") {
        return "bg-[var(--status-danger)]";
    }
    return severity === "warning" ? "bg-[var(--status-warning)]" : "bg-[var(--status-info)]";
}
