/**
 * NeuroBook 与 nb-story 的工具与条目在对话视图里的登记：主体记忆的检索与更新、查会话与 Agent、作答，以及回复上“没核实的
 * 出处”的附注。它们不是通用的 harness 工具，
 * 不在 nb-agent-ui 的内置登记里；主应用以后有 Agent 插件时由它登记，现在放在 Lab 的宿主里，也当作“宿主登记领域工具”
 * 的示例（docs/specs/ui/agent-conversation-view.md“注册表”）。
 */

import {agentRef, argString} from "@notnotype/nb-agent-ui";
import type {AgentViewContribution, ToolCallView, ToolRendererEntry} from "@notnotype/nb-agent-ui";
import LabAnswerNode from "./LabAnswerNode.vue";
import LabWordCountStatus from "./LabWordCountStatus.vue";
import LabUnverifiedRefsEntry from "./LabUnverifiedRefsEntry.vue";

const tools: ToolRendererEntry[] = [
    {
        id: "subject_rag_search", toolNames: ["subject_rag_search"], category: "explore", icon: "i-lucide-brain",
        label: {"zh-CN": "检索记忆", "en-US": "Search memory"}, summary: (call) => argString(call, "query"),
        groupPhrase: (calls) => agentRef("toolGroup.search", {count: calls.length}), presentation: "line",
    },
    {
        id: "agent_lookup", toolNames: ["get_session", "get_agent", "get_agent_profile"], category: "explore", icon: "i-lucide-bot",
        label: {"zh-CN": "查询 Agent", "en-US": "Look up agent"}, summary: (call) => call.name,
        // 组短语收到这一组的调用，可以按参数写；这里只说查成功了的是哪几种，还没有成功的时候退回次数。
        groupPhrase: (calls) => {
            const kinds = [...new Set(calls.filter((call) => call.status === "success").map((call) => call.name))];
            return kinds.length === 0 ? agentRef("toolGroup.lookup", {count: calls.length}) : {"zh-CN": `查了 ${kinds.join("、")}`, "en-US": `Looked up ${kinds.join(", ")}`};
        },
        presentation: "line",
    },
    {
        id: "subject_memory", toolNames: ["subject_memory_update", "subject_event_append"], category: "mutate", icon: "i-lucide-notebook-pen",
        label: {"zh-CN": "更新记忆", "en-US": "Update memory"}, summary: (call) => argString(call, "subjectPath"), presentation: "line",
    },
    // nb-story 交答案的收尾工具：常显的节点，宿主组件画结论与出处；交成功的那次是这一轮的结果。
    {
        id: "answer", toolNames: ["answer"], category: "interact", icon: "i-lucide-message-square-text",
        label: {"zh-CN": "作答", "en-US": "Answer"}, summary: answerSummary, presentation: "node", node: LabAnswerNode, outcome: true,
    },
];

/**
 * 交卷被退回时过程里只剩一行（Spec 验收 29），原因由这里写进行内：`call.error` 的第一行。运行结束时还没有结果的调用也算
 * 出错但没有说明，那时写“没有完成”，不说成退回。
 */
function answerSummary(call: ToolCallView): string {
    if (call.status !== "error" && call.status !== "invalid") return argString(call, "conclusion");
    const reason = call.error?.split("\n", 1)[0]?.trim() ?? "";
    return reason === "" ? "没有完成" : `退回：${reason}`;
}

/** 宿主加的状态栏项样例：一个左边的“本会话改的字数”（来自插件，缺省关）。 */
export const labStatusItemsContribution: AgentViewContribution = {
    source: "lab:status-items",
    statusItems: [{id: "lab.words", component: LabWordCountStatus, side: "left", title: "本会话改的字数", description: "来自插件“字数统计”", source: "字数统计"}],
};

export const labDomainToolsContribution: AgentViewContribution = {
    source: "lab:neurobook-tools",
    tools,
    entries: [{id: "unverified-refs", customType: "nb-story.unverified-refs", component: LabUnverifiedRefsEntry}],
};
