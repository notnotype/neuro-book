import type {AgentUserMessageInput, JsonValue, Usage} from "nbook/server/agent/messages/types";
import type {InvocationErrorInfo, InvocationErrorPhase, SessionEntryId, SessionMetadata} from "nbook/server/agent/session/types";
import type {AgentResolution} from "nbook/server/agent/tools/types";
import type {ClientStateSnapshot} from "nbook/server/agent/variables/types";
import type {ServerTimingSink} from "nbook/server/utils/server-timing-sink";
import type {AgentInvokeCaller} from "nbook/server/agent/harness/invocation-caller";
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
    currentProjectRoot?: string;
    parentSessionId?: number;
    /** session 类别（D15）：workflow 创建的参与者/run session 标注用；缺省 = chat。 */
    kind?: "chat" | "workflow" | "system";
    /** 寻址标签（D15）：workflow acquire 按 (profileKey, tag) 跨 run 复用等场景。 */
    tags?: string[];
};

export type CreateAgentResult = {
    sessionId: number;
    profileKey: string;
    title?: string;
};

export type InvokeAgentInput = {
    sessionId: number;
    mode: "prompt" | "continue" | "steer" | "followup";
    /** 用户提交关联 ID；prompt/steer/followup 必须存在，内部调用缺省时由 Harness 生成。 */
    clientMessageId?: string;
    message?: AgentUserMessageInput;
    payload?: JsonValue;
    /** 仅覆盖本次 invocation 使用的模型；不会写入或修改 session 默认模型。 */
    modelKey?: string;
    /** 可选展示标题；提供时会在 invocation admission 成功后写入目标 session。 */
    title?: string;
    /** 向后兼容：单个 resolution */
    resolution?: AgentResolution;
    /** 批量 resolutions，用于多个 tool approval 场景 */
    resolutions?: AgentResolution[];
    clientState?: ClientStateSnapshot;
    caller?: AgentInvokeCaller;
    block?: boolean;
    /** false 时目标忙碌即拒绝，不写入 follow-up queue；供必须独占自身生命周期的后台 Job 使用。 */
    queueIfBusy?: boolean;
    onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
    /** 内部取消传播：只绑定到本次 admission 接收的 invocation，不暴露给 HTTP DTO。 */
    signal?: AbortSignal;
    internalQueued?: boolean;
    /** follow-up durable queue item；只允许 queue drain 内部设置。 */
    sourceQueueItemId?: string;
    /** Tree 编辑/重跑的新用户 entry 显式父节点；只允许内部 preadmission 路径设置。 */
    userMessageParentId?: SessionEntryId | null;
};

/** Harness 内部 invocation 结果；结构化 data 保持完整，不直接作为 HTTP DTO 返回。 */
export type AgentInvocationResult = {
    sessionId: number;
    invocationId: string;
    status: "completed" | "waiting" | "error";
    acceptance: import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto;
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
    /**
     * true 表示这次运行是被取消的（用户点停止、父级撤销、宽限期强制收尾），不是失败。
     *
     * `status` 仍是 `"error"`，调用方默认按异常终止处理；面向用户的展示必须据此走「已停止」
     * 而不是报错，因为 `error` 里是英文技术文本（Task 139）。
     */
    aborted?: boolean;
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

export type AgentSummary = {
    sessionId: number;
    profileKey: string;
    currentProjectRoot?: string;
    title?: string;
    summary?: string;
    status: "idle";
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
