/**
 * 一个 Profile 能派哪些子代理（docs/specs/agent/subagents.md 的“输入与前置条件”）：Profile 声明的 `agents`，加用户在 Profile 设置里
 * 加的、减用户去掉的。服务端派发、提示词的“可派的子代理”一节与设置页用同一份，页面显示的才是派得出去的。
 */

import type {ToolBinding} from "./profile-tools";

export interface AgentsDeclaration {
    readonly allowed: readonly string[];
    readonly recommended?: readonly string[];
}

export interface ProfileAgents {
    /** 能派的 Profile key，声明的在前、用户加的在后。 */
    readonly allowed: readonly string[];
    /** 推荐的：声明里推荐、且仍在白名单里的。 */
    readonly recommended: readonly string[];
}

export function profileAgents(declaration: AgentsDeclaration | undefined, binding: ToolBinding | undefined): ProfileAgents {
    const allowed = new Set(declaration?.allowed ?? []);
    for (const key of binding?.added ?? []) allowed.add(key);
    for (const key of binding?.removed ?? []) allowed.delete(key);
    return {allowed: [...allowed], recommended: (declaration?.recommended ?? []).filter((key) => allowed.has(key))};
}
