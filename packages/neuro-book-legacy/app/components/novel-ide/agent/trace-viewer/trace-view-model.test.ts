import {describe, expect, it} from "vitest";
import type {AgentTraceIndexEntryDto} from "nbook/shared/dto/agent-trace.dto";
import {groupTraceEntries, normalizeTraceContext, traceEntryKey} from "nbook/app/components/novel-ide/agent/trace-viewer/trace-view-model";

/** 造一条最小合法 index 行，允许覆盖。 */
function entry(overrides: Partial<AgentTraceIndexEntryDto> = {}): AgentTraceIndexEntryDto {
    return {
        id: "1",
        ts: "2026-07-05T00:00:00.000Z",
        status: "ok",
        kind: "turn",
        provider: "faux",
        model: "faux-model",
        bytes: 100,
        ...overrides,
    };
}

describe("groupTraceEntries", () => {
    it("连续同 invocationId 折成一组", () => {
        const groups = groupTraceEntries([
            entry({id: "3", invocationId: "a"}),
            entry({id: "2", invocationId: "a"}),
            entry({id: "1", invocationId: "b"}),
        ]);
        expect(groups.map((g) => [g.invocationId, g.entries.length])).toEqual([["a", 2], ["b", 1]]);
    });

    it("同 invocationId 被其它组隔断后不跨组合并", () => {
        const groups = groupTraceEntries([
            entry({id: "4", invocationId: "a"}),
            entry({id: "3", invocationId: "b"}),
            entry({id: "2", invocationId: "a"}),
        ]);
        expect(groups.map((g) => g.invocationId)).toEqual(["a", "b", "a"]);
    });

    it("无 invocationId 的条目各自成组（含与有 id 条目交错）", () => {
        const groups = groupTraceEntries([
            entry({id: "3"}),
            entry({id: "2"}),
            entry({id: "1", invocationId: "a"}),
        ]);
        expect(groups.map((g) => [g.invocationId, g.entries.length])).toEqual([[undefined, 1], [undefined, 1], ["a", 1]]);
    });
});

describe("traceEntryKey", () => {
    it("recent 聚合条目带 bucket 前缀，per-bucket 条目裸 id——跨 bucket 同号不撞键", () => {
        expect(traceEntryKey({id: "3", bucket: "1"})).toBe("1/3");
        expect(traceEntryKey({id: "3", bucket: "2"})).not.toBe(traceEntryKey({id: "3", bucket: "1"}));
        expect(traceEntryKey({id: "3"})).toBe("3");
    });
});

describe("normalizeTraceContext", () => {
    it("标准 pi context 全解析：systemPrompt + text/thinking/toolCall 块 + tools", () => {
        const view = normalizeTraceContext({
            systemPrompt: "sp",
            messages: [
                {role: "user", content: "hello"},
                {role: "assistant", content: [
                    {type: "thinking", thinking: "hmm"},
                    {type: "text", text: "world"},
                    {type: "toolCall", id: "c1", name: "read", arguments: {path: "a.md"}},
                ]},
            ],
            tools: [{name: "read", description: "读文件", parameters: {}}],
        });
        expect(view?.systemPrompt).toBe("sp");
        expect(view?.messages[0]).toMatchObject({role: "user", blocks: [{kind: "text", text: "hello"}]});
        expect(view?.messages[1]?.blocks).toEqual([
            {kind: "thinking", text: "hmm"},
            {kind: "text", text: "world"},
            {kind: "toolCall", name: "read", args: {path: "a.md"}},
        ]);
        expect(view?.tools[0]).toMatchObject({name: "read", description: "读文件"});
    });

    it("toolResult 的 note 拼接 toolName · toolCallId · error", () => {
        const view = normalizeTraceContext({
            messages: [{role: "toolResult", toolName: "read", toolCallId: "c1", isError: true, content: [{type: "text", text: "boom"}]}],
        });
        expect(view?.messages[0]).toMatchObject({role: "toolResult", note: "read · c1 · error"});
    });

    it("非法形状全部降级、绝不 throw", () => {
        expect(normalizeTraceContext(undefined)).toBeNull();
        expect(normalizeTraceContext("text")).toBeNull();
        expect(normalizeTraceContext([1, 2])).toBeNull();

        const view = normalizeTraceContext({
            messages: [
                42,
                {role: "assistant", content: [{type: "mystery", data: 1}]},
                {role: "user", content: {weird: true}},
            ],
            tools: [null],
        });
        expect(view?.messages[0]).toMatchObject({role: "unknown", blocks: [{kind: "json", value: 42}]});
        expect(view?.messages[1]?.blocks[0]).toMatchObject({kind: "json"});
        expect(view?.messages[2]?.blocks[0]).toMatchObject({kind: "json", value: {weird: true}});
        expect(view?.tools[0]?.name).toBe("(unnamed)");
    });
});
