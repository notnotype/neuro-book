/**
 * 一个 Profile 能用 `$` 带上哪些 Skill（docs/specs/agent/skills.md 的“输入与前置条件”）：Profile 声明的 `skills`（`"all"` 是
 * Skill 目录里的全部），加用户在 Profile 设置里加的、减用户去掉的。服务端认标签、`skills://` 的根、`$` 菜单与设置页用同一份。
 * 设置页改白名单的写法与可派的子代理相同（`changeAgentsBinding`）。
 */

import type {AgentProfileDeclaration} from "./points";
import type {ToolBinding} from "./profile-tools";

/** 声明的 id：`"all"` 时取 `catalog`（当前目录的全部 id），不声明为空。 */
export function declaredSkills(declaration: AgentProfileDeclaration["skills"], catalog: readonly string[]): readonly string[] {
    if (declaration === undefined) return [];
    return declaration.allowed === "all" ? catalog : declaration.allowed;
}

/** 白名单：声明的在前、用户加的在后，减去用户去掉的。目录里已经没有的 id 照样留着（skills.md 输出 8）。 */
export function profileSkills(declaration: AgentProfileDeclaration["skills"], binding: ToolBinding | undefined, catalog: readonly string[]): readonly string[] {
    const allowed = new Set(declaredSkills(declaration, catalog));
    for (const id of binding?.added ?? []) allowed.add(id);
    for (const id of binding?.removed ?? []) allowed.delete(id);
    return [...allowed];
}
