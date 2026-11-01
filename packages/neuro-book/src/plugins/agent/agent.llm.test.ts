/**
 * Agent 插件接真实模型（w00032 t10 收口）：窗口经真实的远程链路建会话、订阅帧、发一条消息，服务端的 `nbook.agent` 经
 * `nbook.models` 解析模型、跑一轮（docs/specs/agent/sessions.md 输出 7、8）。只在 `NBOOK_LLM_TESTS=1` 时运行
 * （docs/testing/README.md 的“真实模型”）。
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
import type {RemoteFrame} from "./shared/remote";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const GREETER = "test.llm.greeter";
const greeter = agentProfile(GREETER, {name: "问候", description: "测试用", tools: {required: [], optional: []}});
const plugin: PluginDefinition = {id: "test.llm", entries: [defineEntry({id: "server", location: "server", activationEvents: [greeter.activationEvent], contributions: [greeter.contribution], activate: () => ({contributions: {"agent.profiles": {[GREETER]: defineProfile({id: GREETER, version: "1", name: "问候", description: "测试用", system: "你是一个简短的助手，只用中文回答。"})}}})})]};

describe.skipIf(config === null)("Agent 接真实模型", () => {
    test("窗口经远程合同建会话、订阅帧、发一条消息：收到流式增量与助手的回复，运行正常结束", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "llm");
        // 密钥只进场地的启动环境；设置里只有变量名。
        world = await agentWorld(join(root, "world"), {
            plugins: [plugin],
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep"].map((id) => ({id, axis: "gradient", name: "", description: "", model: id === "main" ? config!.model : null})).concat([{id: "compaction", axis: "specialist", name: "", description: "", model: null}])},
            },
        });
        const {client} = await world.window("w");
        const created = await client.create({profile: GREETER});
        if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
        const sessionId = created.value.sessionId;
        const frames: RemoteFrame[] = [];
        const subscription = await client.events.frames.subscribe({sessionId}, (frame) => frames.push(frame));
        if (!subscription.ok) throw new Error("subscribe failed");
        const sent = await client.send({sessionId, commandId: "llm-1", input: {text: "只回复两个字：你好"}});
        if (!sent.ok || sent.value.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
        const runId = sent.value.value.runId;
        // 推着时钟走：增量的合并窗口、空闲计时都在场地的手动时钟上。
        const result = await waitUntil("运行结束", async () => {
            world!.settings.clock.advance(100);
            const read = await client.runResult({sessionId, runId});
            return read.ok ? read.value : null;
        }, {timeoutMs: 90_000, intervalMs: 50});
        expect(result).toMatchObject({reason: "completed"});
        expect(result.text.length).toBeGreaterThan(0);
        expect(frames.some((frame) => frame.type === "delta" && frame.purpose === "turn")).toBe(true);
        expect(frames.some((frame) => frame.type === "log" && frame.item.kind === "event" && frame.item.event.type === "assistant")).toBe(true);
        subscription.value.release();
    }, 120_000);
});
