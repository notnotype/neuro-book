/**
 * 权限规则的存储形状（docs/specs/agent/permissions.md）：设置与项目规则文件共用，求值在宿主套件。形状只有一份，在
 * `@notnotype/nb-harness/kit/shapes`，这里转出；下面是 NeuroBook 自己的 Agent 模式与原因串。
 */

export {RuleSchema, RulesSchema} from "@notnotype/nb-harness/kit/shapes";
export type {Rule, RuleAction} from "@notnotype/nb-harness/kit/shapes";

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
