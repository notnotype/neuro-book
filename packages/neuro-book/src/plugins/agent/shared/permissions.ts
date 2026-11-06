/**
 * 权限规则的存储形状（docs/specs/agent/permissions.md）：设置与项目规则文件共用，求值在 `backend/permissions`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 匹配器不进 schema：写错一个 `type` 不该让整份设置作废、把别的拒绝规则也带走。求值时算不出来，走“偏向收紧”。 */
export const RuleSchema = Type.Object({
    tool: Type.String({minLength: 1}),
    when: Type.Optional(Type.Unknown()),
    action: Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]),
    reason: Type.Optional(Type.String()),
}, {additionalProperties: false});
export const RulesSchema = Type.Array(RuleSchema);
export type Rule = Static<typeof RuleSchema>;
export type RuleAction = Rule["action"];

export type AgentMode = "normal" | "discuss" | "plan";
export const AGENT_MODES_EXTENSION = "nbook.agent.modes";
/** `switch_mode` 的提问：界面按这个 `kind` 画专门的向导，不当普通问题。 */
export const MODE_SWITCH_KIND = "mode-switch";
export interface ModeSwitchRequest {
    readonly kind: typeof MODE_SWITCH_KIND;
    readonly from: AgentMode;
    readonly to: AgentMode;
    /** 从 `plan` 切走时的计划全文。 */
    readonly plan?: string;
}
export interface ModeSwitchAnswer {
    readonly approved: boolean;
    /** 批准时同时换的审批模式；不写保持当前。 */
    readonly approvalMode?: "ask" | "allow-writes" | "auto" | "yolo";
    readonly note?: string;
}

/**
 * 审批请求 `reason` 里不是规则理由的几种：宿主换成当前语言的文字（permissions.md 输出 21）。规则的理由是用户写的，原样显示。
 * 模型转人工的理由放在前缀之后。
 */
export const MODE_ASK_REASON = "nbook.agent/mode-gate";
export const AUTO_FAILED_REASON = "nbook.agent/auto-failed";
export const AUTO_ESCALATED_PREFIX = "nbook.agent/auto-escalated:";
