import {describe, expect, test} from "bun:test";
import {LLM_TEST_PROVIDER_ID, llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {validateHarnessConfig} from "../config/config";
import {createModelCatalog} from "../models/models";
import {buildModelContext, createMemorySessionStore, createSession} from "../session/session";
import type {EntryInput} from "../session/session";
import {assistantMessage, seed, userMessage} from "../session/testing/fixtures";
import {compactSession, createCompactionRegistry, resolveCompactionSettings} from "./compaction";

// 真实模型调用要花钱：只在 `bun run test:llm`（NBOOK_LLM_TESTS=1）下运行，并需要开发者授权。服务、模型与 key 取共享的测试配置（NBOOK_LLM_*）。
const llm = llmTestConfig();

describe.skipIf(llm === null)("真实模型冒烟（harness.compaction 场景 7）", () => {
    test("六轮小会话做一次 soft 压缩：摘要非空、切点在日志里、回放的第一条用户消息含摘要", async () => {
        const modelRef = `${LLM_TEST_PROVIDER_ID}/${llm!.model}`;
        const config = validateHarnessConfig({
            // 内核不读环境变量：测试把配置里的服务写成一个自建提供方，模型就是它名下的那一个
            models: {defaultModel: modelRef},
            // 自建提供方没有目录数据，soft 压缩要求模型有正的 contextWindow；冒烟只要求它为正，不代表服务的真实上限
            providers: [{id: LLM_TEST_PROVIDER_ID, api: llm!.api, baseUrl: llm!.baseUrl, models: [{id: llm!.model, contextWindow: 128_000}]}],
        });
        if (!config.ok) throw new Error(JSON.stringify(config.problems));
        const selected = createModelCatalog({config: config.value}).select({});
        if (!selected.ok) throw new Error(`${selected.code}: ${selected.detail}`);

        const created = await createSession(createMemorySessionStore(), {id: "llm"});
        if (!created.ok) throw new Error(created.detail);
        const log = created.value;
        const inputs: EntryInput[] = [seed("你是小说助手")];
        const topics = ["主角叫林岚，是个海员", "故事发生在 1987 年的青岛", "反派是船长周沉", "第一章写暴风雨夜的出航", "林岚发现船上有走私货", "周沉察觉了林岚的怀疑"];
        topics.forEach((topic, index) => {
            inputs.push(userMessage(`设定：${topic}。请记住。`, index * 10 + 1));
            inputs.push(assistantMessage([{type: "text", text: `记住了：${topic}。`}], {timestamp: index * 10 + 2}));
        });
        await log.append(inputs);

        const result = await compactSession({
            log, registry: createCompactionRegistry(), model: selected.value.model, apiKey: llm!.apiKey,
            settings: resolveCompactionSettings({keepRecentTokens: 60, instructions: "保留人名与年份"}), seeds: [seed("你是小说助手")],
        });
        if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
        expect(result.value.method).toBe("soft");
        expect(result.value.output.summary.length).toBeGreaterThan(20);
        expect(log.entries.some((entry) => entry.id === result.value.output.firstKeptEntryId)).toBe(true);
        const context = buildModelContext(log.entries);
        expect(context[0]).toMatchObject({role: "user", content: "你是小说助手"});
        expect(context[1]).toMatchObject({role: "user", attribution: "agent"});
        const replayed = context[1]!.content;
        const text = typeof replayed === "string" ? replayed : replayed.map((block) => (block.type === "text" ? block.text : "")).join("");
        expect(text).toContain(result.value.output.summary);
    }, 120_000);
});
