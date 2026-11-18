/**
 * `nbook.agent` 给对话视图登记的 eval 渲染器（docs/specs/agent/eval.md，开发者定的注意力排序见 w00032 t21 决定 6）：思维链里的一张
 * 卡片，标题是动作名，副标题是代码的标题（模型给的 `title`，没给时是代码的第一行）。子调用的计数、卡片下的子行与运行中的用时是
 * 对话视图对所有带子调用的卡片做的（nb-agent-ui 的 `AgentChainBlock`），这里不管。详情组件由调用方传进来：这个模块不导入 `.vue`，
 * 按需加载。
 */

import type {Component} from "vue";
import {markRaw} from "vue";

import type {AgentViewContribution, ToolCallView} from "@notnotype/nb-agent-ui";
import {argString} from "@notnotype/nb-agent-ui";

import {agentText} from "../shared/text";

/**
 * 卡片副标题：模型写的标题；没写时取代码的第一行。参数里 `title` 排在 `code` 前面，流式生成代码时标题已经写完了（适配器从半截
 * 参数里抽出 `title`）。
 */
export function evalSummary(call: ToolCallView): string {
    const title = argString(call, "title").trim();
    if (title !== "") return title;
    return argString(call, "code").split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

export function evalContribution(components: {readonly detail: Component}): AgentViewContribution {
    return {
        source: "nbook.agent:eval",
        tools: [{
            id: "nbook.agent.eval",
            // 视图认的工具名是 `displayToolName("nbook.agent.eval")`。
            toolNames: ["eval"],
            category: "other",
            icon: "i-lucide-square-code",
            label: agentText("conversation.eval.label"),
            summary: evalSummary,
            presentation: "card",
            detail: markRaw(components.detail),
        }],
    };
}
