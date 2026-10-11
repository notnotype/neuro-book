/**
 * 工具：内核的工具协议、来源与可见工具、审批判定与审批模型、适配成 OMP AgentTool。行为合同见 docs/specs/harness/tools.md。
 */

export type {
    ToolResultBudget,
    AdapterHooks, ApprovalGrant, ApprovalMode, ApprovalOutcome, ApprovalRequest, Decision, JsonValue, JudgeRequest, Judgement, Risk, RiskDecision, ToolCall, ToolContext,
    ToolDefinition, ToolDescriptor, ToolInterceptor, ToolOutcome, ToolSource, ToolTier, ToolsFailure, ToolsResult,
} from "./types";
export {defineTool, evaluateRisk, toolDefinitionProblem} from "./define";
export {createStaticToolSource, describeTool, visibleTools} from "./source";
export {decideApproval, MODE_TABLE, resolveApprovalMode} from "./approval";
export {buildJudgeMessages, judgeWithModel} from "./judge";
export {toAgentTool, toAgentToolResult} from "./adapter";
export {assertToolResultBudget, DEFAULT_TOOL_RESULT_BUDGET, elideMiddle, spillToolResult} from "./spill";
