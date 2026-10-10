import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import Type from "typebox";
import {createCompactionRegistry} from "../compaction/compaction";
import {createConfigStore} from "../config/config";
import {createModelCatalog, openCredentials, parseModelRef} from "../models/models";
import {Appending, createProfileCatalog, createProfileHost, defineProfile, History, Input, Prompt, System, User} from "../profile/profile";
import {createMemorySessionStore} from "../session/session";
import {createStaticToolSource, defineTool} from "../tools/tools";
import {createRuntime} from "./runtime";

// 真实模型调用要花钱：只在 `bun run test:llm`（NBOOK_LLM_TESTS=1）下运行，并需要开发者授权。模型与 key 取共享的测试配置。
const llm = llmTestConfig();
const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

describe.skipIf(llm === null)("真实模型冒烟（harness.runtime 场景 9）", () => {
    test("带一个只读工具的调用：模型调用工具、拿到结果、给出回复；日志里有工具调用与结果", async () => {
        const ref = parseModelRef(llm!.model);
        if (ref === null) throw new Error(`REAL_MODEL_SMOKE_MODEL 不是模型引用：${llm!.model}`);
        const root = await createTestTmpRoot("nb-harness-runtime-llm", "runtime-llm");
        roots.push(root);
        // 测试配置允许覆盖服务地址（DEEPSEEK_API_BASE）；内核不读环境变量，所以由测试把它写成配置里的自建服务。
        const baseUrl = process.env.DEEPSEEK_API_BASE;
        const config = createConfigStore({
            models: {defaultModel: llm!.model},
            ...(baseUrl === undefined || baseUrl === "" ? {} : {providers: [{id: ref.providerId, api: "openai-completions", baseUrl, models: [{id: ref.modelId}]}]}),
            approval: {mode: "write"},
        });
        if (!config.ok) throw new Error(JSON.stringify(config.problems));
        const credentials = await openCredentials({sqlitePath: join(root, "auth.sqlite")});
        if (!credentials.ok) throw new Error(credentials.detail);
        try {
            await credentials.value.setApiKey(ref.providerId, llm!.apiKey);
            const lookup = defineTool({
                id: "lookup", description: "查人物设定：给出人名，返回设定", parameters: Type.Object({name: Type.String()}), risk: "read",
                execute: async (args) => ({ok: true, content: `${(args as {name: string}).name}：1987 年青岛的海员，二十六岁。`}),
            });
            const profile = defineProfile({
                id: "writer", name: "写作助手", description: "冒烟", version: 1, fields: {"harness/tools": ["lookup"]},
                prompt: () => (
                    <Prompt>
                        <System>你是小说写作助手。回答之前必须先用 lookup 工具查人物设定，再用一句话回答。</System>
                        <History><User once>我们在写一部海员题材的小说。</User></History>
                        <Appending><Input /></Appending>
                    </Prompt>
                ),
            });
            const runtime = createRuntime({
                config: config.value, profiles: createProfileCatalog([{source: "test", profiles: [profile]}]), host: createProfileHost(),
                models: createModelCatalog({config: config.value.current}), credentials: credentials.value,
                tools: [createStaticToolSource([lookup])], compaction: createCompactionRegistry(), store: createMemorySessionStore(), limits: {maxTurns: 4},
            });
            const created = await runtime.createSession({profileId: "writer"});
            if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
            const started = await created.value.prompt({content: "林岚多大年纪？"});
            if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
            const result = await started.value.done;
            expect(result.status).toBe("completed");
            const roles = result.entries.filter((entry) => entry.type === "message").map((entry) => (entry.type === "message" ? entry.message.role : ""));
            expect(roles).toContain("toolResult");
            expect(roles.at(-1)).toBe("assistant");
            await created.value.close();
        } finally {
            credentials.value.close();
        }
    }, 120_000);
});
