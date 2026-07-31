import type {AgentUserMessageInput, JsonValue, Usage} from "nbook/server/agent/messages/types";
import type {InvocationErrorInfo, InvocationErrorPhase, SessionMetadata} from "nbook/server/agent/session/types";
import type {AgentResolution} from "nbook/server/agent/tools/types";
import type {ClientStateSnapshot} from "nbook/server/agent/variables/types";
import type {ServerTimingSink} from "nbook/server/utils/server-timing";
import type {
    AgentAbortRequestDto,
    AgentAbortResult,
    AgentActiveInvocationDto,
    AgentCommandResult,
    AgentCommandRequestDto,
    AgentFollowUpQueueStateDto,
    AgentQueuedMessageDto,
    AgentRuntimeStreamEventDto,
    AgentSessionListPageDto,
    AgentSessionListQueryDto,
    AgentSessionLiveStateDto,
    AgentSessionQueryDto,
    AgentSessionQueryResultDto,
    AgentSessionRecoveryDto,
    AgentSessionRelationsDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
} from "nbook/shared/dto/agent-session.dto";

export type CreateAgentInput = {
    profileKey: string;
    initial?: JsonValue;
    /** 可选展示标题；为空时使用 profile manifest name。 */
    title?: string;
    workspaceRoot?: string;
    workspaceKey?: string;
    projectPath?: string;
    parentSessionId?: number;
};

export type CreateAgentResult = {
    sessionId: number;
    profileKey: string;
    title?: string;
};

export type InvokeAgentInput = {
    sessionId: number;
    mode: "prompt" | "continue" | "steer" | "followup";
    message?: AgentUserMessageInput;
    payload?: JsonValue;
    /** 可选展示标题；提供时会在 invocation admission 成功后写入目标 session。 */
    title?: string;
    /** 向后兼容：单个 resolution */
    resolution?: AgentResolution;
    /** 批量 resolutions，用于多个 tool approval 场景 */
    resolutions?: AgentResolution[];
    clientState?: ClientStateSnapshot;
    caller?: AgentInvokeCaller;
    block?: boolean;
    onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
    internalQueued?: boolean;
};

/** Harness 内部 invocation 结果；结构化 data 保持完整，不直接作为 HTTP DTO 返回。 */
export type AgentInvocationResult = {
    sessionId: number;
    invocationId: string;
    status: "completed" | "waiting" | "error";
    /** Durable assistant 正文的有界调用方预览；完整内容从 session history 读取。 */
    finalMessage?: string;
    /** finalMessage 对应原始正文的 UTF-8 字节数。 */
    finalMessageBytes?: number;
    /** true 表示 finalMessage 不是完整正文。 */
    finalMessageOmitted?: boolean;
    reportResult?: {
        result: string;
        success?: boolean;
        /** Profile 的完整结构化输出；仅供内部调用者与 runtime hook 使用。 */
        data?: JsonValue;
    };
    error?: string;
    errorPhase?: InvocationErrorPhase;
    errorInfo?: InvocationErrorInfo;
    usage?: Usage;
    elapsedMs?: number;
    queuedItem?: AgentQueuedMessageDto;
};

/** Harness 内部 tree 操作结果；HTTP Adapter 必须投影其中的 invocation。 */
export type AgentTreeOperationResult = {
    status: "completed" | "invoked";
    state: AgentSessionLiveStateDto;
    invocation?: AgentInvocationResult;
};

export type AgentInvokeCallerKind = "user" | "agent" | "sidecar" | "system";

export type AgentInvokeCaller = {
    kind: AgentInvokeCallerKind;
    sessionId?: number;
    /** Agent 工具发起子调用时，记录父 invocation 身份以建立当前运行调用树。 */
    invocationId?: string;
    profileKey?: string;
    toolCallId?: string;
};

export type AgentSummary = {
    sessionId: number;
    profileKey: string;
    workspaceRoot: string;
    title?: string;
    summary?: string;
    status: "idle" | "running" | "waiting";
};

export type DetachAgentResult = {
    sessionId: number;
    status: "detached" | "already_detached" | "not_linked";
};

export type SessionRecentMessage = {
    role: SessionRecentMessageRole;
    text: string;
    timestamp?: number;
};

export type SessionRecentMessageRole = "user" | "assistant" | "toolResult";

export type SessionQueryInput = {
    sessionId?: number;
    includeRecentMessages?: boolean;
    recentMessageLimit?: number;
    recentMessageRoles?: SessionRecentMessageRole[];
    tokenBudget?: number;
};

export type SessionQueryResult = {
    metadata: SessionMetadata;
    activeLeafId: string | null;
    title?: string;
    summary?: string;
    usage?: Usage;
    linkedAgents: AgentSummary[];
    recentMessages?: SessionRecentMessage[];
};

export type AgentRuntimeState = {
    activeInvocation: AgentActiveInvocationDto | null;
    steerQueue: AgentQueuedMessageDto[];
    followUpQueue: AgentFollowUpQueueStateDto;
};

export type AgentSessionService = {
    listSessions(query?: AgentSessionListQueryDto): Promise<AgentSessionSummaryDto[]>;
    listSessionPage(query?: AgentSessionListQueryDto): Promise<AgentSessionListPageDto>;
    getSessionQuery(sessionId: number, query?: AgentSessionQueryDto, timingSink?: ServerTimingSink): Promise<AgentSessionQueryResultDto>;
    getSessionRecovery(sessionId: number, timingSink?: ServerTimingSink): Promise<AgentSessionRecoveryDto>;
    getSessionRelations(sessionId: number, timingSink?: ServerTimingSink): Promise<AgentSessionRelationsDto>;
    runCommand(sessionId: number, body: AgentCommandRequestDto, timingSink?: ServerTimingSink): Promise<AgentCommandResult>;
    moveTree(sessionId: number, body: AgentTreeRequestDto): Promise<AgentTreeOperationResult>;
    abortInvocation(sessionId: number, body?: AgentAbortRequestDto): Promise<AgentAbortResult>;
};
