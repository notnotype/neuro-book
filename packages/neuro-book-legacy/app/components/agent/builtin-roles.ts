/**
 * 内置角色：用户与 Agent。第三种角色（例如协作的子 Agent）登记到同一个“角色”扩展点。
 * 角色 id 与消息的 `kind` 对应；Agent 的头像优先用会话 Profile 的图标。
 */
import type {AgentViewContribution, RoleEntry} from "./agent-view-registry";

const roles: RoleEntry[] = [
    {id: "user", icon: "i-lucide-user", label: {key: "agentView.role.user"}, tone: "neutral"},
    {id: "assistant", icon: "i-lucide-sparkles", label: {key: "agentView.role.assistant"}, tone: "accent"},
];

export const builtinRolesContribution: AgentViewContribution = {source: "builtin:roles", roles};
