import type {JsonValue} from "nbook/server/agent/messages/types";

/**
 * Agent task list 在 session custom state 中的固定 key。
 */
export const AGENT_TASKS_STATE_KEY = "agent.tasks";

/**
 * Plot 工具的当前选择状态在 session custom state 中的固定 key。
 */
export const PLOT_SELECTION_STATE_KEY = "plot.selection";

/**
 * World Engine 工具最近查询的 subject 焦点。
 */
export const WORLD_FOCUS_STATE_KEY = "world.focus";

/**
 * Agent 工作模式 reminder 状态在 session custom state 中的固定 key（Task 90）。
 * 值 shape：{mode, fromMode, phase, hasExitedPlan, reason?, workDirectory, lastTransition, approved?, updatedAt}。
 */
export const AGENT_MODE_STATE_KEY = "agent.mode";

/**
 * Agent 工作模式的前端投影 key，值为 "normal" | "discuss" | "plan"。
 */
export const AGENT_MODE_UI_STATE_KEY = "ui.agentMode";

/**
 * 等待用户 resolution 的工具表单 metadata，后缀为 toolCallId。
 */
export const AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX = "agent.pendingUserResolution.";

/**
 * Session 展示标题/摘要后台维护状态。
 */
export const SESSION_SUMMARIZER_STATE_KEY = "summarizer.state";

/**
 * Session 标题所有权。值 shape：{owner: "user" | "auto"}。
 * owner=user 表示用户手动改过名，summarizer 和 invoke title 都不再覆盖标题；
 * summarize 命令会把所有权交还给 auto。缺省视为 auto。
 */
export const SESSION_TITLE_OWNER_STATE_KEY = "session.titleOwner";

/**
 * 标题所有权状态值。所有写入方必须用该类型约束，读取统一走 readTitleOwner。
 */
export type SessionTitleOwnerState = {owner: "user" | "auto"};

/**
 * 从 session customState 读取标题所有权。缺省或值非法时视为 auto（允许自动覆盖标题）。
 */
export function readTitleOwner(customState: Record<string, JsonValue>): "user" | "auto" {
    const value = customState[SESSION_TITLE_OWNER_STATE_KEY];
    return typeof value === "object" && value !== null && !Array.isArray(value) && value.owner === "user" ? "user" : "auto";
}

/**
 * Follow-up queue 的持久投影状态，用于刷新或重建 harness 后恢复 UI snapshot。
 */
export const AGENT_FOLLOW_UP_QUEUE_STATE_KEY = "agent.followUpQueue";
