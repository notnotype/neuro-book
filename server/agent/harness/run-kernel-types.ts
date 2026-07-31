import type {AgentToolCall, AssistantMessage, JsonValue, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage, StoredToolResultMessage, StoredUserMessage} from "nbook/server/agent/messages/stored-types";
import type {AgentProfile} from "nbook/server/agent/profiles/types";
import type {ProfileRuntimeSettings} from "nbook/shared/agent/profile-runtime-settings";
import type {TSchema} from "typebox";
import type {AgentRuntimeHookStage} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext, InvocationErrorInfo, SessionEntryId, SessionSnapshot} from "nbook/server/agent/session/types";
import type {SessionWritePlan} from "nbook/server/agent/session/write-plan";
import type {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {AgentInvokeCaller, AgentInvocationResult} from "nbook/server/agent/harness/types";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import type {UserInputFormSpec} from "nbook/server/agent/tools/types";
import type {PiTraceSettings} from "nbook/server/agent/observability/traced-provider";
import type {ProfileTurnContextPlan, ProfileTurnContextSettlement} from "nbook/server/agent/profiles/profile-turn-context";
import type {Models} from "@earendil-works/pi-ai";
import type {PublicRuntimeProjectionState} from "nbook/server/agent/events/public-event-projection";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";

export type RunRuntimeState = Map<string, JsonValue>;

export type PendingSessionWritePlan = {
    toolCallIndex: number;
    toolCallId: string;
    enqueueOrder: number;
    plan: SessionWritePlan;
};

/**
 * 一次工具执行的双边界结果。
 *
 * `stored` 是 Run Kernel/JSONL/下一轮 Provider hydration 的真相；`event` 仅用于
 * Pi AgentEvent 的文本投影，禁止写回 session 或 RunFrame。
 */
export type RuntimeToolResult = {
    stored: StoredToolResultMessage;
    event: ToolResultMessage;
};

export type RunToolBatchResult = {
    toolResults: RuntimeToolResult[];
    reportResult?: AgentInvocationResult["reportResult"];
    sidecarResult?: RunSidecarToolResult;
    reportResultError?: string;
    sidecarResultError?: string;
    toolOverrides?: Record<string, NeuroAgentTool>;
    /** 向后兼容：单个 waiting approval */
    waiting?: {
        toolCallId: string;
        toolName: string;
        formSpec?: UserInputFormSpec;
    };
    /** 批量 waiting approvals */
    waitingApprovals?: Array<{
        toolCallId: string;
        toolName: string;
    }>;
    shouldContinue: boolean;
};

export type RunSidecarToolResult = {
    result: string;
    /** 旁路结构化结果；成功 report_sidecar_result 后必须存在。 */
    data?: unknown;
};

export type RuntimeHookExecutionInput = {
    sessionId: number;
    invocationId: string;
    profile: AgentProfile;
    runtimeState: RunRuntimeState;
    stage: AgentRuntimeHookStage;
    snapshot?: SessionSnapshot;
    context?: NeuroSessionContext;
    turnIndex?: number;
    pendingUserMessage?: StoredUserMessage;
    payload?: JsonValue;
    invocationMessage?: string;
    caller: AgentInvokeCaller;
    turn?: {
        assistant: AssistantMessage;
        toolResults: StoredToolResultMessage[];
        waiting?: RunToolBatchResult["waiting"];
        messageStatus?: "partial" | "interrupted" | "error";
    };
    runResult?: {
        status: "completed" | "waiting";
        finalAssistant?: AssistantMessage;
        reportResult?: AgentInvocationResult["reportResult"];
        waiting?: RunToolBatchResult["waiting"];
    };
    modelMessages?: StoredAgentMessage[];
    activeHookBuiltin?: boolean;
};

export type RuntimeHookExecutionResult = {
    requestOptionsPatch?: Record<string, JsonValue>;
    toolKeysPatch?: string[];
    transcript?: "persist" | "runtime_only";
    profilePrompt?: boolean;
    sessionContext?: boolean;
    reportResultReminder?: boolean;
    runtimeMessages: StoredAgentMessage[];
};

export type TurnIngestResult = {
    transcript: "persist" | "runtime_only";
    /** 非空表示本轮 transcript 实际写入后的末端 entry，用于 sidecar 继续追加同一条旁路分支。 */
    transcriptLeafId?: SessionEntryId | null;
};

export type CompletedRunLoopResult = {
    status: "completed";
    finalAssistant?: AssistantMessage;
    reportResult?: AgentInvocationResult["reportResult"];
    sidecarResult?: RunSidecarToolResult;
};

export type WaitingRunLoopResult = {
    status: "waiting";
    finalAssistant?: AssistantMessage;
    reportResult?: AgentInvocationResult["reportResult"];
    sidecarResult?: RunSidecarToolResult;
    waiting: NonNullable<RunToolBatchResult["waiting"]>;
};

export type FailedRunLoopResult = {
    status: "failed";
    finalAssistant?: AssistantMessage;
    errorInfo: InvocationErrorInfo;
    terminalStatus?: "error" | "aborted" | "interrupted";
};

export type RunLoopResult = CompletedRunLoopResult | WaitingRunLoopResult | FailedRunLoopResult;

export type RunTurnTransactionResult =
    | {
        kind: "next";
        shouldContinue: boolean;
    }
    | {
        kind: "waiting";
        result: RunLoopResult;
    }
    | {
        kind: "failed";
        result: RunLoopResult;
    };

export type RunKernelPhase = "model" | "ingest" | "compaction" | "settleRun" | "unknown";

export type ActiveSidecarRun = {
    name: string;
    sidecarDataSchema?: TSchema;
};

export type RunFrame = {
    invocationId?: string;
    sessionId: number;
    workspaceKey: string;
    workspaceRootRef: WorkspaceRootRef;
    workspaceFsRoot: AbsoluteFsPath;
    projectPath?: string;
    systemPrompt: string;
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    /** false 时 Provider 仍流式执行，但公开事件只在完整消息完成后发送。 */
    realtimeOutput?: boolean;
    compaction?: ProfileRuntimeSettings["compaction"];
    /** 本 run 的 Pi 请求 trace 设置，由 prepareRun 从 effective config 解析。缺省表示不追踪。 */
    piTrace?: PiTraceSettings;
    sessionContextEnabled: boolean;
    toolKeys: string[];
    /** 当前 phase 实际可执行工具；为空时等于 toolKeys。 */
    executionToolKeys?: string[];
    profileKey: string;
    profile: AgentProfile;
    /** 本 run 的 Agent 工作模式（Task 90）；只读模式下写工具注入审批。 */
    agentMode: AgentMode;
    /** Profile 显式声明的逐 turn 动态上下文。 */
    profileTurnContexts?: ProfileTurnContextPlan[];
    /** Harness 最终解析的单文件 diff 字符预算。 */
    fileChangeDiffMaxChars?: number;
    /** 已进入模型、等待成功 ingest 后结算的动态上下文交付。 */
    pendingProfileTurnContextSettlements?: ProfileTurnContextSettlement[];
    thinkingLevel: ThinkingLevel;
    runtimeState: RunRuntimeState;
    abortSignal?: AbortSignal;
    /** RunFrame 持有 durable 引用态消息；attachment 仅在 Provider 调用前 hydrate。 */
    messages: StoredAgentMessage[];
    /** prepareNextTurn 注入的下一轮临时上下文；进入一次 provider snapshot 后清空。 */
    nextTurnRuntimeMessages: StoredAgentMessage[];
    reportResult?: AgentInvocationResult["reportResult"];
    /** 当前 sidecar run 通过 report_sidecar_result 返回的结构化结果。 */
    sidecarResult?: RunSidecarToolResult;
    /** 连续 report_result 工具错误次数；成功 report_result 后清零。 */
    reportResultErrorCount: number;
    /** 最近一次 report_result 工具错误文本；用于超过错误预算后的 Runtime Error。 */
    lastReportResultError?: string;
    /** 最近一次结果工具错误的工具名；用于超过错误预算后的 Runtime Error。 */
    lastReportResultErrorTool?: "report_result" | "report_sidecar_result";
    finalAssistant?: AssistantMessage;
    turnIndex: number;
    reportResultReminderSent: boolean;
    reportResultReminderEnabled: boolean;
    caller: AgentInvokeCaller;
    /** sidecar run 强制不把 assistant/toolResult transcript 写入 session。 */
    forceRuntimeOnlyTranscript?: boolean;
    /** sidecar run 强制把 assistant/toolResult transcript 写入 session。 */
    forcePersistTranscript?: boolean;
    /** sidecar transcript 写入的父节点；为空时使用当前 active leaf。 */
    transcriptParentLeafId?: SessionEntryId | null;
    /** sidecar transcript 写入后恢复原 active leaf，避免旁路分支成为主路径。 */
    restoreLeafAfterTranscript?: boolean;
    /** transcript 写入后要恢复到的 active leaf。 */
    restoreLeafIdAfterTranscript?: SessionEntryId | null;
    /** sidecar run 默认不向公开事件流发送内部 turn 事件。 */
    suppressEvents?: boolean;
    /** sidecar run 不消费用户 steer，避免旁路吃掉主 run 的引导。 */
    disableSteer?: boolean;
    /** sidecar run 不触发自动压缩，避免旁路写入 compaction entry。 */
    disableAutomaticCompaction?: boolean;
    /** 非空表示当前 RunFrame 正在执行指定 sidecar pass。 */
    activeSidecar?: ActiveSidecarRun;
    /** 当前 turn 内已经执行过自动压缩。 */
    automaticCompactionDoneForTurn: boolean;
    lastTurnIngest?: TurnIngestResult;
    pendingWritePlans: PendingSessionWritePlan[];
    /** 当前 run 的 bounded public event 投影状态。 */
    publicEventProjection: PublicRuntimeProjectionState;
    onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
};

export type TurnSnapshot = {
    index: number;
    sessionSnapshot: SessionSnapshot;
    sessionContext: NeuroSessionContext;
    systemPrompt: string;
    /** Provider 请求前的冻结 stored truth；禁止提前投影 marker 或 hydrate base64。 */
    modelMessages: StoredAgentMessage[];
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs?: number | null;
    requestOptions?: Record<string, JsonValue>;
    realtimeOutput: boolean;
    toolKeys: string[];
    executionToolKeys: string[];
    toolOverrides: Record<string, NeuroAgentTool>;
    tools: ReturnType<AgentToolRegistry["allowed"]>;
    thinkingLevel: ThinkingLevel;
};

export type RuntimeTurn = {
    index: number;
    snapshot: TurnSnapshot;
    assistant: AssistantMessage;
    toolCalls: AgentToolCall[];
    toolResults: RuntimeToolResult[];
    reportResult?: AgentInvocationResult["reportResult"];
    sidecarResult?: RunSidecarToolResult;
    reportResultError?: string;
    sidecarResultError?: string;
    waiting?: RunToolBatchResult["waiting"];
    shouldContinue: boolean;
};

export type TurnContinuationReason = "tool" | "steer" | "report_result";

export type TurnContinuationDecision = {
    continue: boolean;
    reasons: TurnContinuationReason[];
    steeredMessages: StoredUserMessage[];
    needsReportResultReminder: boolean;
};

export type SuccessfulTurnOutcome =
    | {
        kind: "completed";
        turn: RuntimeTurn;
    }
    | {
        kind: "waiting";
        turn: RuntimeTurn;
        waiting: NonNullable<RunToolBatchResult["waiting"]>;
    };

export type FailedTurnOutcome = {
    kind: "failed";
    phase: "provider" | "tool" | "approval" | "unknown";
    errorInfo: InvocationErrorInfo;
    finalAssistant: AssistantMessage;
    partialAssistant?: AssistantMessage;
    messageStatus?: "partial" | "interrupted" | "error";
};

export type TurnOutcome = SuccessfulTurnOutcome | FailedTurnOutcome;
