/**
 * 贡献点 `canon.components`（docs/specs/canon/components.md 输入与前置条件、输出 1）：贡献 id 是类型 id
 * （`<插件 id>.<名>`，由 `idPrefix` 核对），声明是除 id 以外的部分。声明只看它自己（内核的单条校验）：命名空间撞名
 * 要看全部登记，由接收方建登记表时判断（输出 2）。
 */

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {buildRegistry} from "@notnotype/nb-canon/schema";
import type {ComponentDeclaration} from "@notnotype/nb-canon/schema";

export const CANON_COMPONENTS_POINT = "canon.components";

export type ComponentContribution = Omit<ComponentDeclaration, "id">;

/** 一条声明连同贡献 id 交给 nb-canon 的登记校验；不过时返回原因。 */
export function componentDeclarationProblem(contribution: ContributionDescriptor): string | null {
    const declaration = contribution.declaration;
    if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) return `Component 类型 ${contribution.id} 的声明必须是对象`;
    if ("id" in declaration) return `Component 类型 ${contribution.id} 的声明里不写 id，id 就是贡献 id`;
    const [problem] = buildRegistry([{...(declaration as ComponentContribution), id: contribution.id}]).diagnostics;
    if (problem === undefined) return null;
    return problem.code === "component-declaration-invalid" ? `${problem.path}：${problem.message}` : problem.code;
}

export const componentsPoint: ContributionPointDefinition<ComponentContribution> = {
    id: CANON_COMPONENTS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    validate: componentDeclarationProblem,
};

/**
 * 内置的两个最小类型，字段只够测试与星瑕样本用；完整字段清单由 w00039 t10 定。
 */
export const BUILTIN_COMPONENTS: readonly ComponentDeclaration[] = [
    {
        id: "nbook.canon.person",
        label: "人物",
        namespace: "character",
        version: 1,
        fields: [
            {id: "外观", label: "外观", kind: "text", retold: true},
            {id: "状态", label: "状态", kind: "text"},
            {id: "态度", label: "现在的态度", kind: "text", precision: "semantic"},
        ],
    },
    {
        id: "nbook.canon.panel",
        label: "面板",
        namespace: "panel",
        version: 1,
        instanceFields: true,
    },
];
