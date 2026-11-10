/**
 * `@notnotype/nb-harness/kit/approval`：审批判定（docs/specs/agent/permissions.md）。三层规则、闸门分类与判定顺序在这里；审批者与
 * 转问由宿主给（`createApprovalHook` 的 `review`、`escalate`），审批模型是审批者的一种实现（`modelReviewer`）。
 */

export {createApprovalHook} from "./hook.js";
export type {ApprovalHookOptions} from "./hook.js";
export {decide} from "./judge.js";
export type {AskSource, Decision, GateClass, GateTexts, ModeWriteAction} from "./judge.js";
export {AUTO_REVIEW_TIMEOUT_MS, modelReviewer} from "./review.js";
export type {ModelReviewerOptions} from "./review.js";
export {evaluate, layerResult, matchesCommand, matchesTool, mergeLayers, needsSubjects} from "./rules.js";
export type {CallView, GlobExpander, PathSubject, RuleHit} from "./rules.js";
export type {Escalate, Escalation, EscalationSource, ReviewRequest, Reviewer} from "./types.js";
