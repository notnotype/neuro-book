/**
 * 不调用真实模型的完整装配：Profile + 会话日志 + 插件工具 + 两轮对话 + 事件订阅。
 * 脚本化流只验证装配，不代表模型行为；真实模型见 real-model.ts。
 *
 * 运行：bun examples/offline-turn.ts
 */
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {AgentTool} from "@oh-my-pi/pi-agent-core";
import {createHarness, definePlugin} from "@notnotype/nb-harness";
import {scriptedStreamFn} from "@notnotype/nb-harness/testing";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";

const root = await mkdtemp(join(tmpdir(), "nb-harness-offline-"));

// 领域工具以插件形式接入：工具实现 OMP 的 AgentTool 接口。
const wordCount: AgentTool = {
    name: "word_count",
    label: "Word count",
    description: "统计一段文字的字符数",
    parameters: {type: "object", properties: {text: {type: "string"}}, required: ["text"], additionalProperties: false},
    execute: async (_toolCallId, params) => {
        const text = String((params as {text: string}).text);
        return {content: [{type: "text", text: `${[...text].length}`}]};
    },
} as AgentTool;

try {
    const harness = await createHarness({
        model: "deepseek/deepseek-flash",
        cwd: root,
        sessionLog: await createJsonlSessionLog({root, sessionId: "offline"}),
        node: ProfilePrompt({children: [System({children: ["你是一名写作助手。"]})]}),
        plugins: [definePlugin({manifest: {name: "writing-stats", version: "0.1.0"}, tools: [wordCount]})],
        streamFn: scriptedStreamFn("好的，已经记下。"),
        apiKey: () => "offline",
    });

    try {
        console.log("工具：", harness.tools.map((tool) => tool.name));

        const eventTypes: string[] = [];
        const unsubscribe = harness.subscribe((event) => eventTypes.push(event.type));

        const first = await harness.turn("第一章主角叫林照。");
        const second = await harness.turn("记住了吗？");
        unsubscribe();

        console.log("第一轮回复：", first.text);
        console.log("第二轮新增条目：", second.entries.map((entry) => `${entry.seq}:${entry.kind}`));
        console.log("事件首尾：", eventTypes[0], "…", eventTypes[eventTypes.length - 1]);
    } finally {
        await harness.close();
    }

    // 会话日志是独立的事实源：关闭 harness 后仍可读回。
    const replay = await createJsonlSessionLog({root, sessionId: "offline"});
    console.log("日志读回：", (await replay.read()).map((entry) => (entry.kind === "message" ? `${entry.role}:${entry.text}` : entry.kind)));
} finally {
    await rm(root, {recursive: true, force: true});
}
