import {describe, expect, it} from "vitest";
import {aggregateSegmentLabels, buildTraceSegments, computeToolsHash, type PromptPrefixAttribution} from "nbook/server/agent/observability/trace-segments";
import type {StoredMessageLike} from "nbook/server/agent/messages/stored-message-presentation";

function userMessage(text: string): StoredMessageLike {
    return {role: "user", content: [{type: "text", text}]} as StoredMessageLike;
}

function assistantMessage(text: string): StoredMessageLike {
    return {role: "assistant", content: [{type: "text", text}], stopReason: "stop"} as StoredMessageLike;
}

describe("buildTraceSegments", () => {
    it("无前缀归因时全部消息落入 conversation，并单独计 system / tools", () => {
        const segments = buildTraceSegments({
            systemPrompt: "x".repeat(400),
            tools: [{name: "read"}],
            messages: [userMessage("hello"), assistantMessage("hi")],
        });

        expect(segments.map((segment) => segment.kind)).toEqual(["system", "tools", "conversation"]);
        expect(segments[0]).toMatchObject({range: null, estimatedTokens: 100});
        expect(segments[1]?.range).toBeNull();
        expect(segments[2]?.range).toEqual({start: 0, end: 2});
    });

    it("systemPrompt 与 tools 为空时整段省略", () => {
        const segments = buildTraceSegments({systemPrompt: "", tools: [], messages: [userMessage("hi")]});
        expect(segments.map((segment) => segment.kind)).toEqual(["conversation"]);
    });

    it("按前缀归因切分，并把同一 kind 的连续消息压成一段", () => {
        const prefix: PromptPrefixAttribution = {
            kinds: ["historySet", "historySet", "conversation", "modelContext", "appending", "currentInput"],
            labels: [["Import:AGENTS.md"], ["SkillCatalog"], null, null, ["Reminder:agent-mode"], null],
            mode: "full",
        };
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: prefix.kinds.map((kind, index) => userMessage(`${kind}-${String(index)}`)),
            prefix,
        });

        expect(segments.map((segment) => [segment.kind, segment.range])).toEqual([
            ["historySet", {start: 0, end: 2}],
            ["conversation", {start: 2, end: 3}],
            ["modelContext", {start: 3, end: 4}],
            ["appending", {start: 4, end: 5}],
            ["currentInput", {start: 5, end: 6}],
        ]);
        expect(segments[0]?.labels).toEqual([["Import:AGENTS.md"], ["SkillCatalog"]]);
        // 整段无来源时不产出 labels 字段，避免 trace 里堆 null 数组。
        expect(segments[1]?.labels).toBeUndefined();
        expect(segments[3]?.labels).toEqual([["Reminder:agent-mode"]]);
    });

    it("超出前缀长度的消息（本 invocation 后续 turn 追加）落入 conversation", () => {
        const prefix: PromptPrefixAttribution = {kinds: ["historySet"], labels: [["Import:AGENTS.md"]], mode: "full"};
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: [userMessage("hist"), assistantMessage("turn1"), userMessage("tool result")],
            prefix,
        });

        expect(segments.map((segment) => [segment.kind, segment.range])).toEqual([
            ["historySet", {start: 0, end: 1}],
            ["conversation", {start: 1, end: 3}],
        ]);
    });

    it("同一 kind 被打断后产生多段，消费方按 kind 求和", () => {
        const prefix: PromptPrefixAttribution = {
            kinds: ["appending", "conversation", "appending"],
            labels: [["Reminder:a"], null, ["Reminder:b"]],
            mode: "full",
        };
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: prefix.kinds.map((kind) => userMessage(kind)),
            prefix,
        });

        expect(segments.map((segment) => segment.kind)).toEqual(["appending", "conversation", "appending"]);
    });

    it("估算 token 按 chars/4，与 compaction 口径一致", () => {
        const segments = buildTraceSegments({
            systemPrompt: "",
            tools: [],
            messages: [userMessage("a".repeat(40))],
        });
        expect(segments[0]?.estimatedTokens).toBe(10);
    });
});

describe("aggregateSegmentLabels", () => {
    it("分区内按消息条数均摊，总和不超过分区总量", () => {
        const aggregates = aggregateSegmentLabels([
            {
                kind: "historySet",
                estimatedTokens: 300,
                range: {start: 0, end: 3},
                labels: [["Import:big.md"], ["SkillCatalog"], ["Import:small.md"]],
            },
        ]);

        expect(aggregates).toHaveLength(3);
        expect(aggregates.every((item) => item.estimatedTokens === 100)).toBe(true);
        expect(aggregates.reduce((sum, item) => sum + item.estimatedTokens, 0)).toBe(300);
    });

    it("一条消息带多个来源时再按来源数均分，不重复计数", () => {
        const aggregates = aggregateSegmentLabels([
            {kind: "historySet", estimatedTokens: 100, range: {start: 0, end: 1}, labels: [["A", "B"]]},
        ]);
        expect(aggregates).toEqual([
            {kind: "historySet", label: "A", estimatedTokens: 50},
            {kind: "historySet", label: "B", estimatedTokens: 50},
        ]);
    });

    it("同一 kind 的多个分区（历史旧提醒 + 本轮提醒）按 kind+label 合并", () => {
        const aggregates = aggregateSegmentLabels([
            {kind: "appending", estimatedTokens: 40, range: {start: 0, end: 1}, labels: [["Reminder:mode"]]},
            {kind: "conversation", estimatedTokens: 10, range: {start: 1, end: 2}},
            {kind: "appending", estimatedTokens: 60, range: {start: 2, end: 3}, labels: [["Reminder:mode"]]},
        ]);
        expect(aggregates).toEqual([{kind: "appending", label: "Reminder:mode", estimatedTokens: 100}]);
    });

    it("按 token 降序，头名即诊断里的「最大单一来源」", () => {
        const aggregates = aggregateSegmentLabels([
            {kind: "historySet", estimatedTokens: 300, range: {start: 0, end: 2}, labels: [["small"], ["small"]]},
            {kind: "historySet", estimatedTokens: 500, range: {start: 2, end: 3}, labels: [["big"]]},
        ]);
        expect(aggregates[0]).toMatchObject({label: "big", estimatedTokens: 500});
    });

    it("无 labels 或无 range 的分区不参与聚合", () => {
        expect(aggregateSegmentLabels([
            {kind: "system", estimatedTokens: 100, range: null},
            {kind: "conversation", estimatedTokens: 100, range: {start: 0, end: 1}},
        ])).toEqual([]);
    });
});

describe("computeToolsHash", () => {
    it("工具集相同则指纹相同，schema 变化则指纹变化", () => {
        const a = computeToolsHash([{name: "read", parameters: {type: "object"}}]);
        const b = computeToolsHash([{name: "read", parameters: {type: "object"}}]);
        const c = computeToolsHash([{name: "read", parameters: {type: "string"}}]);

        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).toHaveLength(8);
    });

    it("工具数量变化会改变指纹（模式切换裁剪工具集的场景）", () => {
        expect(computeToolsHash([{name: "read"}])).not.toBe(computeToolsHash([{name: "read"}, {name: "write"}]));
    });

    it("无工具时不产生指纹", () => {
        expect(computeToolsHash([])).toBeUndefined();
    });
});
