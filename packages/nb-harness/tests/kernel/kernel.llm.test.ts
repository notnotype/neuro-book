/**
 * 新内核的真实模型 Smoke（docs/specs/harness/session.md“验收与 Smoke”）：会话目录上的 JSONL 存储加真实的 OMP 适配器，
 * 一轮对话、重开、再一轮。只在显式设置 NBOOK_LLM_TESTS=1 且有凭据时运行（`bun run test:llm`）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {defineModel, resolveModel} from "@notnotype/nb-harness";
import {closeSession, createJsonlStore, createSession, defineProfile, ompCall, ompModelInfo, openSession, systemClock, type SessionEnv} from "@notnotype/nb-harness/kernel";
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

function env(): SessionEnv {
    const config = llm!;
    const base = resolveModel(config.model).model;
    const target = defineModel({provider: base.provider, api: base.api, baseUrl: config.baseUrl ?? base.baseUrl, id: base.id, apiKeyEnv: config.apiKeyEnv, reasoning: base.reasoning, input: base.input, contextWindow: base.contextWindow, maxTokens: base.maxTokens});
    const call = ompCall({model: target.model, apiKey: target.apiKey, priceKnown: false});
    return {
        store: createJsonlStore({root}),
        profiles: {resolve: (key) => (key === profile.id ? profile : undefined)},
        models: {resolve: () => ({ok: true, info: ompModelInfo(target.model), call})},
        tools: {declarations: () => [], create: () => Promise.reject(new Error("no tools"))},
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
});
