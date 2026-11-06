/**
 * 上下文压缩接真实模型（docs/specs/agent/compaction.md 验收）：几轮对话撑过触发点，真实模型写摘要，压缩之后接着聊时还记得压缩前
 * 才说过的设定。判据是压缩事件出现过、摘要不为空、之后的回答里有那个设定，不看措辞。
 * 只在 `NBOOK_LLM_TESTS=1` 时运行（docs/testing/README.md 的“真实模型”）。缓存命中多少取决于服务商，这里只记录，不设判据。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {splitReference} from "nbook/plugins/models/shared/rules";

import {MAIN_PROFILE} from "./shared/contracts";
import {agentWorld} from "./testing/world";
import type {AgentWorld} from "./testing/world";

const config = llmTestConfig();
let root = "";
let world: AgentWorld | null = null;
let commands = 0;

afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe.skipIf(config === null)("压缩接真实模型", () => {
    test("长对话触发压缩，之后还记得压缩前的设定", async () => {
        const {provider, model} = splitReference(config!.model)!;
        root = await createTestTmpRoot("neuro-book-agent-llm", "compaction");
        world = await agentWorld(join(root, "world"), {
            env: {[config!.apiKeyEnv]: config!.apiKey},
            userSettings: {
                // 触发点调得很低，几轮就超过：真实窗口要几万 token 才压缩。
                "nbook.models/providers": [{id: provider, kind: "catalog", name: provider, ...(config!.baseUrl === null ? {} : {baseUrl: config!.baseUrl}), apiKeyEnv: config!.apiKeyEnv, auth: "default", models: [{id: model, enabled: true, compaction: {mode: "tokens", value: 1_800}}]}],
                "nbook.models/roles": {items: ["tiny", "fast", "main", "deep", "compaction"].map((id) => ({id, axis: id === "compaction" ? "specialist" : "gradient", name: "", description: "", model: config!.model}))},
                // 模型可能自己想写文件：测试里不等审批。
                "nbook.agent/profileSettings": {[MAIN_PROFILE]: {approvalMode: "yolo"}},
            },
        });
        const created = await world.service.create({profile: MAIN_PROFILE});
        if (!created.ok) throw new Error(created.code);
        const session = created.value;
        const say = async (text: string) => {
            const sent = await session.send({commandId: `llm-${String((commands += 1))}`, input: {text}});
            if (!sent.ok || sent.value.runId === null) throw new Error(`send failed: ${JSON.stringify(sent)}`);
            const result = await session.waitRun(sent.value.runId);
            expect(result.reason).toBe("completed");
            return result.text ?? "";
        };

        await say("请记住这个设定：主角叫陈砚，故事发生在雨夜的药铺里。用一句话复述它。");
        await say("按这个设定写一段约 500 字的开头，只写正文。");
        await say("接着写下一段，约 500 字，只写正文。");
        const events = await session.path();
        const compactions = events.filter((event) => event.type === "compaction").map((event) => event.data as {method: string; replacement: string | null; tokensBefore: number; tokensAfter: number; details?: {usage?: {cacheRead?: number; input?: number}}});
        expect(compactions.length).toBeGreaterThanOrEqual(1);
        // 观察：压缩前后的估算与摘要那次请求的缓存读取，不设判据。
        console.log(`compaction: ${JSON.stringify(compactions.map((item) => ({method: item.method, before: item.tokensBefore, after: item.tokensAfter, cacheRead: item.details?.usage?.cacheRead ?? null, input: item.details?.usage?.input ?? null})))}`);
        for (const item of compactions) if (item.replacement !== null) expect(item.replacement.trim().length).toBeGreaterThan(20);

        const answer = await say("故事的主角叫什么名字？只回答名字。");
        expect(answer).toContain("陈砚");
    }, 420_000);
});
