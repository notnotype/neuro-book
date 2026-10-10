import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import type {Message} from "@oh-my-pi/pi-ai";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createJsonlSessionStore} from "./jsonl/jsonl";
import {buildModelContext, createMemorySessionStore, createSession, defineProjection, fold, openSession, planRecovery, renderCompactionSummary, sessionSettings, sessionStatus} from "./session";
import type {EntryInput, SessionEntry, SessionLog, SessionStore} from "./session";
import {keepAllRoles, requestSeenByModel} from "./testing/agent-capture";
import {assistantMessage, interactionRequest, interactionResponse, invocation, seed, toolCall, toolResult, userMessage} from "./testing/fixtures";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

const stores: {label: string; make(): Promise<SessionStore>}[] = [
    {label: "内存存储", make: async () => createMemorySessionStore()},
    {
        label: "JSONL 存储",
        make: async () => {
            const root = await createTestTmpRoot("nb-harness-session-replay", "session-replay");
            roots.push(root);
            return createJsonlSessionStore({root});
        },
    },
];

async function logWith(store: SessionStore, batches: readonly (readonly EntryInput[])[]): Promise<SessionLog> {
    const created = await createSession(store, {id: "replay"});
    if (!created.ok) throw new Error(created.detail);
    for (const batch of batches) {
        const result = await created.value.append(batch);
        if (!result.ok) throw new Error(`append 失败：${result.code} ${result.detail}`);
    }
    return created.value;
}

function toolCallIds(message: Message): string[] {
    return message.role === "assistant" ? message.content.filter((block) => block.type === "toolCall").map((block) => block.id) : [];
}

function textOf(message: Message): string {
    return typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "")).join("");
}

describe("回放：模型上下文（输出 12）", () => {
    test("场景 9：两轮用相同的工具调用 id，第二轮的结果未写入：只保留第一轮的调用，结果不会配给第二轮", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            userMessage("一"),
            assistantMessage([toolCall("call_0", "read")], {stopReason: "toolUse"}),
            toolResult("call_0", "read", "第一轮的结果"),
            assistantMessage([{type: "text", text: "读完了"}]),
            userMessage("二"),
            assistantMessage([{type: "text", text: "再读一次"}, toolCall("call_0", "read")], {stopReason: "toolUse"}),
        ]]);
        const context = buildModelContext(log.entries);
        expect(context.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "assistant", "user", "assistant"]);
        expect(toolCallIds(context[1]!)).toEqual(["call_0"]);
        expect(toolCallIds(context[5]!)).toEqual([]);
        expect(textOf(context[5]!)).toBe("再读一次");
    });

    test("场景 10：带签名思考块与两个调用、其中一个没有结果：去掉无结果的调用与 redactedThinking，清除思考签名，保留思考文本", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            userMessage("一"),
            assistantMessage([
                {type: "thinking", thinking: "先读再改", thinkingSignature: "sig-1"},
                {type: "redactedThinking", data: "opaque"} as never,
                toolCall("c1", "read"),
                toolCall("c2", "edit"),
            ], {stopReason: "toolUse"}),
            toolResult("c1", "read", "内容"),
        ]]);
        const [, assistant] = buildModelContext(log.entries);
        expect(assistant!.role).toBe("assistant");
        if (assistant!.role !== "assistant") return;
        expect(assistant!.content.map((block) => block.type)).toEqual(["thinking", "toolCall"]);
        expect(assistant!.content[0]).toEqual({type: "thinking", thinking: "先读再改"});
        expect(toolCallIds(assistant!)).toEqual(["c1"]);
        // 没改写的助手消息原样回放，签名保留。
        const intact = await logWith(createMemorySessionStore(), [[assistantMessage([{type: "thinking", thinking: "想", thinkingSignature: "sig"}, toolCall("c1", "read")], {stopReason: "toolUse"}), toolResult("c1", "read", "x")]]);
        const [kept] = buildModelContext(intact.entries);
        expect(kept!.role === "assistant" && kept!.content[0]).toEqual({type: "thinking", thinking: "想", thinkingSignature: "sig"});
    });

    test("配不上调用的工具结果去掉；返回的是副本，可以改而不影响日志", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            userMessage("一"),
            toolResult("stray", "read", "没有调用的结果"),
            assistantMessage([toolCall("c1", "read")], {stopReason: "toolUse"}),
            toolResult("c1", "read", "A"),
            toolResult("c1", "read", "重复的 A"),
            toolResult("other", "read", "别的"),
        ]]);
        const context = buildModelContext(log.entries);
        expect(context.map((message) => (message.role === "toolResult" ? textOf(message) : message.role))).toEqual(["user", "assistant", "A"]);
        (context[0] as {content: string}).content = "改了";
        expect(log.entries[0]!.type === "message" && log.entries[0]!.message.content).toBe("一");
    });

    test("调用窗口在下一条用户消息处结束：用户消息之后才出现的工具结果配不上前面的调用，两边都去掉", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            userMessage("一"),
            assistantMessage([{type: "text", text: "我来读"}, toolCall("c1", "read")], {stopReason: "toolUse"}),
            userMessage("等等"),
            toolResult("c1", "read", "迟到的结果"),
        ]]);
        const context = buildModelContext(log.entries);
        expect(context.map((message) => `${message.role}:${textOf(message)}`)).toEqual(["user:一", "assistant:我来读", "user:等等"]);
        expect(planRecovery([{id: "i", parentId: null, timestamp: new Date(0).toISOString(), type: "custom", customType: "harness/invocation", data: {invocationId: "x", phase: "start"}}, ...log.entries]).map((input) => input.type === "message" ? `${input.message.role}:${(input.message as {toolCallId?: string}).toolCallId ?? ""}` : "invocation")).toEqual(["toolResult:c1", "invocation"]);
    });

    test("输出 12.2：出错或中止的助手消息连同窗口里的工具结果一起去掉，即使它还有文字", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            userMessage("一"),
            assistantMessage([{type: "text", text: "出错前的半句"}, toolCall("c1", "read")], {stopReason: "error"}),
            toolResult("c1", "read", "照样返回了"),
            assistantMessage([{type: "text", text: "被中止的回答"}], {stopReason: "aborted"}),
            userMessage("二"),
        ]]);
        expect(buildModelContext(log.entries).map((message) => `${message.role}:${textOf(message)}`)).toEqual(["user:一", "user:二"]);
    });

    test("场景 14：压缩后的回放顺序为本段的种子、摘要、保留的第四轮起、之后的轮；种子带角色与 attribution: agent", async () => {
        const turns = (from: number, to: number): EntryInput[] =>
            Array.from({length: to - from + 1}, (_, index) => from + index).flatMap((turn) => [userMessage(`问 ${turn}`), assistantMessage([{type: "text", text: `答 ${turn}`}])]);
        const log = await logWith(createMemorySessionStore(), [
            [seed("只写一次的任务说明", {role: "developer", once: true}), seed("技能目录")],
            turns(1, 5),
        ]);
        const fourthUser = log.entries.find((entry) => entry.type === "message" && entry.message.role === "user" && entry.message.content === "问 4")!;
        await log.append([{type: "compaction", summary: "前三轮在讨论大纲", firstKeptEntryId: fourthUser.id, tokensBefore: 12_345}, seed("技能目录")]);
        await log.append(turns(6, 6));

        const context = buildModelContext(log.entries);
        expect(context.map((message) => `${message.role}:${textOf(message).slice(0, 6)}`)).toEqual([
            "user:技能目录", `user:${renderCompactionSummary("前三轮在讨论大纲").slice(0, 6)}`, "user:问 4", "assistant:答 4", "user:问 5", "assistant:答 5", "user:问 6", "assistant:答 6",
        ]);
        expect(context[0]).toMatchObject({role: "user", attribution: "agent"});
        expect(context[1]).toMatchObject({role: "user", attribution: "agent"});
        expect(textOf(context[1]!)).toContain("<summary>\n前三轮在讨论大纲\n</summary>");
        expect(context.some((message) => textOf(message).includes("只写一次"))).toBe(false);

        const developerSeed = await logWith(createMemorySessionStore(), [[seed("规则", {role: "developer"}), userMessage("问")]]);
        expect(buildModelContext(developerSeed.entries)[0]).toMatchObject({role: "developer", content: "规则", attribution: "agent"});
    });
});

describe("回放：会话状态、设置与自定义回放（输出 13–15）", () => {
    test("输出 13：没有未结束的调用为 idle；有未结束的调用按是否有待处理事项分 running 与 waiting；resumed 之后只看新范围", async () => {
        const log = await logWith(createMemorySessionStore(), [[userMessage("一")]]);
        expect(sessionStatus(log.entries)).toEqual({phase: "idle", pending: []});
        await log.append([invocation("inv-1", "start"), assistantMessage([toolCall("c1", "edit")], {stopReason: "toolUse"})]);
        expect(sessionStatus(log.entries)).toMatchObject({phase: "running", invocationId: "inv-1", pending: []});
        const assistantId = log.entries.at(-1)!.id;
        await log.append([interactionRequest("ask-1", assistantId, "c1")]);
        expect(sessionStatus(log.entries)).toMatchObject({phase: "waiting", invocationId: "inv-1", pending: [{interactionId: "ask-1", kind: "approval", request: {assistantEntryId: assistantId, toolCallId: "c1", toolName: "edit", tier: "write"}}]});
        await log.append([invocation("inv-1", "waiting")]);
        expect(sessionStatus(log.entries).phase).toBe("waiting");
        await log.append([interactionResponse("ask-1", {decision: "approve", decidedBy: "user"}), invocation("inv-1", "resumed")]);
        expect(sessionStatus(log.entries)).toMatchObject({phase: "running", invocationId: "inv-1", pending: []});
        await log.append([invocation("inv-1", "end")]);
        expect(sessionStatus(log.entries).phase).toBe("idle");
    });

    test("输出 14：模型与角色取最后一个 model_change，思考档位与标题取最后一个；approvalGrants 只收 approve 且 scope: session 的应答并按工具去重", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            {type: "model_change", model: "a/one", role: "main"},
            {type: "thinking_level_change", thinkingLevel: "high"},
            {type: "title_change", title: "旧", source: "auto"},
            assistantMessage([toolCall("c1", "edit"), toolCall("c2", "bash"), toolCall("c3", "edit")], {stopReason: "toolUse"}),
        ]]);
        const assistantId = log.entries.at(-1)!.id;
        await log.append([
            interactionRequest("g1", assistantId, "c1", "edit"), interactionResponse("g1", {decision: "approve", scope: "session", decidedBy: "user"}),
            interactionRequest("g2", assistantId, "c2", "bash"), interactionResponse("g2", {decision: "approve", scope: "once", decidedBy: "user"}),
            interactionRequest("g3", assistantId, "c3", "edit"), interactionResponse("g3", {decision: "approve", scope: "session", decidedBy: "approver"}),
            {type: "model_change", model: "b/two"},
            {type: "thinking_level_change", thinkingLevel: null},
            {type: "title_change", title: "新", source: "user"},
        ]);
        expect(sessionSettings(log.entries)).toEqual({model: "b/two", title: "新", approvalGrants: [{toolName: "edit", tier: "write"}]});
    });

    test("输出 15：fold 从 initial 起按序号对每个条目调用一次 reduce", async () => {
        const log = await logWith(createMemorySessionStore(), [[userMessage("一"), assistantMessage([{type: "text", text: "好"}]), {type: "title_change", title: "t", source: "auto"}]]);
        const roles = defineProjection({initial: [] as string[], reduce: (state, entry) => (entry.type === "message" ? [...state, entry.message.role] : state)});
        expect(fold(log.entries, roles)).toEqual(["user", "assistant"]);
        expect(fold([], roles)).toEqual([]);
    });
});

describe("回放：崩溃收口（输出 16）", () => {
    for (const {label, make} of stores) {
        test(`场景 6（${label}）：四个调用各一种状态；重开后只列出待审批的，拒绝的补拒绝结果、批准未执行的补中断结果，交给 OMP Agent 后每个调用都有结果`, async () => {
            const store = await make();
            const log = await logWith(store, [[invocation("inv-1", "start"), userMessage("改四处")]]);
            await log.append([assistantMessage([toolCall("c1", "read"), toolCall("c2", "edit"), toolCall("c3", "edit"), toolCall("c4", "bash")], {stopReason: "toolUse"})]);
            const assistantId = log.entries.at(-1)!.id;
            await log.append([
                toolResult("c1", "read", "读到了"),
                interactionRequest("i2", assistantId, "c2"),
                interactionRequest("i3", assistantId, "c3"), interactionResponse("i3", {decision: "reject", decidedBy: "user", note: "这段不要动"}),
                interactionRequest("i4", assistantId, "c4", "bash"), interactionResponse("i4", {decision: "approve", decidedBy: "user"}),
            ]);
            log.close();

            const reopened = await openSession(store, "replay");
            if (!reopened.ok) throw new Error(reopened.detail);
            const entries = reopened.value.entries;
            expect(sessionStatus(entries)).toMatchObject({phase: "waiting", invocationId: "inv-1", pending: [{interactionId: "i2"}]});

            const plan = planRecovery(entries);
            expect(plan).toEqual(planRecovery(entries));
            expect(plan.map((input) => (input.type === "message" && input.message.role === "toolResult" ? `${input.message.toolCallId}:${input.message.isError}:${textOf(input.message)}` : input.type === "custom" ? (input.data as {phase: string}).phase : input.type))).toEqual([
                "c3:true:用户拒绝执行工具 edit：这段不要动",
                "c4:true:工具 bash 的执行被中断，结果未知",
                "waiting",
            ]);
            const written = await reopened.value.append(plan);
            expect(written.ok).toBe(true);
            expect(planRecovery(reopened.value.entries)).toEqual([]);
            expect(sessionStatus(reopened.value.entries)).toMatchObject({phase: "waiting", pending: [{interactionId: "i2"}]});

            const context = buildModelContext(reopened.value.entries);
            const assistant = context.find((message) => message.role === "assistant")!;
            expect(toolCallIds(assistant)).toEqual(["c1", "c3", "c4"]);
            expect(context.filter((message) => message.role === "toolResult").map((message) => (message as {toolCallId: string}).toolCallId)).toEqual(["c1", "c3", "c4"]);

            const seen = await requestSeenByModel(context, {convertToLlm: keepAllRoles});
            const calls = seen.flatMap(toolCallIds);
            const results = seen.filter((message) => message.role === "toolResult");
            expect(calls).toEqual(["c1", "c3", "c4"]);
            expect(results.map((message) => (message as {toolCallId: string}).toolCallId)).toEqual(calls);
            expect(results.some((message) => textOf(message).includes("No result provided") || (message as {details?: {__synthetic?: boolean}}).details?.__synthetic === true)).toBe(false);
            reopened.value.close();
        });
    }

    test("场景 8：旧调用失败后开始新调用：只处理新调用，出错的助手消息不进模型上下文", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            invocation("inv-1", "start"), userMessage("一"),
            assistantMessage([toolCall("c1", "read")], {stopReason: "error"}),
            invocation("inv-1", "error"),
            userMessage("二"), invocation("inv-2", "start"),
        ]]);
        expect(planRecovery(log.entries)).toEqual([invocation("inv-2", "interrupted")]);
        expect(sessionStatus(log.entries)).toMatchObject({phase: "running", invocationId: "inv-2"});
        expect(buildModelContext(log.entries).map((message) => `${message.role}:${textOf(message)}`)).toEqual(["user:一", "user:二"]);
        await log.append(planRecovery(log.entries));
        expect(planRecovery(log.entries)).toEqual([]);
        expect(sessionStatus(log.entries).phase).toBe("idle");
    });

    test("收口计划只写入了一部分（结果条目写了、收尾条目没写）时再次调用，只剩收尾条目；结果条目带消息必填的 timestamp", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            invocation("inv-1", "start"), userMessage("一"),
            assistantMessage([toolCall("c1", "read"), toolCall("c2", "read")], {stopReason: "toolUse"}),
        ]]);
        const plan = planRecovery(log.entries);
        expect(plan).toHaveLength(3);
        const results = plan.filter((input) => input.type === "message");
        for (const input of results) expect(input.type === "message" && typeof input.message.timestamp).toBe("number");
        await log.append(results);
        expect(planRecovery(log.entries)).toEqual([invocation("inv-1", "interrupted")]);
        await log.append(planRecovery(log.entries));
        expect(planRecovery(log.entries)).toEqual([]);
    });

    test("压缩条目的 firstKeptEntryId 找不到或指向压缩之后时，保留段为空：回放只有种子、摘要与本段历史", async () => {
        const log = await logWith(createMemorySessionStore(), [[userMessage("一"), assistantMessage([{type: "text", text: "答一"}])]]);
        await log.append([{type: "compaction", summary: "摘要", firstKeptEntryId: "no-such-entry", tokensBefore: 1}, userMessage("二")]);
        expect(buildModelContext(log.entries).map((message) => `${message.role}:${textOf(message).slice(0, 2)}`)).toEqual(["user:Pr", "user:二"]);
        const after = log.entries.at(-1)!.id;
        await log.append([{type: "compaction", summary: "再压", firstKeptEntryId: after, tokensBefore: 1}, userMessage("三")]);
        expect(buildModelContext(log.entries).map((message) => `${message.role}:${textOf(message).slice(0, 2)}`)).toEqual(["user:Pr", "user:二", "user:三"]);
    });

    test("已结束的调用不再处理；没有 interaction 的无结果调用补中断结果后调用标为 interrupted", async () => {
        const log = await logWith(createMemorySessionStore(), [[
            invocation("inv-1", "start"), userMessage("一"),
            assistantMessage([toolCall("c1", "read"), toolCall("c2", "read")], {stopReason: "toolUse"}),
            toolResult("c1", "read", "A"),
        ]]);
        const plan = planRecovery(log.entries);
        expect(plan.map((input) => (input.type === "message" ? input.message.role : input.type === "custom" ? (input.data as {phase: string}).phase : input.type))).toEqual(["toolResult", "interrupted"]);
        await log.append(plan);
        expect(planRecovery(log.entries)).toEqual([]);
        await log.append([invocation("inv-1", "end")]);
        expect(planRecovery(log.entries)).toEqual([]);
        const finished = await logWith(createMemorySessionStore(), [[invocation("x", "start"), assistantMessage([toolCall("c", "read")], {stopReason: "toolUse"}), invocation("x", "aborted")]]);
        expect(planRecovery(finished.entries)).toEqual([]);
    });
});

describe("场景 1 的回放部分", () => {
    test("关闭后重新打开：buildModelContext 得到三条消息，sessionSettings 得到标题", async () => {
        const store = createMemorySessionStore();
        const log = await logWith(store, [
            [userMessage("改第三章")],
            [assistantMessage([toolCall("c1", "read", {path: "a"}), toolCall("c2", "read", {path: "b"})], {stopReason: "toolUse"})],
            [toolResult("c1", "read", "A"), toolResult("c2", "read", "B")],
            [{type: "title_change", title: "第三章修订", source: "auto"}],
        ]);
        log.close();
        const reopened = await openSession(store, "replay");
        if (!reopened.ok) throw new Error(reopened.detail);
        const context = buildModelContext(reopened.value.entries);
        expect(context.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "toolResult"]);
        expect(sessionSettings(reopened.value.entries).title).toBe("第三章修订");
        expect((reopened.value.entries satisfies readonly SessionEntry[]).length).toBe(5);
    });
});
