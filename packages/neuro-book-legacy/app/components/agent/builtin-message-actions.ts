/**
 * 内置的消息操作：复制、编辑、重试、从此处分支。与插件走同一个“消息操作”扩展点。
 */
import type {MessageView} from "./agent-view.types";
import type {AgentViewContribution, MessageActionEntry} from "./agent-view-registry";

/** 改写历史的操作要求消息已落盘；尚未确认送达的用户消息在服务端可能不存在。 */
const confirmed = (message: MessageView) => message.kind !== "user" || message.delivery === undefined;

const messageActions: MessageActionEntry[] = [
    {
        id: "copy", order: 10, messageKinds: ["user", "assistant"], icon: "i-lucide-copy",
        label: {key: "agentView.messageAction.copy"},
        toAction: (message) => ({type: "message.copy", messageId: message.id}),
    },
    {
        id: "edit", order: 20, messageKinds: ["user"], icon: "i-lucide-pencil",
        label: {key: "agentView.messageAction.edit"},
        appliesTo: confirmed,
        when: (ctx) => ctx.interaction.canMutateHistory,
        toAction: (message) => ({type: "message.editStart", messageId: message.id}),
    },
    {
        id: "retry", order: 30, messageKinds: ["user", "assistant"], icon: "i-lucide-rotate-cw",
        label: {key: "agentView.messageAction.retry"},
        appliesTo: confirmed,
        when: (ctx) => ctx.interaction.canMutateHistory && ctx.run.status === "idle",
        toAction: (message) => ({type: "message.retry", messageId: message.id}),
    },
    {
        id: "branch-from", order: 40, messageKinds: ["user", "assistant"], icon: "i-lucide-git-branch-plus",
        label: {key: "agentView.messageAction.branchFrom"},
        appliesTo: confirmed,
        when: (ctx) => ctx.interaction.canMutateHistory && ctx.run.status === "idle",
        toAction: (message) => ({type: "message.branchFrom", messageId: message.id}),
    },
];

export const builtinMessageActionsContribution: AgentViewContribution = {source: "builtin:message-actions", messageActions};
