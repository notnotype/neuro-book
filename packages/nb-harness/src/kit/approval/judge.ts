/**
 * 一次调用的判定顺序（docs/specs/agent/permissions.md 输出 1）。纯函数：规则结果与闸门分类由调用方算好。
 * 询问分来源：闸门的询问不被放行规则与 `yolo` 改变，规则的询问在 `yolo` 下放行，所以两者不能混成一个“询问”；来源也交给
 * 钩子的转问（`Escalate`），宿主据此决定交给谁回答。
 */

import type {ApprovalMode, ApprovalVerdict, ToolEffect} from "../../kernel/contracts.js";
import type {RuleHit} from "./rules.js";

/** 闸门对一次调用的分类；没有闸门时是 null。 */
export type GateClass = "read" | "scratch" | "write";
export type ModeWriteAction = "deny" | "ask";

/** 闸门的文字（都进日志，宿主定）：转问时的原因串、拒绝时给模型的话。 */
export interface GateTexts {
    readonly askReason: string;
    readonly blockedText: string;
}

/** 询问是谁要的：某层规则、模式闸门，还是审批模式本身。 */
export type AskSource = "rule" | "gate" | "mode";

/** 给模型看的拒绝文字走 `params.reason`：内核把它拼进工具结果。 */
const denied = (code: string, reason?: string, by = "permissions"): Extract<ApprovalVerdict, {readonly verdict: "deny"}> => ({verdict: "deny", rejection: {code, by, ...(reason === undefined ? {} : {params: {reason}})}});

/** `review`：`auto` 下交审批者；审批者的结论由钩子换成放行或转问（输出 19）。 */
export type Decision =
    | Exclude<ApprovalVerdict, {readonly verdict: "ask"}>
    | {readonly verdict: "ask"; readonly reason?: string; readonly source: AskSource}
    | {readonly verdict: "review"};

export function decide(input: {
    readonly rules: RuleHit | null;
    readonly gate: GateClass | null;
    readonly gateTexts: GateTexts;
    readonly modeWriteAction: ModeWriteAction;
    readonly effect: ToolEffect;
    readonly approvalMode: ApprovalMode;
    /** 写工具，写路径全部落在布局的 `localWrites` 里；只有 `auto` 看。 */
    readonly localWrite?: boolean;
}): Decision {
    const {rules, gate, effect, approvalMode} = input;
    if (rules?.action === "deny") return denied("rule-denied", rules.reason, "rule");
    if (gate === "write") {
        return input.modeWriteAction === "deny" ? denied("mode-blocked", input.gateTexts.blockedText, "mode") : {verdict: "ask", reason: input.gateTexts.askReason, source: "gate"};
    }
    if (rules?.action === "allow") return {verdict: "allow", by: "rule"};
    if (rules?.action === "ask") {
        return approvalMode === "yolo" ? {verdict: "allow", by: "mode:yolo"} : {verdict: "ask", ...(rules.reason === undefined ? {} : {reason: rules.reason}), source: "rule"};
    }
    if (gate === "scratch") return {verdict: "allow", by: "mode:scratch"};
    if (effect === "read") return {verdict: "allow", by: "mode:read"};
    if (approvalMode === "yolo") return {verdict: "allow", by: "mode:yolo"};
    if (approvalMode === "allow-writes" && effect === "write") return {verdict: "allow", by: "mode:allow-writes"};
    if (approvalMode === "auto") return input.localWrite === true ? {verdict: "allow", by: "mode:auto"} : {verdict: "review"};
    return {verdict: "ask", source: "mode"};
}
