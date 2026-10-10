import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {streamSimple} from "@oh-my-pi/pi-ai";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {validateHarnessConfig} from "../config/config";
import {createModelCatalog, openCredentials} from "./models";

// 真实模型调用要花钱：只在 `bun run test:llm`（NBOOK_LLM_TESTS=1）下运行，并需要开发者授权。
const enabled = process.env.NBOOK_LLM_TESTS === "1" && typeof process.env.DEEPSEEK_API_KEY === "string" && process.env.DEEPSEEK_API_KEY !== "";
const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

describe.skipIf(!enabled)("真实模型冒烟（harness.models 场景 4）", () => {
    test("从环境变量把 key 写进临时凭据库，解析模型、取 key，经 OMP streamSimple 完成一次最短对话", async () => {
        const root = await createTestTmpRoot("nb-harness-models-llm", "models-llm");
        roots.push(root);
        const credentials = await openCredentials({sqlitePath: join(root, "auth.sqlite")});
        if (!credentials.ok) throw new Error(credentials.detail);
        try {
            await credentials.value.setApiKey("deepseek", process.env.DEEPSEEK_API_KEY as string);
            const config = validateHarnessConfig({models: {defaultModel: "deepseek/deepseek-chat"}});
            if (!config.ok) throw new Error(JSON.stringify(config.problems));
            const selected = createModelCatalog({config: config.value}).select({});
            if (!selected.ok) throw new Error(selected.detail);
            const apiKey = await credentials.value.apiKeyFor(selected.value.model);
            expect(apiKey).toBeDefined();
            const stream = streamSimple(selected.value.model, {systemPrompt: ["只回答 ok"], messages: [{role: "user", content: "回答 ok", timestamp: Date.now()}]}, {apiKey, maxTokens: 5});
            const reply = await stream.result();
            expect(reply.stopReason).not.toBe("error");
            expect(reply.content.some((block) => block.type === "text" && block.text.length > 0)).toBe(true);
        } finally {
            credentials.value.close();
        }
    });
});
