/**
 * Profile 的白名单合成：Profile 声明的 `allowed`（`"all"` 是目录里的全部），加用户在 Profile 设置里加的、减用户去掉的。Skill
 * （docs/specs/agent/skills.md 的“白名单”：服务端认标签、`skills://` 的根、`$` 菜单与设置页）与表情包（docs/specs/agent/stickers.md
 * 的“白名单”：提示词里的槽与设置页）用同一套规则。设置页改白名单的写法与可派的子代理相同（`changeAgentsBinding`）。
 */

import type {ToolBinding} from "./profile-tools";

/** Profile 声明里的一种白名单（`skills`、`stickers`）。 */
export interface DeclaredAllowlist {
    readonly allowed: readonly string[] | "all";
}

/** 声明的 id：`"all"` 时取 `catalog`（当前目录的全部 id），不声明为空。 */
export function declaredAllowlist(declaration: DeclaredAllowlist | undefined, catalog: readonly string[]): readonly string[] {
    if (declaration === undefined) return [];
    return declaration.allowed === "all" ? catalog : declaration.allowed;
}

/** 白名单：声明的在前、用户加的在后，减去用户去掉的。目录里已经没有的 id 照样留着（skills.md 输出 8）。 */
export function profileAllowlist(declaration: DeclaredAllowlist | undefined, binding: ToolBinding | undefined, catalog: readonly string[]): readonly string[] {
    const allowed = new Set(declaredAllowlist(declaration, catalog));
    for (const id of binding?.added ?? []) allowed.add(id);
    for (const id of binding?.removed ?? []) allowed.delete(id);
    return [...allowed];
}
