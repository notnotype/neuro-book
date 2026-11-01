/**
 * 模型服务接真实模型（w00032 t09 第 5 片）：在配置场地里起 `nbook.models`，像用户在设置页里那样添加 DeepSeek、用 `env:` 引用
 * 启动环境里的密钥、启用模型、绑定“主力”，再经 `modelsKey.port()` 解析并发一轮请求（docs/specs/models/service.md 输出 1、8）。
 * 只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {CoreSettings, ModelDelta, ModelRequest} from "@notnotype/nb-harness/kernel/contracts";

import {splitReference} from "./shared/rules";
import {modelsWorld} from "./testing/world";
import type {ModelsWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: ModelsWorld | null = null;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const ok = <T>(result: {ok: boolean; value?: T}): T => {
    if (!result.ok) throw new Error(`call failed: ${JSON.stringify(result)}`);
    return result.value as T;
};

describe.skipIf(config === null)("模型服务接真实模型", () => {
    test("添加目录服务商、密钥写成 env: 引用、启用模型并绑主力；经模型端口解析出模型，一轮请求流式返回文字与用量", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-models-llm", "llm");
        // 密钥只进场地的启动环境，不写进设置与凭据库。
        world = await modelsWorld(join(root, "world"), {env: {[config!.apiKeyEnv]: config!.apiKey}});
        const client = await world.window("w");
        ok(await client.addProvider({source: {kind: "catalog", id: provider}}));
        if (config!.baseUrl !== null) ok(await client.updateProvider({id: provider, patch: {baseUrl: config!.baseUrl}}));
        expect(ok(await client.setKey({provider, value: `env:${config!.apiKeyEnv}`}))).toEqual({kind: "env", name: config!.apiKeyEnv, found: true});
        ok(await client.upsertModel({provider, model: {id: model, enabled: true}}));
        ok(await client.setRole({id: "main", model: config!.model}));

        const settings: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};
        const resolution = world.service.port().resolve({settings, purpose: "turn", profile: "test.profile"});
        if (!resolution.ok) throw new Error(`resolve failed: ${resolution.code}`);
        const request: ModelRequest = {purpose: "turn", model: config!.model, params: {maxTokens: 32}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "只回复两个字：你好", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};
        const deltas: ModelDelta[] = [];
        const response = await resolution.call(request, AbortSignal.timeout(60_000), (delta) => deltas.push(delta));

        expect(response.error).toBeUndefined();
        expect(response.stopReason).toBe("stop");
        const text = response.content.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("");
        expect(text.length).toBeGreaterThan(0);
        expect(deltas.length).toBeGreaterThan(0);
        expect(response.usage.input).toBeGreaterThan(0);
        expect(response.usage.output).toBeGreaterThan(0);
    }, 120_000);
});
