import {describe, expect, it} from "vitest";
import {
    aggregateByKind,
    cacheBar,
    calibrate,
    groupDiagnostics,
} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import type {AgentContextDiagnosticDto, AgentContextTimelineEntryDto} from "nbook/shared/dto/agent-context-inspection.dto";
import type {AgentTraceSegmentDto} from "nbook/shared/dto/agent-trace.dto";

function segment(partial: Pick<AgentTraceSegmentDto, "kind" | "estimatedTokens"> & Partial<AgentTraceSegmentDto>): AgentTraceSegmentDto {
    return {range: null, ...partial};
}

function timelineEntry(usage?: AgentContextTimelineEntryDto["usage"]): AgentContextTimelineEntryDto {
    return {id: "1", ts: "2026-07-27T00:00:00Z", kind: "turn", model: "m1", ...(usage ? {usage} : {})};
}

describe("aggregateByKind", () => {
    it("同一 kind 的多段合并成一行，条数累加", () => {
        const rows = aggregateByKind([
            segment({kind: "appending", estimatedTokens: 40, range: {start: 0, end: 1}}),
            segment({kind: "conversation", estimatedTokens: 10, range: {start: 1, end: 3}}),
            segment({kind: "appending", estimatedTokens: 60, range: {start: 3, end: 5}}),
        ]);

        expect(rows).toEqual([
            {kind: "conversation", messageCount: 2, estimatedTokens: 10, calibratedTokens: null, percent: 0},
            {kind: "appending", messageCount: 3, estimatedTokens: 100, calibratedTokens: null, percent: 0},
        ]);
    });

    it("按 prompt 中的实际位置排序，让表格读起来就是上下文的样子", () => {
        const rows = aggregateByKind([
            segment({kind: "currentInput", estimatedTokens: 1, range: {start: 3, end: 4}}),
            segment({kind: "tools", estimatedTokens: 2}),
            segment({kind: "system", estimatedTokens: 3}),
            segment({kind: "historySet", estimatedTokens: 4, range: {start: 0, end: 1}}),
        ]);
        expect(rows.map((row) => row.kind)).toEqual(["system", "tools", "historySet", "currentInput"]);
    });

    it("system / tools 不在 messages 里，条数为 null", () => {
        const rows = aggregateByKind([segment({kind: "system", estimatedTokens: 3})]);
        expect(rows[0]?.messageCount).toBeNull();
    });
});

describe("calibrate", () => {
    it("校准值之和等于 provider 上报的真实 prompt 总量", () => {
        const rows = calibrate(
            aggregateByKind([
                segment({kind: "system", estimatedTokens: 100}),
                segment({kind: "conversation", estimatedTokens: 300, range: {start: 0, end: 1}}),
            ]),
            2000,
        );

        expect(rows.map((row) => row.calibratedTokens)).toEqual([500, 1500]);
        expect(rows.reduce((sum, row) => sum + (row.calibratedTokens ?? 0), 0)).toBe(2000);
    });

    it("provider 未上报 usage 时不编数字，只给估算占比", () => {
        const rows = calibrate(
            aggregateByKind([
                segment({kind: "system", estimatedTokens: 100}),
                segment({kind: "conversation", estimatedTokens: 300, range: {start: 0, end: 1}}),
            ]),
            null,
        );

        expect(rows.every((row) => row.calibratedTokens === null)).toBe(true);
        expect(rows.map((row) => row.percent)).toEqual([25, 75]);
    });

    it("估算总量为 0 时不产生 NaN 占比", () => {
        const rows = calibrate([{kind: "system", messageCount: null, estimatedTokens: 0, calibratedTokens: null, percent: 0}], 1000);
        expect(rows[0]).toMatchObject({calibratedTokens: null, percent: 0});
    });
});

describe("cacheBar", () => {
    it("拆成三段且占比之和为 100", () => {
        const bar = cacheBar(timelineEntry({input: 100, output: 50, cacheRead: 800, cacheWrite: 100}));
        expect(bar.state).toBe("measured");
        if (bar.state !== "measured") {
            return;
        }
        expect(bar.cacheReadPercent + bar.cacheWritePercent + bar.freshInputPercent).toBeCloseTo(100);
        expect(bar.promptTokens).toBe(1000);
        // 命中率分母含 cacheWrite，与 app/utils/prompt-cache.ts 同口径。
        expect(bar.hitRate).toBe(80);
    });

    it("完全没有 usage 视为未上报", () => {
        expect(cacheBar(timelineEntry()).state).toBe("unreported");
    });

    it("usage 三项全为 0 视为未上报，而不是 0% 命中", () => {
        expect(cacheBar(timelineEntry({input: 0, output: 10, cacheRead: 0, cacheWrite: 0})).state).toBe("unreported");
    });
});

describe("groupDiagnostics", () => {
    it("带 traceId 的挂到对应请求，其余按 Tab 归属拆开", () => {
        const diagnostics: AgentContextDiagnosticDto[] = [
            {code: "fixedOverhead", severity: "info", tokens: 100, percent: 10},
            {code: "cacheRetention", severity: "info", retention: "short", seconds: 300},
            {code: "cacheExpired", severity: "warning", traceId: "7", gapSeconds: 720, retentionSeconds: 300},
            {code: "cacheCompactionRebuild", severity: "info", traceId: "7"},
            {code: "cacheModelChanged", severity: "info", traceId: "9", from: "a", to: "b"},
        ];

        const grouped = groupDiagnostics(diagnostics);
        expect(grouped.composition.map((item) => item.code)).toEqual(["fixedOverhead"]);
        // 缓存 Tab 不该混进与缓存无关的观察，否则重点被淹没。
        expect(grouped.cachePanel.map((item) => item.code)).toEqual(["cacheRetention"]);
        expect(grouped.byTraceId.get("7")?.map((item) => item.code)).toEqual(["cacheExpired", "cacheCompactionRebuild"]);
        expect(grouped.byTraceId.get("9")).toHaveLength(1);
    });

    it("空输入不产生空组", () => {
        const grouped = groupDiagnostics([]);
        expect(grouped.composition).toEqual([]);
        expect(grouped.cachePanel).toEqual([]);
        expect(grouped.byTraceId.size).toBe(0);
    });
});
