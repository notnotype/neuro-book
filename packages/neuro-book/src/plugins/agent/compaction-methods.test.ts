/**
 * 压缩方法的纯逻辑（docs/specs/agent/compaction.md 输出 1–4）：不起内核，用合成的请求消息。端到端的行为在 `compaction.test.ts`。
 */

import {describe, expect, test} from "bun:test";

import type {CompactionCut, Message, ModelResponse} from "@notnotype/nb-harness/kernel/contracts";

import {keptMessageIndex, pickCut} from "./backend/compaction/cuts";
import {modelFailure, outputLimit, sumUsage} from "./backend/compaction/replies";
import {segmentsOf} from "./backend/compaction/summary";

const event = (eventId: string) => ({kind: "event", eventId, type: "input", extension: "kernel"}) as const;
const user = (text: string, eventId: string): Message => ({role: "user", content: [{kind: "text", text, origin: event(eventId)}]});
const cut = (entryId: string, tokensKept: number, rest: Partial<CompactionCut> = {}): CompactionCut => ({entryId, kind: "turn", tokensKept, firstEventId: null, firstCallId: null, ...rest});

describe("切点", () => {
    test("输出 4：保留量不超过上限的最早切点；第一个切点什么都不去掉不选；都超了取最后一个；只有一个时整段换成摘要", () => {
        expect(pickCut([cut("a", 90_000), cut("b", 50_000), cut("c", 19_000), cut("d", 3_000)])?.entryId).toBe("c");
        expect(pickCut([cut("a", 90_000), cut("b", 50_000), cut("c", 30_000)])?.entryId).toBe("c");
        expect(pickCut([cut("a", 90_000)])).toBeNull();
        expect(pickCut([])).toBeNull();
    });

    test("输出 4：按对话事件或步的工具调用定位保留部分；定位不到时全部要摘要", () => {
        const messages: Message[] = [
            user("前面", "e1"),
            {role: "assistant", content: [], toolCalls: [{id: "call-7", tool: "t", args: {}}]},
            {role: "tool", callId: "call-7", content: [{kind: "text", text: "结果", origin: event("r1")}]},
        ];
        expect(keptMessageIndex(messages, cut("x", 1, {firstEventId: "e1"}))).toBe(0);
        // 只调工具的回复没有带来源的块，步切点靠工具调用 id 找到它。
        expect(keptMessageIndex(messages, cut("x", 1, {kind: "step", firstEventId: "reply-9", firstCallId: "call-7"}))).toBe(1);
        expect(keptMessageIndex(messages, cut("x", 1, {firstEventId: "nope"}))).toBe(3);
        expect(keptMessageIndex(messages, null)).toBe(3);
    });
});

describe("摘要的输入", () => {
    const fixed = {kind: "fixed", by: "profile"} as const;

    test("输出 3：只收对话本身的块：开场、规则、扩展的槽不进；图片只留尺寸，不带 base64", () => {
        const messages: Message[] = [
            {role: "user", content: [{kind: "text", text: "规则文件的内容", origin: fixed}, {kind: "text", text: "用户的话", origin: event("e1")}]},
            {role: "user", content: [{kind: "text", text: "只有开场", origin: {kind: "slot", name: "s", extension: "x"}}]},
            {role: "tool", callId: "c", content: [{kind: "image", data: "QUJD".repeat(1_000), mime: "image/png", width: 800, height: 600, origin: event("e2")}]},
        ];
        const [text] = segmentsOf(messages, 0);
        expect(text).toContain("用户的话");
        expect(text).toContain("[图片 800×600]");
        expect(text).not.toContain("规则文件的内容");
        expect(text).not.toContain("只有开场");
        expect(text).not.toContain("QUJD");
    });

    test("输出 3：按预算分段，整条放得下就不切；单条放不下才切块，每块不超预算（每 3 字节一个 token）", () => {
        const messages = [user("一".repeat(100), "e1"), user("二".repeat(100), "e2"), user("三".repeat(100), "e3")];
        expect(segmentsOf(messages, 0)).toHaveLength(1);
        const segments = segmentsOf(messages, 130);
        expect(segments).toHaveLength(3);
        expect(segments.join("")).toContain("三");
        const pieces = segmentsOf([user("好".repeat(1_000), "e1")], 100);
        expect(pieces.length).toBeGreaterThan(1);
        for (const piece of pieces) expect(Buffer.byteLength(piece, "utf8") / 3).toBeLessThanOrEqual(100 + 10);
        expect(pieces.join("").replaceAll(/【[^】]*】\n/gu, "")).toContain("好".repeat(900));
    });
});

describe("模型的回复", () => {
    const usage = {input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.5, complete: true};
    const reply = (rest: Partial<ModelResponse>): ModelResponse => ({content: [{kind: "text", text: "摘要"}], toolCalls: [], stopReason: "stop", usage, model: "p/m", ...rest});

    test("输出 2：能当摘要的是有文字、没调工具、没被截断的回复", () => {
        expect(modelFailure(reply({}))).toBeNull();
        expect(modelFailure(reply({toolCalls: [{id: "c", tool: "t", args: {}}], stopReason: "tool"}))).toBe("called-a-tool");
        // 有文字又带工具调用（不支持禁止工具调用的端点）：文字不能当摘要。
        expect(modelFailure(reply({toolCalls: [{id: "c", tool: "t", args: {}}]}))).toBe("called-a-tool");
        expect(modelFailure(reply({stopReason: "length"}))).toBe("truncated");
        expect(modelFailure(reply({content: [], stopReason: "stop"}))).toBe("empty-reply");
        expect(modelFailure(reply({stopReason: "error", content: [], error: {kind: "network", message: "x"}}))).toBe("network");
    });

    test("输出 6、3：输出上限不超过 16,384、模型的输出上限和窗口的四分之一；用量是各次调用之和，有一次没单价费用就是未知", () => {
        expect(outputLimit({contextWindow: 200_000})).toBe(16_384);
        expect(outputLimit({contextWindow: 200_000, maxOutput: 4_096})).toBe(4_096);
        expect(outputLimit({contextWindow: 8_000})).toBe(2_000);
        expect(outputLimit({contextWindow: 0})).toBe(16_384);
        expect(sumUsage([usage, {...usage, input: 1, cost: 0.25}])).toEqual({input: 11, output: 10, cacheRead: 0, cacheWrite: 0, cost: 0.75});
        expect(sumUsage([usage, {...usage, cost: null}])).toMatchObject({cost: null});
    });
});
