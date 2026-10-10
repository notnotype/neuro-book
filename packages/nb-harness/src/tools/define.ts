/** 工具定义的校验与风险求值（docs/specs/harness/tools.md 输出 1、5）。 */

import type {TSchema} from "typebox";
import type {Risk, RiskDecision, ToolDefinition, ToolTier} from "./types";

const BUILTIN_ID = /^[a-z][a-z0-9-]*$/u;
const PLUGIN_ID = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/u;
const TIERS: ReadonlySet<string> = new Set(["read", "write", "exec"]);

export const isValidToolId = (id: string): boolean => BUILTIN_ID.test(id) || PLUGIN_ID.test(id);

function riskShapeProblem(risk: unknown): string | null {
    if (typeof risk === "function") return null;
    if (typeof risk === "string") return TIERS.has(risk) ? null : `risk 只能是 read、write、exec：${risk}`;
    if (typeof risk === "object" && risk !== null) {
        const decision = risk as Partial<RiskDecision>;
        if (!TIERS.has(decision.tier as string)) return "risk.tier 只能是 read、write、exec";
        if (decision.policy !== undefined && decision.policy !== "deny" && decision.policy !== "ask") return "risk.policy 只能是 deny 或 ask";
        if (decision.reason !== undefined && typeof decision.reason !== "string") return "risk.reason 必须是字符串";
        return null;
    }
    return "risk 必须是等级、{tier, policy?, reason?} 或函数";
}

/** schema 里每个 pattern 都要能被 OMP 的校验器编译（它用不带 u 标志的 RegExp）；坏的正则在定义时拒绝，不等到合法调用才炸。 */
function patternProblem(schema: unknown, path = "parameters"): string | null {
    if (typeof schema !== "object" || schema === null) return null;
    for (const [key, value] of Object.entries(schema)) {
        if (key === "pattern" && typeof value === "string") {
            try {
                new RegExp(value);
            } catch (error) {
                return `${path}.pattern 不是合法正则：${error instanceof Error ? error.message : String(error)}`;
            }
        }
        const nested = patternProblem(value, `${path}.${key}`);
        if (nested !== null) return nested;
    }
    return null;
}

export function toolDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "工具定义必须是对象";
    const d = definition as Partial<ToolDefinition>;
    if (typeof d.id !== "string" || !isValidToolId(d.id)) return "id 必须是 [a-z][a-z0-9-]* 或 <命名空间>/<名称>";
    if (typeof d.description !== "string" || d.description === "") return "description 必须是非空字符串";
    if (typeof d.parameters !== "object" || d.parameters === null || (d.parameters as {type?: unknown}).type !== "object") return "parameters 必须是 TypeBox 对象 schema";
    const pattern = patternProblem(d.parameters);
    if (pattern !== null) return pattern;
    if (d.risk !== undefined) {
        const problem = riskShapeProblem(d.risk);
        if (problem !== null) return problem;
    }
    if (d.scope !== undefined && d.scope !== "session" && d.scope !== "project") return "scope 只能是 session 或 project";
    if (typeof d.execute !== "function") return "execute 必须是函数";
    return null;
}

export function defineTool<P extends TSchema>(definition: ToolDefinition<P>): ToolDefinition<P> {
    const problem = toolDefinitionProblem(definition);
    if (problem !== null) throw new TypeError(`工具定义不合规则：${problem}`);
    return Object.freeze({...definition});
}

/** 输出 5：没有 risk 按 exec；函数抛错或返回不合规则的值都按最严（exec 加询问用户）——动态返回值与静态定义过同一套形状检查。 */
export function evaluateRisk(risk: Risk | undefined, args: unknown): RiskDecision {
    if (risk === undefined) return {tier: "exec"};
    if (typeof risk === "string") return {tier: risk};
    if (typeof risk !== "function") return {...risk};
    let decision: unknown;
    try {
        decision = risk(args);
    } catch (error) {
        return {tier: "exec", policy: "ask", reason: `风险函数抛出：${error instanceof Error ? error.message : String(error)}`};
    }
    const problem = typeof decision === "function" ? "不能返回函数" : riskShapeProblem(decision);
    if (problem !== null) return {tier: "exec", policy: "ask", reason: `风险函数返回不合规则：${problem}`};
    return typeof decision === "string" ? {tier: decision as ToolTier} : {...(decision as RiskDecision)};
}

export const TIER_RANK: Readonly<Record<ToolTier, number>> = {read: 0, write: 1, exec: 2};
