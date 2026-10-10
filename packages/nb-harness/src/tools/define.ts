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
        return null;
    }
    return "risk 必须是等级、{tier, policy?, reason?} 或函数";
}

export function toolDefinitionProblem(definition: unknown): string | null {
    if (typeof definition !== "object" || definition === null) return "工具定义必须是对象";
    const d = definition as Partial<ToolDefinition>;
    if (typeof d.id !== "string" || !isValidToolId(d.id)) return "id 必须是 [a-z][a-z0-9-]* 或 <命名空间>/<名称>";
    if (typeof d.description !== "string" || d.description === "") return "description 必须是非空字符串";
    if (typeof d.parameters !== "object" || d.parameters === null || (d.parameters as {type?: unknown}).type !== "object") return "parameters 必须是 TypeBox 对象 schema";
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

/** 输出 5：没有 risk 按 exec；函数抛错按最严（exec 加询问用户）。 */
export function evaluateRisk(risk: Risk | undefined, args: unknown): RiskDecision {
    if (risk === undefined) return {tier: "exec"};
    if (typeof risk === "string") return {tier: risk};
    if (typeof risk !== "function") return {...risk};
    try {
        const decision = risk(args);
        return typeof decision === "string" ? {tier: decision} : {...decision};
    } catch (error) {
        return {tier: "exec", policy: "ask", reason: `风险函数抛出：${error instanceof Error ? error.message : String(error)}`};
    }
}

export const TIER_RANK: Readonly<Record<ToolTier, number>> = {read: 0, write: 1, exec: 2};
