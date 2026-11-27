/**
 * 审批钩子交给宿主替换的两处：审批者（`auto` 下判出“交给审批者”的调用）与转问（所有要问人的调用交给谁回答）。判定者与回答者由
 * 宿主给，钩子不写死“用户”或“审批模型”（docs/specs/agent/permissions.md；w00043 要让另一个 bot 判定工具调用）。
 */

import type {ApprovalCtx, ApprovalVerdict, ToolCall, ToolEffect} from "../../kernel/contracts.js";
import type {PathSubject} from "./rules.js";

/** 交给审批者或转问的一次调用。 */
export interface ReviewRequest {
    readonly call: ToolCall;
    readonly effect: ToolEffect;
    /** 展开过的判定路径（全局地址）。 */
    readonly paths: readonly PathSubject[];
    /** 路径与命令之外的判定对象（工具的 `subjects` 交出的，例如截图的 `{kind: "screen"}`），原样交给审批者（permissions.md 输出 20）。 */
    readonly subjects: readonly {readonly kind: string; readonly value: string}[];
}

/** 审批者：放行、拒绝或转问。 */
export type Reviewer = (request: ReviewRequest, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;

/** 这次调用为什么要转问。 */
export type EscalationSource =
    /** 某层规则判 ask。 */
    | "rule"
    /** 项目规则读坏，写与执行一律问（permissions.md 输出 6）。 */
    | "rules-invalid"
    /** 写的地址分类为 ask（输出 7）。 */
    | "address"
    /** 模式闸门判为写、闸门动作是 ask。 */
    | "gate"
    /** 审批模式本身要问（`ask`，或 `allow-writes` 下的执行）。 */
    | "mode"
    /** 审批者转人工。 */
    | "reviewer";

export interface Escalation extends ReviewRequest {
    readonly source: EscalationSource;
    /** 给回答者看的原因串；没有时为 undefined。 */
    readonly reason?: string;
}

/** 要转问的调用交给谁回答。缺省原样交回 `{verdict: "ask", reason}`，由内核问用户。 */
export type Escalate = (escalation: Escalation, ctx: ApprovalCtx) => Promise<ApprovalVerdict>;
