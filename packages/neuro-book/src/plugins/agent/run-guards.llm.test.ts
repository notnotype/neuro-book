/**
 * 运行保护接真实模型（docs/specs/agent/run-guards.md 的 Smoke）：带上传输设置（只发一次 HTTP、自己计第一事件、关掉内层的空回复重发）之后，
 * 一轮真实对话照常完成，费用记进会话累计。只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {splitReference} from "nbook/plugins/models/shared/rules";

import {agentProfile} from "./shared/points";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const PLAIN = "test.llm.plain";
const plain = agentProfile(PLAIN, {name: "保护烟测", description: "测试用", tools: {required: [], optional: []}});
const plugin: PluginDefinition = {id: "test.llm", entries: [defineEntry({
    id: "server",
    location: "server",
    activationEvents: [plain.activationEvent],
    contributions: [plain.contribution],
    activate: () => ({contributions: {"agent.profiles": {[PLAIN]: defineProfile({id: PLAIN, version: "1", name: "保护烟测", description: "测试用", system: "你是一个简短回答问题的助手。"})}}}),
})]};

describe.skipIf(config === null)("运行保护接真实模型", () => {
    test("一轮对话照常完成，只发一次模型请求，费用进会话累计", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "run-guards");
        world = await agentWorld(join(root, "world"), {
            plugins: [plugin],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", headers: {}, models: [{id: model, enabled: true, headers: {}}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null}))},
                "nbook.agent/warnCost": 1000,
                "nbook.agent/maxCost": 1000,
            },
        });
        const created = await world.service.create({profile: PLAIN});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const session = created.value;

        const sent = await session.send({commandId: "llm-guards", input: {text: "用一句话回答：太阳从哪边升起？"}});
        if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.runId;
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            return session.runResult({runId});
        }, {timeoutMs: 120_000, intervalMs: 100});

        expect(result).toMatchObject({reason: "completed"});
        expect(result!.text.length).toBeGreaterThan(0);
        expect(result!.usage.complete).toBe(true);
        const events = await session.path();
        expect(events.filter((event) => event.type === "modelStarted")).toHaveLength(1);
        expect(events.filter((event) => event.type === "modelFailed")).toHaveLength(0);
        const {usage} = await session.snapshot();
        expect(usage.cost + usage.unpriced).toBeGreaterThan(0);
    }, 180_000);
});
