import {describe, expect, test} from "bun:test";
import {createMemorySessionStore, createSession} from "./session";
import type {EntryInput, SessionLog} from "./session";
import {assistantMessage, interactionRequest, interactionResponse, invocation, reminder, seed, toolCall, userMessage} from "./testing/fixtures";
import {describeStoreScenarios} from "./testing/store-scenarios";

describeStoreScenarios("内存存储", async () => createMemorySessionStore());

async function fresh(): Promise<SessionLog> {
    const result = await createSession(createMemorySessionStore());
    if (!result.ok) throw new Error(result.detail);
    return result.value;
}

async function rejection(log: SessionLog, inputs: readonly EntryInput[]): Promise<{code: string; detail: string; index: number | undefined}> {
    const result = await log.append(inputs);
    if (result.ok) throw new Error("本应被拒绝");
    return {code: result.code, detail: result.detail, index: result.index};
}

describe("条目校验（输入与前置条件）", () => {
    test("值必须能被 JSON 如实表示：undefined、NaN、非普通对象与循环引用都被拒绝，detail 给出路径", async () => {
        const log = await fresh();
        const withUndefined = {type: "custom", customType: "x/y", data: {a: {b: undefined}}} as unknown as EntryInput;
        expect((await rejection(log, [withUndefined])).detail).toContain("/data/a/b/");
        const withNaN = {type: "compaction", summary: "s", firstKeptEntryId: "e", tokensBefore: Number.NaN} as EntryInput;
        expect((await rejection(log, [withNaN])).detail).toContain("tokensBefore");
        const withDate = {type: "custom", customType: "x/y", data: {at: new Date(0)}} as unknown as EntryInput;
        expect((await rejection(log, [withDate])).detail).toContain("Date");
        const circular: {type: "custom"; customType: string; data: Record<string, unknown>} = {type: "custom", customType: "x/y", data: {}};
        circular.data.self = circular.data;
        expect((await rejection(log, [circular as unknown as EntryInput])).detail).toContain("循环");
        expect(log.entries).toHaveLength(0);
    });

    test("customType 必须是 <命名空间>/<名称>；harness 命名空间只允许保留的五种，形状也要对", async () => {
        const log = await fresh();
        expect((await rejection(log, [{type: "custom", customType: "NoSlash"}])).code).toBe("invalid-entry");
        expect((await rejection(log, [{type: "custom", customType: "harness/unknown"}])).detail).toContain("harness/");
        expect((await rejection(log, [{type: "custom", customType: "harness/invocation", data: {invocationId: "i", phase: "flying"}}])).detail).toContain("phase");
        expect((await rejection(log, [{type: "custom_message", customType: "harness/invocation", content: "x", display: true}])).detail).toContain("custom");
        expect((await rejection(log, [{type: "custom_message", customType: "harness/seed", content: "x", display: true}])).detail).toContain("details");
        expect((await rejection(log, [{type: "custom_message", customType: "harness/reminder", content: "x", display: false, details: {extra: 1}}])).detail).toContain("details");
        expect((await rejection(log, [{type: "custom", customType: "harness/profile-state", data: {profileId: "p"}}])).detail).toContain("state");

        const accepted = await log.append([
            invocation("inv-1", "start"),
            seed("任务：写第三章", {role: "developer", once: true}),
            reminder("保持第三人称"),
            {type: "custom", customType: "harness/profile-state", data: {profileId: "writer", state: {style: {lastTurn: 1}}}},
            {type: "custom", customType: "plugin.x/anything", data: [1, "two", null]},
        ]);
        expect(accepted.ok && accepted.value.length).toBe(5);
    });

    test("interaction：request 与 response 字段随 phase 互斥；request 指向已有助手消息里的工具调用；response 在 request 之后且各至多一个", async () => {
        const log = await fresh();
        const [assistant] = (await log.append([assistantMessage([toolCall("call-1", "edit")], {stopReason: "toolUse"})])).ok
            ? (await log.append([])).ok ? log.entries : []
            : [];
        const assistantId = assistant!.id;

        const requestWithResponse: EntryInput = {
            type: "custom", customType: "harness/interaction",
            data: {interactionId: "a", kind: "approval", phase: "request", request: {assistantEntryId: assistantId, toolCallId: "call-1", toolName: "edit"}, response: {decision: "approve", decidedBy: "user"}},
        };
        expect((await rejection(log, [requestWithResponse])).detail).toContain("response");
        expect((await rejection(log, [interactionRequest("a", "no-such-entry", "call-1")])).detail).toContain("assistantEntryId");
        expect((await rejection(log, [interactionRequest("a", assistantId, "call-9")])).detail).toContain("toolCallId");
        expect((await rejection(log, [interactionResponse("a", {decision: "approve", decidedBy: "user"})])).detail).toContain("request");

        expect((await log.append([interactionRequest("a", assistantId, "call-1")])).ok).toBe(true);
        expect((await rejection(log, [interactionRequest("a", assistantId, "call-1")])).detail).toContain("已有 request");
        expect((await log.append([interactionResponse("a", {decision: "reject", decidedBy: "user", note: "不要改这里"})])).ok).toBe(true);
        expect((await rejection(log, [interactionResponse("a", {decision: "approve", decidedBy: "approver"})])).detail).toContain("已有 response");

        // 同一批里的后一条可以依赖前一条：request 在前、response 在后一起写入。
        const batch = await log.append([interactionRequest("b", assistantId, "call-1"), interactionResponse("b", {decision: "approve", scope: "session", decidedBy: "user"})]);
        expect(batch.ok && batch.value.length).toBe(2);
        // 整批拒绝时不留下前面的 request：response 在前、request 在后的批整批不写。
        const reversed = await rejection(log, [interactionResponse("c", {decision: "approve", decidedBy: "user"}), interactionRequest("c", assistantId, "call-1")]);
        expect(reversed.index).toBe(0);
        expect(log.entries.filter((entry) => entry.type === "custom" && (entry.data as {interactionId?: string}).interactionId === "c")).toHaveLength(0);
    });

    test("message 的角色只能是 user、developer、assistant、toolResult；content 的块类型与 OMP 的必填字段按角色检查", async () => {
        const log = await fresh();
        expect((await rejection(log, [{type: "message", message: {role: "system", content: "x"} as never}])).detail).toContain("role");
        expect((await rejection(log, [{type: "message", message: {role: "user", content: [{type: "toolCall", id: "c", name: "n", arguments: {}}], timestamp: 1} as never}])).detail).toContain("content");
        expect((await rejection(log, [{type: "message", message: {role: "user", content: "没有时间戳"} as never}])).detail).toContain("timestamp");
        const complete = assistantMessage([{type: "text", text: "好的"}]);
        const without = (field: string): EntryInput => {
            const copy = structuredClone(complete) as unknown as {message: Record<string, unknown>};
            delete copy.message[field];
            return copy as unknown as EntryInput;
        };
        for (const field of ["api", "provider", "model", "usage", "stopReason", "timestamp"]) {
            expect((await rejection(log, [without(field)])).detail).toContain(field);
        }
        const badStop = structuredClone(complete) as unknown as {message: {stopReason: string}};
        badStop.message.stopReason = "finished";
        expect((await rejection(log, [badStop as unknown as EntryInput])).detail).toContain("stopReason");
        expect((await rejection(log, [{type: "message", message: {role: "toolResult", toolCallId: "c", toolName: "n", content: [], timestamp: 1} as never}])).detail).toContain("isError");
        expect((await log.append([userMessage("好"), assistantMessage([{type: "text", text: "好的"}, {type: "thinking", thinking: "…", thinkingSignature: "sig"}])])).ok).toBe(true);
        // 同一条助手消息里工具调用 id 重复：按 id 配不开结果，OMP 发请求前会改名并合成假结果，所以在输入边界拒绝。
        expect((await rejection(log, [assistantMessage([toolCall("call_0", "read"), toolCall("call_0", "read")], {stopReason: "toolUse"})])).detail).toContain("工具调用 id 重复");
    });
});
