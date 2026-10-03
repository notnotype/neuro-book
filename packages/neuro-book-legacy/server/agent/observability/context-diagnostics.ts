/**
 * 上下文诊断引擎（Task 126）。
 *
 * 从「最近一次请求的分区」+「本 session 的请求时间轴」推出可解释的观察项。
 *
 * 语气契约（勿改）：诊断是**展示**，不是规训。每条只陈述事实与因果，不写「建议」「不应该」，
 * 也不评价用户的使用方式。绝大多数条目是 info；warning 留给「会实际影响下一步的状态」
 * （接近压缩线、缓存已过期、工具集变了）；danger 只给真正的配置错误。
 *
 * 输出是结构化的 `{code, severity, ...params}`，文案由前端按 i18n key 渲染——
 * 与仓库其余 UI 文案一致，且便于中英双语。
 *
 * 纯函数、无 IO、不读 config。
 */
import type {PiTraceSegment, PiTraceSegmentKind} from "nbook/server/agent/observability/pi-request-recorder";
import {aggregateSegmentLabels} from "nbook/server/agent/observability/trace-segments";

/** 时间轴上的一次请求；字段全部取自 index.jsonl，不需要读完整记录。 */
export type ContextTimelineEntry = {
    id: string;
    ts: string;
    kind: "turn" | "compaction" | "health-check";
    model: string;
    toolsHash?: string;
    usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
};

/** 缓存保留期。null 表示该 provider 不由我们控制断点（OpenAI 兼容的自动前缀缓存）。 */
export type CacheRetention = {kind: "none" | "short" | "long"; seconds: number} | null;

export type ContextDiagnosticsInput = {
    /** 最近一条 turn trace 的分区归因。 */
    segments: readonly PiTraceSegment[];
    /** 本 session 的请求时间轴，按 ts 升序。 */
    timeline: readonly ContextTimelineEntry[];
    provider: string;
    /** 模型上下文窗口；null 表示未配置。 */
    contextWindowTokens: number | null;
    /** 自动压缩的触发线（tokens）；null 表示未启用或无法解析。 */
    compactionTriggerTokens: number | null;
    cacheRetention: CacheRetention;
};

type Severity = "info" | "warning" | "danger";

/**
 * 全部诊断 code。
 *
 * 显式列成常量元组而不是只留 TS 联合：联合类型运行时不可枚举，而 i18n 完备性测试
 * 需要在运行时遍历它，确认每个 code 在 zh-CN / en-US 都配了文案。
 * 新增诊断时这里和判别联合都要加，漏了会被 typecheck 或该测试挡住。
 */
export const CONTEXT_DIAGNOSTIC_CODES = [
    "fixedOverhead",
    "dominantSource",
    "toolSchemaCost",
    "nearCompaction",
    "contextWindowUnset",
    "dynamicContextRewrite",
    "cacheRetention",
    "cacheAutoPrefix",
    "cacheNotReported",
    "cacheExpired",
    "cacheCompactionRebuild",
    "cacheToolsChanged",
    "cacheModelChanged",
] as const;

export type ContextDiagnosticCode = typeof CONTEXT_DIAGNOSTIC_CODES[number];

/**
 * 一条诊断。code 是稳定标识（前端 i18n key 与折叠记忆都挂它），其余字段是该 code 的参数。
 * 用判别联合而不是 `Record<string, unknown>`，保证前端渲染时参数类型可查。
 */
export type ContextDiagnostic =
    | {code: "fixedOverhead"; severity: Severity; tokens: number; percent: number}
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

/** 编译期防线：判别联合与常量元组必须覆盖同一组 code，任一侧漏加都会在这里报错。 */
type AssertCodesAligned = ContextDiagnostic["code"] extends ContextDiagnosticCode
    ? ContextDiagnosticCode extends ContextDiagnostic["code"] ? true : never
    : never;
const _codesAligned: AssertCodesAligned = true;
void _codesAligned;

/** 固定开销：每次请求都在、且不随对话增长的部分。 */
const FIXED_OVERHEAD_KINDS: readonly PiTraceSegmentKind[] = ["system", "tools", "historySet"];

/** 固定开销占比超过这个值时，对话可用空间已不足一半，值得标出来——但仍只陈述事实。 */
const FIXED_OVERHEAD_WARNING_PERCENT = 50;

/** 接近压缩线的提示阈值。 */
const NEAR_COMPACTION_PERCENT = 80;

export function buildContextDiagnostics(input: ContextDiagnosticsInput): ContextDiagnostic[] {
    return [
        ...compositionDiagnostics(input),
        ...cacheDiagnostics(input),
    ];
}

/** 组成类观察：固定开销、单一来源、工具开销、压缩线、窗口未配置。 */
function compositionDiagnostics(input: ContextDiagnosticsInput): ContextDiagnostic[] {
    const diagnostics: ContextDiagnostic[] = [];
    const totalTokens = sumTokens(input.segments);

    if (input.contextWindowTokens === null) {
        diagnostics.push({code: "contextWindowUnset", severity: "danger"});
    }

    const fixedTokens = sumTokens(input.segments.filter((segment) => FIXED_OVERHEAD_KINDS.includes(segment.kind)));
    if (fixedTokens > 0 && input.contextWindowTokens !== null) {
        const percent = fixedTokens / input.contextWindowTokens * 100;
        diagnostics.push({
            code: "fixedOverhead",
            severity: percent >= FIXED_OVERHEAD_WARNING_PERCENT ? "warning" : "info",
            tokens: fixedTokens,
            percent,
        });
    }

    // 单一来源突出：以整个请求为分母，回答「哪个文件最占地方」。
    const dominant = dominantLabel(input.segments);
    if (dominant && totalTokens > 0) {
        diagnostics.push({code: "dominantSource", severity: "info", label: dominant.label, percent: dominant.tokens / totalTokens * 100});
    }

    const toolTokens = sumTokens(input.segments.filter((segment) => segment.kind === "tools"));
    if (toolTokens > 0 && totalTokens > 0) {
        diagnostics.push({code: "toolSchemaCost", severity: "info", percent: toolTokens / totalTokens * 100});
    }

    if (input.compactionTriggerTokens !== null && input.compactionTriggerTokens > 0) {
        const percent = totalTokens / input.compactionTriggerTokens * 100;
        if (percent >= NEAR_COMPACTION_PERCENT) {
            diagnostics.push({
                code: "nearCompaction",
                severity: "warning",
                percent,
                estimatedTurnsLeft: estimateTurnsLeft(input.timeline, input.compactionTriggerTokens - totalTokens),
            });
        }
    }

    // 结构性事实：ModelContext + AppendingSet 每个新回合都要重写，用户改不了，只陈述。
    const dynamicTokens = sumTokens(input.segments.filter((segment) => segment.kind === "modelContext" || segment.kind === "appending"));
    if (dynamicTokens > 0) {
        diagnostics.push({code: "dynamicContextRewrite", severity: "info", tokens: dynamicTokens});
    }

    return diagnostics;
}

/** 缓存类观察：provider 能力、保留期、以及逐请求的断点原因。 */
function cacheDiagnostics(input: ContextDiagnosticsInput): ContextDiagnostic[] {
    const diagnostics: ContextDiagnostic[] = [];

    if (input.cacheRetention) {
        diagnostics.push({
            code: "cacheRetention",
            severity: "info",
            retention: input.cacheRetention.kind,
            seconds: input.cacheRetention.seconds,
        });
    } else {
        diagnostics.push({code: "cacheAutoPrefix", severity: "info", provider: input.provider});
    }

    const turns = input.timeline.filter((entry) => entry.kind === "turn");
    // 全程没有任何缓存读写数字，多半是 provider（或中间转发）不上报，而不是真的没缓存。
    const reported = turns.some((entry) => (entry.usage?.cacheRead ?? 0) > 0 || (entry.usage?.cacheWrite ?? 0) > 0);
    if (turns.length > 0 && !reported) {
        diagnostics.push({code: "cacheNotReported", severity: "info", provider: input.provider});
    }

    for (const [index, entry] of input.timeline.entries()) {
        if (entry.kind !== "turn" || index === 0) {
            continue;
        }
        const previousTurn = findPreviousTurn(input.timeline, index);
        if (!previousTurn) {
            continue;
        }

        if (input.cacheRetention && input.cacheRetention.kind !== "none") {
            const gapSeconds = (Date.parse(entry.ts) - Date.parse(previousTurn.ts)) / 1000;
            if (Number.isFinite(gapSeconds) && gapSeconds > input.cacheRetention.seconds) {
                diagnostics.push({
                    code: "cacheExpired",
                    severity: "warning",
                    traceId: entry.id,
                    gapSeconds,
                    retentionSeconds: input.cacheRetention.seconds,
                });
            }
        }
        // 压缩会重写历史，其后第一次请求必然从头建缓存。
        if (input.timeline.slice(index - 1, index).some((between) => between.kind === "compaction")) {
            diagnostics.push({code: "cacheCompactionRebuild", severity: "info", traceId: entry.id});
        }
        // 工具断点在 messages 之前，工具集一变，其后全部失效。
        if (entry.toolsHash !== undefined && previousTurn.toolsHash !== undefined && entry.toolsHash !== previousTurn.toolsHash) {
            diagnostics.push({code: "cacheToolsChanged", severity: "warning", traceId: entry.id});
        }
        if (entry.model !== previousTurn.model) {
            diagnostics.push({code: "cacheModelChanged", severity: "info", traceId: entry.id, from: previousTurn.model, to: entry.model});
        }
    }

    return diagnostics;
}

function sumTokens(segments: readonly PiTraceSegment[]): number {
    return segments.reduce((total, segment) => total + segment.estimatedTokens, 0);
}

/** 最大的单一来源。均摊规则由 `aggregateSegmentLabels` 统一持有，这里只取头名。 */
function dominantLabel(segments: readonly PiTraceSegment[]): {label: string; tokens: number} | null {
    const top = aggregateSegmentLabels(segments)[0];
    return top ? {label: top.label, tokens: top.estimatedTokens} : null;
}

/**
 * 按最近几轮的平均增量估算还剩几轮触发压缩。
 *
 * 增量取相邻两次 turn 的 prompt 总量之差；没有足够样本或增量非正时返回 null
 * （不硬编一个假数字，让前端显示「暂无法估算」）。
 */
function estimateTurnsLeft(timeline: readonly ContextTimelineEntry[], remainingTokens: number): number | null {
    const totals = timeline
        .filter((entry) => entry.kind === "turn" && entry.usage)
        .map((entry) => entry.usage!.input + entry.usage!.cacheRead + entry.usage!.cacheWrite);
    if (totals.length < 2 || remainingTokens <= 0) {
        return null;
    }
    const recent = totals.slice(-5);
    const growth = (recent.at(-1)! - recent[0]!) / (recent.length - 1);
    return growth > 0 ? Math.max(1, Math.floor(remainingTokens / growth)) : null;
}

/** 往前找最近一次 turn（跳过 compaction / health-check）。 */
function findPreviousTurn(timeline: readonly ContextTimelineEntry[], index: number): ContextTimelineEntry | null {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const entry = timeline[cursor];
        if (entry?.kind === "turn") {
            return entry;
        }
    }
    return null;
}
