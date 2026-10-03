import {describe, expect, it} from "vitest";
import {
    buildContextDiagnostics,
    type ContextDiagnostic,
    type ContextDiagnosticsInput,
    type ContextTimelineEntry,
} from "nbook/server/agent/observability/context-diagnostics";
import type {PiTraceSegment} from "nbook/server/agent/observability/pi-request-recorder";

function segment(partial: Partial<PiTraceSegment> & Pick<PiTraceSegment, "kind" | "estimatedTokens">): PiTraceSegment {
    return {range: null, ...partial};
}

function turn(partial: Partial<ContextTimelineEntry> & Pick<ContextTimelineEntry, "id" | "ts">): ContextTimelineEntry {
    return {kind: "turn", model: "m1", usage: {input: 10, output: 5, cacheRead: 0, cacheWrite: 0}, ...partial};
}

function input(overrides: Partial<ContextDiagnosticsInput> = {}): ContextDiagnosticsInput {
    return {
        segments: [],
        timeline: [],
        provider: "anthropic",
        contextWindowTokens: 200_000,
        compactionTriggerTokens: null,
        cacheRetention: {kind: "short", seconds: 300},
        ...overrides,
    };
}

function codes(diagnostics: ContextDiagnostic[]): string[] {
    return diagnostics.map((diagnostic) => diagnostic.code);
}

function find<T extends ContextDiagnostic["code"]>(diagnostics: ContextDiagnostic[], code: T): Extract<ContextDiagnostic, {code: T}> | undefined {
    return diagnostics.find((diagnostic) => diagnostic.code === code) as Extract<ContextDiagnostic, {code: T}> | undefined;
}

describe("组成类诊断", () => {
    it("固定开销 = System + Tools + HistorySet，超过一半窗口时升到 warning", () => {
        const diagnostics = buildContextDiagnostics(input({
            contextWindowTokens: 100,
            segments: [
                segment({kind: "system", estimatedTokens: 10}),
                segment({kind: "tools", estimatedTokens: 20}),
                segment({kind: "historySet", estimatedTokens: 25, range: {start: 0, end: 1}}),
                segment({kind: "conversation", estimatedTokens: 5, range: {start: 1, end: 2}}),
            ],
        }));

        const fixed = find(diagnostics, "fixedOverhead");
        expect(fixed).toMatchObject({tokens: 55, severity: "warning"});
        expect(fixed?.percent).toBeCloseTo(55);
    });

    it("固定开销未过半时保持 info —— 诊断是展示不是规训", () => {
        const diagnostics = buildContextDiagnostics(input({
            contextWindowTokens: 100,
            segments: [segment({kind: "system", estimatedTokens: 20}), segment({kind: "conversation", estimatedTokens: 80, range: {start: 0, end: 1}})],
        }));
        expect(find(diagnostics, "fixedOverhead")?.severity).toBe("info");
    });

    it("窗口未配置是真正的配置问题，用 danger", () => {
        expect(codes(buildContextDiagnostics(input({contextWindowTokens: null})))).toContain("contextWindowUnset");
    });

    it("找出占比最大的单一来源，并按条数均摊分区 token", () => {
        const diagnostics = buildContextDiagnostics(input({
            segments: [
                segment({
                    kind: "historySet",
                    estimatedTokens: 300,
                    range: {start: 0, end: 3},
                    labels: [["Import:big.md"], ["SkillCatalog"], ["Import:small.md"]],
                }),
            ],
        }));
        // 三条各摊 100，三者并列时取先出现的；关键是不重复计数、不超总量。
        expect(find(diagnostics, "dominantSource")?.percent).toBeCloseTo(100 / 300 * 100);
    });

    it("一条消息带多个来源时按来源数再均分，避免重复计数", () => {
        const diagnostics = buildContextDiagnostics(input({
            segments: [segment({kind: "historySet", estimatedTokens: 100, range: {start: 0, end: 1}, labels: [["A", "B"]]})],
        }));
        expect(find(diagnostics, "dominantSource")?.percent).toBeCloseTo(50);
    });

    it("接近压缩线时给 warning，并按最近几轮增量估算剩余轮次", () => {
        const diagnostics = buildContextDiagnostics(input({
            compactionTriggerTokens: 1000,
            segments: [segment({kind: "conversation", estimatedTokens: 900, range: {start: 0, end: 1}})],
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z", usage: {input: 100, output: 0, cacheRead: 0, cacheWrite: 0}}),
                turn({id: "2", ts: "2026-07-27T00:01:00Z", usage: {input: 150, output: 0, cacheRead: 0, cacheWrite: 0}}),
                turn({id: "3", ts: "2026-07-27T00:02:00Z", usage: {input: 200, output: 0, cacheRead: 0, cacheWrite: 0}}),
            ],
        }));
        // 剩 100 token，每轮涨 50 → 约 2 轮。
        expect(find(diagnostics, "nearCompaction")).toMatchObject({severity: "warning", estimatedTurnsLeft: 2});
    });

    it("样本不足时不硬编估算值，返回 null", () => {
        const diagnostics = buildContextDiagnostics(input({
            compactionTriggerTokens: 1000,
            segments: [segment({kind: "conversation", estimatedTokens: 900, range: {start: 0, end: 1}})],
            timeline: [turn({id: "1", ts: "2026-07-27T00:00:00Z"})],
        }));
        expect(find(diagnostics, "nearCompaction")?.estimatedTurnsLeft).toBeNull();
    });

    it("未接近压缩线时不产出该条目", () => {
        const diagnostics = buildContextDiagnostics(input({
            compactionTriggerTokens: 1000,
            segments: [segment({kind: "conversation", estimatedTokens: 100, range: {start: 0, end: 1}})],
        }));
        expect(codes(diagnostics)).not.toContain("nearCompaction");
    });

    it("动态上下文重写量是结构性事实，恒以 info 陈述", () => {
        const diagnostics = buildContextDiagnostics(input({
            segments: [
                segment({kind: "modelContext", estimatedTokens: 40, range: {start: 0, end: 1}}),
                segment({kind: "appending", estimatedTokens: 60, range: {start: 1, end: 2}}),
            ],
        }));
        expect(find(diagnostics, "dynamicContextRewrite")).toMatchObject({severity: "info", tokens: 100});
    });
});

describe("缓存类诊断", () => {
    it("显式断点 provider 陈述保留期", () => {
        const diagnostics = buildContextDiagnostics(input({cacheRetention: {kind: "short", seconds: 300}}));
        expect(find(diagnostics, "cacheRetention")).toMatchObject({retention: "short", seconds: 300});
    });

    it("自动前缀缓存 provider 标注能力差异，而不是当成没有缓存", () => {
        const diagnostics = buildContextDiagnostics(input({cacheRetention: null, provider: "xiaomi"}));
        expect(codes(diagnostics)).toContain("cacheAutoPrefix");
        expect(codes(diagnostics)).not.toContain("cacheRetention");
    });

    it("全程零缓存数字时标注「provider 未上报」而不是判定没命中", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [turn({id: "1", ts: "2026-07-27T00:00:00Z"}), turn({id: "2", ts: "2026-07-27T00:00:30Z"})],
        }));
        expect(codes(diagnostics)).toContain("cacheNotReported");
    });

    it("有缓存读写数字时不产出「未上报」", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [turn({id: "1", ts: "2026-07-27T00:00:00Z", usage: {input: 1, output: 1, cacheRead: 100, cacheWrite: 0}})],
        }));
        expect(codes(diagnostics)).not.toContain("cacheNotReported");
    });

    it("请求间隔超过保留期时逐条标出已过期", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z"}),
                turn({id: "2", ts: "2026-07-27T00:12:00Z"}),
            ],
        }));
        expect(find(diagnostics, "cacheExpired")).toMatchObject({traceId: "2", gapSeconds: 720, retentionSeconds: 300});
    });

    it("间隔在保留期内不报过期", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [turn({id: "1", ts: "2026-07-27T00:00:00Z"}), turn({id: "2", ts: "2026-07-27T00:02:00Z"})],
        }));
        expect(codes(diagnostics)).not.toContain("cacheExpired");
    });

    it("压缩之后的第一次请求标注缓存重建", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z"}),
                {id: "2", ts: "2026-07-27T00:00:10Z", kind: "compaction", model: "m1"},
                turn({id: "3", ts: "2026-07-27T00:00:20Z"}),
            ],
        }));
        expect(find(diagnostics, "cacheCompactionRebuild")?.traceId).toBe("3");
    });

    it("工具集指纹变化时标出断点前移", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z", toolsHash: "aaaaaaaa"}),
                turn({id: "2", ts: "2026-07-27T00:00:10Z", toolsHash: "bbbbbbbb"}),
            ],
        }));
        expect(find(diagnostics, "cacheToolsChanged")).toMatchObject({traceId: "2", severity: "warning"});
    });

    it("缺少工具指纹（旧记录）时不误报工具变化", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z"}),
                turn({id: "2", ts: "2026-07-27T00:00:10Z", toolsHash: "bbbbbbbb"}),
            ],
        }));
        expect(codes(diagnostics)).not.toContain("cacheToolsChanged");
    });

    it("换模型时记录前后模型名", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z", model: "m1"}),
                turn({id: "2", ts: "2026-07-27T00:00:10Z", model: "m2"}),
            ],
        }));
        expect(find(diagnostics, "cacheModelChanged")).toMatchObject({from: "m1", to: "m2", traceId: "2"});
    });

    it("跳过 compaction / health-check 找上一次 turn，避免把它们当成对比基准", () => {
        const diagnostics = buildContextDiagnostics(input({
            timeline: [
                turn({id: "1", ts: "2026-07-27T00:00:00Z", model: "m1"}),
                {id: "2", ts: "2026-07-27T00:00:05Z", kind: "health-check", model: "other"},
                turn({id: "3", ts: "2026-07-27T00:00:10Z", model: "m1"}),
            ],
        }));
        expect(codes(diagnostics)).not.toContain("cacheModelChanged");
    });
});
