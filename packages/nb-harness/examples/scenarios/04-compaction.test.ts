/**
 * 场景 4：压缩——阈值触发、压缩条目与种子、压缩后模型看到的上下文。
 *
 * 要说明的事：
 * - 压缩方法走注册。内置的 `soft` 用 OMP 的本地摘要（真实模型调用）；这里把它的摘要传输换成脚本
 *   （`createCompactionRegistry({soft: {completeImpl}})`，OMP 给宿主的正式注入点），不联网，方法顺序不用改。
 * - Profile 字段 `harness/compaction` 决定阈值与保留量。示例 Profile 的字段是固定的，场景用 `defineProfile`
 *   从它派生一个只改字段的变体——Profile 只是数据，可以这样复用。
 * - 触发：一次调用 `completed` 后，最后一条助手消息报告的上下文用量超过阈值就压缩；压缩是调用的尾段，
 *   `done` 完成时压缩条目已经写好，并算在这次调用的 `entries` 里。
 * - 压缩写入一条 `compaction` 条目，并在同一批里重写种子：`once` 的 `<Developer>` 不再写，`<WorkspaceTree />` 那条
 *   重新渲染（目录此时的内容）。之后回放出来的上下文是：种子、摘要（一条 `attribution: "agent"` 的用户消息）、保留的近期历史。
 *
 * 行为合同：docs/specs/harness/runtime.md 输出第 14 条；docs/specs/harness/compaction.md 输出第 5–9 条；docs/specs/harness/session.md 输出第 12 条。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {AssistantMessage} from "@oh-my-pi/pi-ai";
import type {RuntimeEvent} from "@notnotype/nb-harness";
import type {CompleteImpl} from "@notnotype/nb-harness/compaction";
import {defineProfile} from "@notnotype/nb-harness/profile";
import {assemble} from "../assemble";
import type {Assembled} from "../assemble";
import {contextText, scriptedModel} from "../testing/scripted-model";
import {createStage, exampleConfig, kinds, loadWriterProfile} from "../testing/stage";
import type {Stage} from "../testing/stage";

let stage: Stage | null = null;
let assembled: Assembled | null = null;
afterAll(async () => {
    assembled?.close();
    await stage?.cleanup();
});

const ZERO_USAGE = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}};

describe("示例场景 4：压缩", () => {
    test("用量超过阈值后自动压缩；之后模型看到种子、摘要与保留的历史", async () => {
        stage = await createStage("04-compaction");
        // 摘要传输脚本化：记下每次交给摘要模型的提示词，回一段固定摘要
        const prompts: string[] = [];
        const completeImpl: CompleteImpl = async (model, context) => {
            prompts.push(context.messages.map((message) => (typeof message.content === "string" ? message.content : message.content.map((block) => ("text" in block ? block.text : "")).join(""))).join("\n"));
            const reply: AssistantMessage = {role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{type: "text", text: `摘要 #${prompts.length}：林岚是海员，故事在 1987 年的青岛。`}], usage: ZERO_USAGE, stopReason: "stop", timestamp: prompts.length};
            return reply;
        };

        // 从示例 Profile 派生：只换压缩字段——阈值 100 token，保留最近 60 token
        const writer = await loadWriterProfile();
        const profile = defineProfile({
            id: "writer-compact", name: writer.name, description: writer.description, version: writer.version,
            fields: {...writer.fields, "harness/compaction": {keepRecentTokens: 60, threshold: {tokens: 100}}},
            prompt: writer.prompt,
        });

        // 每条回复都报告 520 token 的用量，超过阈值
        const model = scriptedModel(Array.from({length: 6}, (_, index) => ({text: `第 ${index + 1} 次回复：${"林岚望着海。".repeat(20)}`, usage: {input: 500, output: 20, totalTokens: 520}})));
        assembled = await assemble({
            workspace: stage.workspace, state: stage.state, config: exampleConfig(), profiles: [profile],
            apiKeys: {scripted: "example-key"}, model: {stream: model.stream}, compaction: {soft: {completeImpl}},
        });
        const created = await assembled.runtime.createSession({profileId: "writer-compact", id: "compact"});
        if (!created.ok) throw new Error(`${created.code}: ${created.detail}`);
        const session = created.value;
        const compactions: RuntimeEvent[] = [];
        session.subscribe((event) => {
            if (event.type === "compaction") compactions.push(event);
        });

        // 没有历史时手动压缩：没有可压的，返回 null，不写任何东西
        expect(await session.compact()).toEqual({ok: true, value: null});
        // 还没调用过：没有上下文用量
        expect(session.status.context).toBeUndefined();

        for (let turn = 1; turn <= 3; turn += 1) {
            // 第 3 轮开始前目录里多一个文件：压缩用的是触发它的那次调用的准备结果，所以第 3 轮之后重写的种子会列出它
            if (turn === 3) await writeFile(join(stage.workspace, "chapter-2.md"), "第二章\n", "utf8");
            const started = await session.prompt({content: `第 ${turn} 轮：${"请记住这个设定。".repeat(10)}`});
            if (!started.ok) throw new Error(`${started.code}: ${started.detail}`);
            expect((await started.value.done).status).toBe("completed");
        }
        // 至少压缩过一次，都成功；日志末尾是压缩条目加一条种子（once 的那条不再写）
        expect(compactions.length).toBeGreaterThan(0);
        expect(compactions.every((event) => event.type === "compaction" && event.result.ok)).toBe(true);
        expect(kinds(session.log.entries).slice(-2)).toEqual(["compaction", "custom_message:harness/seed"]);
        expect(prompts.length).toBeGreaterThan(0);
        // 状态里的上下文用量：最后一条助手消息报告 520，阈值 100
        expect(session.status.context).toEqual({tokens: 520, window: 100_000, threshold: 100});

        // 压缩后再调用：开头是重写的种子（列出了新文件），其后是摘要，然后才是保留的历史与本次输入
        const after = await session.prompt({content: "压缩之后的一轮。"});
        if (!after.ok) throw new Error(`${after.code}: ${after.detail}`);
        expect((await after.value.done).status).toBe("completed");
        const context = model.contexts.at(-1)!;
        expect(context.messages[0]).toMatchObject({role: "user", attribution: "agent"});
        expect(contextText(context)).toContain("- chapter-2.md");
        expect(context.messages[1]).toMatchObject({role: "user", attribution: "agent"});
        expect(JSON.stringify(context.messages[1]!.content)).toContain("摘要 #");
        expect(context.messages.at(-1)).toMatchObject({role: "user"});
        await session.close();
    });
});
