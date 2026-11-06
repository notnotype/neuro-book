/**
 * 内置的消息操作：复制、编辑、重试、从此处分支。与插件走同一个“消息操作”扩展点。
 */
import type {MessageView} from "../types";
import type {AgentViewContribution, MessageActionEntry} from "../registry";
import {agentRef} from "../text";

/** 改写历史的操作要求消息已落盘；尚未确认送达的用户消息在服务端可能不存在。 */
const confirmed = (message: MessageView) => message.kind !== "user" || message.delivery === undefined;

const messageActions: MessageActionEntry[] = [
    {
        id: "copy", order: 10, messageKinds: ["user", "assistant"], icon: "i-lucide-copy",
        label: agentRef("messageAction.copy"),
        // 结果是结果节点时答案在工具参数里，那条消息的正文通常为空（Spec“分轮视图”）。
        toAction: (message, {outcomeCallId}) => (outcomeCallId === null
            ? {type: "message.copy", messageId: message.id}
            : {type: "tool.copy", toolCallId: outcomeCallId}),
    },
    {
        id: "edit", order: 20, messageKinds: ["user"], icon: "i-lucide-pencil",
        label: agentRef("messageAction.edit"),
        // 补充说明不开新的一轮，退不到“它之前”。
        appliesTo: (message) => confirmed(message) && message.kind === "user" && message.intent === "normal",
        when: (ctx) => ctx.interaction.canMutateHistory && ctx.run.status === "idle",
        toAction: (message) => ({type: "message.editStart", messageId: message.id}),
    },
    {
        id: "retry", order: 30, messageKinds: ["user", "assistant"], icon: "i-lucide-rotate-cw",
        label: agentRef("messageAction.retry"),
        appliesTo: confirmed,
        when: (ctx) => ctx.interaction.canMutateHistory && ctx.run.status === "idle",
        toAction: (message) => ({type: "message.retry", messageId: message.id}),
    },
    {
        id: "branch-from", order: 40, messageKinds: ["user", "assistant"], icon: "i-lucide-git-branch-plus",
        label: agentRef("messageAction.branchFrom"),
        appliesTo: confirmed,
        when: (ctx) => ctx.interaction.canMutateHistory && ctx.run.status === "idle",
        toAction: (message) => ({type: "message.branchFrom", messageId: message.id}),
    },
];

export const builtinMessageActionsContribution: AgentViewContribution = {source: "builtin:message-actions", messageActions};
