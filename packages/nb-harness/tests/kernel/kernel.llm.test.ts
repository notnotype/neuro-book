/**
 * 新内核的真实模型 Smoke（docs/specs/harness/session.md、runtime.md“验收与 Smoke”）：会话目录上的 JSONL 存储加真实的
 * OMP 适配器。一轮对话、重开、再一轮；带工具调用；流式中途中止；回退后重发。只在显式设置 NBOOK_LLM_TESTS=1 且有凭据时运行
 * （`bun run test:llm`）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {defineModel, resolveModel} from "@notnotype/nb-harness";
import {closeSession, createJsonlStore, createSession, defineProfile, ompCall, ompModelInfo, openSession, systemClock, type LogEvent, type SessionEnv, type ToolDeclaration} from "@notnotype/nb-harness/kernel";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

const llm = llmTestConfig();
let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-llm", "kernel-real-model");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const profile = defineProfile({id: "test.smoke", version: "1", name: "Smoke", description: "真实模型 Smoke", system: "你是简洁的助手，用一句中文回答。"});

/** 加法工具：模型要算两数之和时调用它。 */
const addTool: ToolDeclaration = {id: "lab.add", description: "Add two integers and return the sum.", parameters: {type: "object", properties: {a: {type: "integer"}, b: {type: "integer"}}, required: ["a", "b"]}, provider: "test", version: "1", finish: false, concurrency: "exclusive", strict: true, effect: "read"};

function env(withTools = false): SessionEnv {
    const config = llm!;
    const base = resolveModel(config.model).model;
    const target = defineModel({provider: base.provider, api: base.api, baseUrl: config.baseUrl ?? base.baseUrl, id: base.id, apiKeyEnv: config.apiKeyEnv, reasoning: base.reasoning, input: base.input, contextWindow: base.contextWindow, maxTokens: base.maxTokens});
    const call = ompCall({model: target.model, apiKey: target.apiKey, priceKnown: false});
    return {
        store: createJsonlStore({root}),
        profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
        models: {resolve: () => ({ok: true, info: ompModelInfo(target.model), call})},
        tools: {
            declarations: () => (withTools ? [addTool] : []),
            create: () => ({execute: async (args) => String(Number(args.a) + Number(args.b))}),
        },
        resources: () => ({read: async () => undefined, resolve: (uri) => uri}),
        sessions: {get: () => Promise.reject(new Error("no sessions"))},
        clock: systemClock,
        approve: async () => ({verdict: "allow", by: "smoke-policy"}),
    };
}

describe.skipIf(llm === null)("新内核：真实模型", () => {
    test("一轮对话、重开、再一轮：第二轮看得到第一轮的内容", async () => {
        const created = await createSession(env(), {profile: profile.id, id: "smoke"});
        if (!created.ok) throw new Error(created.code);
        const first = await created.value.send({commandId: "1", input: {text: "记住这个暗号：青鸟。只回答“记住了”。"}});
        if (!first.ok || first.value.runId === null) throw new Error("send failed");
        const firstResult = await created.value.waitRun(first.value.runId);
        expect(firstResult).toMatchObject({reason: "completed", error: null});
        expect(firstResult.usage.input).toBeGreaterThan(0);
        await closeSession(created.value);

        const reopened = await openSession(env(), "smoke");
        if (!reopened.ok) throw new Error(reopened.code);
        const second = await reopened.value.send({commandId: "2", input: {text: "刚才的暗号是什么？只回答暗号。"}});
        if (!second.ok || second.value.runId === null) throw new Error("send failed");
        const secondResult = await reopened.value.waitRun(second.value.runId);
        expect(secondResult).toMatchObject({reason: "completed", error: null});
        expect(secondResult.text).toContain("青鸟");
        await closeSession(reopened.value);
    }, 120_000);

    test("带工具调用：模型调用加法工具，结果回给模型，最终回复带上和", async () => {
        const created = await createSession(env(true), {profile: profile.id, id: "smoke-tools"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const sent = await session.send({commandId: "1", input: {text: "请调用 lab__add 工具计算 17 加 25，然后用一句话告诉我结果。"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        const result = await session.waitRun(sent.value.runId);
        expect(result).toMatchObject({reason: "completed", error: null});
        const events = await session.path();
        const started = events.find((event) => event.type === "toolStarted");
        expect(started?.data).toMatchObject({tool: "lab.add", args: {a: 17, b: 25}});
        expect(events.find((event) => event.type === "toolResult")?.data).toMatchObject({status: "ok", text: "42"});
        expect(result.text).toContain("42");
        await closeSession(session);
    }, 120_000);

    test("流式中途中止：运行以 aborted 收口，模型请求记 modelFailed{aborted}；重开后能接着聊", async () => {
        const created = await createSession(env(), {profile: profile.id, id: "smoke-abort"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const firstDelta = new Promise<void>((resolve) => {
            const stop = session.subscribe((frame) => {
                if (frame.type === "delta") {
                    stop();
                    resolve();
                }
            });
        });
        const sent = await session.send({commandId: "1", input: {text: "写一篇两千字的短篇小说，讲一只猫的一生。"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await firstDelta;
        await session.abort({commandId: "stop"});
        expect((await session.waitRun(sent.value.runId)).reason).toBe("aborted");
        const types = (await session.path()).map((event: LogEvent) => event.type);
        expect(types.slice(-3)).toEqual(["modelFailed", "turnEnded", "runEnded"]);
        await closeSession(session);
        const reopened = await openSession(env(), "smoke-abort");
        if (!reopened.ok) throw new Error(reopened.code);
        const again = await reopened.value.send({commandId: "2", input: {text: "只回答“好”。"}});
        if (!again.ok || again.value.runId === null) throw new Error("send failed");
        expect((await reopened.value.waitRun(again.value.runId)).reason).toBe("completed");
        await closeSession(reopened.value);
    }, 120_000);

    test("回退后重发：新问题替换旧问题，回答按新问题", async () => {
        const created = await createSession(env(), {profile: profile.id, id: "smoke-rewind"});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const sent = await session.send({commandId: "1", input: {text: "法国的首都是哪里？只回答城市名。"}});
        if (!sent.ok || sent.value.runId === null) throw new Error("send failed");
        await session.waitRun(sent.value.runId);
        const before = (await session.rewindTargets()).find((target) => target.kind === "before-turn")!;
        const resent = await session.rewind({commandId: "2", to: before.id, resend: {text: "日本的首都是哪里？只回答城市名。"}});
        if (!resent.ok || resent.value.runId === undefined) throw new Error("resend failed");
        const result = await session.waitRun(resent.value.runId);
        expect(result.text).toContain("东京");
        const inputs = (await session.path()).filter((event) => event.type === "input").map((event) => (event.data as {text: string}).text);
        expect(inputs).toEqual(["日本的首都是哪里？只回答城市名。"]);
        await closeSession(session);
    }, 120_000);
});
