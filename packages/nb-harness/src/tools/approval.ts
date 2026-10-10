/**
 * 审批模式与判定（docs/specs/harness/tools.md 输出 4、6）。纯函数：输入工具、参数、模式、配置与本会话内的允许，输出第一个命中的结果。
 */

import {evaluateRisk, TIER_RANK} from "./define";
import type {ApprovalGrant, ApprovalMode, Decision, ToolDefinition, ToolTier} from "./types";

export function resolveApprovalMode(input: {session?: ApprovalMode; config?: ApprovalMode; profile?: ApprovalMode; approvalRoleBound: boolean}): ApprovalMode {
    return input.session ?? input.config ?? input.profile ?? (input.approvalRoleBound ? "auto" : "write");
}

/** 模式 × 等级：放行、询问用户或交给审批模型（Spec 输出 6 的第 6 步）。 */
export const MODE_TABLE: Readonly<Record<ApprovalMode, Readonly<Record<ToolTier, "allow" | "ask" | "model">>>> = {
    "always-ask": {read: "allow", write: "ask", exec: "ask"},
    write: {read: "allow", write: "allow", exec: "ask"},
    auto: {read: "allow", write: "model", exec: "model"},
    yolo: {read: "allow", write: "allow", exec: "allow"},
};

export function decideApproval(input: {
    tool: ToolDefinition;
    args: unknown;
    mode: ApprovalMode;
    config: Readonly<Record<string, "allow" | "deny" | "ask">>;
    grants: readonly ApprovalGrant[];
}): Decision {
    const risk = evaluateRisk(input.tool.risk, input.args);
    const tier = risk.tier;
    const declared = risk.reason === undefined ? "" : `；工具说明：${risk.reason}`;
    if (risk.policy === "deny") return {outcome: "deny", tier, step: 1, reason: `工具对这组参数声明一律拒绝${declared}`};
    const configured = input.config[input.tool.id];
    if (configured === "deny") return {outcome: "deny", tier, step: 2, reason: "配置里该工具为 deny"};
    const granted = input.grants.find((grant) => grant.toolName === input.tool.id && TIER_RANK[(grant.tier ?? "read") as ToolTier] >= TIER_RANK[tier]);
    if (granted !== undefined) return {outcome: "allow", tier, step: 3, reason: `本会话内已允许 ${input.tool.id}（${granted.tier ?? "read"}）`};
    if (risk.policy === "ask") {
        return input.mode === "yolo"
            ? {outcome: "allow", tier, step: 4, reason: `工具声明要询问，yolo 模式下放行${declared}`}
            : {outcome: "ask", tier, step: 4, reason: `工具对这组参数声明要询问用户${declared}`};
    }
    if (configured === "allow") return {outcome: "allow", tier, step: 5, reason: "配置里该工具为 allow"};
    if (configured === "ask") return {outcome: "ask", tier, step: 5, reason: "配置里该工具为 ask"};
    const byMode = MODE_TABLE[input.mode][tier];
    return {outcome: byMode, tier, step: 6, reason: `${input.mode} 模式下 ${tier} 等级${byMode === "allow" ? "放行" : byMode === "ask" ? "需要用户审批" : "交给审批模型"}`};
}
