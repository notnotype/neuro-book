/**
 * 贡献点 `canon.marks`（docs/specs/canon/components.md 输入的“标注种类的登记”、输出 17）与 `canon.diagnostics`
 * （canon/model.md 输入的“诊断的登记”）：贡献 id 是种类或诊断的 id，前缀由 `idPrefix: "plugin"` 核对成声明它的插件 id，
 * 声明是除 id 以外的部分。重复要看全部登记，由接收方建登记时判断。
 *
 * 只在项目入口用：单条校验要编译载荷的 JSON Schema（nb-canon 主入口），浏览器不需要。
 */

import type {ContributionDescriptor, ContributionPointDefinition} from "@notnotype/nb-runtime/plugins";
import {buildDiagnosticRegistry, buildMarkRegistry} from "@notnotype/nb-canon";
import type {DiagnosticDeclaration, MarkDeclaration} from "@notnotype/nb-canon";

export const CANON_MARKS_POINT = "canon.marks";
export const CANON_DIAGNOSTICS_POINT = "canon.diagnostics";

export type MarkContribution = Omit<MarkDeclaration, "id">;
export type DiagnosticContribution = Omit<DiagnosticDeclaration, "id">;

/**
 * 单条声明的校验：前缀已由贡献点核对，这里用一个占位的插件 id 交给 nb-canon 的登记，只看声明本身合不合规则。
 */
function declarationProblem(contribution: ContributionDescriptor, kind: "mark" | "diagnostic"): string | null {
    const declaration = contribution.declaration;
    const label = kind === "mark" ? "标注种类" : "诊断";
    if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) return `${label} ${contribution.id} 的声明必须是对象`;
    if ("id" in declaration) return `${label} ${contribution.id} 的声明里不写 id，id 就是贡献 id`;
    // 声明来自插件清单，形状未经核对：交给登记去查（它逐项核对，不信任声明的类型）。
    const probe = {...(declaration as object), id: "probe.item"};
    const [problem] = kind === "mark" ? buildMarkRegistry([{plugin: "probe", declaration: probe as MarkDeclaration}]).diagnostics : buildDiagnosticRegistry([{plugin: "probe", declaration: probe as DiagnosticDeclaration}]).diagnostics;
    return problem === undefined ? null : `${problem.path}：${problem.message}`;
}

export const marksPoint: ContributionPointDefinition<MarkContribution> = {
    id: CANON_MARKS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    validate: (contribution) => declarationProblem(contribution, "mark"),
};

export const diagnosticsPoint: ContributionPointDefinition<DiagnosticContribution> = {
    id: CANON_DIAGNOSTICS_POINT,
    implementation: "none",
    idPrefix: "plugin",
    validate: (contribution) => declarationProblem(contribution, "diagnostic"),
};
