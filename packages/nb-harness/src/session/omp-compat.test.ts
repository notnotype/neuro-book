import {describe, expect, test} from "bun:test";
import {prepareCompaction} from "@oh-my-pi/pi-agent-core";
import type {SessionEntry as OmpSessionEntry} from "@oh-my-pi/pi-agent-core";
import {buildModelContext, createMemorySessionStore, createSession} from "./session";
import type {EntryInput, SessionEntry, SessionLog} from "./session";
import {keepAllRoles, requestSeenByModel} from "./testing/agent-capture";
import {assistantMessage, seed, toolCall, toolResult, userMessage} from "./testing/fixtures";

async function logWith(batches: readonly (readonly EntryInput[])[]): Promise<SessionLog> {
    const created = await createSession(createMemorySessionStore(), {id: "omp"});
    if (!created.ok) throw new Error(created.detail);
    for (const batch of batches) {
        const result = await created.value.append(batch);
        if (!result.ok) throw new Error(`append 失败：${result.code} ${result.detail}`);
    }
    return created.value;
}

const turns = (from: number, to: number): EntryInput[] =>
    Array.from({length: to - from + 1}, (_, index) => from + index).flatMap((turn) => [
        userMessage(`问 ${turn}：${"内容 ".repeat(40)}`),
        assistantMessage([toolCall(`t${turn}`, "read", {path: `ch${turn}.md`})], {stopReason: "toolUse"}),
        toolResult(`t${turn}`, "read", `第 ${turn} 章 ${"正文 ".repeat(80)}`),
        assistantMessage([{type: "text", text: `答 ${turn}：${"回答 ".repeat(40)}`}]),
    ]);

describe("与 OMP 兼容（输出 23）", () => {
    test("场景 14：条目满足 OMP 压缩模块的 SessionEntry 类型，浅副本可以交给 prepareCompaction（关闭远程压缩），结果的 firstKeptEntryId 是我们的条目 id", async () => {
        const log = await logWith([[seed("只写一次", {role: "developer", once: true}), seed("技能目录")], turns(1, 5)]);
        // 类型层面的子集关系：赋值不需要断言。
        const forOmp: OmpSessionEntry[] = [...log.entries];
        expect(forOmp).toHaveLength(log.entries.length);

        const prepared = prepareCompaction(forOmp, {enabled: true, keepRecentTokens: 200, remoteEnabled: false});
        expect(prepared).toBeDefined();
        if (prepared === undefined) return;
        expect(log.entries.some((entry) => entry.id === prepared.firstKeptEntryId)).toBe(true);
        expect(prepared.messagesToSummarize.length).toBeGreaterThan(0);
        expect(prepared.recentMessages.length).toBeGreaterThan(0);
        expect(prepared.messagesToSummarize.length + prepared.turnPrefixMessages.length + prepared.recentMessages.length).toBeLessThanOrEqual(log.entries.length);

        // 按它的切点写入压缩条目并重新写入种子，再追加一轮：我们按输出 12 回放，OMP 再次准备压缩时认得前一个压缩条目。
        await log.append([{type: "compaction", summary: "前面几轮在讨论大纲", firstKeptEntryId: prepared.firstKeptEntryId, tokensBefore: prepared.tokensBefore}, seed("技能目录")]);
        await log.append(turns(6, 6));
        const context = buildModelContext(log.entries);
        expect(context[0]).toMatchObject({role: "user", content: "技能目录", attribution: "agent"});
        expect(context[1]!.role).toBe("user");
        const keptIndex = log.entries.findIndex((entry) => entry.id === prepared.firstKeptEntryId);
        const expectedTail = log.entries.slice(keptIndex).filter((entry) => entry.type === "message").length;
        expect(context.length).toBe(2 + expectedTail);

        const again = prepareCompaction([...log.entries], {enabled: true, keepRecentTokens: 200, remoteEnabled: false});
        expect(again).toBeDefined();
        expect(again?.previousSummary).toBe("前面几轮在讨论大纲");
    });

    test("最后一个条目是没有 providerReplayThroughEntryId 的压缩条目时，OMP 不准备压缩（返回 undefined），压缩模块要在种子重新写入之后再调用", async () => {
        const log = await logWith([turns(1, 2)]);
        const first = log.entries[0]!;
        await log.append([{type: "compaction", summary: "s", firstKeptEntryId: first.id, tokensBefore: 0}]);
        expect(prepareCompaction([...log.entries], {enabled: true, keepRecentTokens: 100, remoteEnabled: false})).toBeUndefined();
        await log.append([seed("目录")]);
        expect(prepareCompaction([...log.entries], {enabled: true, keepRecentTokens: 100, remoteEnabled: false})).toBeDefined();
    });

    test("给 runtime 的约束：OMP Agent 缺省的 convertToLlm 会丢掉 developer 消息，交会话上下文时要自己传保留四种角色的转换", async () => {
        const log = await logWith([[seed("规则", {role: "developer"}), userMessage("问")]]);
        const context = buildModelContext(log.entries);
        expect(context.map((message) => message.role)).toEqual(["developer", "user"]);

        const byDefault = await requestSeenByModel(context);
        expect(byDefault.map((message) => message.role)).toEqual(["user", "user"]);
        const kept = await requestSeenByModel(context, {convertToLlm: keepAllRoles});
        expect(kept.map((message) => message.role)).toEqual(["developer", "user", "user"]);
    });

    test("会话条目的类型是 OMP SessionEntry 的子集：每个变体都能赋给 OMP 的同名变体", () => {
        const sample: SessionEntry[] = [
            {id: "a", parentId: null, timestamp: "2026-10-10T00:00:00.000Z", type: "message", message: {role: "user", content: "x", timestamp: 1}},
            {id: "b", parentId: "a", timestamp: "2026-10-10T00:00:00.000Z", type: "custom_message", customType: "harness/seed", content: "s", display: true, details: {role: "user"}},
            {id: "c", parentId: "b", timestamp: "2026-10-10T00:00:00.000Z", type: "custom", customType: "harness/invocation", data: {invocationId: "i", phase: "start"}},
            {id: "d", parentId: "c", timestamp: "2026-10-10T00:00:00.000Z", type: "model_change", model: "m", role: "main"},
            {id: "e", parentId: "d", timestamp: "2026-10-10T00:00:00.000Z", type: "thinking_level_change", thinkingLevel: null},
            {id: "f", parentId: "e", timestamp: "2026-10-10T00:00:00.000Z", type: "title_change", title: "t", source: "auto"},
            {id: "g", parentId: "f", timestamp: "2026-10-10T00:00:00.000Z", type: "compaction", summary: "s", firstKeptEntryId: "a", tokensBefore: 1},
        ];
        const omp: OmpSessionEntry[] = sample;
        expect(omp.map((entry) => entry.type)).toEqual(["message", "custom_message", "custom", "model_change", "thinking_level_change", "title_change", "compaction"]);
    });
});
