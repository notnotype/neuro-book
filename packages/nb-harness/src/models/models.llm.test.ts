import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {streamSimple} from "@oh-my-pi/pi-ai";
import {LLM_TEST_PROVIDER_ID, llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {validateHarnessConfig} from "../config/config";
import {createModelCatalog, openCredentials} from "./models";

// 真实模型调用要花钱：只在 `bun run test:llm`（NBOOK_LLM_TESTS=1）下运行，并需要开发者授权。服务、模型与 key 取共享的测试配置（NBOOK_LLM_*）。
const llm = llmTestConfig();
const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

describe.skipIf(llm === null)("真实模型冒烟（harness.models 场景 4）", () => {
    test("从测试配置把 key 写进临时凭据库，解析模型、取 key，经 OMP streamSimple 完成一次最短对话", async () => {
        const modelRef = `${LLM_TEST_PROVIDER_ID}/${llm!.model}`;
        const root = await createTestTmpRoot("nb-harness-models-llm", "models-llm");
        roots.push(root);
        const credentials = await openCredentials({sqlitePath: join(root, "auth.sqlite")});
        if (!credentials.ok) throw new Error(credentials.detail);
        try {
            await credentials.value.setApiKey(LLM_TEST_PROVIDER_ID, llm!.apiKey);
            const config = validateHarnessConfig({
                // 内核不读环境变量：测试把配置里的服务写成一个自建提供方，模型就是它名下的那一个
                models: {defaultModel: modelRef},
                providers: [{id: LLM_TEST_PROVIDER_ID, api: llm!.api, baseUrl: llm!.baseUrl, models: [{id: llm!.model}]}],
            });
            if (!config.ok) throw new Error(JSON.stringify(config.problems));
            const selected = createModelCatalog({config: config.value}).select({});
            if (!selected.ok) throw new Error(`${selected.code}: ${selected.detail}`);
            const apiKey = await credentials.value.apiKeyFor(selected.value.model);
            expect(apiKey).toBe(llm!.apiKey);
            const stream = streamSimple(selected.value.model, {systemPrompt: ["只回答 ok"], messages: [{role: "user", content: "回答 ok", timestamp: Date.now()}]}, {apiKey, maxTokens: 5});
            const reply = await stream.result();
            expect(reply.stopReason).toBe("stop");
            expect(reply.content.some((block) => block.type === "text")).toBe(true);
        } finally {
            credentials.value.close();
        }
    }, 120_000);
});
