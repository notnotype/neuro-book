/**
 * 对话里通往“模型请求”页的两个入口（docs/specs/agent/request-trace.md 的入口表）：顶栏溢出菜单的“查看模型请求”，回复上的
 * “查看这次请求”。登记进 nb-agent-ui 的注册表，点了发出本插件的动作，由 `session-host.ts` 补上当前会话、交给命令。
 */

import type {AgentViewContribution} from "@notnotype/nb-agent-ui";

import {agentText} from "../shared/text";

/** 顶栏：只看当前会话。 */
export const OPEN_REQUESTS_ACTION = "nbook.agent:open-requests";
/** 回复：选中这条回复出自的那次请求，`payload` 是 `{request}`。 */
export const OPEN_REQUEST_ACTION = "nbook.agent:open-request";

export const requestEntriesContribution: AgentViewContribution = {
    source: "nbook.agent:requests",
    headerActions: [{
        id: "nbook.agent.open-requests",
        order: 50,
        icon: "i-lucide-activity",
        label: agentText("conversation.requests.open"),
        target: {kind: "action", action: {type: OPEN_REQUESTS_ACTION}},
        pinnable: false,
        when: (ctx) => ctx.session !== null,
    }],
    messageActions: [{
        id: "nbook.agent.open-request",
        messageKinds: ["assistant"],
        // 只在这条回复确实发过请求时出现（输出 26）：拦截层直接交回的回复没有 `request`。
        appliesTo: (message) => message.kind === "assistant" && message.request !== undefined,
        icon: "i-lucide-activity",
        label: agentText("conversation.requests.openThis"),
        toAction: (message) => ({type: OPEN_REQUEST_ACTION, payload: message.kind === "assistant" && message.request !== undefined ? {request: message.request} : null}),
    }],
};
