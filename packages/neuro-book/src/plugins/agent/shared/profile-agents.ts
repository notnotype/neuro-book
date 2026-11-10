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

/**
 * 设置页改白名单（profile-settings.md 输出 25）：加声明里有的就是撤销“去掉”，加声明里没有的记成“我加的”；去掉反过来。两个数组都空时交回
 * undefined，设置里不留这一项。
 */
export function changeAgentsBinding(binding: ToolBinding | undefined, declared: readonly string[], change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}): {added: string[]; removed: string[]} | undefined {
    const added = new Set(binding?.added ?? []);
    const removed = new Set(binding?.removed ?? []);
    for (const key of change.add ?? []) {
        removed.delete(key);
        if (!declared.includes(key)) added.add(key);
    }
    for (const key of change.remove ?? []) {
        added.delete(key);
        if (declared.includes(key)) removed.add(key);
    }
    return added.size === 0 && removed.size === 0 ? undefined : {added: [...added], removed: [...removed]};
}
