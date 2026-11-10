/**
 * `nbook.agent` 给对话视图登记的工具渲染器（docs/specs/agent/conversation.md 输出 33–39）：三个子代理工具画成卡片节点，任务中心的三个
 * 工具画成思维链里的一行。工具名是 `displayToolName` 显式映射出来的键，别的插件的同名工具不会撞上。组件由调用方传进来：这个模块不导入
 * `.vue`，按需加载。
 */

import type {Component} from "vue";
import {markRaw} from "vue";

import type {AgentViewContribution, ToolCallView, ToolRendererEntry} from "@notnotype/nb-agent-ui";
import {argArray, argString} from "@notnotype/nb-agent-ui";

import {agentText} from "../shared/text";

const card = (id: string, toolName: string, label: "spawn" | "send" | "answer", node: Component, summary: (call: ToolCallView) => string): ToolRendererEntry => ({
    id, toolNames: [toolName], category: "other", icon: "i-lucide-bot", label: agentText(`conversation.subagent.${label}`), summary, presentation: "node", node,
});

const line = (id: string, toolName: string, label: "wait" | "kill" | "jobs", icon: string, summary: (call: ToolCallView) => string): ToolRendererEntry => ({
    id, toolNames: [toolName], category: "other", icon, label: agentText(`conversation.subagent.${label}`), summary, presentation: "line",
});

export function subagentContribution(components: {readonly card: Component}): AgentViewContribution {
    const node = markRaw(components.card);
    return {
        source: "nbook.agent:subagents",
        tools: [
            card("nbook.agent.spawn", "agent_spawn", "spawn", node, (call) => argString(call, "name") || argString(call, "prompt")),
            card("nbook.agent.send", "agent_send", "send", node, (call) => argString(call, "message")),
            card("nbook.agent.answer", "agent_answer", "answer", node, (call) => argString(call, "question")),
            line("nbook.agent.wait", "agent.wait", "wait", "i-lucide-hourglass", (call) => argArray(call, "jobs").filter((item): item is string => typeof item === "string").join("、")),
            line("nbook.agent.kill", "agent.kill", "kill", "i-lucide-circle-stop", (call) => argString(call, "job")),
            line("nbook.agent.jobs", "agent.jobs", "jobs", "i-lucide-list", () => ""),
        ],
    };
}
