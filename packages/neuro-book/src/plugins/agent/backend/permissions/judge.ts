/**
 * 一次调用的判定顺序（docs/specs/agent/permissions.md 输出 1）。纯函数：规则结果与闸门分类由调用方算好。
 * 询问分来源：闸门的询问不被放行规则与 `yolo` 改变，规则的询问在 `yolo` 下放行，所以两者不能混成一个“询问”。
 */

import type {ApprovalMode, ApprovalVerdict, ToolEffect} from "@notnotype/nb-harness/kernel/contracts";

import {MODE_ASK_REASON} from "../../shared/permissions";
import type {RuleHit} from "./rules";

/** 闸门对一次调用的分类；不在 `discuss`、`plan` 时是 null。 */
export type GateClass = "read" | "scratch" | "write";
export type ModeWriteAction = "deny" | "ask";

/** 给模型看的拒绝文字走 `params.reason`：内核把它拼进工具结果。 */
const denied = (code: string, reason?: string, by = "permissions"): ApprovalVerdict => ({verdict: "deny", rejection: {code, by, ...(reason === undefined ? {} : {params: {reason}})}});

export const MODE_BLOCKED_TEXT = "This session is in a read-only mode (discuss or plan), so this call was not run. Call switch_mode to ask the user to change modes, or use a read-only approach.";

/** `review`：`auto` 下交审批模型；模型的结论由钩子换成放行或询问（输出 19）。 */
export type Decision = ApprovalVerdict | {readonly verdict: "review"};

export function decide(input: {
    readonly rules: RuleHit | null;
    readonly gate: GateClass | null;
    readonly modeWriteAction: ModeWriteAction;
    readonly effect: ToolEffect;
    readonly approvalMode: ApprovalMode;
    /** 写工具，写路径全部落在作品与会话草稿里；只有 `auto` 看。 */
    readonly localWrite?: boolean;
}): Decision {
    const {rules, gate, effect, approvalMode} = input;
    if (rules?.action === "deny") return denied("rule-denied", rules.reason, "rule");
    if (gate === "write") {
        return input.modeWriteAction === "deny" ? denied("mode-blocked", MODE_BLOCKED_TEXT, "mode") : {verdict: "ask", reason: MODE_ASK_REASON};
    }
    if (rules?.action === "allow") return {verdict: "allow", by: "rule"};
    if (rules?.action === "ask") {
        return approvalMode === "yolo" ? {verdict: "allow", by: "mode:yolo"} : {verdict: "ask", ...(rules.reason === undefined ? {} : {reason: rules.reason})};
    }
    if (gate === "scratch") return {verdict: "allow", by: "mode:scratch"};
    if (effect === "read") return {verdict: "allow", by: "mode:read"};
    if (approvalMode === "yolo") return {verdict: "allow", by: "mode:yolo"};
    if (approvalMode === "allow-writes" && effect === "write") return {verdict: "allow", by: "mode:allow-writes"};
    if (approvalMode === "auto") return input.localWrite === true ? {verdict: "allow", by: "mode:auto"} : {verdict: "review"};
    return {verdict: "ask"};
}
