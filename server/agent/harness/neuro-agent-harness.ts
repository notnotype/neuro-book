import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile} from "node:fs/promises";
import {basename, join, normalize, relative, resolve} from "node:path";
import type {AgentEvent} from "@earendil-works/pi-agent-core";
import {clampThinkingLevel, validateToolArguments} from "@earendil-works/pi-ai";
import type {Models} from "@earendil-works/pi-ai";
import {Value} from "typebox/value";
import type {AgentMessage, AgentToolCall, AgentUserMessageInput, AssistantMessage, JsonValue, Message, Model, ThinkingLevel, ToolResultMessage} from "nbook/server/agent/messages/types";
import {
    createStoredTextToolResult,
    createStoredToolResultFromResult,
    createStoredUserMessage,
    createTextToolResult,
    createToolResultFromResult,
    messageText,
} from "nbook/server/agent/messages/message-utils";
import {storedMessageForText, storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import type {
    StoredAgentMessage,
    StoredAgentUserMessageInput,
    StoredContent,
    StoredFollowUpQueueItem,
    StoredFollowUpQueueState,
    StoredToolResultMessage,
    StoredUserMessage,
} from "nbook/server/agent/messages/stored-types";
import {
    encodeFollowUpQueue,
    parseFollowUpQueue,
    parseStoredMessage,
    parseStoredMessages,
} from "nbook/server/agent/messages/stored-message-codec";
import {
    appendInvocationPayload,
    storedInputMarkdown,
    storedUserMessageMarkdown,
    wrapStoredSteerContent,
} from "nbook/server/agent/messages/stored-user-markdown";
import {AgentInvocationPayloadError, AgentProfileCatalog, type AgentProfileRuntimeResolution} from "nbook/server/agent/profiles/catalog";
import {StableAttachmentSnapshotReader} from "nbook/server/agent/attachments/stable-attachment-snapshot-reader";
import {assertTypeBoxValue} from "nbook/server/agent/profiles/schema-validation";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {summarizerProfile} from "nbook/server/agent/profiles/summarizer-profile";
import {adhocAgentProfile} from "nbook/server/agent/profiles/adhoc-profile";
import type {AgentProfile, ProfileTurnPlan} from "nbook/server/agent/profiles/types";
import {compileProfileSystemPrompt, validateProfileTurnPlan} from "nbook/server/agent/profiles/profile-dsl";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import {buildAgentHistoryPage} from "nbook/server/agent/session/history-query";
import {buildAgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {projectRelatedSessions} from "nbook/server/agent/session/relation-projection";
import {SessionWriteExecutor} from "nbook/server/agent/session/write-plan";
import type {AppendManySessionEntryDraft, SessionWriteEntryBatch, SessionWritePlan, SessionWriteResult, SessionWriteTimingSink} from "nbook/server/agent/session/write-plan";
import {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import {relationLedgerChange} from "nbook/server/agent/session/relation-ledger";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY, AGENT_MODE_STATE_KEY, AGENT_MODE_UI_STATE_KEY, AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX, SESSION_SUMMARIZER_STATE_KEY, SESSION_TITLE_OWNER_STATE_KEY, readTitleOwner, type SessionTitleOwnerState} from "nbook/server/agent/session/custom-state-keys";
import type {InvocationErrorInfo, InvocationErrorPhase, ModelChangeEntry, NeuroSessionContext, SessionEntry, SessionEntryDraft, SessionEntryId, SessionMetadata, SessionSnapshot} from "nbook/server/agent/session/types";
import {SessionCurrentProjectError} from "nbook/server/agent/session/current-project-error";
import {canonicalSessionModel, projectSessionModelRef, sessionModelsEqual} from "nbook/server/agent/session/session-model";
import type {DurableSessionModelRef} from "nbook/server/agent/session/session-model-redaction";
import type {AgentRuntimeHook, AgentRuntimeHookResult, RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import {SkillCatalog} from "nbook/server/agent/skills/skill-catalog";
import {WorkflowCatalog} from "nbook/server/agent/workflow/workflow-catalog";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";
import {findPendingApprovalCall, findPendingApprovalCalls, resolutionToToolResult} from "nbook/server/agent/tools/approval";
import {assertPublicToolCallId} from "nbook/shared/agent/public-tool-identity";
import {
    listProjects,
    openProject,
    registerAgentPresenceProbe,
    requireActiveReadyProject,
    runReadyProjectOperation,
    startReadyProjectOperation,
} from "nbook/server/workspace-files/project-session";
import {createBuiltinTools, createReportResultTool} from "nbook/server/agent";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {isAgentToolDefinition} from "nbook/server/agent/tools/types";
import type {AgentResolution, NeuroAgentTool, NeuroToolResult, ToolExecutionContext, ToolExecutionMode, UserInputFormSpec} from "nbook/server/agent/tools/types";
import {projectRuntimeEvent} from "nbook/server/agent/events/public-event-projection";
import {projectAgentChatEntry} from "nbook/server/agent/events/public-chat-entry-projection";
import {publicAgentUserInputFormSpec} from "nbook/server/agent/events/public-user-input-form";
import {type AgentQueuedInvocationTruth, projectQueuedMessage, projectQueuedMessages} from "nbook/server/agent/events/public-queue-projection";
import {createPublicProjectionBudget, projectPublicToolArgs, projectPublicToolName, type PublicProjectionBudget, textPreview} from "nbook/server/agent/events/public-tool-projection";
import {PUBLIC_TOOL_ARGS_TEXT_BYTES} from "nbook/server/agent/events/public-event-policy";
import {projectPublicSessionSummarizerState, projectPublicSessionSummary} from "nbook/server/agent/events/public-session-projection";
import {assertPublicClientVariablePatch, projectPublicControlReason} from "nbook/server/agent/events/public-control-event-projection";
import {projectPublicFinalMessage} from "nbook/server/agent/events/public-invocation-result-projection";
import {appendCompaction, compactIfNeeded, resolveCompactionOptions, resolveCompactionTriggerTokens} from "nbook/server/agent/harness/compaction";
import {resolveAgentVisibleModels} from "nbook/server/agent/harness/agent-visible-models";
import type {
    PendingSessionWritePlan,
    RunFrame,
    RunLoopResult,
    RunRuntimeState,
    RunToolBatchResult,
    RunTurnTransactionResult,
    RuntimeHookExecutionInput,
    RuntimeHookExecutionResult,
    RuntimeToolResult,
    RuntimeTurn,
    TurnContinuationDecision,
    TurnIngestResult,
    TurnOutcome,
    TurnSnapshot,
} from "nbook/server/agent/harness/run-kernel-types";
import {resolveTurnContinuation} from "nbook/server/agent/harness/turn-continuation";
import {createFailedTurnIngestDraft, createRuntimeErrorAssistant, sanitizePartialAssistant, sanitizeProviderAssistant} from "nbook/server/agent/harness/turn-failure";
import {applyFailedTurnTransaction, applySuccessfulTurnTransaction} from "nbook/server/agent/harness/turn-transaction";
import {applyNextTurnPreparation} from "nbook/server/agent/harness/prepare-next-turn";
import {assertValidProfileStateWrite, buildPromptPrefixAttribution, compilePrepareRunWritePlan} from "nbook/server/agent/harness/prepare-run";
import {toRunKernelErrorInfo, withRunKernelPhase} from "nbook/server/agent/harness/run-kernel-error";
import {consumeNextTurnModelMessages, createRunFrame} from "nbook/server/agent/harness/run-frame-state";
import {isEmptyObjectSchema, isReportResultBinding, reportResultSchemaForProfile} from "nbook/server/agent/profiles/report-result-schema";
import {resolveRuntimeProfileSettings} from "nbook/server/agent/profiles/profile-settings";
import {createLayeredProfileHomeFacade, ensureGlobalProfileHome, ensureProfileHome, type ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {assemblePersistedProfilePromptMessages} from "nbook/server/agent/profiles/prompt-order";
import {
    materializeProfileTurnContexts,
    mergeProfileTurnContextMessages,
    settleProfileTurnContexts,
    type ProfileTurnContextSettlement,
} from "nbook/server/agent/profiles/profile-turn-context";
import {resolvePiApiKeyForModelFromConfig, resolvePiModelFromConfig} from "nbook/server/agent/harness/model-resolver";
import {resolvePiModelsFromConfig} from "nbook/server/agent/harness/pi-runtime-resolver";
import {mergePiRequestHeaders, parsePiSimpleRequestOptions, piRequestAuthOptions} from "nbook/server/agent/harness/pi-request-options";
import {planModeDirectory, planModeToolDirectory, resolvePlanModeFile} from "nbook/server/agent/plan-mode-path";
import {projectSqlSchemaSummary} from "nbook/server/agent/tools/project-sql-schema-summary";
import {absoluteFsPath, relativeFilePathInside, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    canonicalProjectLocator,
    isProjectLifecycleError,
    ProjectLifecycleError,
    projectWorkspaceRef,
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolveSystemNbookRoot} from "nbook/server/workspace-files/system-workspace-assets";
import {resolveProfileSummarizer} from "nbook/server/agent/profiles/profile-summarizer";
import {resolveProfileRuntimeSettings as resolveRuntimeSettings} from "nbook/server/agent/profiles/profile-runtime-settings";
import type {ProfileRuntimeSettings} from "nbook/shared/agent/profile-runtime-settings";
import {extractPatchTargetPaths} from "nbook/server/agent/tools/apply-patch";
import {isReadonlyMode, type AgentMode} from "nbook/shared/dto/agent-session.dto";
import type {EffectiveConfig, RuntimeConfigTarget} from "nbook/server/config/types";
import {runProjectFileOperation} from "nbook/server/workspace-files/project-data-plane-guard";
import type {
    AgentSummary,
    AgentInvocationResult,
    AgentTreeOperationResult,
    DetachAgentResult,
    CreateAgentInput,
    CreateAgentResult,
    InvokeAgentInput,
    SessionQueryResult,
    SessionQueryInput,
    SessionRecentMessageRole,
} from "nbook/server/agent/harness/types";
import type {AgentInvokeCaller, AgentMessageIdentity} from "nbook/server/agent/harness/invocation-caller";
import type {
    AgentAbortRequestDto,
    AgentAbortResult,
    AgentActiveInvocationDto,
    AgentCommandRequestDto,
    AgentCommandResult,
    AgentFollowUpQueueStateDto,
    AgentPendingApprovalDto,
    AgentRuntimeStreamEventDto,
    AgentSessionContextUsageDto,
    AgentSessionAttachmentItemDto,
    AgentSessionAttachmentListQueryDto,
    AgentSessionAttachmentPageDto,
    AgentSessionEventDto,
    AgentSessionEventsQueryDto,
    AgentSessionListPageDto,
    AgentSessionListQueryDto,
    AgentSessionLiveStateDto,
    AgentSessionProfileAvailability,
    AgentSessionQueryDto,
    AgentSessionQueryResultDto,
    AgentSessionRecoveryDto,
    AgentSessionRelationsDto,
    AgentSessionSummarizerStateDto,
    AgentSessionSummaryDto,
    AgentTreeRequestDto,
    AgentUserMessageContentDto,
} from "nbook/shared/dto/agent-session.dto";
import {AgentSessionEventHub, type AgentSessionEventSubscription} from "nbook/server/agent/events/session-event-hub";
import {createProfileVariableAccessor} from "nbook/server/agent/variables/accessor";
import {normalizeClientState} from "nbook/server/agent/variables/accessor";
import {createVariableRegistryForProfile, createVariableRegistryForSession} from "nbook/server/agent/variables/profile-registry";
import type {ClientStateSnapshot, ProfileVariableAccessor, VariableInvocationState, VariableJsonPatchOperation, VariablePatchAck, VariablePatchRequest} from "nbook/server/agent/variables/types";
import {appLogger} from "nbook/server/app-logs/logger";
import {PiRequestRecorder} from "nbook/server/agent/observability/pi-request-recorder";
import type {PiTraceCorrelation, PiTraceKind} from "nbook/server/agent/observability/pi-request-recorder";
import {tracedStreamSimple} from "nbook/server/agent/observability/traced-provider";
import {aggregateSegmentLabels, buildTraceSegments, computeToolsHash, type PromptPrefixAttribution} from "nbook/server/agent/observability/trace-segments";
import {buildContextDiagnostics} from "nbook/server/agent/observability/context-diagnostics";
import {emptyContextFacts, resolveModelCacheRetention, timelineDto} from "nbook/server/agent/observability/context-inspection";
import {PiTraceReader} from "nbook/server/agent/observability/pi-trace-reader";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";
import type {PiTraceBinding, PiTraceSettings} from "nbook/server/agent/observability/traced-provider";
import type {ServerTimingSink} from "nbook/server/utils/server-timing-sink";
import {LowCodeFormDtoSchema} from "nbook/shared/dto/low-code-form.dto";
import {ProfileBuildCoordinator} from "nbook/server/agent/profiles/profile-build-coordinator";
import {providerErrorText} from "nbook/server/agent/observability/provider-error-sanitizer";
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {LocalAttachmentBlobAdapter} from "nbook/server/agent/attachments/local-attachment-blob-adapter";
import {AgentAttachmentCodec, canonicalImageMime} from "nbook/server/agent/attachments/agent-attachment-codec";
import {hasStoredAttachment, storedMessagesForText} from "nbook/server/agent/attachments/agent-attachment-codec";
import {SessionAttachmentAuthority} from "nbook/server/agent/attachments/session-attachment-authority";
import {estimateStoredContextTokens} from "nbook/server/agent/messages/stored-message-tokens";
import type {AttachmentId, AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {attachmentIdFromMarkdownTarget, parseAgentImageMarkdown, serializeAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import {sessionInteraction} from "nbook/shared/agent/session-interaction-policy";

type HarnessOptions = ({
    repo: JsonlSessionRepository;
    /** 生产Adapter显式传入；测试可只注入已隔离的repo。 */
    runtimePaths?: RuntimePaths;
} | {
    repo?: never;
    /** 没有显式Repository时，RuntimePaths决定唯一Workspace Root。 */
    runtimePaths: RuntimePaths;
}) & {
    profiles?: AgentProfileCatalog;
    skills?: SkillCatalog;
    workflows?: WorkflowCatalog;
    jobs?: AgentJobManager;
    tools?: AgentToolRegistry;
    modelResolver?: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    /** 为当前冻结配置创建或选择 Pi Models runtime。 */
    runtimeResolver?: (config: Pick<EffectiveConfig, "models">, model: Model<any>) => Models;
    eventHub?: AgentSessionEventHub;
    /** 调试和测试时可强制 turn 内工具全串行；默认按 tool.executionMode 调度。 */
    toolExecution?: ToolExecutionMode;
    /** 测试可关闭后台 summarizer，避免 fire-and-forget 消耗 faux provider 响应；生产默认开启。 */
    enableSessionSummarizer?: boolean;
    /** HTTP runtime 开启 profile 文件 watcher；测试和脚本默认不开启，避免短生命周期句柄泄漏。 */
    watchProfiles?: boolean;
    /** 测试或替代存储后端可注入；生产默认使用 Workspace Root Local Adapter。 */
    attachmentStore?: AttachmentStore;
};

const REPORT_RESULT_ERROR_LIMIT = 3;
/** provider/tool 收到 AbortSignal 后自行收尾的宽限期；超时后由 Harness fencing 强制收口。 */
const INVOCATION_ABORT_GRACE_MS = 150;

type SessionSummarizerState = {
    sessionId?: number;
    profileKey?: string;
    summarizerInputFingerprint?: string;
    running?: boolean;
    dirty?: boolean;
    sourceLeafId?: SessionEntryId | null;
    sourcePromptUserTurnCount?: number;
    lastDialogueContentFingerprint?: string;
    lastDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningDialogueContentTokens?: number;
    runningSourcePromptUserTurnCount?: number;
    lastRunAt?: number;
    lastError?: string;
};

type SessionSummarizerJob = {
    promise: Promise<void>;
    rerunRequested: boolean;
    /** true 表示下一轮以 force 语义运行：跳过 fingerprint 判定并绕过配置禁用（用户显式 summarize 命令）。 */
    forceRequested: boolean;
};

type PendingApprovalLookup = ReturnType<typeof findPendingApprovalCalls>;

type DrainedSteers = {
    messages: StoredUserMessage[];
    /** 存在表示Steer已写入session，下一条transcript必须接在此leaf之后。 */
    leafId?: SessionEntryId;
};

type PendingUserResolutionState = {
    toolCallId: string;
    toolName: string;
    formSpec?: {
        form: JsonValue;
        layout?: "dialog" | "inline" | "fullscreen";
        prompt?: string;
    };
};

type PreparedRunProfile = {
    plan: ProfileTurnPlan;
    writePlan?: SessionWritePlan;
    turnContextSettlements: ProfileTurnContextSettlement[];
    runtimeSettings: ProfileRuntimeSettings;
};

type PreparedInvocationPayload = {
    payload?: JsonValue;
    message?: string;
};

type PreparedRun = {
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
    profile: AgentProfile;
    prepared: ProfileTurnPlan;
    systemPrompt: string;
    messages: StoredAgentMessage[];
    /** messages 前缀的分区归因（Task 126 可观测）。 */
    promptPrefix: PromptPrefixAttribution;
    models: Models;
    model: Model<any>;
    apiKey?: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
    compaction?: ProfileRuntimeSettings["compaction"];
    fileChangeDiffMaxChars?: number;
    piTrace?: PiTraceSettings;
    sessionContextEnabled: boolean;
    toolKeys: string[];
    executionToolKeys?: string[];
    thinkingLevel: ThinkingLevel;
    reportResultReminderEnabled: boolean;
    turnContextSettlements: ProfileTurnContextSettlement[];
};

type InvocationAdmission = {
    snapshot: SessionSnapshot | null;
    pendingUserMessage: StoredUserMessage | null;
    pendingInvocationMessage: string | undefined;
    pendingPayload: JsonValue | undefined;
    pendingResolutions: AgentResolution[];
    currentInvocation: AgentActiveInvocationDto | null;
    /** 本次 running 段在权威 admission 中捕获的精确 Project generation；Workspace Root invocation 为 null。 */
    currentProject: ReadyProjectSessionRef | null;
    invocationId: string;
    abortController: AbortController;
    runtimeState: RunRuntimeState;
    isResume: boolean;
    acceptance: InvocationAcceptanceTracker;
} | {
    queued: AgentInvocationResult;
};

/** accepted invocation 的外部完成边界；cancel API 用它区分“signal 已发出”和“运行态已释放”。 */
type InvocationCompletion = {
    promise: Promise<void>;
    settled: boolean;
    resolve(): void;
};

/** 强制取消结果通道；底层 Promise 不合作时让公开 invoke 调用有界返回。 */
type InvocationAbortGate = {
    promise: Promise<AgentInvocationResult>;
    resolve(result: AgentInvocationResult): void;
};

type SessionRuntimeProjection = {
    snapshot: SessionSnapshot;
    context: NeuroSessionContext;
    profile: AgentProfile | null;
    profileAvailability: AgentSessionProfileAvailability;
    profileIssueMessage?: string;
    baseSummary: AgentSessionSummaryDto;
    summary: AgentSessionSummaryDto;
    pendingApprovals: PendingApprovalLookup;
    activeInvocation: AgentActiveInvocationDto | null;
};

type TranscriptReplayAnchor = {
    invocationId?: string;
    turnIndex: number;
    after: number;
    firstSeq: number;
};

type SessionRelationIndexLink = {
    ownerSessionId: number;
    targetSessionId: number;
    profileKey: string;
    detached: boolean;
};

type SessionRelationIndex = {
    ownerToLinked: Map<number, Map<number, SessionRelationIndexLink>>;
    targetToOwners: Map<number, Map<number, SessionRelationIndexLink>>;
    archivedSessionIds: Set<number>;
};

type PendingRelationIndexEntries = {
    ownerSessionId: number;
    entries: SessionEntry[];
};

type AgentOperationTiming = {
    readSession: number;
    reduce: number;
    profileRuntime: number;
    /** 只统计 durable append、session_entry publish 和 after-write observer，不包含 live state。 */
    writePlan: number;
    /** 只统计 live state projection 和 session_state_changed publish。 */
    liveState: number;
    relations: number;
    snapshotSystemPrompt: number;
    total: number;
};

type AgentOperationTimingKey = Exclude<keyof AgentOperationTiming, "total">;

const AGENT_TIMING_KEYS: Array<keyof AgentOperationTiming> = [
    "readSession",
    "reduce",
    "profileRuntime",
    "writePlan",
    "liveState",
    "relations",
    "snapshotSystemPrompt",
    "total",
];

const AGENT_COMMAND_SLOW_MS = 500;
const AGENT_RELATIONS_SLOW_MS = 500;
const AGENT_SNAPSHOT_SLOW_MS = 1000;

function createAgentOperationTiming(): AgentOperationTiming {
    return {
        readSession: 0,
        reduce: 0,
        profileRuntime: 0,
        writePlan: 0,
        liveState: 0,
        relations: 0,
        snapshotSystemPrompt: 0,
        total: 0,
    };
}

async function measureAgentTimingStep<T>(
    timing: AgentOperationTiming | undefined,
    key: AgentOperationTimingKey,
    task: () => Promise<T>,
): Promise<T> {
    if (!timing) {
        return task();
    }
    const startedAt = performance.now();
    try {
        return await task();
    } finally {
        timing[key] += performance.now() - startedAt;
    }
}

function measureAgentTimingStepSync<T>(
    timing: AgentOperationTiming | undefined,
    key: AgentOperationTimingKey,
    task: () => T,
): T {
    if (!timing) {
        return task();
    }
    const startedAt = performance.now();
    try {
        return task();
    } finally {
        timing[key] += performance.now() - startedAt;
    }
}

function roundAgentOperationTiming(timing: AgentOperationTiming): AgentOperationTiming {
    return AGENT_TIMING_KEYS.reduce((result, key) => {
        result[key] = Math.round(timing[key] * 100) / 100;
        return result;
    }, createAgentOperationTiming());
}

/**
 * Neuro Book 自有 Agent Harness。它拥有 session/profile/tool 语义，底层使用 Pi Agent loop。
 */
type FollowUpQueueTruthState = StoredFollowUpQueueState;

/** invocation 在进入 admission 前必须明确区分 raw HTTP/tool 输入与已持久化输入。 */
type InvocationSource =
    | {kind: "raw"; message?: AgentUserMessageInput}
    | {kind: "stored"; message?: StoredAgentUserMessageInput};

/** Harness 内部统一调用输入；stored 分支只能由已经完成 attachment admission 的路径构造。 */
type InvocationCoreInput = Omit<InvokeAgentInput, "message"> & {
    source: InvocationSource;
};

type PreparedInvocationInput = {
    clientMessageId: string;
    message?: StoredAgentUserMessageInput;
    payload?: JsonValue;
    modelKey?: string;
    messageIdentity: AgentMessageIdentity;
};

/** invocation 内可由 durable user entry commit 单向推进的 admission receipt。 */
type InvocationAcceptanceTracker = {
    value: import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto;
};

/** Session mutation 临界区内发现 invocation 已不再允许时，携带稳定 receipt 返回。 */
class InvocationAdmissionRejected extends Error {
    constructor(readonly result: AgentInvocationResult) {
        super(result.error ?? "Agent invocation admission rejected");
        this.name = "InvocationAdmissionRejected";
    }
}

export class NeuroAgentHarness {
    readonly repo: JsonlSessionRepository;
    /** Harness所有managed session共享的物理Workspace Root。 */
    readonly workspaceRoot: AbsoluteFsPath;
    /** 生产运行时的完整根集合；仅注入repo的隔离测试可以为空。 */
    readonly runtimePaths?: RuntimePaths;
    /** 全局唯一 recorder 实例；trace 的写入与 clearBucket 都必须走它的串行队列（route 不得另建）。 */
    readonly piTraceRecorder: PiRequestRecorder;
    readonly profiles: AgentProfileCatalog;
    readonly skills: SkillCatalog;
    readonly workflows: WorkflowCatalog;
    /** 统一后台任务管理器（Task 111 PLAN-E）：workflow/bash/invoke 的非阻塞执行与回流 */
    readonly jobs: AgentJobManager;
    readonly tools: AgentToolRegistry;
    readonly eventHub: AgentSessionEventHub;
    private readonly attachmentStore: AttachmentStore;
    readonly attachmentCodec: AgentAttachmentCodec;
    readonly sessionAttachments: SessionAttachmentAuthority;
    private readonly attachmentSnapshotReader: StableAttachmentSnapshotReader;
    private readonly writeExecutor: SessionWriteExecutor;
    private readonly modelResolver: (config: Pick<EffectiveConfig, "agent" | "models">, profileKey: string, override?: {modelKey?: string | null} | null) => Model<any>;
    private readonly runtimeResolver: (config: Pick<EffectiveConfig, "models">, model: Model<any>) => Models;
    private readonly toolExecution: ToolExecutionMode;
    private readonly enableSessionSummarizer: boolean;
    private readonly activeInvocations = new Map<number, AgentActiveInvocationDto>();
    /** agent 在场探针的内存事实（仅本进程运行期，不落盘）：sessionId -> invocation 捕获的 ready generation。 */
    private readonly activeInvocationProjects = new Map<number, ReadyProjectSessionRef>();
    /** 当前 running 段登记的精确 Project generation operation；durable waiting 时释放。 */
    private readonly invocationProjectOperations = new Map<string, ReadyProjectSessionRef>();
    private readonly steerableSessions = new Set<number>();
    private readonly steerQueues = new Map<number, AgentQueuedInvocationTruth[]>();
    private readonly followUpQueues = new Map<number, FollowUpQueueTruthState>();
    private readonly abortControllers = new Map<number, AbortController>();
    /** accepted running 段的 settle/fence 控制面，waiting 后 resume 会以同一 invocationId 新建。 */
    private readonly invocationCompletions = new Map<string, InvocationCompletion>();
    private readonly invocationAbortGates = new Map<string, InvocationAbortGate>();
    private readonly invocationAcceptances = new Map<string, InvocationAcceptanceTracker>();
    private readonly invocationClientStates = new Map<string, ClientStateSnapshot | undefined>();
    private readonly invocationVariableStates = new Map<string, VariableInvocationState>();
    private readonly invocationRuntimeStates = new Map<string, RunRuntimeState>();
    /** waiting/resume 期间保留 invocation 级模型覆盖；terminal 时随 invocation 状态一并释放。 */
    private readonly invocationModelOverrides = new Map<string, string>();
    /** 每个 Session 的 mutation 临界区；状态读取、interaction admission 与提交必须在同一区间完成。 */
    private readonly sessionMutationQueues = new Map<number, Promise<void>>();
    private readonly summarizerRuns = new Map<number, SessionSummarizerJob>();
    /** 不阻塞请求返回的普通后台任务；Harness关闭前必须全部结束。 */
    private readonly backgroundTasks = new Set<Promise<void>>();
    private readonly transcriptReplayAnchors = new Map<number, TranscriptReplayAnchor>();
    /** 关系生命周期是低频控制面操作；单进程内串行化 create/link、detach 与 archive。 */
    private relationMutationTail: Promise<void> = Promise.resolve();
    private sessionRelationIndex: SessionRelationIndex | null = null;
    private sessionRelationIndexLoad: Promise<SessionRelationIndex> | null = null;
    private pendingRelationIndexEntries: PendingRelationIndexEntries[] = [];
    private readonly profileBuildCoordinator?: ProfileBuildCoordinator;
    private readonly pendingClientPatches = new Map<string, {
        request: VariablePatchRequest;
        resolve: (ack: VariablePatchAck) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    constructor(options: HarnessOptions) {
        if (!("repo" in options) && !("runtimePaths" in options)) {
            throw new Error("Agent Harness必须显式提供隔离Repository或RuntimePaths");
        }
        this.runtimePaths = options.runtimePaths;
        this.repo = options.repo
            ? options.repo
            : new JsonlSessionRepository(options.runtimePaths.workspaceRoot);
        this.workspaceRoot = absoluteFsPath(this.repo.rootWorkspace);
        if (options.runtimePaths && relative(options.runtimePaths.workspaceRoot, this.workspaceRoot) !== "") {
            throw new Error("Agent Harness repo与RuntimePaths.workspaceRoot不一致");
        }
        this.piTraceRecorder = new PiRequestRecorder({
            tracesRoot: this.repo.tracesRoot,
            onWriteError: (error) => {
                void appLogger.warn("agent.piTrace.writeFailed", {error: error instanceof Error ? error.message : String(error)});
            },
        });
        const systemNbookRoot = options.runtimePaths
            ? resolveSystemNbookRoot(options.runtimePaths.applicationRoot)
            : absoluteFsPath(join(this.workspaceRoot, ".nbook", "agent", "system"));
        const userNbookRoot = options.runtimePaths?.userNbookRoot
            ?? absoluteFsPath(join(this.workspaceRoot, ".nbook"));
        this.profiles = options.profiles ?? new AgentProfileCatalog(
            join(systemNbookRoot, "agent", "profiles"),
            join(userNbookRoot, "agent", "profiles"),
        );
        this.skills = options.skills ?? new SkillCatalog(
            join(systemNbookRoot, "agent", "skills"),
            join(userNbookRoot, "agent", "skills"),
        );
        this.workflows = options.workflows ?? new WorkflowCatalog(
            join(systemNbookRoot, "agent", "workflows"),
            join(userNbookRoot, "agent", "workflows"),
        );
        // 后台任务管理器（PLAN-E）：登记表随 Workspace Root .nbook 走；启动恢复在构造尾部 fire-and-forget
        this.jobs = options.jobs ?? new AgentJobManager(() => this, join(this.workspaceRoot, ".nbook", "agent", "jobs.jsonl"));
        this.tools = options.tools ?? new AgentToolRegistry();
        this.eventHub = options.eventHub ?? new AgentSessionEventHub();
        this.attachmentStore = options.attachmentStore ?? new AttachmentStore(new LocalAttachmentBlobAdapter(this.repo.attachmentsRoot));
        this.attachmentCodec = new AgentAttachmentCodec(this.attachmentStore);
        this.sessionAttachments = new SessionAttachmentAuthority(this.repo);
        this.attachmentSnapshotReader = new StableAttachmentSnapshotReader(
            absoluteFsPath(this.repo.attachmentsRoot),
            AGENT_IMAGE_POLICY.maxImageBytes,
        );
        this.writeExecutor = new SessionWriteExecutor({
            repo: this.repo,
            eventHub: this.eventHub,
            liveStateProvider: (sessionId) => this.getSessionLiveState(sessionId),
            onEntriesWritten: async (batch) => {
                this.trackRelationIndexEntries(batch);
                if (await this.sessionAttachments.onEntriesWritten(batch)) {
                    this.publishSessionAttachmentsChanged(batch.sessionId);
                }
            },
            invocationWriteAllowed: (sessionId, invocationId) => this.ownsInvocation(sessionId, invocationId),
        });
        this.modelResolver = options.modelResolver ?? resolvePiModelFromConfig;
        this.runtimeResolver = options.runtimeResolver ?? resolvePiModelsFromConfig;
        this.toolExecution = options.toolExecution ?? "parallel";
        this.enableSessionSummarizer = options.enableSessionSummarizer ?? true;
        this.profiles.register(defaultAgentProfile);
        this.profiles.register(summarizerProfile);
        this.profiles.register(adhocAgentProfile);
        if (options.watchProfiles) {
            this.profiles.enableRuntimeRegistry();
            this.profileBuildCoordinator = new ProfileBuildCoordinator({
                catalog: this.profiles,
            });
            this.profiles.attachBuildCoordinator(this.profileBuildCoordinator);
            const startup = this.profiles.refreshRuntimeRegistry("startup").then(() => this.profileBuildCoordinator?.bootSweep()).catch((error) => {
                void appLogger.warn("agent.profileBuild.bootSweepFailed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            this.startBackgroundTask("profile-runtime-startup", startup);
        }
        for (const tool of createBuiltinTools()) {
            this.tools.register(tool);
        }
        if (options.watchProfiles) {
            const watcherStartup = this.profiles.startWatching().catch((error) => {
                void appLogger.warn("agent.profileCatalog.watchStartFailed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
            this.startBackgroundTask("profile-watcher-startup", watcherStartup);
        }
        // agent 在场探针（Task 94）：只承认捕获了同一个 ready generation 的运行中 invocation。
        // waiting 不算在场：invocation 等用户输入时项目可休眠，resume 会重新走 invokeAgent 的 ensure-open 把项目重开。
        // 探针是单槽覆盖式：多实例（如测试）时后建覆盖先建，无需在实例销毁时清理。
        registerAgentPresenceProbe((project) => {
            for (const [sessionId, invocationProject] of this.activeInvocationProjects) {
                if (invocationProject === project && this.activeInvocations.get(sessionId)?.status !== "waiting") {
                    return true;
                }
            }
            return false;
        });
        // 后台任务启动恢复（PLAN-E）：上次进程遗留的 running/waiting job 标 interrupted 并给 owner 补发中断通知
        void this.jobs.recoverInterrupted().catch((error) => {
            void appLogger.warn("agent.jobs.recoverFailed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    /**
     * 给 Agent HTTP 热路径收集统一分段耗时，并只在超过阈值时写慢请求日志。
     */
    private async withAgentOperationTiming<T>(
        event: "agent.command.slow" | "agent.relations.slow" | "agent.snapshot.slow",
        thresholdMs: number,
        data: Record<string, unknown>,
        task: (timing: AgentOperationTiming) => Promise<T>,
        timingSink?: ServerTimingSink,
    ): Promise<T> {
        const timing = createAgentOperationTiming();
        const startedAt = performance.now();
        try {
            return await task(timing);
        } finally {
            timing.total = performance.now() - startedAt;
            this.writeAgentServerTiming(timingSink, timing);
            if (timing.total > thresholdMs) {
                void appLogger.warn(event, {
                    ...data,
                    timing: roundAgentOperationTiming(timing),
                });
            }
        }
    }

    private writeAgentServerTiming(timingSink: ServerTimingSink | undefined, timing: AgentOperationTiming): void {
        if (!timingSink) {
            return;
        }
        for (const key of AGENT_TIMING_KEYS) {
            timingSink.mark(key, timing[key]);
        }
    }

    private sessionWriteTiming(timing: AgentOperationTiming | undefined): SessionWriteTimingSink | undefined {
        if (!timing) {
            return undefined;
        }
        return {
            measureWritePlan: (task) => measureAgentTimingStep(timing, "writePlan", task),
            measureLiveState: (_sessionId, task) => measureAgentTimingStep(timing, "liveState", task),
        };
    }

    /**
     * 等待 harness 内部后台任务安静下来。测试和服务关闭时使用，普通 invocation 不等待它。
     */
    async drainBackgroundTasks(): Promise<void> {
        while (this.summarizerRuns.size > 0 || this.backgroundTasks.size > 0) {
            await Promise.all([
                ...[...this.summarizerRuns.values()].map((job) => job.promise),
                ...this.backgroundTasks,
            ]);
        }
    }

    /** 登记一个fire-and-forget任务，并确保失败不会形成未处理Promise。 */
    private startBackgroundTask(kind: string, task: Promise<void>): void {
        let tracked: Promise<void>;
        tracked = task
            .catch((error: unknown) => {
                void appLogger.error("agent.background.error", {
                    kind,
                    error: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                this.backgroundTasks.delete(tracked);
            });
        this.backgroundTasks.add(tracked);
    }

    /**
     * 释放 harness 持有的运行期资源。测试或临时 runtime 开启 watcher 时需要显式调用。
     */
    async dispose(): Promise<void> {
        // 先终止公开订阅，避免旧 SSE writer 在后台任务排空期间继续持有 response。
        this.eventHub.close();
        // Job 可能长期停在 waiting；停服必须先取消，再等待执行、回流和登记表有序落定。
        await this.jobs.shutdown();
        await this.drainBackgroundTasks();
        await this.profiles.dispose();
    }

    /**
     * 创建空 agent session。HistorySet 首次 invoke 时再注入。
     */
    async createAgent(input: CreateAgentInput): Promise<CreateAgentResult> {
        if (input.parentSessionId) {
            return this.withRelationMutationLock(() => this.createAgentUnlocked(input));
        }
        return this.createAgentUnlocked(input);
    }

    /** 在关系变更队列内完成 parent 校验、child 创建与 link。 */
    private async createAgentUnlocked(input: CreateAgentInput): Promise<CreateAgentResult> {
        const profile = await this.profiles.get(input.profileKey);
        if (profile.capabilities?.creation === "system_only") {
            throw new Error(`agent profile ${input.profileKey} 仅供系统内部创建，不能通过 create_agent 或公开 session API 创建。`);
        }
        const parsedInitial = this.profiles.parseInitial(profile, (input.initial ?? {}) as JsonValue);
        const title = this.normalizeCreateTitle(input.title) ?? profile.manifest.name;
        const parentSnapshot = input.parentSessionId
            ? await this.repo.readSession(input.parentSessionId)
            : null;
        if (parentSnapshot && this.repo.reduce(parentSnapshot).archived) {
            throw new Error(`不能在已归档 session ${String(input.parentSessionId)} 下创建关联 Agent。`);
        }
        const currentProjectRoot = input.currentProjectRoot ?? parentSnapshot?.metadata.currentProjectRoot;
        if (currentProjectRoot) requireActiveReadyProject(projectWorkspaceRef(currentProjectRoot));
        await mkdir(this.workspaceRoot, {recursive: true});
        const snapshot = await this.repo.createSession({
            profileKey: input.profileKey,
            initial: parsedInitial,
            currentProjectRoot,
            parentSessionId: input.parentSessionId,
            title,
            kind: input.kind,
            tags: input.tags,
        });
        const initialModel = await this.resolveInitialSessionModel(snapshot);
        if (initialModel) {
            await this.executeWritePlan({
                target: {sessionId: snapshot.metadata.sessionId},
                cause: "agent.session.initial_model",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "model_change",
                        model: canonicalSessionModel(initialModel),
                    },
                }],
            });
        }
        if (input.parentSessionId) {
            await this.appendAgentLinkUnlocked(input.parentSessionId, snapshot.metadata.sessionId, input.profileKey);
            this.publishLinkedAgentSnapshotRequired(input.parentSessionId);
            this.publishLinkedAgentSnapshotRequired(snapshot.metadata.sessionId);
        }
        if (!initialModel) {
            await this.publishSessionState(snapshot.metadata.sessionId);
        }
        void appLogger.info("agent.session.create", {
            sessionId: snapshot.metadata.sessionId,
            profileKey: input.profileKey,
            currentProjectRoot: snapshot.metadata.currentProjectRoot ?? null,
            parentSessionId: input.parentSessionId ?? null,
        });
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: input.profileKey,
            title,
        };
    }

    /**
     * 由 harness 直接创建后台 system session，不写 linked-agent entry。
     */
    private async createSystemAgent(input: {
        profileKey: string;
        initial: JsonValue;
        currentProjectRoot?: string;
        systemRole: "summarizer";
    }): Promise<SessionSnapshot> {
        const profile = await this.profiles.get(input.profileKey);
        const parsedInitial = this.profiles.parseInitial(profile, input.initial);
        const snapshot = await this.repo.createSession({
            profileKey: input.profileKey,
            initial: parsedInitial,
            currentProjectRoot: input.currentProjectRoot,
            systemRole: input.systemRole,
            title: profile.manifest.name,
        });
        await this.publishSessionState(snapshot.metadata.sessionId);
        void appLogger.info("agent.systemSession.create", {
            sessionId: snapshot.metadata.sessionId,
            profileKey: input.profileKey,
            currentProjectRoot: input.currentProjectRoot ?? null,
            systemRole: input.systemRole,
        });
        return snapshot;
    }

    /**
     * 读取 session 当前 active path 的 reduce 结果，供工具读取 profile/session custom state。
     */
    async readSessionContext(sessionId: number): Promise<NeuroSessionContext> {
        return this.repo.reduce(await this.repo.readSession(sessionId));
    }

    /** 重新绑定或清除Session Current Project；运行中与等待中的Session禁止变更归属。 */
    async updateCurrentProject(sessionId: number, projectRoot: string | null): Promise<AgentSessionSummaryDto> {
        return this.withSessionMutation(sessionId, async () => {
            const projection = await this.resolveSessionRuntimeProjection(sessionId);
            if (projection.activeInvocation) {
                throw new SessionCurrentProjectError(
                    "current_project_rebind_forbidden",
                    "运行中或等待中的 Session 不能重新绑定 Current Project。",
                    projection.snapshot.metadata.currentProjectRoot,
                );
            }
            let currentProjectRoot: string | null = null;
            if (projectRoot !== null) {
                const ref = projectWorkspaceRef(projectRoot);
                const locator = canonicalProjectLocator(this.workspaceRoot, ref);
                const snapshot = await listProjects(this.workspaceRoot);
                const project = snapshot.projects.find((candidate) => (
                    canonicalProjectLocator(this.workspaceRoot, candidate) === locator
                ));
                if (!project) {
                    throw new ProjectLifecycleError(
                        "PROJECT_NOT_FOUND",
                        `Session Current Project不存在：${ref.projectRoot}`,
                    );
                }
                // 写入 Lifecycle 发布的真实目录拼写，避免 Windows 大小写别名进入 durable metadata。
                currentProjectRoot = project.projectRoot;
            }
            await this.executeWritePlan({
                target: {sessionId},
                cause: "agent.session.current_project",
                ops: [{kind: "append", entry: {type: "current_project_change", projectRoot: currentProjectRoot}}],
            });
            return (await this.resolveSessionRuntimeProjection(sessionId)).summary;
        });
    }

    /**
     * 返回 invocation admission 捕获的 Project generation。
     *
     * `null` 表示本 invocation 属于 Workspace Root；缺少 invocation state 表示调用链已经越过
     * admission/terminal 边界，必须失败而不能重新按持久化root查询latest generation。
     */
    projectForInvocation(invocationId: string): ReadyProjectSessionRef | null {
        const state = this.invocationVariableStates.get(invocationId);
        if (!state) {
            throw new Error(`invocation variable state不存在：${invocationId}`);
        }
        return state.currentProject;
    }

    /** 按v2 metadata打开并捕获权威admission使用的精确generation。 */
    private async captureInvocationProject(
        sessionId: number,
        metadata: SessionMetadata,
    ): Promise<ReadyProjectSessionRef | null> {
        if (metadata.migrationReview) {
            throw new SessionCurrentProjectError(
                "migration_review_required",
                "该 Session 无法确定所属 Project，必须先重新绑定或明确改为 Workspace Root Session。",
                metadata.currentProjectRoot,
            );
        }
        if (!metadata.currentProjectRoot) return null;
        try {
            return await openProject(
                projectWorkspaceRef(metadata.currentProjectRoot),
                {kind: "agent", sessionId},
                this.workspaceRoot,
            );
        } catch (error) {
            if (isProjectLifecycleError(error) && error.code === "PROJECT_NOT_FOUND") {
                throw new SessionCurrentProjectError(
                    "current_project_missing",
                    `Session Current Project不存在：${metadata.currentProjectRoot}`,
                    metadata.currentProjectRoot,
                );
            }
            throw error;
        }
    }

    /** snapshot/control读取只接受已经ready的Current Project，不隐式open。 */
    private readyProjectForMetadata(metadata: SessionMetadata): ReadyProjectSessionRef | null {
        if (metadata.migrationReview) {
            throw new SessionCurrentProjectError(
                "migration_review_required",
                "该 Session 无法确定所属 Project，必须先重新绑定或明确改为 Workspace Root Session。",
                metadata.currentProjectRoot,
            );
        }
        return metadata.currentProjectRoot
            ? requireActiveReadyProject(projectWorkspaceRef(metadata.currentProjectRoot))
            : null;
    }

    /**
     * 从权威 admission capture到本次 running 段 terminal持有同一个generation operation。
     * durable waiting会释放；resume沿用invocationId，但重新open并捕获当时的ready generation。
     */
    private holdInvocationProject(
        sessionId: number,
        invocationId: string,
        project: ReadyProjectSessionRef,
        controller: AbortController,
    ): void {
        const existing = this.invocationProjectOperations.get(invocationId);
        if (existing) {
            if (existing !== project) {
                throw new Error(`同一 invocation running 段不能跨 Project generation：${invocationId}`);
            }
            return;
        }
        const completion = this.invocationCompletions.get(invocationId);
        if (!completion) {
            throw new Error(`invocation completion不存在：${invocationId}`);
        }
        startReadyProjectOperation(project, (signal) => {
            const abortForProjectClose = () => {
                const reason = signal.reason instanceof Error
                    ? signal.reason.message
                    : "ProjectSession generation已开始关闭";
                controller.abort(reason);
                void this.abortInvocationMatching(
                    sessionId,
                    invocationId,
                    {reason},
                    controller,
                ).catch((error) => {
                    void appLogger.warn("agent.invoke.projectCloseAbortFailed", {
                        sessionId,
                        invocationId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            };
            if (signal.aborted) {
                abortForProjectClose();
            } else {
                signal.addEventListener("abort", abortForProjectClose, {once: true});
            }
            return {
                result: undefined,
                completion: completion.promise.finally(() => {
                    signal.removeEventListener("abort", abortForProjectClose);
                }),
            };
        });
        this.invocationProjectOperations.set(invocationId, project);
    }

    /** 使用 invocation admission 捕获的 Project generation 构造运行配置目标。 */
    configTargetForInvocation(invocationId: string): RuntimeConfigTarget {
        const project = this.projectForInvocation(invocationId);
        return project
            ? {scope: "project", workspaceRoot: this.workspaceRoot, project}
            : {scope: "global", workspaceRoot: this.workspaceRoot, project: null};
    }

    /**
     * 追加 session custom entry。工具写状态必须走这里，确保 SSE 与 session snapshot 同步。
     */
    async appendCustomState(sessionId: number, key: string, value: JsonValue, invocationId?: string): Promise<SessionEntry> {
        return new ToolSessionWriteSink({
            executor: this.writeExecutor,
            sessionId,
            invocationId,
        }).customState("tool.custom_state", key, value);
    }

    /**
     * 调用 agent。prompt 会写入用户消息；continue 只从当前 session 尾部继续。
     */
    async invokeAgent(input: InvokeAgentInput): Promise<AgentInvocationResult> {
        const normalized = input.mode === "continue"
            ? input
            : {...input, clientMessageId: input.clientMessageId ?? randomUUID()};
        const {message, ...rest} = normalized;
        return this.invokeCore({...rest, source: {kind: "raw", message}});
    }

    /** 已完成 admission 的 queue 输入直接进入 core，禁止重新解码或保存 attachment。 */
    private async invokeStored(input: Omit<InvokeAgentInput, "message"> & {message?: StoredAgentUserMessageInput}): Promise<AgentInvocationResult> {
        const normalized = input.mode === "continue"
            ? input
            : {...input, clientMessageId: input.clientMessageId ?? randomUUID()};
        const {message, ...rest} = normalized;
        return this.invokeCore({...rest, source: {kind: "stored", message}});
    }

    /** raw/stored invocation 共用的状态机实现；Tree 可传入同一 mutation 内完成的 admission。 */
    private async invokeCore(input: InvocationCoreInput, preadmitted?: InvocationAdmission): Promise<AgentInvocationResult> {
        const startedAt = Date.now();
        if (input.block === false) {
            throw new Error("block:false 第一版尚未实现");
        }
        if (input.signal?.aborted) {
            const error = new Error("invocation aborted before admission");
            error.name = "AbortError";
            throw error;
        }
        const hasResolutions = (input.resolutions?.length ?? 0) > 0 || Boolean(input.resolution);
        let preflightSnapshot: SessionSnapshot | null = null;
        if (!preadmitted) {
            preflightSnapshot = await this.repo.readSession(input.sessionId);
            const preflightProjection = await this.resolveSessionRuntimeProjection(input.sessionId, preflightSnapshot);
            const preflightInteraction = preflightProjection.summary.interaction;
            const interactionAllowed = hasResolutions
                ? preflightInteraction?.canResolveUserInput === true
                : preflightInteraction?.canInvoke === true;
            if (!interactionAllowed) {
                if (preflightProjection.context.archived) {
                    return this.rejectedInvokeResult(input, "当前 Session 已归档，只能查看或恢复。");
                }
                if (!preflightProjection.profile) {
                    return this.profileUnavailableInvokeResult(
                        input.sessionId,
                        preflightProjection.context.profileKey,
                        randomUUID(),
                        this.requestAcceptance(input),
                    );
                }
                return this.rejectedInvokeResult(input, "当前 Session 状态不允许执行该操作。");
            }
        }
        const invokeTitle = this.normalizeInvokeTitle(input.title);
        const caller = this.normalizeInvokeCaller(input.caller);
        const messageIdentity = this.normalizeMessageIdentity(input.messageIdentity);
        let admission: InvocationAdmission;
        if (preadmitted) {
            admission = preadmitted;
        } else {
            try {
                admission = await this.withSessionMutation(input.sessionId, () => this.admitInvocationLocked(input));
            } catch (error) {
                if (error instanceof InvocationAdmissionRejected) {
                    return error.result;
                }
                if (input.mode === "prompt" && error instanceof AgentInvocationPayloadError) {
                    const errorInfo: InvocationErrorInfo = {
                        ...this.toInvocationErrorInfo(error, "prepare"),
                        retryable: true,
                        code: error.code,
                    };
                    return {
                        sessionId: input.sessionId,
                        invocationId: randomUUID(),
                        status: "error",
                        acceptance: this.requestAcceptance(input),
                        error: errorInfo.message,
                        errorPhase: errorInfo.phase,
                        errorInfo,
                    };
                }
                throw error;
            }
        }
        if ("queued" in admission) {
            if (invokeTitle) {
                // 排队项尚未取得 invocation admission；队列项 id 不是 session invocation ownership，
                // 标题属于 admission 元数据写入，不能用队列 id 通过执行期 ownership fence。
                const titleSnapshot = preflightSnapshot ?? await this.repo.readSession(input.sessionId);
                await this.writeInvokeTitle(input.sessionId, invokeTitle, undefined, this.repo.reduce(titleSnapshot));
            }
            void appLogger.info("agent.invoke.queued", {
                sessionId: input.sessionId,
                invocationId: admission.queued.invocationId,
                status: admission.queued.status,
                callerKind: caller.kind,
            });
            return admission.queued;
        }
        let snapshot = admission.snapshot;
        const pendingUserMessage = admission.pendingUserMessage;
        const pendingInvocationMessage = admission.pendingInvocationMessage;
        const pendingPayload = admission.pendingPayload;
        const pendingResolutions = admission.pendingResolutions;
        const currentProject = admission.currentProject;
        const invocationId = admission.invocationId;
        const abortController = admission.abortController;
        const runtimeState = admission.runtimeState;
        const acceptance = admission.acceptance;
        const abortGate = this.invocationAbortGates.get(invocationId);
        let removeAbortListener: (() => void) | undefined;
        if (input.signal) {
            const onAbort = () => {
                void this.abortInvocationMatching(input.sessionId, invocationId, {
                    reason: input.signal?.reason instanceof Error
                        ? input.signal.reason.message
                        : input.signal?.reason === undefined ? undefined : String(input.signal.reason),
                }, abortController).catch((error) => {
                    void appLogger.warn("agent.invoke.signalAbortFailed", {
                        sessionId: input.sessionId,
                        invocationId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            };
            if (input.signal.aborted) {
                onAbort();
            } else {
                input.signal.addEventListener("abort", onAbort, {once: true});
                removeAbortListener = () => input.signal?.removeEventListener("abort", onAbort);
            }
        }
        if (input.modelKey !== undefined) {
            this.invocationModelOverrides.set(invocationId, input.modelKey);
        }
        const invocationModelKey = input.modelKey ?? this.invocationModelOverrides.get(invocationId);
        let errorPhase: InvocationErrorPhase = "pre_loop";
        const execution = (async (): Promise<AgentInvocationResult> => {
        try {
            if (hasResolutions) {
                snapshot = snapshot ?? await this.repo.readSession(input.sessionId);
                const profileRuntime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
                if (!profileRuntime.profile) {
                    this.finishInvocationState(input.sessionId, invocationId);
                    return this.profileUnavailableInvokeResult(
                        input.sessionId,
                        snapshot.metadata.profileKey,
                        invocationId,
                        acceptance.value,
                    );
                }
            }
            if (invokeTitle) {
                snapshot = snapshot ?? await this.repo.readSession(input.sessionId);
                await this.writeInvokeTitle(input.sessionId, invokeTitle, invocationId, this.repo.reduce(snapshot));
            }
            snapshot = snapshot ?? await this.repo.readSession(input.sessionId);
            // Current Project 已由权威 admission 捕获并登记 operation；执行期禁止重新查询 latest generation。
            const variableState = this.invocationVariableStates.get(invocationId);
            if (!variableState) {
                throw new Error(`invocation variable state不存在：${invocationId}`);
            }
            if (variableState.currentProject !== currentProject) {
                throw new Error(`invocation Project capture与admission不一致：${invocationId}`);
            }
            // continue/rerun 没有新的图片正文，也必须验证全 Session canonical metadata。
            await this.sessionAttachments.validate(input.sessionId);
            const preparedRun = await this.prepareRun({
                sessionId: input.sessionId,
                invocationId,
                snapshot,
                pendingResolutions,
                pendingUserMessage,
                pendingInvocationMessage,
                pendingPayload,
                clientState: input.clientState,
                runtimeState,
                caller,
                messageIdentity,
                modelKey: invocationModelKey,
                clientMessageId: input.clientMessageId,
                intent: input.mode === "steer" ? "steer" : "normal",
                sourceQueueItemId: input.sourceQueueItemId,
                userMessageParentId: input.userMessageParentId,
                acceptance,
            });
            if (!this.ownsInvocation(input.sessionId, invocationId)) {
                return this.forcedAbortResult(input.sessionId, invocationId, startedAt);
            }
            errorPhase = "model";
            void appLogger.info("agent.invoke.start", {
                sessionId: input.sessionId,
                invocationId,
                profileKey: preparedRun.context.profileKey,
                model: resolveAgentModelLogName(preparedRun.model),
                workspaceRoot: this.workspaceRoot,
                currentProjectRoot: currentProject?.workspace.ref.projectRoot ?? null,
                toolKeys: preparedRun.toolKeys,
                executionToolKeys: preparedRun.executionToolKeys ?? null,
                callerKind: caller.kind,
                hasResolutions,
            });

            const result = await this.runLoop({
                sessionId: input.sessionId,
                workspaceRoot: this.workspaceRoot,
                currentProject,
                systemPrompt: preparedRun.systemPrompt,
                messages: preparedRun.messages,
                promptPrefix: preparedRun.promptPrefix,
                models: preparedRun.models,
                model: preparedRun.model,
                apiKey: preparedRun.apiKey,
                timeoutMs: preparedRun.timeoutMs,
                requestOptions: preparedRun.requestOptions,
                compaction: preparedRun.compaction,
                fileChangeDiffMaxChars: preparedRun.fileChangeDiffMaxChars,
                piTrace: preparedRun.piTrace,
                sessionContextEnabled: preparedRun.sessionContextEnabled,
                toolKeys: preparedRun.toolKeys,
                executionToolKeys: preparedRun.executionToolKeys,
                profileKey: preparedRun.context.profileKey,
                profile: preparedRun.profile,
                agentMode: preparedRun.context.agentMode,
                profileTurnContexts: preparedRun.prepared.turnContexts,
                pendingProfileTurnContextSettlements: preparedRun.turnContextSettlements,
                thinkingLevel: preparedRun.thinkingLevel,
                runtimeState,
                reportResultReminderEnabled: preparedRun.reportResultReminderEnabled,
                caller,
                abortSignal: abortController.signal,
                invocationId,
                onEvent: input.onEvent,
            });
            errorPhase = "ingest";
            const finalResult = await this.finalizeInvokeResult({
                input,
                invocationId,
                startedAt,
                snapshot: preparedRun.snapshot,
                context: preparedRun.context,
                prepared: preparedRun.prepared,
                toolKeys: preparedRun.toolKeys,
                result,
                acceptance: acceptance.value,
            });
            errorPhase = "settleRun";
            const committed = await this.completeInvocation({
                sessionId: input.sessionId,
                invocationId,
                profile: preparedRun.profile,
                sessionContextEnabled: preparedRun.sessionContextEnabled,
                models: preparedRun.models,
                model: preparedRun.model,
                apiKey: preparedRun.apiKey,
                timeoutMs: preparedRun.timeoutMs,
                requestOptions: preparedRun.requestOptions,
                compaction: preparedRun.compaction,
                fileChangeDiffMaxChars: preparedRun.fileChangeDiffMaxChars,
                piTrace: preparedRun.piTrace,
                thinkingLevel: preparedRun.thinkingLevel,
                runtimeState,
                runResult: result,
                finalResult,
                caller,
            });
            if (!committed) {
                return this.forcedAbortResult(input.sessionId, invocationId, startedAt);
            }
            return finalResult;
        } catch (error) {
            return this.failInvocation({
                sessionId: input.sessionId,
                invocationId,
                startedAt,
                error,
                errorPhase,
                aborted: abortController.signal.aborted,
                acceptance: acceptance.value,
            });
        }
        })();
        try {
            return await (abortGate ? Promise.race([execution, abortGate.promise]) : execution);
        } finally {
            // watchdog 强制返回时，底层不合作 Promise 可能永不 settle；解绑必须跟公开 completion boundary 走。
            removeAbortListener?.();
            this.invocationAcceptances.delete(invocationId);
        }
    }

    private normalizeInvokeCaller(caller: InvokeAgentInput["caller"]): AgentInvokeCaller {
        return caller ?? {kind: "user"};
    }

    /** durable 身份必须由显式 messageIdentity 决定；缺失时按用户消息兼容。 */
    private normalizeMessageIdentity(identity: InvokeAgentInput["messageIdentity"]): AgentMessageIdentity {
        return identity ?? "user";
    }

    /** 用户输入模式必须有稳定 clientMessageId；continue 不创建用户消息。 */
    private requireClientMessageId(value: string | undefined, mode: InvokeAgentInput["mode"]): string {
        if (!value) {
            throw new Error(`${mode} 模式缺少 clientMessageId`);
        }
        return value;
    }

    /** 返回请求在 durable admission 前的初始 receipt。 */
    private requestAcceptance(input: Pick<InvocationCoreInput, "mode" | "clientMessageId">): import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto {
        return input.mode === "continue"
            ? {state: "none"}
            : {state: "not_accepted", clientMessageId: this.requireClientMessageId(input.clientMessageId, input.mode)};
    }

    /** 生成 archived / policy 等 admission 前失败结果。 */
    private rejectedInvokeResult(input: InvocationCoreInput, message: string): AgentInvocationResult {
        const errorInfo = this.toInvocationErrorInfo(message, "prepare");
        return {
            sessionId: input.sessionId,
            invocationId: randomUUID(),
            status: "error",
            acceptance: this.requestAcceptance(input),
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
        };
    }

    /**
     * 规范化创建 session 时显式传入的展示标题。
     */
    private normalizeCreateTitle(title: CreateAgentInput["title"]): string | undefined {
        return this.normalizeSessionTitle(title, "create_agent.title");
    }

    /**
     * 规范化调用方显式传入的 session 展示标题。
     */
    private normalizeInvokeTitle(title: InvokeAgentInput["title"]): string | undefined {
        return this.normalizeSessionTitle(title, "invoke_agent.title");
    }

    /**
     * 统一处理工具传入的可选 session 标题。
     */
    private normalizeSessionTitle(title: string | undefined, fieldName: string): string | undefined {
        if (title === undefined) {
            return undefined;
        }
        const trimmed = title.trim();
        if (!trimmed) {
            throw new Error(`${fieldName} 不能为空。`);
        }
        return trimmed;
    }

    /**
     * 写入 invoke_agent 指定的 session 展示标题，不移动 active path。
     * 用户手动改过名（titleOwner=user）后，invoke 传入的 title 不再覆盖。
     * context 由调用方传入已 reduce 的会话上下文以复用读取；缺省时内部兜底读一次。
     */
    private async writeInvokeTitle(sessionId: number, title: string, invocationId?: string, context?: NeuroSessionContext): Promise<void> {
        const resolved = context ?? this.repo.reduce(await this.repo.readSession(sessionId));
        if (readTitleOwner(resolved.customState) === "user") {
            return;
        }
        await this.executeWritePlan({
            target: {sessionId},
            cause: "invoke_agent.title",
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "session_update",
                    updates: {title},
                },
            }],
        }, invocationId);
    }

    /**
     * Session mutation 临界区内重新执行 invocation 的权威 admission。
     * 快速 preflight 不能替代这里；archive/waiting/Profile/Project/附件状态均以本次读取为准。
     */
    private async admitInvocationLocked(input: InvocationCoreInput): Promise<InvocationAdmission> {
        const snapshot = await this.repo.readSession(input.sessionId);
        const projection = await this.resolveSessionRuntimeProjection(input.sessionId, snapshot);
        const hasResolutions = (input.resolutions?.length ?? 0) > 0 || Boolean(input.resolution);
        const interactionAllowed = hasResolutions
            ? projection.summary.interaction?.canResolveUserInput === true
            : projection.summary.interaction?.canInvoke === true;
        if (!interactionAllowed) {
            const result = projection.context.archived
                ? this.rejectedInvokeResult(input, "当前 Session 已归档，只能查看或恢复。")
                : !projection.profile
                    ? this.profileUnavailableInvokeResult(
                        input.sessionId,
                        projection.context.profileKey,
                        randomUUID(),
                        this.requestAcceptance(input),
                    )
                    : this.rejectedInvokeResult(input, "当前 Session 状态不允许执行该操作。");
            throw new InvocationAdmissionRejected(result);
        }
        await this.sessionAttachments.validateDurableOwnership(input.sessionId);
        return this.admitInvocation(input, snapshot.metadata);
    }

    /** 在已持有 Session mutation lock 且完成 policy admission 后 claim invocation。 */
    private async admitInvocation(
        input: InvocationCoreInput,
        metadata: SessionMetadata,
        preparedInput?: PreparedInvocationInput,
    ): Promise<InvocationAdmission> {
        let snapshot: SessionSnapshot | null = null;
        let pendingUserMessage: StoredUserMessage | null = null;
        let pendingInvocationMessage: string | undefined;
        let pendingPayload: JsonValue | undefined;
        let pendingResolutions: AgentResolution[] = [];
        let currentInvocation = this.activeInvocations.get(input.sessionId) ?? null;
        const caller = this.normalizeInvokeCaller(input.caller);
        const messageIdentity = this.normalizeMessageIdentity(input.messageIdentity);
        const clientMessageId = input.mode === "continue"
            ? undefined
            : this.requireClientMessageId(input.clientMessageId, input.mode);

        // 向后兼容：支持单个 resolution
        const resolutions = input.resolutions ?? (input.resolution ? [input.resolution] : []);
        const hasResolutions = resolutions.length > 0;

        if (!currentInvocation && input.mode === "continue" && hasResolutions) {
            snapshot = await this.repo.readSession(input.sessionId);
            const context = this.repo.reduce(snapshot);
            const pendingMessages = storedMessagesForText(context.messages);
            const pendingApprovals = findPendingApprovalCalls(pendingMessages, await this.userResolutionToolKeysForSnapshot(snapshot));
            const baseSummary = this.repo.summary(snapshot);
            currentInvocation = this.resolveActiveInvocation(input.sessionId, baseSummary.status, pendingApprovals, snapshot);
            if (pendingApprovals.length === 0) {
                throw new Error("当前 session 没有等待中的审批 tool call");
            }
            if (currentInvocation?.status !== "waiting") {
                throw new Error("waiting_invocation_not_recoverable");
            }
        }
        if (hasResolutions && currentInvocation && currentInvocation.status !== "waiting") {
            if (currentInvocation.status === "aborting") {
                throw new Error("active_invocation_aborting");
            }
            throw new Error("waiting_invocation_not_recoverable");
        }
        const invocationId = hasResolutions && currentInvocation?.status === "waiting"
            ? currentInvocation.invocationId
            : randomUUID();
        const hasInvocationInput = Boolean(input.source.message) || input.payload !== undefined;
        if ((input.mode === "steer" || input.mode === "followup") && !hasInvocationInput) {
            throw new Error(`${input.mode} 模式必须提供 message 或 input`);
        }
        if (input.mode === "steer" && input.modelKey !== undefined) {
            throw new Error("steer 模式属于当前运行中的 invocation，不能覆盖模型；请在新的 prompt/followup invocation 上指定 modelKey。");
        }
        if (currentInvocation && !hasResolutions && !input.internalQueued) {
            if (currentInvocation.status === "aborting") {
                throw new Error("active_invocation_aborting");
            }
            if (input.mode === "steer" && hasInvocationInput) {
                if (!this.steerableSessions.has(input.sessionId)) {
                    throw new Error("steer_not_available");
                }
                const item = this.enqueueSteer(input.sessionId, await this.prepareInvocationInput(input, messageIdentity), caller, messageIdentity);
                return {
                    queued: {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "waiting",
                        acceptance: {
                            state: "queued",
                            clientMessageId: item.clientMessageId,
                            queueItemId: item.id,
                        },
                        finalMessage: `steer queued: ${item.id}`,
                        queuedItem: projectQueuedMessage(item),
                    },
                };
            }
            if ((input.mode === "prompt" || input.mode === "followup") && hasInvocationInput) {
                if (input.queueIfBusy === false) {
                    throw new Error("active_invocation_exists");
                }
                const item = await this.enqueueFollowUp(input.sessionId, await this.prepareInvocationInput(input, messageIdentity), caller, messageIdentity);
                return {
                    queued: {
                        sessionId: input.sessionId,
                        invocationId,
                        status: "waiting",
                        acceptance: {
                            state: "queued",
                            clientMessageId: item.clientMessageId,
                            queueItemId: item.id,
                        },
                        finalMessage: `follow up queued: ${item.id}`,
                        queuedItem: projectQueuedMessage(item),
                    },
                };
            }
            throw new Error("active_invocation_exists");
        }
        if (input.mode === "steer") {
            throw new Error("active_invocation_required");
        }
        if (input.mode === "followup") {
            throw new Error("active_invocation_required");
        }
        if (input.mode === "prompt") {
            if (!hasInvocationInput) {
                throw new Error("prompt 模式必须提供 message 或 input");
            }
            const prepared = preparedInput ?? await this.prepareInvocationInput(input);
            pendingPayload = prepared.payload;
            pendingInvocationMessage = storedInputMarkdown(prepared.message);
            pendingUserMessage = this.createInvocationUserMessage(prepared);
        }
        if (input.mode === "continue" && (input.source.message || input.payload !== undefined)) {
            throw new Error("continue 模式不能提供 message 或 input");
        }
        if (input.mode === "continue" && hasResolutions) {
            pendingResolutions = resolutions;
        }
        const activeInvocation: AgentActiveInvocationDto = currentInvocation?.status === "waiting" && hasResolutions
            ? {
                ...currentInvocation,
                status: "running",
            }
            : {
                invocationId,
                sessionId: input.sessionId,
                status: "running",
                mode: input.mode,
                startedAt: Date.now(),
            };
        const abortController = this.abortControllers.get(input.sessionId) ?? new AbortController();
        const runtimeState = this.invocationRuntimeStates.get(invocationId) ?? new Map<string, JsonValue>();
        const acceptance: InvocationAcceptanceTracker = {
            value: clientMessageId
                ? {state: "not_accepted", clientMessageId}
                : {state: "none"},
        };
        const isResume = Boolean(hasResolutions && currentInvocation?.status === "waiting");
        // 所有可等待 policy/input/queue 工作已经结束；ready 返回后必须同步登记 operation。
        const currentProject = await this.captureInvocationProject(input.sessionId, metadata);
        this.activeInvocations.set(input.sessionId, activeInvocation);
        this.steerableSessions.add(input.sessionId);
        this.abortControllers.set(input.sessionId, abortController);
        this.invocationClientStates.set(invocationId, input.clientState);
        this.invocationVariableStates.set(invocationId, {
            readFingerprints: new Map(),
            clientOverlay: normalizeClientState(input.clientState),
            currentProject,
        });
        this.invocationRuntimeStates.set(invocationId, runtimeState);
        this.invocationAcceptances.set(invocationId, acceptance);
        if (!this.invocationCompletions.has(invocationId)) {
            this.invocationCompletions.set(invocationId, createInvocationCompletion());
        }
        if (!this.invocationAbortGates.has(invocationId)) {
            this.invocationAbortGates.set(invocationId, createInvocationAbortGate());
        }
        try {
            if (currentProject) {
                this.holdInvocationProject(input.sessionId, invocationId, currentProject, abortController);
                this.activeInvocationProjects.set(input.sessionId, currentProject);
            }
            if (!isResume) {
                await this.writeLifecycle(input.sessionId, invocationId, "start");
            }
        } catch (error) {
            this.finishInvocationState(input.sessionId, invocationId);
            throw error;
        }

        return {
            snapshot,
            pendingUserMessage,
            pendingInvocationMessage,
            pendingPayload,
            pendingResolutions,
            currentInvocation,
            currentProject,
            invocationId,
            abortController,
            runtimeState,
            isResume,
            acceptance,
        };
    }

    private async finalizeInvokeResult(input: {
        input: InvokeAgentInput;
        invocationId: string;
        startedAt: number;
        snapshot: SessionSnapshot;
        context: ReturnType<JsonlSessionRepository["reduce"]>;
        prepared: ProfileTurnPlan;
        toolKeys: string[];
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        acceptance: import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto;
    }): Promise<AgentInvocationResult> {
        const {input: invokeInput, invocationId, result} = input;
        if (!this.ownsInvocation(invokeInput.sessionId, invocationId)) {
            return this.forcedAbortResult(invokeInput.sessionId, invocationId, input.startedAt);
        }
        if (result.status === "failed") {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "error",
                acceptance: input.acceptance,
                error: result.errorInfo.message,
                errorPhase: result.errorInfo.phase,
                errorInfo: result.errorInfo,
                // 取消与失败在这里必须区分开：调用方仍按异常终止处理，但界面据此走「已停止」而非报错。
                ...(result.terminalStatus === "aborted" ? {aborted: true} : {}),
                ...projectPublicFinalMessage(result.finalAssistant ? messageText(result.finalAssistant, {stripThinking: true}) : undefined),
                usage: result.usage,
                elapsedMs: Date.now() - input.startedAt,
            };
        }

        if (result.status === "waiting") {
            return {
                sessionId: invokeInput.sessionId,
                invocationId,
                status: "waiting",
                acceptance: input.acceptance,
                finalMessage: `waiting for ${result.waiting.toolName}`,
                usage: result.usage,
                elapsedMs: Date.now() - input.startedAt,
            };
        }

        return {
            sessionId: invokeInput.sessionId,
            invocationId,
            status: "completed",
            acceptance: input.acceptance,
            ...projectPublicFinalMessage(result.finalAssistant ? messageText(result.finalAssistant, {stripThinking: true}) : undefined),
            reportResult: result.reportResult,
            usage: result.usage,
            elapsedMs: Date.now() - input.startedAt,
        };
    }

    /**
     * 处理 accepted invocation 的正常 terminal：settleRun、terminal lifecycle、queue policy 和 cleanup。
     */
    private async completeInvocation(input: {
        sessionId: number;
        invocationId: string;
        profile: AgentProfile;
        sessionContextEnabled: boolean;
        models: Models;
        model: Model<any>;
        apiKey?: string;
        timeoutMs: number | null;
        requestOptions: Record<string, JsonValue>;
        compaction?: ProfileRuntimeSettings["compaction"];
        fileChangeDiffMaxChars?: number;
        piTrace?: PiTraceSettings;
        thinkingLevel: ThinkingLevel;
        runtimeState: RunRuntimeState;
        runResult: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        finalResult: AgentInvocationResult;
        caller: AgentInvokeCaller;
    }): Promise<boolean> {
        if (!this.ownsInvocation(input.sessionId, input.invocationId)) {
            return false;
        }
        if (input.finalResult.status !== "error") {
            await this.settleRun({
                sessionId: input.sessionId,
                invocationId: input.invocationId,
                profile: input.profile,
                runtimeState: input.runtimeState,
                status: input.finalResult.status,
                result: input.runResult,
                caller: input.caller,
            });
        }
        const aborted = input.runResult.status === "failed" && input.runResult.terminalStatus === "aborted";
        const committed = await this.commitInvocationState({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            lifecycleStatus: aborted ? "aborted" : input.finalResult.status === "error" ? "error" : input.finalResult.status === "waiting" ? "waiting" : "end",
            // 取消不写正文，理由同 failInvocation：status: "aborted" 已经是全部事实，写 provider 原文会泄漏到界面。
            error: aborted ? undefined : input.finalResult.error,
            errorInfo: aborted
                ? undefined
                : input.finalResult.errorInfo ?? (input.finalResult.error ? this.toInvocationErrorInfo(input.finalResult.error, input.finalResult.errorPhase ?? "unknown") : undefined),
            ...(input.finalResult.status === "waiting"
                ? {nextState: "waiting"}
                : {nextState: "finished", pauseReason: input.finalResult.status === "error" ? aborted ? "aborted" : "error" : undefined}),
        });
        if (!committed) {
            return false;
        }
        if (this.enableSessionSummarizer && input.finalResult.status === "completed") {
            this.scheduleSessionSummarizer(input.sessionId).catch((error) => {
                void appLogger.error("agent.summarizer.schedule.error", {
                    sessionId: input.sessionId,
                    invocationId: input.invocationId,
                    profileKey: input.profile.manifest.key,
                }, error, "Agent summarizer schedule failed");
            });
        }
        void appLogger.info("agent.invoke.finish", {
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            profileKey: input.profile.manifest.key,
            status: aborted ? "aborted" : input.finalResult.status,
            errorPhase: input.finalResult.errorPhase ?? null,
            elapsedMs: input.finalResult.elapsedMs,
            usage: input.finalResult.usage ?? null,
            waitingToolName: input.runResult.status === "waiting" ? input.runResult.waiting.toolName : null,
            callerKind: input.caller.kind,
        });
        if (input.finalResult.status === "completed") {
            await this.drainFollowUps(input.sessionId).catch((error) => {
                void appLogger.warn("agent.followup.drainFailed", {
                    sessionId: input.sessionId,
                    invocationId: input.invocationId,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }
        return true;
    }

    /**
     * 处理 accepted invocation 的异常 terminal：规范化错误、写 lifecycle，并释放运行态。
     */
    private async failInvocation(input: {
        sessionId: number;
        invocationId: string;
        startedAt: number;
        error: unknown;
        errorPhase: InvocationErrorPhase;
        aborted: boolean;
        acceptance: import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto;
    }): Promise<AgentInvocationResult> {
        if (!this.ownsInvocation(input.sessionId, input.invocationId)) {
            return this.forcedAbortResult(input.sessionId, input.invocationId, input.startedAt);
        }
        const errorInfo = toRunKernelErrorInfo(input.error, input.aborted ? "unknown" : input.errorPhase);
        // 用户主动取消不是错误：durable 只记 status: "aborted"，不写 provider 原文。
        // SDK 抛的是英文 "Request was aborted"，以前它会被当成错误详情一路显示到界面上（Task 139）。
        // 日志与调用方返回值仍保留技术细节，那是诊断面不是用户面。
        const committed = await this.commitInvocationState({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            lifecycleStatus: input.aborted ? "aborted" : "error",
            error: input.aborted ? undefined : errorInfo.message,
            errorInfo: input.aborted ? undefined : errorInfo,
            nextState: "finished",
            pauseReason: input.aborted ? "aborted" : "error",
        });
        if (!committed) {
            return this.forcedAbortResult(input.sessionId, input.invocationId, input.startedAt);
        }
        void appLogger.error("agent.invoke.error", {
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            status: input.aborted ? "aborted" : "error",
            errorPhase: errorInfo.phase,
            elapsedMs: Date.now() - input.startedAt,
            errorMessage: errorInfo.message,
        }, input.error, "Agent invocation failed");
        return {
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            status: "error",
            acceptance: input.acceptance,
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
            ...(input.aborted ? {aborted: true} : {}),
            elapsedMs: Date.now() - input.startedAt,
        };
    }

    /**
     * prepareRun stage：恢复 resolution、执行 prepareRun hooks、运行 profile prepare，并组装首轮 RunFrame 输入。
     */
    private async prepareRun(input: {
        sessionId: number;
        invocationId: string;
        snapshot: SessionSnapshot;
        pendingResolutions: AgentResolution[];
        pendingUserMessage: StoredUserMessage | null;
        pendingInvocationMessage: string | undefined;
        pendingPayload: JsonValue | undefined;
        clientState?: ClientStateSnapshot;
        runtimeState: RunRuntimeState;
        caller: AgentInvokeCaller;
        messageIdentity: AgentMessageIdentity;
        /** 本 invocation 的模型覆盖；只参与本次 prepare，不写 session model_change。 */
        modelKey?: string;
        /** 当前用户输入的稳定关联 ID；continue/resolution 为空。 */
        clientMessageId?: string;
        intent: "normal" | "steer";
        sourceQueueItemId?: string;
        userMessageParentId?: SessionEntryId | null;
        acceptance: InvocationAcceptanceTracker;
    }): Promise<PreparedRun> {
        let snapshot = input.snapshot;
        if (input.pendingResolutions.length > 0) {
            await this.appendResolutions(snapshot, input.pendingResolutions, input.invocationId);
            await this.writeLifecycle(input.sessionId, input.invocationId, "resumed");
            snapshot = await this.repo.readSession(input.sessionId);
        }
        await this.publishSessionState(input.sessionId, input.invocationId);

        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const preparedInvocation = this.prepareInvocationPayload(profile, input.pendingInvocationMessage, input.pendingPayload);
        const prepareRunHooks = await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            profile,
            runtimeState: input.runtimeState,
            stage: "prepareRun",
            snapshot,
            pendingUserMessage: input.pendingUserMessage ?? undefined,
            payload: preparedInvocation.payload,
            invocationMessage: preparedInvocation.message,
            caller: input.caller,
        });

        snapshot = await this.repo.readSession(input.sessionId);
        const prepared = await this.prepare(snapshot, {
            invocationId: input.invocationId,
            pendingUserMessage: input.pendingUserMessage ?? undefined,
            invocationPayload: preparedInvocation.payload,
            invocationMessage: preparedInvocation.message,
            clientState: input.clientState,
            caller: input.caller,
            sessionContextEnabled: prepareRunHooks.sessionContext === true,
        });
        if (prepared.writePlan) {
            await this.executeWritePlan(prepared.writePlan, input.invocationId);
        }

        snapshot = await this.repo.readSession(input.sessionId);
        if (input.pendingUserMessage) {
            const entry = input.messageIdentity === "system"
                ? {
                    type: "custom_message" as const,
                    message: input.pendingUserMessage,
                    visibleToModel: true,
                    ...(input.sourceQueueItemId === undefined ? {} : {sourceQueueItemId: input.sourceQueueItemId}),
                }
                : {
                    type: "message" as const,
                    message: input.pendingUserMessage,
                    origin: "prompt" as const,
                    clientMessageId: this.requireClientMessageId(input.clientMessageId, "prompt"),
                    intent: input.intent,
                    ...(input.sourceQueueItemId === undefined ? {} : {sourceQueueItemId: input.sourceQueueItemId}),
                    ...(input.userMessageParentId === undefined ? {} : {parentId: input.userMessageParentId}),
                };
            const written = await this.executeWritePlan({
                target: {sessionId: input.sessionId},
                cause: "prompt",
                ops: [{
                    kind: "appendMany",
                    entries: [entry],
                }],
            }, input.invocationId);
            const userEntry = written.find((entry) => (entry.type === "message" || entry.type === "custom_message") && entry.message.role === "user");
            if (!userEntry) {
                throw new Error("用户消息已写入但缺少 durable entry ID");
            }
            input.acceptance.value = {
                state: "persisted",
                clientMessageId: this.requireClientMessageId(input.clientMessageId, "prompt"),
                entryId: userEntry.id,
            };
            if (input.sourceQueueItemId !== undefined) {
                await this.ackFollowUp(input.sessionId, input.sourceQueueItemId);
            }
            snapshot = await this.repo.readSession(input.sessionId);
        }

        let context = this.repo.reduce(snapshot);
        const config = await loadEffectiveConfig(this.configTargetForInvocation(input.invocationId));
        let model: Model<any>;
        if (input.modelKey !== undefined) {
            // invocation override 是临时运行参数；禁止走 model_change 或 session reconcile 写回。
            model = this.modelResolver(config, context.profileKey, {modelKey: input.modelKey});
        } else {
            const preparedModel = await this.ensureSessionModelConfigured(snapshot, context, config);
            snapshot = preparedModel.snapshot;
            context = preparedModel.context;
            model = preparedModel.model ?? this.modelResolver(config, context.profileKey);
        }
        const models = this.runtimeResolver(config, model);
        const providerOptions = this.providerOptions(config, model);
        const apiKey = resolvePiApiKeyForModelFromConfig(config, model);
        const runProfile = await this.profiles.get(context.profileKey);
        const toolKeys = [...runProfile.rootToolKeys];
        const executionToolKeys = runProfile.toolKeys ? [...runProfile.toolKeys] : undefined;
        const thinkingLevel = this.resolveThinkingLevel(context, config, model);
        const systemPrompt = prepareRunHooks.profilePrompt ? prepared.plan.systemPrompt ?? context.systemPrompt : context.systemPrompt;
        const preparedModelContextMessages = prepareRunHooks.sessionContext === true ? prepared.plan.modelContextMessages ?? [] : [];
        const appendingCount = prepareRunHooks.sessionContext === true
            ? (prepared.plan.modelContextAppendingMessages?.length ?? 0) + (prepared.plan.appendingMessages?.length ?? 0)
            : 0;
        const modelContext = [
            ...prepareRunHooks.runtimeMessages,
            ...preparedModelContextMessages,
        ];
        const messages = assemblePersistedProfilePromptMessages({
            persistedMessages: context.messages,
            modelContext,
            appendingCount,
            currentUserInputCount: input.pendingUserMessage ? 1 : 0,
        });
        this.assertNoUnclosedToolCallsForModel(storedMessagesForText(messages) as AgentMessage[], this.userResolutionToolKeysForProfile(runProfile));
        // 必须在下面重读 snapshot / context 之前算：归因描述的是上面这份 messages 数组。
        const promptPrefix = buildPromptPrefixAttribution({
            snapshot,
            persistedMessages: context.messages,
            modelContextCount: modelContext.length,
            appendingCount,
            currentUserInputCount: input.pendingUserMessage ? 1 : 0,
        });

        snapshot = await this.repo.readSession(input.sessionId);
        context = this.repo.reduce(snapshot);
        return {
            snapshot,
            context,
            profile: runProfile,
            prepared: prepared.plan,
            systemPrompt,
            messages,
            promptPrefix,
            models,
            model,
            apiKey,
            timeoutMs: providerOptions.timeoutMs,
            requestOptions: providerOptions.requestOptions,
            compaction: prepared.runtimeSettings.compaction,
            fileChangeDiffMaxChars: prepared.runtimeSettings.fileChangeNotice.diffMaxChars,
            piTrace: this.piTraceSettings(config),
            sessionContextEnabled: prepareRunHooks.sessionContext === true,
            toolKeys,
            executionToolKeys,
            thinkingLevel,
            reportResultReminderEnabled: prepareRunHooks.reportResultReminder === true,
            turnContextSettlements: prepared.turnContextSettlements,
        };
    }

    /**
     * 执行正常 run 的收尾 hook。
     *
     * error / aborted 不进入这里，避免 profile hook 和 Kernel failure path 竞争写 terminal lifecycle。
     */
    private async settleRun(input: {
        sessionId: number;
        invocationId: string;
        profile: AgentProfile;
        runtimeState: RunRuntimeState;
        status: "completed" | "waiting";
        result: Awaited<ReturnType<NeuroAgentHarness["runLoop"]>>;
        caller: AgentInvokeCaller;
    }): Promise<void> {
        if (input.result.status === "failed") {
            return;
        }
        const snapshot = await this.repo.readSession(input.sessionId);
        const context = this.repo.reduce(snapshot);
        await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            profile: input.profile,
            runtimeState: input.runtimeState,
            stage: "settleRun",
            snapshot,
            context,
            caller: input.caller,
            runResult: {
                status: input.status,
                finalAssistant: input.result.finalAssistant,
                reportResult: input.result.reportResult,
                waiting: input.result.status === "waiting" ? input.result.waiting : undefined,
            },
        });
    }

    /**
     * 查询 agent 摘要。无参返回当前未 detach 的 agent。
     */
    async getAgent(sessionId?: number, ownerSessionId?: number): Promise<AgentSummary | AgentSummary[]> {
        if (typeof sessionId === "number") {
            return this.sessionSummary(await this.repo.readSession(sessionId));
        }
        if (typeof ownerSessionId !== "number") {
            return [];
        }
        const index = await this.relationIndex();
        const summaries: AgentSummary[] = [];
        for (const linked of this.currentOwnedLinks(ownerSessionId, index)) {
            summaries.push(this.sessionSummary(await this.repo.readSession(linked.targetSessionId)));
        }
        return summaries.sort((left, right) => left.sessionId - right.sessionId);
    }

    /**
     * 解除 link。session 不删除，只写 append-only link 状态。
     */
    async detachAgent(sessionId: number, ownerSessionId?: number): Promise<DetachAgentResult> {
        return this.withRelationMutationLock(() => this.detachAgentUnlocked(sessionId, ownerSessionId));
    }

    /** 在关系变更队列内按账本当前状态解除关系。 */
    private async detachAgentUnlocked(sessionId: number, ownerSessionId?: number): Promise<DetachAgentResult> {
        if (typeof ownerSessionId === "number") {
            const ownerContext = this.repo.reduce(await this.repo.readSession(ownerSessionId));
            const linked = ownerContext.linkedAgents.find((item) => item.sessionId === sessionId);
            if (!linked) {
                return {sessionId, status: "not_linked"};
            }
            if (linked.detached) {
                return {sessionId, status: "already_detached"};
            }
            await this.executeWritePlan({
                target: {sessionId: ownerSessionId},
                cause: "agent.detach",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "custom",
                        key: `agent.detach.${sessionId}`,
                        value: {
                            sessionId,
                        },
                    },
                }],
            });
            this.publishLinkedAgentSnapshotRequired(ownerSessionId);
            this.publishLinkedAgentSnapshotRequired(sessionId);
            return {sessionId, status: "detached"};
        }
        return {sessionId, status: "not_linked"};
    }

    /**
     * 列出前端可打开的 session。内部调用保留数组形态；HTTP 使用 listSessionPage。
     */
    async listSessions(query: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> {
        const summaries = await this.resolveSessionListSummaries(query);
        const offset = query.offset ?? 0;
        return query.limit ? summaries.slice(offset, offset + query.limit) : summaries.slice(offset);
    }

    /**
     * 分页列出前端可打开的 session。
     */
    async listSessionPage(query: AgentSessionListQueryDto = {}): Promise<AgentSessionListPageDto> {
        const summaries = await this.resolveSessionListSummaries(query);
        const offset = query.offset ?? 0;
        const limit = query.limit ?? 50;
        const items = summaries.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        const hasMore = nextOffset < summaries.length;
        return {
            items,
            total: summaries.length,
            offset,
            limit,
            hasMore,
            ...(hasMore ? {nextOffset} : {}),
        };
    }

    /**
     * 构造列表摘要的轻量运行态投影。不要在这里解析完整 snapshot/system prompt/relations。
     */
    private async resolveSessionListSummaries(query: AgentSessionListQueryDto): Promise<AgentSessionSummaryDto[]> {
        const repoQuery = {
            ...query,
            includeArchived: query.includeArchived || query.status === "archived",
            status: undefined,
            limit: undefined,
            offset: undefined,
        };
        const baseSummaries = await this.repo.listSessions(repoQuery);
        const profileRuntimeByKey = await this.resolveProfileRuntimeMap(baseSummaries.map((summary) => summary.profileKey));
        const userResolutionToolKeysByProfile = new Map<string, string[]>();
        const summaries: AgentSessionSummaryDto[] = [];
        for (const summary of baseSummaries) {
            const profileRuntime = profileRuntimeByKey.get(summary.profileKey) ?? {
                profile: null,
                availability: "missing" as const,
                issueMessage: `未找到 agent profile: ${summary.profileKey}`,
            };
            summaries.push(await this.projectSessionListSummary(summary, profileRuntime, userResolutionToolKeysByProfile));
        }
        return summaries.filter((summary) => this.matchesSessionStatusFilter(summary, query.status));
    }

    /**
     * 批量解析列表所需 profile 运行态。missing 回退旧单个解析路径，兼容测试和自定义 catalog。
     */
    private async resolveProfileRuntimeMap(profileKeys: string[]): Promise<Map<string, AgentProfileRuntimeResolution>> {
        const resolved = await this.profiles.resolveMany(profileKeys);
        for (const profileKey of [...new Set(profileKeys)]) {
            const runtime = resolved.get(profileKey);
            if (runtime && runtime.availability !== "missing") {
                continue;
            }
            resolved.set(profileKey, await this.resolveProfileRuntime(profileKey));
        }
        return resolved;
    }

    /**
     * 为 session list 生成必要运行态字段。
     */
    private async projectSessionListSummary(
        summary: AgentSessionSummaryDto,
        profileRuntime: AgentProfileRuntimeResolution,
        userResolutionToolKeysByProfile: Map<string, string[]>,
    ): Promise<AgentSessionSummaryDto> {
        const activeInvocation = this.activeInvocations.get(summary.sessionId) ?? await this.hydrateWaitingInvocationForList(
            summary,
            profileRuntime,
            userResolutionToolKeysByProfile,
        );
        const status = this.resolveSessionStatus(summary.sessionId, summary.status, summary.archived, activeInvocation);
        return projectPublicSessionSummary({
            ...summary,
            status,
            profileAvailability: profileRuntime.availability,
            ...(profileRuntime.issueMessage ? {profileIssueMessage: profileRuntime.issueMessage} : {}),
            interaction: sessionInteraction({
                archived: summary.archived,
                status,
                profileAvailability: profileRuntime.availability,
            }),
        });
    }

    /**
     * 服务重启后，从历史 pending user input 恢复 waiting 状态。
     */
    private async hydrateWaitingInvocationForList(
        summary: AgentSessionSummaryDto,
        profileRuntime: AgentProfileRuntimeResolution,
        userResolutionToolKeysByProfile: Map<string, string[]>,
    ): Promise<AgentActiveInvocationDto | null> {
        if (summary.archived || summary.status === "archived") {
            return null;
        }
        const snapshot = await this.repo.readSession(summary.sessionId);
        const context = this.repo.reduce(snapshot);
        const pendingMessages = storedMessagesForText(context.messages);
        const toolKeys = this.userResolutionToolKeysForListProfile(summary.profileKey, profileRuntime.profile, userResolutionToolKeysByProfile);
        const pendingApprovals = findPendingApprovalCalls(pendingMessages, toolKeys);
        return this.resolveActiveInvocation(summary.sessionId, summary.status, pendingApprovals, snapshot);
    }

    /**
     * 列表路径按 profileKey 缓存可恢复用户输入工具 key。
     */
    private userResolutionToolKeysForListProfile(
        profileKey: string,
        profile: AgentProfile | null,
        cache: Map<string, string[]>,
    ): string[] {
        const cached = cache.get(profileKey);
        if (cached) {
            return cached;
        }
        const keys = profile ? this.userResolutionToolKeysForProfile(profile) : this.baseUserResolutionToolKeys();
        cache.set(profileKey, keys);
        return keys;
    }

    /**
     * 归档绑定到指定 Project Workspace 的 session，保留 JSONL 文件但默认从列表和统计中隐藏。
     */
    async archiveSessionsByProjectRoot(projectRoot: string, reason: string): Promise<number> {
        const sessions = await this.repo.listSessions({
            scope: "project",
            projectRoot,
            includeArchived: true,
            includeSystem: true,
            status: "all",
        });
        let archivedCount = 0;
        for (const session of sessions) {
            if (session.archived) {
                continue;
            }
            await this.archiveSession(session.sessionId, reason, "project.delete.archiveSessions");
            archivedCount += 1;
        }
        return archivedCount;
    }

    /** 归档 Session。关系账本保持不变，有效关系视图只隐藏归档端。 */
    private async archiveSession(sessionId: number, reason: string | undefined, cause: string, timing?: AgentOperationTiming): Promise<SessionWriteResult> {
        return this.withRelationMutationLock(() => this.archiveSessionUnlocked(sessionId, reason, cause, timing));
    }

    /** 在关系变更队列内追加 archive 事实，并使受影响关系投影失效。 */
    private async archiveSessionUnlocked(sessionId: number, reason: string | undefined, cause: string, timing?: AgentOperationTiming): Promise<SessionWriteResult> {
        return this.withSessionMutation(sessionId, async () => {
            const snapshot = await this.repo.readSession(sessionId);
            const projection = await this.resolveSessionRuntimeProjection(sessionId, snapshot, timing);
            const index = await this.relationIndex();
            const affected = this.relationProjectionPeers(sessionId, index);
            if (projection.context.archived) {
                return {
                    entries: [],
                    liveStates: new Map([[sessionId, await this.getSessionLiveState(sessionId)]]),
                };
            }
            if (projection.summary.interaction?.canArchive !== true) {
                throw new Error("当前 Session 状态不允许归档。");
            }
            const result = await this.writeExecutor.execute([{
                target: {sessionId},
                cause,
                ops: [{kind: "append", entry: {type: "session_archived", reason}}],
            }], undefined, {timing: this.sessionWriteTiming(timing)});
            for (const affectedSessionId of affected) {
                this.publishLinkedAgentSnapshotRequired(affectedSessionId);
            }
            return result;
        });
    }

    /** 恢复 Session；仍 linked 的关系会通过 effective view 自动重新显现。 */
    private async restoreSession(sessionId: number, cause: string, timing?: AgentOperationTiming): Promise<SessionWriteResult> {
        return this.withRelationMutationLock(async () => {
            return this.withSessionMutation(sessionId, async () => {
                const snapshot = await this.repo.readSession(sessionId);
                const projection = await this.resolveSessionRuntimeProjection(sessionId, snapshot, timing);
                const index = await this.relationIndex();
                const affected = this.relationProjectionPeers(sessionId, index);
                if (!projection.context.archived) {
                    return {
                        entries: [],
                        liveStates: new Map([[sessionId, await this.getSessionLiveState(sessionId)]]),
                    };
                }
                if (projection.summary.interaction?.canRestore !== true) {
                    throw new Error("当前 Session 状态不允许恢复。");
                }
                const result = await this.writeExecutor.execute([{
                    target: {sessionId},
                    cause,
                    ops: [{kind: "append", entry: {type: "session_restored"}}],
                }], undefined, {timing: this.sessionWriteTiming(timing)});
                for (const affectedSessionId of affected) {
                    this.publishLinkedAgentSnapshotRequired(affectedSessionId);
                }
                return result;
            });
        });
    }

    /** 找出 archive / restore 后需要刷新关系投影的全部端点。 */
    private relationProjectionPeers(sessionId: number, index: SessionRelationIndex): Set<number> {
        const affected = new Set<number>([sessionId]);
        for (const link of index.ownerToLinked.get(sessionId)?.values() ?? []) {
            affected.add(link.targetSessionId);
        }
        for (const link of index.targetToOwners.get(sessionId)?.values() ?? []) {
            affected.add(link.ownerSessionId);
        }
        return affected;
    }

    /** 串行执行关系生命周期变更；失败不会阻断后续排队操作。 */
    private async withRelationMutationLock<TResult>(task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.relationMutationTail;
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.relationMutationTail = previous.catch(() => undefined).then(() => current);
        await previous.catch(() => undefined);
        try {
            return await task();
        } finally {
            release();
        }
    }

    /**
     * 按前端 session 状态筛选运行期摘要。
     */
    private matchesSessionStatusFilter(summary: AgentSessionSummaryDto, status: AgentSessionListQueryDto["status"]): boolean {
        if (!status || status === "all") {
            return true;
        }
        if (status === "active") {
            return !summary.archived;
        }
        return summary.status === status;
    }

    /**
     * 返回 SSE 使用的轻量 session live state。
     *
     * 这里故意不包含 messages、entries、tree、systemPrompt、linked agents。
     */
    async getSessionLiveState(sessionId: number): Promise<AgentSessionLiveStateDto> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId);
        const effectiveThinkingLevel = await this.snapshotThinkingLevel(projection.snapshot, projection.context);
        const model = await this.snapshotModel(projection.snapshot, projection.context);
        const summarizer = this.sessionSummarizerStateDto(projection.context);
        const pendingArgsBudget = createPublicProjectionBudget(PUBLIC_TOOL_ARGS_TEXT_BYTES);
        const pendingUserInputs: AgentPendingApprovalDto[] = [];
        for (const pending of projection.pendingApprovals) {
            pendingUserInputs.push(await this.pendingApprovalDto(projection.snapshot, pending, false, pendingArgsBudget));
        }
        return {
            summary: projection.summary,
            ...(summarizer ? {summarizer} : {}),
            activeLeafId: projection.snapshot.leafId,
            activePathRevision: this.repo.activePathRevision(projection.snapshot),
            pendingUserInputs,
            steerQueue: {count: this.steerQueues.get(sessionId)?.length ?? 0},
            followUpQueue: this.followUpQueueSummary(sessionId, projection.context),
            activeInvocation: projection.activeInvocation,
            model: projectSessionModelRef(model),
            thinkingLevel: projection.context.thinkingLevel,
            effectiveThinkingLevel,
            agentMode: projection.context.agentMode,
            contextUsage: await this.sessionContextUsage(projection.snapshot, projection.context),
        };
    }

    /**
     * 按严格 query view 返回 session recovery、history 或按需 system prompt。
     * history 分支故意不触发 profile、relations、context usage 等 shell 计算。
     */
    async getSessionQuery(
        sessionId: number,
        query: AgentSessionQueryDto = {},
        timingSink?: ServerTimingSink,
    ): Promise<AgentSessionQueryResultDto> {
        return this.withAgentOperationTiming("agent.snapshot.slow", AGENT_SNAPSHOT_SLOW_MS, {sessionId, view: query.view ?? "recovery"}, async (timing) => {
            if (query.view === "history") {
                const snapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
                const activePathRevision = this.repo.activePathRevision(snapshot);
                const history = buildAgentHistoryPage({
                    sessionId,
                    activePathRevision,
                    activePath: this.repo.activePath(snapshot),
                    cursor: query.cursor,
                });
                return {
                    kind: "history",
                    sessionId,
                    activePathRevision,
                    history,
                } satisfies AgentSessionQueryResultDto;
            }
            if (query.view === "systemPrompt") {
                const snapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
                const context = measureAgentTimingStepSync(timing, "reduce", () => this.repo.reduce(snapshot));
                const profileRuntime = await measureAgentTimingStep(
                    timing,
                    "profileRuntime",
                    () => this.resolveProfileRuntime(snapshot.metadata.profileKey),
                );
                const systemPrompt = await measureAgentTimingStep(
                    timing,
                    "snapshotSystemPrompt",
                    () => this.snapshotSystemPrompt(snapshot, context, profileRuntime.profile),
                );
                return {
                    kind: "systemPrompt",
                    sessionId,
                    systemPrompt: systemPrompt ?? "",
                } satisfies AgentSessionQueryResultDto;
            }
            const eventCursor = this.snapshotEventCursor(sessionId);
            const snapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
            return this.buildSessionRecovery(sessionId, snapshot, eventCursor, timing);
        }, timingSink);
    }

    /** 返回覆盖 Session 全部分支的去重附件目录。 */
    async listSessionAttachments(
        sessionId: number,
        query: AgentSessionAttachmentListQueryDto,
    ): Promise<AgentSessionAttachmentPageDto> {
        return this.sessionAttachments.list(sessionId, query);
    }

    /** 按请求顺序批量解析当前 Session 已授权附件。 */
    async resolveSessionAttachments(sessionId: number, ids: readonly AttachmentId[]): Promise<AgentSessionAttachmentItemDto[]> {
        return this.sessionAttachments.resolveItems(sessionId, ids);
    }

    /** 在消费上传 body 前校验 Session、Profile、运行状态与 Project 数据面。 */
    async preflightSessionAttachmentRegistration(sessionId: number): Promise<void> {
        await this.withSessionMutation(sessionId, () => this.assertSessionAttachmentRegistrationLocked(sessionId));
    }

    /** Session mutation 临界区内的附件登记权威门禁。 */
    private async assertSessionAttachmentRegistrationLocked(sessionId: number): Promise<void> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId);
        if (!projection.summary.interaction?.canRegisterAttachment) {
            throw new AttachmentError(
                "invalid_input",
                projection.context.archived
                    ? "当前 Session 已归档，不能登记附件。"
                    : "当前 Session 状态不允许登记附件。",
            );
        }
        this.readyProjectForMetadata(projection.snapshot.metadata);
    }

    /** 保存 multipart 上传的单张图片，并追加不移动 active leaf 的授权登记。 */
    async uploadSessionAttachment(sessionId: number, input: {
        bytes: Uint8Array;
        mimeType?: string;
        name?: string;
    }): Promise<AgentSessionAttachmentItemDto> {
        await this.preflightSessionAttachmentRegistration(sessionId);
        return this.saveRegisteredSessionImage(sessionId, {
            ...input,
            name: normalizeSessionAttachmentName(input.name, "image"),
            source: "upload",
        });
    }

    /** 将跨 Project 路径、Workspace Root `.nbook` 路径或绝对路径快照为稳定附件。 */
    async snapshotSessionAttachment(sessionId: number, input: {
        sourcePath: string;
        name?: string;
    }): Promise<AgentSessionAttachmentItemDto> {
        await this.preflightSessionAttachmentRegistration(sessionId);
        const authorized = await authorizeFileOperation(
            {workspaceRoot: this.workspaceRoot, currentProject: null},
            input.sourcePath,
            "read",
        );
        const target = authorized.target;
        if (target.kind === "relative") {
            throw new AttachmentError(
                "invalid_input",
                "图片快照必须使用 workspace/<project>/<relative-path>、workspace/.nbook 路径或绝对路径。",
            );
        }
        if (target.kind === "workspace-control"
            && (target.relativePath === "agent/attachments"
                || target.relativePath?.startsWith("agent/attachments/"))) {
            throw new AttachmentError("invalid_input", "不能从 Attachment Store 自身创建快照。");
        }
        const bytes = await runProjectFileOperation([target], async () => (
            this.attachmentSnapshotReader.read(target.absolutePath)
        ));
        return this.saveRegisteredSessionImage(sessionId, {
            bytes,
            name: normalizeSessionAttachmentName(input.name, basename(target.absolutePath)),
            source: "file_snapshot",
        });
    }

    /** 按需读取历史用户消息，并按 stored contentIndex 重建完整 Markdown。 */
    async getSessionUserContent(sessionId: number, entryId: string): Promise<AgentUserMessageContentDto> {
        const context = await this.repo.readEntryContext(sessionId, entryId);
        this.readyProjectForMetadata(context.metadata);
        const entry = context.entry;
        if (!entry || entry.type !== "message" || entry.message.role !== "user") {
            throw new Error("User message entry 不存在");
        }
        if (!entry.intent) {
            throw new Error("User message entry 缺少 intent");
        }
        return {text: storedUserMessageMarkdown(entry.message, entry.intent)};
    }

    /**
     * 解析 Session 内登记、user/toolResult message 或 custom_message 的 attachment locator。
     * content hash 不是授权凭证；调用方只能提供 session/entry/contentIndex。
     */
    async resolveSessionAttachment(sessionId: number, entryId: string, contentIndex: number): Promise<{
        ref: AttachmentRef;
        name?: string;
        /** locator 授权完成后才能使用的原图读取能力。 */
        read: () => Promise<Uint8Array>;
    }> {
        if (!Number.isSafeInteger(contentIndex) || contentIndex < 0 || contentIndex > 1024) {
            throw new Error("Attachment contentIndex 无效");
        }
        const locator = await this.sessionAttachments.locator(sessionId, entryId, contentIndex);
        return {
            ...locator,
            read: () => this.attachmentStore.load(locator.ref),
        };
    }

    /** 保存图片并登记到 Session；登记本身不移动 active leaf。 */
    private async saveRegisteredSessionImage(sessionId: number, input: {
        bytes: Uint8Array;
        mimeType?: string;
        name?: string;
        source: "upload" | "file_snapshot";
    }): Promise<AgentSessionAttachmentItemDto> {
        const block = await this.attachmentCodec.saveImage(input);
        return this.withSessionMutation(sessionId, async () => {
            await this.assertSessionAttachmentRegistrationLocked(sessionId);
            await this.executeWritePlan({
                target: {sessionId},
                cause: `session_attachment.${input.source}`,
                ops: [{
                    kind: "append",
                    projection: true,
                    entry: {
                        type: "session_attachment",
                        origin: "projection",
                        attachment: block.attachment,
                        ...(block.name === undefined ? {} : {name: block.name}),
                        source: input.source,
                    },
                }],
            });
            return this.sessionAttachments.item(sessionId, block.attachment.id);
        });
    }

    /** 获取当前 session 的 recovery shell 与最新 history 尾页。 */
    async getSessionRecovery(sessionId: number, timingSink?: ServerTimingSink): Promise<AgentSessionRecoveryDto> {
        return this.getSessionQuery(sessionId, {}, timingSink) as Promise<AgentSessionRecoveryDto>;
    }

    /**
     * 构建 recovery DTO。event cursor 必须由调用者在读取 JSONL 前捕获，允许重复但禁止遗漏。
     */
    private async buildSessionRecovery(
        sessionId: number,
        sourceSnapshot: SessionSnapshot,
        eventCursor: AgentSessionRecoveryDto["eventCursor"],
        timing: AgentOperationTiming,
    ): Promise<AgentSessionRecoveryDto> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId, sourceSnapshot, timing);
        const {snapshot, context} = projection;
        const relations = await measureAgentTimingStep(timing, "relations", () => this.sessionRelations(projection, timing));
        const effectiveThinkingLevel = await this.snapshotThinkingLevel(snapshot, context);
        const model = await this.snapshotModel(snapshot, context);
        const summarizer = this.sessionSummarizerStateDto(context);
        const followUpQueue = this.followUpQueueState(sessionId, context);
        const history = buildAgentHistoryPage({
            sessionId,
            activePathRevision: this.repo.activePathRevision(snapshot),
            activePath: this.repo.activePath(snapshot),
        });

        return {
            kind: "recovery",
            eventCursor,
            summary: projection.summary,
            ...(summarizer ? {summarizer} : {}),
            activeLeafId: snapshot.leafId,
            activePathRevision: this.repo.activePathRevision(snapshot),
            history,
            tree: this.repo.tree(snapshot),
            linkedAgents: relations.linkedAgents,
            linkedByAgents: relations.linkedByAgents,
            ...(relations.unavailableLinkedAgents
                ? {unavailableLinkedAgents: relations.unavailableLinkedAgents}
                : {}),
            pendingUserInputs: await Promise.all(projection.pendingApprovals.map((pending) => this.pendingApprovalDto(snapshot, pending, true))),
            steerQueue: projectQueuedMessages(this.steerQueues.get(sessionId) ?? []),
            followUpQueue: this.publicFollowUpQueue(followUpQueue),
            activeInvocation: projection.activeInvocation,
            model: projectSessionModelRef(model),
            thinkingLevel: context.thinkingLevel,
            effectiveThinkingLevel,
            agentMode: context.agentMode,
            contextUsage: await this.sessionContextUsage(snapshot, context),
        };
    }

    private snapshotEventCursor(sessionId: number, latestSeq = this.eventHub.lastSeq(sessionId)): AgentSessionRecoveryDto["eventCursor"] {
        const anchor = this.transcriptReplayAnchors.get(sessionId);
        return {
            eventEpoch: this.eventHub.eventEpoch,
            after: anchor && this.eventHub.canReplayFrom(sessionId, anchor.after)
                ? anchor.after
                : latestSeq,
        };
    }

    /**
     * 返回关联 Agent 面板使用的轻量关系投影。
     */
    async getSessionRelations(sessionId: number, timingSink?: ServerTimingSink): Promise<AgentSessionRelationsDto> {
        return this.withAgentOperationTiming("agent.relations.slow", AGENT_RELATIONS_SLOW_MS, {sessionId}, async (timing) => {
            const projection = await this.resolveSessionRuntimeProjection(sessionId, undefined, timing);
            return measureAgentTimingStep(timing, "relations", () => this.sessionRelations(projection, timing));
        }, timingSink);
    }

    /**
     * 把内部 summarizer custom state 投影成前端可用状态。
     */
    private sessionSummarizerStateDto(context: NeuroSessionContext): AgentSessionSummarizerStateDto | undefined {
        const state = this.readSummarizerState(context);
        if (!state.sessionId && !state.running && !state.dirty && !state.lastRunAt && !state.lastError) {
            return undefined;
        }
        return projectPublicSessionSummarizerState({
            running: state.running === true,
            dirty: state.dirty === true,
            lastDialogueContentTokens: state.lastDialogueContentTokens,
            lastRunAt: state.lastRunAt,
            lastError: state.lastError,
        });
    }

    private async sessionRelations(
        projection: SessionRuntimeProjection,
        timing?: AgentOperationTiming,
    ): Promise<AgentSessionRelationsDto> {
        const index = await this.relationIndex();
        const sessionId = projection.snapshot.metadata.sessionId;
        const linkedAgents = await projectRelatedSessions(
            this.currentOwnedLinks(sessionId, index).map((linked) => linked.targetSessionId),
            async (linkedSessionId) => {
                const linkedSnapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(linkedSessionId));
                const linkedProjection = await this.resolveSessionRuntimeProjection(linkedSessionId, linkedSnapshot, timing);
                return linkedProjection.summary;
            },
        );
        const linkedByAgents = await projectRelatedSessions(
            this.currentOwnerLinks(sessionId, index).map((linked) => linked.ownerSessionId),
            async (ownerSessionId) => {
                const ownerSnapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(ownerSessionId));
                const ownerProjection = await this.resolveSessionRuntimeProjection(ownerSessionId, ownerSnapshot, timing);
                return ownerProjection.summary;
            },
        );
        const unavailableLinkedAgents = linkedAgents.unavailable + linkedByAgents.unavailable;
        return {
            sessionId,
            linkedAgents: linkedAgents.items,
            linkedByAgents: [...linkedByAgents.items].sort((left, right) => right.updatedAt - left.updatedAt),
            ...(unavailableLinkedAgents > 0 ? {unavailableLinkedAgents} : {}),
        };
    }

    private async relationIndex(): Promise<SessionRelationIndex> {
        if (this.sessionRelationIndex) {
            return this.sessionRelationIndex;
        }
        if (this.sessionRelationIndexLoad) {
            return this.sessionRelationIndexLoad;
        }
        const load = this.rebuildRelationIndex().finally(() => {
            if (this.sessionRelationIndexLoad === load) {
                this.sessionRelationIndexLoad = null;
            }
        });
        this.sessionRelationIndexLoad = load;
        return load;
    }

    private async rebuildRelationIndex(): Promise<SessionRelationIndex> {
        this.pendingRelationIndexEntries = [];
        const index: SessionRelationIndex = {
            ownerToLinked: new Map(),
            targetToOwners: new Map(),
            archivedSessionIds: new Set(),
        };
        try {
            const summaries = await this.repo.listSessions({includeArchived: true, status: "all"});
            for (const summary of summaries) {
                if (summary.archived) {
                    index.archivedSessionIds.add(summary.sessionId);
                }
                const snapshot = await this.repo.readSession(summary.sessionId);
                const context = this.repo.reduce(snapshot);
                // Relation 是 session 级 append-only 账本，不随 active path/tree 分支切换回滚。
                for (const linked of context.linkedAgents) {
                    this.upsertRelationIndexLink(index, summary.sessionId, linked.sessionId, linked.profileKey, linked.detached);
                }
            }
        } catch (error) {
            this.pendingRelationIndexEntries = [];
            throw error;
        }
        for (const pending of this.pendingRelationIndexEntries) {
            this.applyRelationIndexEntries(index, pending.ownerSessionId, pending.entries);
        }
        this.pendingRelationIndexEntries = [];
        this.sessionRelationIndex = index;
        return index;
    }

    private trackRelationIndexEntries(batch: SessionWriteEntryBatch): void {
        const entries = batch.entries.filter((entry) => relationLedgerChange(entry) !== null
            || entry.type === "session_archived"
            || entry.type === "session_restored");
        if (entries.length === 0) {
            return;
        }
        if (this.sessionRelationIndex) {
            this.applyRelationIndexEntries(this.sessionRelationIndex, batch.sessionId, entries);
            return;
        }
        if (this.sessionRelationIndexLoad) {
            this.pendingRelationIndexEntries.push({
                ownerSessionId: batch.sessionId,
                entries,
            });
        }
    }

    private applyRelationIndexEntries(index: SessionRelationIndex, ownerSessionId: number, entries: SessionEntry[]): void {
        for (const entry of entries) {
            if (entry.type === "session_archived") {
                index.archivedSessionIds.add(ownerSessionId);
                continue;
            }
            if (entry.type === "session_restored") {
                index.archivedSessionIds.delete(ownerSessionId);
                continue;
            }
            const change = relationLedgerChange(entry);
            if (!change) {
                continue;
            }
            if (change.kind === "link") {
                this.upsertRelationIndexLink(
                    index,
                    ownerSessionId,
                    change.targetSessionId,
                    change.profileKey,
                    false,
                );
                continue;
            }
            const current = index.ownerToLinked.get(ownerSessionId)?.get(change.targetSessionId);
            if (!current) {
                continue;
            }
            this.upsertRelationIndexLink(
                index,
                ownerSessionId,
                change.targetSessionId,
                current.profileKey,
                true,
            );
        }
    }

    private upsertRelationIndexLink(
        index: SessionRelationIndex,
        ownerSessionId: number,
        targetSessionId: number,
        profileKey: string,
        detached: boolean,
    ): void {
        const link: SessionRelationIndexLink = {ownerSessionId, targetSessionId, profileKey, detached};
        const ownerLinks = index.ownerToLinked.get(ownerSessionId) ?? new Map<number, SessionRelationIndexLink>();
        ownerLinks.set(targetSessionId, link);
        index.ownerToLinked.set(ownerSessionId, ownerLinks);
        const targetOwners = index.targetToOwners.get(targetSessionId) ?? new Map<number, SessionRelationIndexLink>();
        targetOwners.set(ownerSessionId, link);
        index.targetToOwners.set(targetSessionId, targetOwners);
    }

    /** 返回 owner 当前仍有效的关系；历史 detached 与任一端 archived 都被排除。 */
    private currentOwnedLinks(sessionId: number, index: SessionRelationIndex): SessionRelationIndexLink[] {
        if (index.archivedSessionIds.has(sessionId)) {
            return [];
        }
        return [...(index.ownerToLinked.get(sessionId)?.values() ?? [])].filter((link) => {
            return !link.detached && !index.archivedSessionIds.has(link.targetSessionId);
        });
    }

    /** 返回指向 target 的当前有效关系；历史 detached 与任一端 archived 都被排除。 */
    private currentOwnerLinks(sessionId: number, index: SessionRelationIndex): SessionRelationIndexLink[] {
        if (index.archivedSessionIds.has(sessionId)) {
            return [];
        }
        return [...(index.targetToOwners.get(sessionId)?.values() ?? [])].filter((link) => {
            return link.ownerSessionId !== sessionId
                && !link.detached
                && !index.archivedSessionIds.has(link.ownerSessionId);
        });
    }

    /**
     * 解析当前 profile 的 provider system prompt，供前端只读展示。
     */
    private async snapshotSystemPrompt(snapshot: SessionSnapshot, context: NeuroSessionContext, profile: AgentProfile | null): Promise<string | undefined> {
        if (!profile) {
            return undefined;
        }
        const profileContext = profile.context;
        if (!this.hasBuiltinHook(profile, "builtin.profilePrompt") || !profileContext) {
            return undefined;
        }
        const initial = this.profiles.parseInitial(profile, snapshot.metadata.initial);
        const configTarget = resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot);
        const render = async (): Promise<string | undefined> => {
            const config = await loadEffectiveConfig(configTarget);
            const {settings, home} = await this.resolveProfileSettings(profile, config, context, configTarget.project);
            const session = await this.createRuntimeSessionFacade({
                sessionId: snapshot.metadata.sessionId,
                profileKey: profile.manifest.key,
                initial,
                context,
                currentProject: configTarget.project,
            });
            const prepareContext = {
                session,
                initial: initial as never,
                vars: await this.createProfileVariableAccessor(snapshot, profile, {dryRun: true}),
                settings: settings as never,
                ...(home ? {home} : {}),
                catalog: await this.profiles.snapshot(),
                skills: await this.skills.list(),
                workflows: await this.workflows.list(configTarget.project?.workspace),
                agentVisibleModels: resolveAgentVisibleModels(config),
                runtime: {
                    now: new Date().toISOString(),
                    promptUserTurnCount: this.countPromptUserTurns(snapshot),
                    currentProject: configTarget.project,
                    sqlSchemaSummary: () => projectSqlSchemaSummary(configTarget.project),
                },
            };
            return compileProfileSystemPrompt(profile, prepareContext, await profileContext(prepareContext));
        };
        return configTarget.project
            ? runReadyProjectOperation(configTarget.project, async () => render())
            : render();
    }

    private async pendingApprovalDto(
        snapshot: SessionSnapshot,
        pending: {toolCallId: string; toolName: string; args: Record<string, unknown>},
        includeRecoveryDetails: boolean,
        argsBudget?: PublicProjectionBudget,
    ): Promise<AgentPendingApprovalDto> {
        const base: AgentPendingApprovalDto = {
            toolCallId: assertPublicToolCallId(pending.toolCallId),
            toolName: projectPublicToolName(pending.toolName),
            args: projectPublicToolArgs(pending.toolName, pending.args, argsBudget),
        };

        const pendingState = this.pendingUserResolutionState(snapshot, pending.toolCallId);
        if (pending.toolName !== "request_user_input" && pendingState?.formSpec) {
            if (includeRecoveryDetails) {
                base.formSpec = publicAgentUserInputFormSpec(pendingState.formSpec);
            } else {
                base.detailsOmitted = true;
            }
        }

        // switch_mode 退出 plan（targetMode=normal）且带 planFilePath 时，为审批 UI 附带计划文件预览
        if (pending.toolName !== "switch_mode" || this.readTargetMode(pending.args) !== "normal") {
            return base;
        }
        const planFilePath = typeof pending.args.planFilePath === "string" ? pending.args.planFilePath : "";
        if (!planFilePath.trim()) {
            return base;
        }
        const target = resolvePlanModeFile({
            workspaceRoot: this.workspaceRoot,
            currentProject: this.readyProjectForMetadata(snapshot.metadata),
            planFilePath,
        });
        const projectedPath = textPreview(target.displayPath, 2 * 1024).preview;
        if (!includeRecoveryDetails) {
            return {...base, planFilePath: projectedPath};
        }
        const planContent = await readFile(target.absolutePath, "utf-8");
        return {
            ...base,
            planFilePath: projectedPath,
            planContent,
            planContentBytes: Buffer.byteLength(planContent, "utf8"),
        };
    }

    private pendingUserResolutionState(snapshot: SessionSnapshot, toolCallId: string): PendingUserResolutionState | null {
        const value = this.repo.reduce(snapshot).customState[this.pendingUserResolutionStateKey(toolCallId)];
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return null;
        }
        const record = value as Record<string, JsonValue>;
        if (record.toolCallId !== toolCallId || typeof record.toolName !== "string") {
            return null;
        }
        const formSpec = record.formSpec && typeof record.formSpec === "object" && !Array.isArray(record.formSpec)
            ? record.formSpec as Record<string, JsonValue>
            : null;
        return {
            toolCallId,
            toolName: record.toolName,
            ...(formSpec && formSpec.form
                ? {
                    formSpec: {
                        form: formSpec.form,
                        layout: formSpec.layout === "dialog" || formSpec.layout === "inline" || formSpec.layout === "fullscreen" ? formSpec.layout : undefined,
                        prompt: typeof formSpec.prompt === "string" ? formSpec.prompt : undefined,
                    },
                }
                : {}),
        };
    }

    private pendingUserResolutionStateKey(toolCallId: string): string {
        return `${AGENT_PENDING_USER_RESOLUTION_STATE_PREFIX}${toolCallId}`;
    }

    private pendingUserResolutionEntry(waiting: RunToolBatchResult["waiting"] | undefined): AppendManySessionEntryDraft | null {
        if (!waiting?.formSpec || waiting.toolName === "request_user_input") {
            return null;
        }
        const formSpec = this.pendingUserResolutionFormSpec(waiting.formSpec);
        return {
            type: "custom",
            key: this.pendingUserResolutionStateKey(waiting.toolCallId),
            value: {
                toolCallId: waiting.toolCallId,
                toolName: waiting.toolName,
                formSpec,
            },
        };
    }

    private clearPendingUserResolutionEntry(pending: {toolCallId: string}): AppendManySessionEntryDraft {
        return {
            type: "custom",
            key: this.pendingUserResolutionStateKey(pending.toolCallId),
            value: null,
        };
    }

    private pendingUserResolutionFormSpec(formSpec: UserInputFormSpec): JsonValue {
        return {
            form: formSpec.form as JsonValue,
            ...(formSpec.layout ? {layout: formSpec.layout} : {}),
            ...(formSpec.prompt ? {prompt: formSpec.prompt} : {}),
        };
    }

    /**
     * 解析 snapshot 显示用 thinking 状态，和下一次 run 使用同一套模型/profile 规则。
     */
    private async snapshotThinkingLevel(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<ThinkingLevel> {
        try {
            const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));
            const model = this.resolveEffectiveSessionModel(config, context) ?? this.modelResolver(config, context.profileKey);
            return this.resolveThinkingLevel(context, config, model);
        } catch {
            return "off";
        }
    }

    /**
     * 解析 snapshot 显示用模型。若 session 绑定的模型已被删除，则回落到当前 profile/default。
     */
    private async snapshotModel(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<Model<any> | null> {
        try {
            const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));
            return this.resolveEffectiveSessionModel(config, context);
        } catch {
            return null;
        }
    }

    /**
     * 创建 session 时尝试绑定当前解析出的具体模型；未配置模型时允许创建空 session。
     */
    private async resolveInitialSessionModel(snapshot: SessionSnapshot): Promise<Model<any> | null> {
        try {
            const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));
            return this.resolveConfiguredSessionModel(config, snapshot.metadata.profileKey, null);
        } catch {
            return null;
        }
    }

    /**
     * 构造 agent.mode custom state 值（Task 90）。
     * phase 决定 ModeReminder 的渲染档位；fromMode 供 exit 文案分叉；hasExitedPlan 供 plan 再进入判定 reentry。
     */
    private agentModeState(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        next: {mode: AgentMode; fromMode: AgentMode; phase: "enter" | "reentry" | "steady" | "exit"},
        lastTransition: string,
        extra: {approved?: boolean; reason?: string} = {},
    ): JsonValue {
        const previous = context.customState[AGENT_MODE_STATE_KEY];
        const previousRecord = previous && typeof previous === "object" && !Array.isArray(previous)
            ? previous as Record<string, JsonValue>
            : {};
        // visitedPlan：自上次回到 normal 后是否进入过 plan。plan↔discuss 互切不算"离开计划"
        // （换脑子不换手，计划草稿仍有效），但只要途经 plan 后回到 normal——包括 plan→discuss→normal
        // 的间接路径——就视为一个计划周期结束，置 hasExitedPlan，之后再进 plan 走 reentry
        // （Task 90 决策 6 / README 4.1 + 2026-07-08 规格补充）。
        const visitedPlan = next.mode === "normal" ? false : Boolean(previousRecord.visitedPlan) || next.mode === "plan";
        const hasExitedPlan = Boolean(previousRecord.hasExitedPlan)
            || (next.mode === "normal" && (next.fromMode === "plan" || Boolean(previousRecord.visitedPlan)));
        return {
            mode: next.mode,
            fromMode: next.fromMode,
            phase: next.phase,
            hasExitedPlan,
            visitedPlan,
            workDirectory: planModeToolDirectory({
                workspaceRoot: this.workspaceRoot,
                currentProject: this.readyProjectForMetadata(snapshot.metadata),
            }),
            lastTransition,
            updatedAt: new Date().toISOString(),
            ...(extra.approved !== undefined ? {approved: extra.approved} : {}),
            ...(extra.reason ? {reason: extra.reason} : {}),
        };
    }

    /**
     * 读取当前 agent.mode state 的 hasExitedPlan 标记。
     */
    private hasExitedPlan(context: NeuroSessionContext): boolean {
        const previous = context.customState[AGENT_MODE_STATE_KEY];
        return Boolean(previous && typeof previous === "object" && !Array.isArray(previous)
            && (previous as Record<string, JsonValue>).hasExitedPlan);
    }

    /**
     * 计算切换到 targetMode 的 reminder phase。
     */
    private modeSwitchPhase(targetMode: AgentMode, context: NeuroSessionContext): "enter" | "reentry" | "exit" {
        if (targetMode === "normal") {
            return "exit";
        }
        return targetMode === "plan" && this.hasExitedPlan(context) ? "reentry" : "enter";
    }

    /**
     * 执行 session 控制命令。命令不作为普通用户消息进入模型。
     */
    async runCommand(sessionId: number, body: AgentCommandRequestDto, timingSink?: ServerTimingSink): Promise<AgentCommandResult> {
        return this.withAgentOperationTiming("agent.command.slow", AGENT_COMMAND_SLOW_MS, {
            sessionId,
            command: body.command,
        }, (timing) => body.command === "archive" || body.command === "restore"
            ? this.runCommandMeasured(sessionId, body, timing)
            : this.withSessionMutation(sessionId, () => this.runCommandMeasured(sessionId, body, timing)), timingSink);
    }

    private async runCommandMeasured(
        sessionId: number,
        body: AgentCommandRequestDto,
        timing: AgentOperationTiming,
    ): Promise<AgentCommandResult> {
        if (body.command !== "compact" && body.command !== "archive" && body.command !== "restore") {
            this.assertSessionIdle(sessionId);
        }
        const snapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
        const projection = await this.resolveSessionRuntimeProjection(sessionId, snapshot, timing);
        const interaction = projection.summary.interaction;
        if (!interaction) {
            throw new Error("Session interaction projection 缺失");
        }
        if (body.command === "restore") {
            const result = await this.restoreSession(sessionId, "command.restore", timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        if (body.command === "archive") {
            const result = await this.archiveSession(sessionId, body.reason, "command.archive", timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        const mutatesHistory = body.command === "retry" || body.command === "tree" || body.command === "fork";
        if (mutatesHistory ? !interaction.canMutateHistory : !interaction.canChangeRuntime) {
            throw new Error(projection.context.archived
                ? "当前 Session 已归档，只能查看或恢复。"
                : this.profileUnavailableMessage(snapshot.metadata.profileKey));
        }
        if (body.command === "new" || body.command === "compact") {
            await measureAgentTimingStep(timing, "profileRuntime", () => this.assertProfileRunnable(snapshot));
        }
        if (body.command === "new") {
            const created = await this.createAgent({
                profileKey: snapshot.metadata.profileKey,
                initial: snapshot.metadata.initial,
                currentProjectRoot: snapshot.metadata.currentProjectRoot,
            });
            return {
                kind: "created_session",
                status: "completed",
                sessionId: created.sessionId,
                createdSession: (await this.resolveSessionRuntimeProjection(created.sessionId, undefined, timing)).summary,
            };
        }
        if (body.command === "fork") {
            const forked = await this.repo.forkSession(sessionId, body.entryId ?? snapshot.leafId ?? undefined);
            await measureAgentTimingStep(timing, "liveState", () => this.publishSessionState(forked.metadata.sessionId));
            return {
                kind: "created_session",
                status: "completed",
                sessionId: forked.metadata.sessionId,
                createdSession: (await this.resolveSessionRuntimeProjection(forked.metadata.sessionId, forked, timing)).summary,
            };
        }
        if (body.command === "rename") {
            const title = this.normalizeSessionTitle(body.title, "command.rename.title");
            // 手动改名后标题所有权归用户，summarizer 与 invoke title 都不再覆盖标题。
            const result = await this.executeWritePlanResult({
                target: {sessionId},
                cause: "command.rename",
                ops: [
                    {
                        kind: "append",
                        projection: true,
                        entry: {
                            type: "session_update",
                            updates: {title},
                        },
                    },
                    {
                        kind: "append",
                        projection: true,
                        entry: {
                            type: "custom",
                            key: SESSION_TITLE_OWNER_STATE_KEY,
                            value: {owner: "user"} satisfies SessionTitleOwnerState,
                        },
                    },
                ],
            }, undefined, timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        if (body.command === "summarize") {
            // 把标题所有权交还给 auto，并以 force 语义强制 summarizer 立即重跑一次（绕过 fingerprint 判定与配置禁用）。
            await this.executeWritePlan({
                target: {sessionId},
                cause: "command.summarize",
                ops: [{
                    kind: "append",
                    projection: true,
                    entry: {
                        type: "custom",
                        key: SESSION_TITLE_OWNER_STATE_KEY,
                        value: {owner: "auto"} satisfies SessionTitleOwnerState,
                    },
                }],
            });
            this.scheduleSessionSummarizer(sessionId, {force: true}).catch((error) => {
                void appLogger.error("agent.summarizer.command.error", {
                    sessionId,
                }, error, "Agent summarize command schedule failed");
            });
            return this.commandLiveStateResult(sessionId, "started", undefined, timing);
        }
        if (body.command === "retry") {
            const targetId = body.entryId ?? snapshot.leafId;
            if (targetId) {
                await this.moveLeafForPosition(sessionId, targetId, "before", timing);
            }
            return this.commandLiveStateResult(sessionId, "completed", undefined, timing);
        }
        if (body.command === "tree") {
            await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position, timing);
            return this.commandLiveStateResult(sessionId, "completed", undefined, timing);
        }
        if (body.command === "mode") {
            const targetMode = body.mode;
            const context = measureAgentTimingStepSync(timing, "reduce", () => this.repo.reduce(snapshot));
            if (context.agentMode === targetMode) {
                return this.commandLiveStateResult(sessionId, "completed", undefined, timing);
            }
            const phase = this.modeSwitchPhase(targetMode, context);
            const result = await this.executeWritePlanResult({
                target: {sessionId},
                cause: "command.mode",
                ops: [{
                    kind: "appendMany",
                    entries: [
                        {
                            type: "custom",
                            key: AGENT_MODE_UI_STATE_KEY,
                            value: targetMode,
                        },
                        {
                            type: "custom",
                            key: AGENT_MODE_STATE_KEY,
                            value: this.agentModeState(snapshot, context, {
                                mode: targetMode,
                                fromMode: context.agentMode,
                                phase,
                            }, "ui_mode_toggle"),
                        },
                    ],
                }],
            }, undefined, timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        if (body.command === "model") {
            const context = measureAgentTimingStepSync(timing, "reduce", () => this.repo.reduce(snapshot));
            const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));
            const nextModel = body.modelKey
                ? this.modelResolver(config, context.profileKey, {modelKey: body.modelKey})
                : this.modelResolver(config, context.profileKey);
            const entry: Omit<ModelChangeEntry, "id" | "parentId" | "timestamp"> = {
                type: "model_change",
                model: canonicalSessionModel(nextModel),
            };
            if (sessionModelsEqual(context.model, entry.model)) {
                return this.commandLiveStateResult(sessionId, "completed", undefined, timing);
            }
            const result = await this.executeWritePlanResult({
                target: {sessionId},
                cause: "command.model",
                ops: [{
                    kind: "append",
                    entry,
                }],
            }, undefined, timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        if (body.command === "thinking") {
            const context = measureAgentTimingStepSync(timing, "reduce", () => this.repo.reduce(snapshot));
            if (context.thinkingLevel === body.thinkingLevel) {
                return this.commandLiveStateResult(sessionId, "completed", undefined, timing);
            }
            const result = await this.executeWritePlanResult({
                target: {sessionId},
                cause: "command.thinking",
                ops: [{
                    kind: "append",
                    entry: {
                        type: "thinking_level_change",
                        thinkingLevel: body.thinkingLevel,
                    },
                }],
            }, undefined, timing);
            return this.commandLiveStateResult(sessionId, "completed", result, timing);
        }
        if (body.command === "compact") {
            this.assertSessionIdle(sessionId);
            const currentProject = await this.captureInvocationProject(sessionId, snapshot.metadata);
            const claimed = await this.claimCompactInvocationLocked(sessionId, currentProject);
            this.startBackgroundTask("compact", this.runCompactCommand(
                sessionId,
                claimed.invocationId,
                claimed.abortSignal,
                body.instructions,
            ));
            return this.commandLiveStateResult(sessionId, "started", undefined, timing);
        }
        throw new Error("不支持的 Agent command");
    }

    /**
     * 移动树分支，并可在移动后立即发起下一次 invoke。
     */
    async moveTree(sessionId: number, body: AgentTreeRequestDto): Promise<AgentTreeOperationResult> {
        if (body.position === "empty") {
            return this.withSessionMutation(sessionId, async () => {
                this.assertSessionIdle(sessionId);
                const projection = await this.resolveSessionRuntimeProjection(sessionId);
                if (projection.summary.interaction?.canMutateHistory !== true) {
                    throw new Error(projection.context.archived
                        ? "当前 Session 已归档，只能查看或恢复。"
                        : "当前 Session 状态不允许修改历史。");
                }
                await this.executeWritePlan({
                    target: {sessionId},
                    cause: "tree.empty",
                    ops: [{kind: "moveLeaf", leafId: null}],
                });
                return {
                    status: "completed",
                    state: await this.getSessionLiveState(sessionId),
                };
            });
        }
        if (body.next?.type === "invoke") {
            const next = body.next;
            const admitted = await this.withSessionMutation(sessionId, async () => {
                this.assertSessionIdle(sessionId);
                const snapshot = await this.repo.readSession(sessionId);
                const branchLeafId = this.leafIdForPosition(snapshot, body.targetEntryId, body.position);
                const branchSnapshot: SessionSnapshot = {...snapshot, leafId: branchLeafId};
                const projection = await this.resolveSessionRuntimeProjection(sessionId, branchSnapshot);
                if (projection.summary.interaction?.canMutateHistory !== true
                    || projection.summary.interaction.canInvoke !== true) {
                    throw new Error(projection.context.archived
                        ? "当前 Session 已归档，只能查看或恢复。"
                        : "当前 Session 状态不允许编辑历史并重新运行。");
                }
                await this.assertProfileRunnable(branchSnapshot);
                await this.sessionAttachments.validateDurableOwnership(sessionId);

                const invocationInput: InvocationCoreInput = next.mode === "prompt"
                    ? {
                        sessionId,
                        mode: "prompt",
                        clientMessageId: next.clientMessageId!,
                        clientState: next.clientState,
                        queueIfBusy: false,
                        userMessageParentId: branchLeafId,
                        source: {kind: "raw", message: next.message!},
                    }
                    : {
                        sessionId,
                        mode: "continue",
                        clientState: next.clientState,
                        queueIfBusy: false,
                        source: {kind: "raw"},
                    };
                const prepared = next.mode === "prompt"
                    ? await this.prepareInvocationInput(invocationInput)
                    : undefined;

                await this.executeWritePlan({
                    target: {sessionId},
                    cause: `tree.${body.position}`,
                    ops: [{kind: "moveLeaf", leafId: branchLeafId}],
                });
                try {
                    const admission = await this.admitInvocation(invocationInput, branchSnapshot.metadata, prepared);
                    if ("queued" in admission) {
                        throw new Error("Tree invocation 不得进入运行中队列。");
                    }
                    return {input: invocationInput, admission};
                } catch (error) {
                    await this.executeWritePlan({
                        target: {sessionId},
                        cause: "tree.admission.rollback",
                        ops: [{kind: "moveLeaf", leafId: snapshot.leafId}],
                    });
                    throw error;
                }
            });
            const invocation = await this.invokeCore(admitted.input, admitted.admission);
            return {
                status: "invoked",
                state: await this.getSessionLiveState(sessionId),
                invocation,
            };
        }
        return this.withSessionMutation(sessionId, async () => {
            this.assertSessionIdle(sessionId);
            const snapshot = await this.repo.readSession(sessionId);
            const projection = await this.resolveSessionRuntimeProjection(sessionId, snapshot);
            if (projection.summary.interaction?.canMutateHistory !== true) {
                throw new Error(projection.context.archived
                    ? "当前 Session 已归档，只能查看或恢复。"
                    : "当前 Session 状态不允许修改历史。");
            }
            await this.moveLeafForPosition(sessionId, body.targetEntryId, body.position);
            return {
                status: "completed",
                state: await this.getSessionLiveState(sessionId),
            };
        });
    }

    /**
     * 请求中断当前 invocation。底层 provider/tool 会通过 AbortSignal 尽量停止。
     */
    async abortInvocation(sessionId: number, body: AgentAbortRequestDto = {}): Promise<AgentAbortResult> {
        return this.abortInvocationMatching(sessionId, undefined, body);
    }

    /**
     * 在一个 Session mutation 临界区内读取并 claim abort。
     * expectedInvocationId 非空时只取消精确 invocation，供父 invocation / Workflow signal 使用。
     */
    private async abortInvocationMatching(
        sessionId: number,
        expectedInvocationId: string | undefined,
        body: AgentAbortRequestDto = {},
        controller?: AbortController,
    ): Promise<AgentAbortResult> {
        const admission = await this.withSessionMutation(sessionId, async () => {
            const active = await this.claimAbortInvocation(sessionId);
            if (!active || (expectedInvocationId !== undefined && active.invocationId !== expectedInvocationId)) {
                return {
                    kind: "idle" as const,
                };
            }
            const projection = await this.resolveSessionRuntimeProjection(sessionId);
            if (projection.summary.interaction?.canAbort !== true) {
                throw new Error("当前 Session 状态不允许停止运行。");
            }
            if (active.status === "waiting") {
                active.status = "aborting";
                this.steerQueues.delete(sessionId);
                if (body.clearQueue ?? true) {
                    await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
                } else {
                    await this.pauseFollowUps(sessionId, active.invocationId, "aborted");
                }
                await this.appendAbortResolution(sessionId, active.invocationId, body.reason);
                // 只在调用方显式给了 reason 时才写正文；没有 reason 时 status: "aborted" 本身就是全部事实。
                // 以前这里兜底写的是英文 "invocation aborted"，会当成错误详情显示给用户（Task 139）。
                await this.writeLifecycle(sessionId, active.invocationId, "aborted", body.reason, body.reason ? {
                    message: body.reason,
                    phase: "unknown",
                } : undefined);
                this.eventHub.publish({
                    sessionId,
                    invocationId: active.invocationId,
                    kind: "session",
                    event: {
                        type: "invocation_aborted",
                        reason: projectPublicControlReason(body.reason),
                    },
                });
                await this.finishInvocation(sessionId, active.invocationId);
                // waiting 段的 runLoop 早已返回，不会再自己发终态；前端在 invocation_aborted 上进入 aborting，
                // 必须由这里补一条 agent_end 让它回到 idle。
                this.publishRuntimeEvent(sessionId, active.invocationId, {type: "agent_end", status: "aborted"});
                return {
                    kind: "completed" as const,
                    result: {
                        status: "aborted" as const,
                        sessionId,
                    },
                };
            }
            active.status = "aborting";
            this.steerableSessions.delete(sessionId);
            if (body.clearQueue ?? true) {
                this.steerQueues.delete(sessionId);
                await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
            }
            return {
                kind: "running" as const,
                active,
            };
        });
        if (admission.kind === "idle") {
            return {
                status: "idle",
                sessionId,
            };
        }
        if (admission.kind === "completed") {
            return admission.result;
        }
        (controller ?? this.abortControllers.get(sessionId))?.abort(body.reason);
        this.eventHub.publish({
            sessionId,
            invocationId: admission.active.invocationId,
            kind: "session",
            event: {
                type: "invocation_aborted",
                reason: projectPublicControlReason(body.reason),
            },
        });
        await this.publishSessionState(sessionId, admission.active.invocationId);
        const completion = this.invocationCompletions.get(admission.active.invocationId);
        if (completion && !completion.settled) {
            await Promise.race([
                completion.promise,
                new Promise<void>((resolve) => setTimeout(resolve, INVOCATION_ABORT_GRACE_MS)),
            ]);
        }
        if (this.ownsInvocation(sessionId, admission.active.invocationId)) {
            await this.forceAbortInvocation(sessionId, admission.active.invocationId, body.reason);
        }
        return {
            status: "aborted",
            sessionId,
        };
    }

    private async claimAbortInvocation(sessionId: number): Promise<AgentActiveInvocationDto | null> {
        let active = this.activeInvocations.get(sessionId) ?? null;
        if (active) {
            return active;
        }
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const messages = storedMessagesForText(context.messages);
        const pendingApprovals = findPendingApprovalCalls(messages, await this.userResolutionToolKeysForSnapshot(snapshot));
        const baseSummary = this.repo.summary(snapshot);
        active = this.resolveActiveInvocation(sessionId, baseSummary.status, pendingApprovals, snapshot);
        if (active?.status === "waiting") {
            this.activeInvocations.set(sessionId, active);
        }
        return active;
    }

    private async appendAbortResolution(sessionId: number, invocationId: string, reason?: string): Promise<void> {
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const messages = storedMessagesForText(context.messages);
        const pending = findPendingApprovalCall(messages, await this.userResolutionToolKeysForSnapshot(snapshot));
        if (!pending) {
            return;
        }
        await this.executeWritePlan({
            target: {sessionId},
            cause: "resolution.abort",
            durability: "savePoint",
            ops: [{
                kind: "append",
                entry: {
                    type: "message",
                    message: createStoredTextToolResult({
                        toolCallId: pending.toolCallId,
                        toolName: pending.toolName,
                        text: reason ? `Aborted: ${reason}` : "Aborted.",
                        isError: true,
                    }),
                    origin: "harness",
                },
            }],
        }, invocationId);
    }

    /**
     * 订阅 session 级事件流。
     */
    subscribeSessionEvents(sessionId: number, cursor: AgentSessionEventsQueryDto = {}): AgentSessionEventSubscription {
        return this.eventHub.subscribe(sessionId, cursor);
    }

    /**
     * 前端确认 client.* variable patch 已应用。
     */
    async acknowledgeClientVariablePatch(sessionId: number, ack: VariablePatchAck): Promise<void> {
        const key = clientPatchKey(ack.invocationId, ack.toolCallId, ack.path);
        const pending = this.pendingClientPatches.get(key);
        if (!pending) {
            throw new Error(`未找到等待中的 client variable patch：${ack.path}`);
        }
        if (pending.request.namespace !== ack.namespace || pending.request.path !== ack.path) {
            throw new Error(`client variable patch ack 不匹配：${ack.path}`);
        }
        clearTimeout(pending.timeout);
        this.pendingClientPatches.delete(key);
        await new ToolSessionWriteSink({
            executor: this.writeExecutor,
            sessionId,
            invocationId: ack.invocationId,
        }).append("variable.client_ack", {
            type: "client_variable_patch_ack",
            namespace: "client",
            path: ack.path,
            operations: ack.operations,
            appliedValue: ack.appliedValue,
            error: ack.error,
            invocationId: ack.invocationId,
            toolCallId: ack.toolCallId,
        });
        pending.resolve(ack);
    }

    /**
     * 查询轻量 session 信息，不返回完整历史原文。
     */
    async getSession(input: number | SessionQueryInput | undefined, requesterSessionId?: number): Promise<SessionQueryResult> {
        const query = typeof input === "number" ? {sessionId: input} : input ?? {};
        const targetSessionId = query.sessionId ?? requesterSessionId;
        if (typeof targetSessionId !== "number") {
            throw new Error("get_session 需要 sessionId，或在 agent session 内调用。");
        }
        const recentMessageLimit = query.recentMessageLimit ?? 3;
        const tokenBudget = query.tokenBudget ?? 1200;
        if (!Number.isInteger(recentMessageLimit) || recentMessageLimit < 1 || recentMessageLimit > 10) {
            throw new Error("get_session.recentMessageLimit 必须是 1 到 10 的整数。");
        }
        if (!Number.isInteger(tokenBudget) || tokenBudget < 100 || tokenBudget > 3000) {
            throw new Error("get_session.tokenBudget 必须是 100 到 3000 的整数。");
        }
        const recentMessageRoles = query.recentMessageRoles ? new Set<SessionRecentMessageRole>(query.recentMessageRoles) : null;
        const snapshot = await this.repo.readSession(targetSessionId);
        const context = this.repo.reduce(snapshot);
        const index = await this.relationIndex();
        const linkedAgents: AgentSummary[] = [];
        for (const linked of this.currentOwnedLinks(targetSessionId, index)) {
            linkedAgents.push(this.sessionSummary(await this.repo.readSession(linked.targetSessionId)));
        }
        const result: SessionQueryResult = {
            metadata: snapshot.metadata,
            activeLeafId: snapshot.leafId,
            title: context.title,
            summary: context.summary ?? this.sessionFallbackSummary(context.messages),
            usage: this.repo.usage(snapshot),
            linkedAgents,
        };
        if (!query.includeRecentMessages) {
            return result;
        }
        const recentMessages = this.repo.activePath(snapshot)
            .filter((entry) => entry.type === "message")
            .filter((entry) => {
                return !recentMessageRoles || recentMessageRoles.has(entry.message.role as SessionRecentMessageRole);
            })
            .slice(-recentMessageLimit)
            .map((entry) => ({
                role: entry.message.role as SessionRecentMessageRole,
                text: storedMessageText(entry.message).slice(0, 500),
                timestamp: entry.timestamp,
            }));
        const estimatedTokens = estimateTextTokens(JSON.stringify(recentMessages));
        if (estimatedTokens > tokenBudget) {
            throw new Error(`get_session recentMessages 超出 tokenBudget：估算 ${estimatedTokens} > ${tokenBudget}。复杂历史查询请到 session 文件目录使用 bash、jq、rg 自助查询。`);
        }
        return {
            ...result,
            recentMessages,
        };
    }

    private sessionFallbackSummary(messages: StoredAgentMessage[]): string | undefined {
        const latest = [...messages].reverse()
            .map((message) => storedMessageText(message, {stripThinking: true}))
            .find((text) => text.trim().length > 0);
        return latest?.replace(/\s+/g, " ").trim().slice(0, 360) || undefined;
    }

    private async prepare(snapshot: SessionSnapshot, options: {
        invocationId: string;
        pendingUserMessage?: StoredUserMessage;
        invocationPayload?: JsonValue;
        invocationMessage?: string;
        clientState?: ClientStateSnapshot;
        caller: AgentInvokeCaller;
        sessionContextEnabled: boolean;
    }): Promise<PreparedRunProfile> {
        const profile = await this.profiles.get(snapshot.metadata.profileKey);
        const context = this.repo.reduce(snapshot);
        const parsedInitial = this.profiles.parseInitial(profile, snapshot.metadata.initial);
        const configTarget = this.configTargetForInvocation(options.invocationId);
        const config = await loadEffectiveConfig(configTarget);
        const {settings, home} = await this.resolveProfileSettings(profile, config, context, configTarget.project);
        const runtimeSettings = this.resolveProfileRuntimeSettings(profile, config);
        const session = await this.createRuntimeSessionFacade({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            initial: parsedInitial,
            context,
            currentProject: configTarget.project,
        });
        const vars = await this.createProfileVariableAccessor(snapshot, profile, {clientState: options.clientState, invocationId: options.invocationId});
        const prepared = await profile.prepare!({
            session,
            initial: parsedInitial as never,
            invocation: {
                payload: options.invocationPayload as never,
                message: options.invocationMessage,
                clientState: options.clientState,
                caller: options.caller,
            },
            vars,
            settings: settings as never,
            ...(home ? {home} : {}),
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            workflows: await this.workflows.list(configTarget.project?.workspace),
            agentVisibleModels: resolveAgentVisibleModels(config),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
                currentProject: configTarget.project,
                pendingUserMessage: options.pendingUserMessage,
                sqlSchemaSummary: () => projectSqlSchemaSummary(configTarget.project),
            },
        });
        validateProfileTurnPlan(profile.manifest.key, prepared);
        parseStoredMessages(prepared.historyInitMessages ?? []);
        parseStoredMessages(prepared.appendingMessages ?? []);
        parseStoredMessages(prepared.modelContextAppendingMessages ?? []);
        parseStoredMessages(prepared.modelContextMessages ?? []);

        const materializedTurnContexts = await materializeProfileTurnContexts({
            plans: prepared.turnContexts ?? [],
            project: configTarget.project,
            sessionId: snapshot.metadata.sessionId,
            diffMaxChars: runtimeSettings.fileChangeNotice.diffMaxChars,
        });
        const preparedWithTurnContext: ProfileTurnPlan = {
            ...prepared,
            appendingMessages: mergeProfileTurnContextMessages(
                prepared.appendingMessages ?? [],
                materializedTurnContexts.insertions,
            ),
        };

        const writePlan = compilePrepareRunWritePlan({
            sessionId: snapshot.metadata.sessionId,
            profileKey: profile.manifest.key,
            context,
            prepared: preparedWithTurnContext,
            sessionContextEnabled: options.sessionContextEnabled,
        });
        return {
            plan: preparedWithTurnContext,
            writePlan,
            turnContextSettlements: materializedTurnContexts.settlements,
            runtimeSettings,
        };
    }

    /** 唯一正式 link 写入口；调用方必须已经持有关系变更队列。 */
    private async appendAgentLinkUnlocked(ownerSessionId: number, targetSessionId: number, profileKey: string): Promise<void> {
        await new ToolSessionWriteSink({
            executor: this.writeExecutor,
            sessionId: ownerSessionId,
        }).append("agent.link", {
            type: "custom",
            key: `agent.link.${targetSessionId}`,
            value: {
                sessionId: targetSessionId,
                profileKey,
            },
        });
    }

    private prepareInvocationPayload(profile: AgentProfile, message: string | undefined, payload: JsonValue | undefined): PreparedInvocationPayload {
        return {
            payload: this.profiles.parsePayload(profile, payload),
            message,
        };
    }

    /**
     * source invocation 完成后的后台摘要调度入口。
     *
     * 这里只负责调度和 preflight；Profile 生成摘要内容，Harness 统一把结果写回 source session。
     */
    private async scheduleSessionSummarizer(sourceSessionId: number, options: {force?: boolean} = {}): Promise<void> {
        const running = this.summarizerRuns.get(sourceSessionId);
        if (running) {
            running.rerunRequested = true;
            if (options.force) {
                running.forceRequested = true;
            }
            await this.writeSummarizerState(sourceSessionId, {
                ...this.readSummarizerState(this.repo.reduce(await this.repo.readSession(sourceSessionId))),
                dirty: true,
            }, "summarizer.dirty");
            return;
        }

        const job: SessionSummarizerJob = {
            rerunRequested: false,
            forceRequested: options.force === true,
            promise: Promise.resolve(),
        };
        job.promise = this.runSessionSummarizerJob(sourceSessionId, job).finally(() => {
            this.summarizerRuns.delete(sourceSessionId);
        });
        this.summarizerRuns.set(sourceSessionId, job);
        await job.promise;
    }

    private async runSessionSummarizerJob(sourceSessionId: number, job: SessionSummarizerJob): Promise<void> {
        // 每个 job 只读取一次有效配置，后续 dirty rerun 复用同一策略快照。
        let summarizerSettings: ProfileRuntimeSettings["summarizer"] | undefined;
        do {
            job.rerunRequested = false;
            const force = job.forceRequested;
            job.forceRequested = false;
            const sourceSnapshot = await this.repo.readSession(sourceSessionId);
            if (sourceSnapshot.metadata.systemRole === "summarizer") {
                return;
            }
            const sourceProfile = await this.profiles.get(sourceSnapshot.metadata.profileKey);
            if (!summarizerSettings) {
                const effectiveConfig = await loadEffectiveConfig(resolveNonInvocationConfigTarget(sourceSnapshot.metadata, this.workspaceRoot));
                summarizerSettings = this.resolveProfileRuntimeSettings(sourceProfile, effectiveConfig).summarizer;
            }
            const config = resolveProfileSummarizer(summarizerSettings, force);
            if (!config) {
                continue;
            }
            await this.runSessionSummarizer(sourceSnapshot, config, force);
            const latest = await this.repo.readSession(sourceSessionId);
            const latestState = this.readSummarizerState(this.repo.reduce(latest));
            if (latestState.dirty && this.shouldAttemptDirtySummarizerRerun(latestState)) {
                job.rerunRequested = true;
            }
        } while (job.rerunRequested || job.forceRequested);
    }

    private shouldAttemptDirtySummarizerRerun(state: SessionSummarizerState): boolean {
        return state.lastError === undefined;
    }

    /**
     * 测试辅助：等待指定 source session 的 summarizer 后台任务结束。
     */
    async drainSessionSummarizer(sourceSessionId: number): Promise<void> {
        while (this.summarizerRuns.has(sourceSessionId)) {
            await this.summarizerRuns.get(sourceSessionId)?.promise;
        }
    }

    /**
     * 运行一次 summarizer preflight + 隐藏 run。force=true 时跳过 fingerprint/间隔判定
     * （用户显式 summarize 命令），但仍受 maxDialogueContentTokens 上限约束。
     */
    private async runSessionSummarizer(sourceSnapshot: SessionSnapshot, config: NonNullable<ReturnType<typeof resolveProfileSummarizer>>, force = false): Promise<void> {
        const profileKey = config.profileKey;
        const summarizerInput = this.summarizerInput(sourceSnapshot.metadata.sessionId, config.input);
        const summarizerInputFingerprint = stableJsonHash({
            profileKey,
            initial: summarizerInput,
        });
        const dialogue = buildAgentDialogueContent({
            repo: this.repo,
            snapshot: sourceSnapshot,
            summarizerProfileKey: profileKey,
            summarizerInput,
        });
        const state = this.readSummarizerState(this.repo.reduce(sourceSnapshot));
        const interval = this.summarizerInterval(config.input);
        const sourcePromptUserTurnCount = this.countPromptUserTurns(sourceSnapshot);
        if (!force && !this.shouldRunSummarizer(state, dialogue, interval, summarizerInputFingerprint, sourcePromptUserTurnCount)) {
            if (state.running || state.dirty) {
                await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                    ...state,
                    running: false,
                    dirty: false,
                    lastDialogueContentTokens: dialogue.tokens,
                    lastDialogueContentFingerprint: dialogue.fingerprint,
                }, "summarizer.preflight.skip");
            }
            return;
        }
        const maxTokens = this.summarizerMaxTokens(config.input);
        if (dialogue.tokens > maxTokens) {
            await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                ...state,
                profileKey,
                summarizerInputFingerprint,
                running: false,
                dirty: false,
                sourceLeafId: sourceSnapshot.leafId,
                lastDialogueContentTokens: dialogue.tokens,
                lastError: `Agent Dialogue Content token 估算 ${dialogue.tokens} 超过 summarizer 上限 ${maxTokens}，已跳过本次摘要。`,
            }, "summarizer.preflight.tooLarge");
            return;
        }

        const summarizerSession = await this.ensureSummarizerSession({
            sourceSnapshot,
            profileKey,
            initial: summarizerInput,
            state,
            summarizerInputFingerprint,
        });
        await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
            ...state,
            sessionId: summarizerSession.metadata.sessionId,
            profileKey,
            summarizerInputFingerprint,
            running: true,
            dirty: false,
            sourceLeafId: sourceSnapshot.leafId,
            runningSourcePromptUserTurnCount: sourcePromptUserTurnCount,
            runningDialogueContentTokens: dialogue.tokens,
            runningDialogueContentFingerprint: dialogue.fingerprint,
            lastError: undefined,
        }, "summarizer.preflight.start");

        const result = await this.invokeAgent({
            sessionId: summarizerSession.metadata.sessionId,
            mode: "continue",
            caller: {
                kind: "system",
                sessionId: sourceSnapshot.metadata.sessionId,
                profileKey: sourceSnapshot.metadata.profileKey,
            },
            messageIdentity: "system",
            internalQueued: true,
        });
        if (result.status === "error") {
            await this.writeSummarizerState(sourceSnapshot.metadata.sessionId, {
                ...this.readSummarizerState(this.repo.reduce(await this.repo.readSession(sourceSnapshot.metadata.sessionId))),
                running: false,
                dirty: false,
                lastError: result.error ?? "summarizer 运行失败。",
            }, "summarizer.error");
            return;
        }
        await this.settleSessionSummarizerResult(sourceSnapshot.metadata.sessionId, result.reportResult?.data);
    }

    /**
     * 把 hidden summarizer 的结构化结果写回 source session。
     * source leaf 在运行期间变化时不覆盖展示信息，只标 dirty 让 job 基于新 leaf 重跑。
     */
    private async settleSessionSummarizerResult(sourceSessionId: number, data: unknown): Promise<void> {
        const result = isRecord(data) ? data : {};
        if (typeof result.title !== "string" || typeof result.summary !== "string") {
            const current = this.readSummarizerState(this.repo.reduce(await this.repo.readSession(sourceSessionId)));
            await this.writeSummarizerState(sourceSessionId, {
                ...current,
                running: false,
                dirty: false,
                lastError: "summarizer 未返回合法 title/summary。",
            }, "summarizer.result.invalid");
            return;
        }
        const latestSnapshot = await this.repo.readSession(sourceSessionId);
        const latestContext = this.repo.reduce(latestSnapshot);
        const current = this.readSummarizerState(latestContext);
        if (latestSnapshot.leafId !== current.sourceLeafId) {
            await this.writeSummarizerState(sourceSessionId, {
                ...current,
                running: false,
                dirty: true,
            }, "summarizer.result.stale");
            return;
        }
        const {
            runningDialogueContentFingerprint,
            runningDialogueContentTokens,
            runningSourcePromptUserTurnCount,
            lastError: _lastError,
            ...settled
        } = current;
        const updates = {
            ...(readTitleOwner(latestContext.customState) === "auto" ? {title: this.normalizeSessionTitle(result.title, "summarizer.title")} : {}),
            summary: result.summary.trim(),
        };
        await this.executeWritePlan({
            target: {sessionId: sourceSessionId},
            cause: "summarizer.result",
            ops: [
                {
                    kind: "append",
                    projection: true,
                    entry: {type: "session_update", updates},
                },
                {
                    kind: "append",
                    projection: true,
                    entry: {
                        type: "custom",
                        key: SESSION_SUMMARIZER_STATE_KEY,
                        value: {
                            ...settled,
                            running: false,
                            dirty: false,
                            ...(runningSourcePromptUserTurnCount !== undefined ? {sourcePromptUserTurnCount: runningSourcePromptUserTurnCount} : {}),
                            ...(runningDialogueContentTokens !== undefined ? {lastDialogueContentTokens: runningDialogueContentTokens} : {}),
                            ...(runningDialogueContentFingerprint !== undefined ? {lastDialogueContentFingerprint: runningDialogueContentFingerprint} : {}),
                            lastRunAt: Date.now(),
                        },
                    },
                },
            ],
        });
    }

    private async ensureSummarizerSession(input: {
        sourceSnapshot: SessionSnapshot;
        profileKey: string;
        initial: JsonValue;
        state: SessionSummarizerState;
        summarizerInputFingerprint: string;
    }): Promise<SessionSnapshot> {
        if (input.state.sessionId && input.state.profileKey === input.profileKey && input.state.summarizerInputFingerprint === input.summarizerInputFingerprint) {
            try {
                const existing = await this.repo.readSession(input.state.sessionId);
                if (existing.metadata.systemRole === "summarizer" && existing.metadata.profileKey === input.profileKey) {
                    return existing;
                }
            } catch {
                // session 文件缺失时直接重建后台 summarizer session。
            }
        }
        return this.createSystemAgent({
            profileKey: input.profileKey,
            initial: input.initial,
            currentProjectRoot: input.sourceSnapshot.metadata.currentProjectRoot,
            systemRole: "summarizer",
        });
    }

    private summarizerInput(sourceSessionId: number, input: JsonValue | undefined): JsonValue {
        return {
            ...(isRecord(input) ? input : {}),
            sourceSessionId,
        };
    }

    private summarizerInterval(input: JsonValue | undefined): {kind: "sourceInvocation" | "dialogueContentTokens"; value: number} {
        const interval = isRecord(input) && isRecord(input.interval) ? input.interval : undefined;
        const kind = interval?.kind === "dialogueContentTokens" ? "dialogueContentTokens" : "sourceInvocation";
        const value = typeof interval?.value === "number" && Number.isFinite(interval.value) && interval.value > 0 ? interval.value : 1;
        return {kind, value};
    }

    private summarizerMaxTokens(input: JsonValue | undefined): number {
        const value = isRecord(input) && typeof input.maxDialogueContentTokens === "number" ? input.maxDialogueContentTokens : 80_000;
        return Number.isFinite(value) && value > 0 ? value : 80_000;
    }

    private shouldRunSummarizer(
        state: SessionSummarizerState,
        dialogue: ReturnType<typeof buildAgentDialogueContent>,
        interval: {kind: "sourceInvocation" | "dialogueContentTokens"; value: number},
        summarizerInputFingerprint: string,
        sourcePromptUserTurnCount: number,
    ): boolean {
        if (state.summarizerInputFingerprint !== summarizerInputFingerprint) {
            return true;
        }
        if (state.lastError) {
            return true;
        }
        if (!state.lastDialogueContentFingerprint) {
            return true;
        }
        if (state.sourcePromptUserTurnCount === undefined) {
            return true;
        }
        if (state.lastDialogueContentFingerprint === dialogue.fingerprint) {
            return false;
        }
        if (interval.kind === "dialogueContentTokens") {
            return Math.abs(dialogue.tokens - (state.lastDialogueContentTokens ?? 0)) >= interval.value;
        }
        return sourcePromptUserTurnCount - (state.sourcePromptUserTurnCount ?? 0) >= interval.value;
    }

    private async writeSummarizerState(sessionId: number, state: SessionSummarizerState, cause: string): Promise<void> {
        await this.executeWritePlan({
            target: {sessionId},
            cause,
            ops: [{
                kind: "append",
                projection: true,
                entry: {
                    type: "custom",
                    key: SESSION_SUMMARIZER_STATE_KEY,
                    value: state,
                },
            }],
        });
    }

    private assertValidProfileStateWrite(profileKey: string, write: SessionEntryDraft): void {
        assertValidProfileStateWrite(profileKey, write);
    }

    private countPromptUserTurns(snapshot: SessionSnapshot): number {
        return this.repo.activePath(snapshot).filter((entry) => {
            return entry.type === "message" && entry.origin === "prompt" && entry.message.role === "user";
        }).length;
    }

    private readSummarizerState(context: NeuroSessionContext): SessionSummarizerState {
        const value = context.customState[SESSION_SUMMARIZER_STATE_KEY];
        if (!isRecord(value)) {
            return {};
        }
        return {
            sessionId: typeof value.sessionId === "number" ? value.sessionId : undefined,
            profileKey: typeof value.profileKey === "string" ? value.profileKey : undefined,
            summarizerInputFingerprint: typeof value.summarizerInputFingerprint === "string" ? value.summarizerInputFingerprint : undefined,
            running: typeof value.running === "boolean" ? value.running : undefined,
            dirty: typeof value.dirty === "boolean" ? value.dirty : undefined,
            sourceLeafId: typeof value.sourceLeafId === "string" || value.sourceLeafId === null ? value.sourceLeafId : undefined,
            sourcePromptUserTurnCount: typeof value.sourcePromptUserTurnCount === "number" ? value.sourcePromptUserTurnCount : undefined,
            lastDialogueContentFingerprint: typeof value.lastDialogueContentFingerprint === "string" ? value.lastDialogueContentFingerprint : undefined,
            lastDialogueContentTokens: typeof value.lastDialogueContentTokens === "number" ? value.lastDialogueContentTokens : undefined,
            runningDialogueContentFingerprint: typeof value.runningDialogueContentFingerprint === "string" ? value.runningDialogueContentFingerprint : undefined,
            runningDialogueContentTokens: typeof value.runningDialogueContentTokens === "number" ? value.runningDialogueContentTokens : undefined,
            runningSourcePromptUserTurnCount: typeof value.runningSourcePromptUserTurnCount === "number" ? value.runningSourcePromptUserTurnCount : undefined,
            lastRunAt: typeof value.lastRunAt === "number" ? value.lastRunAt : undefined,
            lastError: typeof value.lastError === "string" ? value.lastError : undefined,
        };
    }

    /**
     * 批量追加 resolutions 到 session。
     */
    private async appendResolutions(snapshot: SessionSnapshot, resolutions: AgentResolution[], invocationId?: string): Promise<void> {
        for (const resolution of resolutions) {
            assertPublicToolCallId(resolution.toolCallId);
        }
        const context = this.repo.reduce(snapshot);
        const messages = storedMessagesForText(context.messages);
        const pendingApprovals = findPendingApprovalCalls(messages, await this.userResolutionToolKeysForSnapshot(snapshot));

        if (pendingApprovals.length === 0) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }

        // 验证所有 resolution 都有对应的 pending approval
        const pendingMap = new Map(pendingApprovals.map((p) => [p.toolCallId, p]));
        for (const resolution of resolutions) {
            const pending = pendingMap.get(resolution.toolCallId);
            if (!pending) {
                throw new Error(`resolution toolCallId ${resolution.toolCallId} 没有对应的 pending approval`);
            }
        }

        // 验证所有 pending approvals 都有对应的 resolution
        const resolutionMap = new Map(resolutions.map((r) => [r.toolCallId, r]));
        for (const pending of pendingApprovals) {
            if (!resolutionMap.has(pending.toolCallId)) {
                throw new Error(`pending approval ${pending.toolCallId} (${pending.toolName}) 缺少对应的 resolution`);
            }
        }

        // 按 pending approvals 顺序写入 tool results
        const entries: AppendManySessionEntryDraft[] = [];
        for (const pending of pendingApprovals) {
            const resolution = resolutionMap.get(pending.toolCallId)!;
            // Task 90: 注入的写审批批准后真实执行工具，以执行结果落库
            const writerResult = await this.writerApprovalToolResult(snapshot, context, pending, resolution, invocationId);
            // Task 111: 声明式 approvalRequired 工具（如 run_workflow）同一契约——批准后真实执行
            const declaredResult = writerResult ?? await this.declaredApprovalToolResult(snapshot, pending, resolution, invocationId);
            const storedResolution = await this.withModeSwitchPreview(snapshot, pending, resolution);
            entries.push({
                type: "message",
                message: writerResult ?? declaredResult ?? resolutionToToolResult(storedResolution, pending),
                origin: "harness",
            });
            entries.push(this.clearPendingUserResolutionEntry(pending));
        }

        await this.executeWritePlan({
            target: {sessionId: snapshot.metadata.sessionId},
            cause: "resolution",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries,
            }],
        }, invocationId);

        // 处理 mode switch transitions
        for (const pending of pendingApprovals) {
            const resolution = resolutionMap.get(pending.toolCallId)!;
            const approved = this.modeSwitchDecision(pending, resolution);
            if (approved !== null) {
                await this.appendModeSwitchResolution(snapshot, context, pending, approved, invocationId);
            }
        }
    }

    private async appendResolution(snapshot: SessionSnapshot, resolution: AgentResolution, invocationId?: string): Promise<void> {
        assertPublicToolCallId(resolution.toolCallId);
        const context = this.repo.reduce(snapshot);
        const messages = storedMessagesForText(context.messages);
        const pending = findPendingApprovalCall(messages, await this.userResolutionToolKeysForSnapshot(snapshot));
        if (!pending) {
            throw new Error("当前 session 没有等待中的审批 tool call");
        }
        // Task 90: 注入的写审批批准后真实执行工具，以执行结果落库
        const writerResult = await this.writerApprovalToolResult(snapshot, context, pending, resolution, invocationId);
        // Task 111: 声明式 approvalRequired 工具（如 run_workflow）同一契约——批准后真实执行
        const declaredResult = writerResult ?? await this.declaredApprovalToolResult(snapshot, pending, resolution, invocationId);
        const storedResolution = await this.withModeSwitchPreview(snapshot, pending, resolution);
        await this.executeWritePlan({
            target: {sessionId: snapshot.metadata.sessionId},
            cause: "resolution",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries: [
                    {
                        type: "message",
                        message: writerResult ?? declaredResult ?? resolutionToToolResult(storedResolution, pending),
                        origin: "harness",
                    },
                    this.clearPendingUserResolutionEntry(pending),
                ],
            }],
        }, invocationId);

        const approved = this.modeSwitchDecision(pending, resolution);
        if (approved !== null) {
            await this.appendModeSwitchResolution(snapshot, context, pending, approved, invocationId);
        }
    }

    /**
     * 为 switch_mode（targetMode=normal）的历史审批结果补齐 UI-only 计划文件预览。
     */
    private async withModeSwitchPreview(
        snapshot: SessionSnapshot,
        pending: {toolName: string; args: Record<string, unknown>},
        resolution: AgentResolution,
    ): Promise<AgentResolution> {
        if (pending.toolName !== "switch_mode" || this.readTargetMode(pending.args) !== "normal") {
            return resolution;
        }
        const planFilePath = typeof pending.args.planFilePath === "string" ? pending.args.planFilePath.trim() : "";
        if (!planFilePath) {
            return resolution;
        }
        const preview: {[key: string]: JsonValue} = {
            planFilePath,
        };
        try {
            const target = resolvePlanModeFile({
                workspaceRoot: this.workspaceRoot,
                currentProject: this.readyProjectForMetadata(snapshot.metadata),
                planFilePath,
            });
            preview.planFilePath = target.displayPath;
            preview.planContent = await readFile(target.absolutePath, "utf-8");
        } catch {
            // 计划文件可能在等待审批期间被移动或删除；审批结果仍应正常落库。
        }
        if (resolution.kind === "user_input") {
            const data = resolution.data && typeof resolution.data === "object" && !Array.isArray(resolution.data)
                ? resolution.data as Record<string, JsonValue>
                : {userInput: resolution.data ?? null};
            const userInput = "userInput" in data ? data.userInput : resolution.data ?? null;
            return {
                ...resolution,
                data: {
                    ...data,
                    userInput,
                    ...preview,
                },
            };
        }
        return {
            ...resolution,
            data: preview,
        };
    }

    /**
     * 消费 switch_mode 审批结果并写入模式状态（Task 90）。
     * 批准 → 切到 targetMode（phase 按 enter/reentry/exit 计算）；拒绝 → 保持原模式，写 steady 轻提醒。
     * no-op（已在目标模式）不写状态，避免 updatedAt 变化重复触发 reminder。
     */
    private async appendModeSwitchResolution(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        pending: {toolName: string; args: Record<string, unknown>},
        approved: boolean,
        invocationId?: string,
    ): Promise<void> {
        const targetMode = this.readTargetMode(pending.args);
        if (!targetMode) {
            return;
        }
        const reason = typeof pending.args.reason === "string" ? pending.args.reason : undefined;
        if (!approved) {
            await this.appendCustomState(snapshot.metadata.sessionId, AGENT_MODE_STATE_KEY, this.agentModeState(snapshot, context, {
                mode: context.agentMode,
                fromMode: context.agentMode,
                phase: "steady",
            }, "switch_mode", {approved, reason}), invocationId);
            return;
        }
        if (targetMode === context.agentMode) {
            return;
        }
        const phase = this.modeSwitchPhase(targetMode, context);
        await this.appendCustomState(snapshot.metadata.sessionId, AGENT_MODE_UI_STATE_KEY, targetMode, invocationId);
        await this.appendCustomState(snapshot.metadata.sessionId, AGENT_MODE_STATE_KEY, this.agentModeState(
            snapshot,
            context,
            {mode: targetMode, fromMode: context.agentMode, phase},
            "switch_mode",
            {approved, reason},
        ), invocationId);
    }

    /**
     * 从 switch_mode 参数读取合法 targetMode；非法值返回 null。
     */
    private readTargetMode(args: Record<string, unknown>): AgentMode | null {
        const value = args.targetMode;
        return value === "normal" || value === "discuss" || value === "plan" ? value : null;
    }

    private modeSwitchDecision(pending: {toolName: string}, resolution: AgentResolution): boolean | null {
        if (pending.toolName !== "switch_mode") {
            return null;
        }
        return this.resolutionApprovalDecision(resolution);
    }

    /**
     * 从 resolution 中读取"批准/拒绝"判定；无法判定时返回 null。
     * 供 switch_mode 审批与只读模式写审批（Task 90）共用。
     */
    private resolutionApprovalDecision(resolution: AgentResolution): boolean | null {
        if (resolution.kind === "tool_approval") {
            return resolution.approved;
        }
        const userInput = this.resolutionUserInput(resolution);
        if (isRecord(userInput) && typeof userInput.approved === "boolean") {
            return userInput.approved;
        }
        const firstAnswer = resolution.answers?.[0];
        if (firstAnswer?.selectedOptionIndex === 0) {
            return true;
        }
        if (firstAnswer?.selectedOptionIndex === 1) {
            return false;
        }
        return null;
    }

    private resolutionUserInput(resolution: AgentResolution): JsonValue | undefined {
        const data = resolution.data;
        if (data && typeof data === "object" && !Array.isArray(data) && "userInput" in data) {
            return (data as {userInput?: JsonValue}).userInput;
        }
        return data;
    }

    private async runLoop(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        systemPrompt: string;
        messages: StoredAgentMessage[];
        promptPrefix?: PromptPrefixAttribution;
        models: Models;
        model: Model<any>;
        apiKey?: string;
        timeoutMs?: number | null;
        requestOptions?: Record<string, JsonValue>;
        compaction?: ProfileRuntimeSettings["compaction"];
        fileChangeDiffMaxChars?: number;
        piTrace?: PiTraceSettings;
        sessionContextEnabled: boolean;
        toolKeys: string[];
        executionToolKeys?: string[];
        profileKey: string;
        profile: AgentProfile;
        /** 本 run 的 Agent 工作模式（Task 90）。 */
        agentMode: AgentMode;
        profileTurnContexts?: RunFrame["profileTurnContexts"];
        pendingProfileTurnContextSettlements?: RunFrame["pendingProfileTurnContextSettlements"];
        thinkingLevel: ThinkingLevel;
        runtimeState: RunRuntimeState;
        reportResultReminderEnabled: boolean;
        caller: AgentInvokeCaller;
        abortSignal?: AbortSignal;
        invocationId?: string;
        onEvent?: (event: AgentRuntimeStreamEventDto) => void | Promise<void>;
        transcriptParentLeafId?: SessionEntryId | null;
    }): Promise<RunLoopResult> {
        const frame = createRunFrame(input);

        this.assertNoUnclosedToolCallsForModel(storedMessagesForText(frame.messages) as AgentMessage[], this.userResolutionToolKeysForProfile(frame.profile));
        await this.emitRuntimeEvent(frame, {type: "agent_start"});
        let shouldContinue = true;
        let failedResult: RunLoopResult | undefined;
        while (shouldContinue) {
            const transaction = await this.runTurnTransaction(frame);
            if (transaction.kind === "failed") {
                failedResult = transaction.result;
                break;
            }
            if (transaction.kind === "waiting") {
                await this.emitRuntimeEvent(frame, {
                    type: "agent_end",
                    status: "waiting",
                    usage: frame.usage,
                });
                return transaction.result;
            }
            shouldContinue = transaction.shouldContinue;
        }
        this.steerableSessions.delete(frame.sessionId);
        const failedTerminalStatus = failedResult?.status === "failed" && (failedResult.terminalStatus === "aborted" || failedResult.terminalStatus === "interrupted")
            ? failedResult.terminalStatus
            : "failed";
        await this.emitRuntimeEvent(frame, {
            type: "agent_end",
            status: failedResult ? failedTerminalStatus : "completed",
            usage: frame.usage,
        });
        if (failedResult) {
            return failedResult;
        }
        return {
            status: "completed",
            finalAssistant: frame.finalAssistant,
            usage: frame.usage,
            reportResult: frame.reportResult,
        };
    }

    /**
     * 执行一个完整 Turn Transaction。
     *
     * 这里是 Run Kernel 的核心安全点：进入模型前 drain steer，provider/tool 完成后 ingest，
     * 再决定 waiting、failed 或准备下一轮。
     */
    private async runTurnTransaction(frame: RunFrame): Promise<RunTurnTransactionResult> {
        // 取消可能落在上一轮的工具执行里：那一轮的结果已经 ingest 落盘，但不能再开新的一轮。
        // 这里必须看 abortSignal 而不是 ownsInvocation —— 用户主动取消只把 active.status 改成 aborting，
        // invocation 仍是本会话的当前运行，下面那个 ownsInvocation fence 恒为 true，挡不住用户取消。
        if (frame.abortSignal?.aborted) {
            return {
                kind: "failed",
                result: {
                    status: "failed",
                    finalAssistant: frame.finalAssistant,
                    usage: frame.usage,
                    errorInfo: {message: "", phase: "unknown"},
                    terminalStatus: "aborted",
                },
            };
        }
        frame.turnIndex += 1;
        await this.emitRuntimeEvent(frame, {type: "turn_start", turnIndex: frame.turnIndex});
        if (frame.turnIndex > 1) {
            await this.appendProfileTurnContexts(frame);
        }
        const preModelSteers = await this.drainSteers({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId,
        });
        if (preModelSteers.leafId) {
            frame.transcriptParentLeafId = preModelSteers.leafId;
        }
        for (const steeredMessage of preModelSteers.messages) {
            frame.messages.push(steeredMessage);
        }
        const turnSnapshot = await withRunKernelPhase("model", () => this.createTurnSnapshot(frame));
        const outcome = await this.executeTurn(frame, turnSnapshot);
        if (frame.invocationId && !this.ownsInvocation(frame.sessionId, frame.invocationId)) {
            return {
                kind: "failed",
                result: {
                    status: "failed",
                    errorInfo: this.toInvocationErrorInfo("invocation aborted", "unknown"),
                    terminalStatus: "aborted",
                },
            };
        }
        if (outcome.kind === "failed") {
            this.steerableSessions.delete(frame.sessionId);
            const failedIngestDraft = createFailedTurnIngestDraft(outcome);
            const ingest = failedIngestDraft ? await withRunKernelPhase("ingest", () => this.ingestTurn(frame, failedIngestDraft)) : undefined;
            const transaction = applyFailedTurnTransaction(frame, outcome, ingest);
            if (ingest) {
                this.clearPersistedTranscriptReplayAnchor(frame, ingest);
            }
            await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: "failed"});
            return {
                kind: "failed",
                result: transaction.result,
            };
        }

        const turn = outcome.turn;
        const ingest = await withRunKernelPhase("ingest", () => this.ingestTurn(frame, {
            assistant: turn.assistant,
            toolResults: turn.toolResults,
            waiting: turn.waiting,
        }));
        const transaction = applySuccessfulTurnTransaction(frame, outcome, ingest);
        this.clearPersistedTranscriptReplayAnchor(frame, ingest);
        await settleProfileTurnContexts(frame.pendingProfileTurnContextSettlements ?? []);
        frame.pendingProfileTurnContextSettlements = [];
        if (!turn.waiting) {
            this.steerableSessions.delete(frame.sessionId);
        }
        if (transaction.kind === "completed" && frame.reportResultErrorCount >= REPORT_RESULT_ERROR_LIMIT) {
            const toolName = "report_result";
            await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: "failed"});
            return {
                kind: "failed",
                result: {
                    status: "failed",
                    finalAssistant: frame.finalAssistant,
                    errorInfo: {
                        message: providerErrorText(`${toolName} 连续失败 ${REPORT_RESULT_ERROR_LIMIT} 次，最后错误：${frame.lastReportResultError ?? "unknown"}`),
                        phase: "tool",
                    },
                    terminalStatus: "error",
                },
            };
        }
        await this.emitRuntimeEvent(frame, {type: "turn_end", turnIndex: frame.turnIndex, status: turn.waiting ? "waiting" : "completed"});
        if (transaction.kind === "waiting") {
            return {
                kind: "waiting",
                result: transaction.result,
            };
        }

        const continuation = await this.resolveTurnContinuation(frame, transaction.turn);
        await this.prepareNextTurn(frame, turn, continuation);
        if (continuation.continue) {
            this.steerableSessions.add(frame.sessionId);
        }
        return {
            kind: "next",
            shouldContinue: continuation.continue,
        };
    }

    /**
     * 物化并追加 Profile 声明的逐 turn 动态上下文。
     * 具体查询、正文与结算语义由 profiles/profile-turn-context.ts 持有。
     */
    private async appendProfileTurnContexts(frame: RunFrame): Promise<void> {
        const plans = frame.profileTurnContexts ?? [];
        if (plans.length === 0) {
            return;
        }
        if (!frame.invocationId) {
            throw new Error("Profile turn context缺少invocationId");
        }
        const materialized = await materializeProfileTurnContexts({
            plans,
            project: this.projectForInvocation(frame.invocationId),
            sessionId: frame.sessionId,
            diffMaxChars: frame.fileChangeDiffMaxChars ?? 512,
        });
        const messages = materialized.insertions
            .sort((left, right) => left.appendingIndex - right.appendingIndex)
            .map((insertion) => insertion.message);
        if (messages.length === 0) {
            return;
        }
        frame.messages.push(...messages);
        frame.pendingProfileTurnContextSettlements = [
            ...frame.pendingProfileTurnContextSettlements ?? [],
            ...materialized.settlements,
        ];
        if (frame.lastTurnIngest?.transcript === "runtime_only") {
            return;
        }
        const entries = await withRunKernelPhase("ingest", () => this.executeWritePlan({
            target: {sessionId: frame.sessionId},
            cause: "profile.turn-context",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries: messages.map((message) => ({
                    type: "custom_message" as const,
                    message,
                    visibleToModel: true,
                })),
            }],
        }, frame.invocationId));
        const contextEntry = entries.at(-1);
        if (contextEntry) {
            frame.transcriptParentLeafId = contextEntry.id;
        }
    }

    /**
     * 投影并发布 provider/tool raw event。
     */
    private async emitFrameEvent(frame: RunFrame, event: AgentEvent): Promise<void> {
        const projected = projectRuntimeEvent(frame.publicEventProjection, event);
        if (!projected) {
            return;
        }
        await this.emitRuntimeEvent(frame, projected);
    }

    /**
     * 发布公开 runtime event。SSE 和 callback 都只接触这个轻量 DTO。
     */
    private async emitRuntimeEvent(frame: RunFrame, event: AgentRuntimeStreamEventDto): Promise<AgentSessionEventDto | null> {
        if (frame.invocationId && !this.ownsInvocation(frame.sessionId, frame.invocationId)) {
            return null;
        }
        // 宿主 observer 获得独立 DTO，禁止其修改随后进入 EventHub/replay 的公开事件。
        await frame.onEvent?.(structuredClone(event));
        const shouldCreateAnchor = event.type === "turn_start" && !this.transcriptReplayAnchors.has(frame.sessionId);
        if (shouldCreateAnchor) {
            this.createTranscriptReplayAnchor(frame, this.eventHub.lastSeq(frame.sessionId) + 1);
        }
        try {
            return this.publishRuntimeEvent(frame.sessionId, frame.invocationId, event);
        } catch (error) {
            if (shouldCreateAnchor) {
                this.clearTranscriptReplayAnchor(frame.sessionId);
            }
            throw error;
        }
    }

    /**
     * 创建本轮 provider 请求的冻结快照。
     */
    private async createTurnSnapshot(frame: RunFrame): Promise<TurnSnapshot> {
        const snapshot = await this.repo.readSession(frame.sessionId);
        const context = this.repo.reduce(snapshot);
        const modelMessages = consumeNextTurnModelMessages(frame);
        const prepareTurn = await this.runRuntimeHooks({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId ?? "",
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            stage: "prepareTurn",
            snapshot,
            context,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            modelMessages,
        });
        const requestOptions = {
            ...frame.requestOptions,
            ...prepareTurn.requestOptionsPatch,
        };
        const toolKeys = frame.toolKeys;
        if (prepareTurn.toolKeysPatch) {
            // Runtime hook 只能裁剪 root tools，不能突破 profile 声明的最大工具集合。
            const rootToolKeys = new Set(frame.toolKeys);
            const invalidToolKey = prepareTurn.toolKeysPatch.find((toolKey) => !rootToolKeys.has(toolKey));
            if (invalidToolKey) {
                throw new Error(`runtime hook prepareTurn toolKeysPatch 必须是 profile root tools 子集：${invalidToolKey}`);
            }
        }
        const executionBaseToolKeySet = new Set(frame.executionToolKeys ?? toolKeys);
        const executionPatchToolKeySet = prepareTurn.toolKeysPatch ? new Set(prepareTurn.toolKeysPatch) : undefined;
        const executionToolKeys = toolKeys.filter((toolKey) => {
            if (!executionBaseToolKeySet.has(toolKey)) {
                return false;
            }
            return executionPatchToolKeySet ? executionPatchToolKeySet.has(toolKey) : true;
        });
        const toolOverrides = await this.toolOverrides(toolKeys, frame.profileKey, this.profiles.parseInitial(frame.profile, snapshot.metadata.initial));
        const tools = this.tools.allowedWithOverrides(toolKeys, toolOverrides);
        if (!frame.compaction?.enabled) {
            this.assertContextWithinWindow({
                messages: modelMessages,
                model: frame.model,
                profileKey: frame.profileKey,
            });
        }
        return {
            index: frame.turnIndex,
            sessionSnapshot: snapshot,
            sessionContext: context,
            systemPrompt: frame.systemPrompt,
            modelMessages,
            promptPrefix: frame.promptPrefix,
            models: frame.models,
            model: frame.model,
            apiKey: frame.apiKey,
            timeoutMs: frame.timeoutMs,
            requestOptions,
            toolKeys,
            executionToolKeys,
            toolOverrides,
            tools,
            thinkingLevel: frame.thinkingLevel,
        };
    }

    /**
     * 执行单个 ReAct turn，输出可被 ingest/failure path 消费的 TurnOutcome。
     */
    private async executeTurn(frame: RunFrame, snapshot: TurnSnapshot): Promise<TurnOutcome> {
        try {
            const assistant = await this.streamAssistant({
                snapshot,
                sessionId: frame.sessionId,
                abortSignal: frame.abortSignal,
                emit: (event) => this.emitFrameEvent(frame, event),
                trace: this.piTraceBinding(frame),
            });
            if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
                return {
                    kind: "failed",
                    phase: "provider",
                    // 取消不带正文：provider 抛的是英文原文，写进来就会被当成错误详情显示（Task 139）。
                    // 界面文案由前端 i18n 承担，服务端只负责说清「这是取消，不是失败」。
                    errorInfo: assistant.stopReason === "aborted"
                        ? {message: "", phase: "model"}
                        : this.toInvocationErrorInfo(assistant.errorMessage || "生成失败，provider 未返回错误详情。", "model"),
                    finalAssistant: assistant,
                    partialAssistant: sanitizePartialAssistant(assistant) ?? undefined,
                    messageStatus: assistant.stopReason === "aborted" ? "interrupted" : "partial",
                };
            }
            const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
            const toolBatch = await this.runToolBatch({
                sessionId: frame.sessionId,
                workspaceRoot: frame.workspaceRoot,
                currentProject: frame.currentProject,
                profileKey: frame.profileKey,
                invocationId: frame.invocationId,
                agentMode: snapshot.sessionContext.agentMode,
                assistant,
                toolCalls,
                executionToolKeys: snapshot.executionToolKeys,
                toolOverrides: snapshot.toolOverrides,
                enqueueSavePointWrite: (plan, source) => {
                    frame.pendingWritePlans.push({
                        ...source,
                        enqueueOrder: frame.pendingWritePlans.length,
                        plan,
                    });
                },
                abortSignal: frame.abortSignal,
                emit: (event) => this.emitFrameEvent(frame, event),
                messages: storedMessagesForText(frame.messages) as AgentMessage[],
            });
            const turn: RuntimeTurn = {
                index: snapshot.index,
                snapshot,
                assistant,
                toolCalls,
                toolResults: toolBatch.toolResults,
                reportResult: toolBatch.reportResult,
                reportResultError: toolBatch.reportResultError,
                waiting: toolBatch.waiting,
                shouldContinue: toolBatch.shouldContinue,
            };
            if (toolBatch.waiting) {
                return {
                    kind: "waiting",
                    turn,
                    waiting: toolBatch.waiting,
                };
            }
            return {
                kind: "completed",
                turn,
            };
        } catch (error) {
            const assistant = createRuntimeErrorAssistant(error);
            return {
                kind: "failed",
                phase: "provider",
                errorInfo: this.toInvocationErrorInfo(error, "model"),
                finalAssistant: assistant,
            };
        }
    }

    /**
     * 执行本轮 turn 的持久化 ingest。
     */
    private async ingestTurn(frame: RunFrame, input: {
        assistant: AssistantMessage;
        toolResults: RuntimeToolResult[];
        waiting?: RunToolBatchResult["waiting"];
        messageStatus?: "partial" | "interrupted" | "error";
    }): Promise<TurnIngestResult> {
        return this.commitTurn({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId,
            assistant: input.assistant,
            toolResults: input.toolResults,
            waiting: input.waiting,
            messageStatus: input.messageStatus,
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            pendingWritePlans: frame.pendingWritePlans,
            transcriptParentLeafId: frame.transcriptParentLeafId,
        });
    }

    /**
     * 在本轮 save point 后判断是否需要继续同一个 run。
     *
     * steer 在这里被 drain 成模型可见消息；真正为下一轮补充材料的动作放到 prepareNextTurn。
     */
    private async resolveTurnContinuation(frame: RunFrame, turn: RuntimeTurn): Promise<TurnContinuationDecision> {
        const drainedSteers = await this.drainSteers({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId,
        });
        if (drainedSteers.leafId) {
            frame.transcriptParentLeafId = drainedSteers.leafId;
        }
        return resolveTurnContinuation({
            turn,
            steeredMessages: drainedSteers.messages,
            hasReportResult: Boolean(frame.reportResult),
            reportResultReminderSent: frame.reportResultReminderSent,
            reportResultAllowed: frame.reportResultReminderEnabled && turn.snapshot.executionToolKeys.includes("report_result"),
        });
    }

    /**
     * 为同一个 run 的下一轮 turn 准备 runtime state 和模型可见消息。
     */
    private async prepareNextTurn(frame: RunFrame, turn: RuntimeTurn, decision: TurnContinuationDecision): Promise<void> {
        const preparation = applyNextTurnPreparation(frame, decision);
        if (preparation.reminderPlan) {
            const entries = await withRunKernelPhase("ingest", () => this.executeWritePlan(preparation.reminderPlan!, frame.invocationId));
            const reminderEntry = entries.findLast((entry) => entry.type === "message");
            if (reminderEntry) {
                frame.transcriptParentLeafId = reminderEntry.id;
            }
        }
        if (!preparation.shouldContinue) {
            return;
        }
        const snapshot = await this.repo.readSession(frame.sessionId);
        const context = this.repo.reduce(snapshot);
        const nextTurnHooks = await withRunKernelPhase("model", () => this.runRuntimeHooks({
            sessionId: frame.sessionId,
            invocationId: frame.invocationId ?? "",
            profile: frame.profile,
            runtimeState: frame.runtimeState,
            stage: "prepareNextTurn",
            snapshot,
            context,
            caller: frame.caller,
            turnIndex: frame.turnIndex,
            turn: {
                assistant: turn.assistant,
                toolResults: turn.toolResults.map((toolResult) => toolResult.stored),
                waiting: turn.waiting,
            },
            modelMessages: frame.messages,
        }));
        if (nextTurnHooks.reportResultReminder !== undefined) {
            frame.reportResultReminderEnabled = nextTurnHooks.reportResultReminder;
        }
        const compacted = await withRunKernelPhase("compaction", () => this.compactBeforeNextTurn(frame));
        if (compacted) {
            await withRunKernelPhase("ingest", () => this.reinjectHistorySetAfterCompaction(frame));
            const compactedSnapshot = await this.repo.readSession(frame.sessionId);
            frame.messages = this.repo.reduce(compactedSnapshot).messages;
        }
        frame.nextTurnRuntimeMessages = nextTurnHooks.runtimeMessages;
    }

    private async compactBeforeNextTurn(frame: RunFrame): Promise<boolean> {
        if (frame.automaticCompactionDoneForTurn) {
            return false;
        }
        if (!frame.compaction?.enabled) {
            this.assertContextWithinWindow(frame);
            return false;
        }
        const compacted = await compactIfNeeded({
            repo: this.repo,
            snapshot: await this.repo.readSession(frame.sessionId),
            messages: frame.messages,
            models: frame.models,
            model: frame.model,
            apiKey: frame.apiKey,
            thinkingLevel: frame.thinkingLevel,
            timeoutMs: frame.timeoutMs,
            requestOptions: frame.requestOptions,
            compaction: frame.compaction,
            trace: this.piTraceBinding(frame, "compaction"),
            signal: frame.abortSignal,
            writeCompactionEntry: async (entry) => {
                await new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: frame.sessionId,
                    invocationId: frame.invocationId,
                }).append("compact.auto", entry);
            },
        });
        frame.automaticCompactionDoneForTurn = compacted;
        return compacted;
    }

    /**
     * 自动 compact 会把早期 HistorySet 压进 summary；下一轮前补写一次初始化历史。
     */
    private async reinjectHistorySetAfterCompaction(frame: RunFrame): Promise<void> {
        if (!frame.sessionContextEnabled || !frame.profile.prepare) {
            return;
        }
        if (!frame.invocationId) {
            throw new Error("Compaction HistorySet reinject缺少invocationId");
        }
        const snapshot = await this.repo.readSession(frame.sessionId);
        const context = this.repo.reduce(snapshot);
        const parsedInitial = this.profiles.parseInitial(frame.profile, snapshot.metadata.initial);
        const configTarget = this.configTargetForInvocation(frame.invocationId);
        const config = await loadEffectiveConfig(configTarget);
        const {settings, home} = await this.resolveProfileSettings(frame.profile, config, context, configTarget.project);
        const prepared = await frame.profile.prepare({
            session: await this.createRuntimeSessionFacade({
                sessionId: frame.sessionId,
                profileKey: frame.profile.manifest.key,
                initial: parsedInitial,
                context,
                currentProject: configTarget.project,
            }),
            initial: parsedInitial as never,
            settings: settings as never,
            ...(home ? {home} : {}),
            vars: await this.createProfileVariableAccessor(snapshot, frame.profile, {
                dryRun: true,
                invocationId: frame.invocationId,
            }),
            catalog: await this.profiles.snapshot(),
            skills: await this.skills.list(),
            workflows: await this.workflows.list(configTarget.project?.workspace),
            agentVisibleModels: resolveAgentVisibleModels(config),
            runtime: {
                now: new Date().toISOString(),
                promptUserTurnCount: this.countPromptUserTurns(snapshot),
                currentProject: configTarget.project,
                sqlSchemaSummary: () => projectSqlSchemaSummary(configTarget.project),
            },
        });
        validateProfileTurnPlan(frame.profile.manifest.key, prepared);
        parseStoredMessages(prepared.historyInitMessages ?? []);
        parseStoredMessages(prepared.appendingMessages ?? []);
        parseStoredMessages(prepared.modelContextAppendingMessages ?? []);
        parseStoredMessages(prepared.modelContextMessages ?? []);
        if (!prepared.historyInitMessages?.length) {
            return;
        }
        await this.executeWritePlan({
            target: {sessionId: frame.sessionId},
            cause: "compact.history_set",
            ops: [{
                kind: "appendMany",
                entries: prepared.historyInitMessages.map((message) => ({
                    type: "custom_message" as const,
                    message,
                    visibleToModel: true,
                })),
            }],
        }, frame.invocationId);
    }

    /** Compaction 被有效配置关闭时主动阻止超窗口请求，避免静默依赖 provider overflow。 */
    private assertContextWithinWindow(frame: Pick<RunFrame, "messages" | "model" | "profileKey">): void {
        const usage = estimateStoredContextTokens(frame.messages);
        if (usage.tokens <= frame.model.contextWindow) {
            return;
        }
        throw new Error(`当前 profile ${frame.profileKey} 的有效配置已关闭 Compaction，上下文 ${usage.tokens} tokens 已超过模型 ${frame.model.id} 的 ${frame.model.contextWindow} token 限制。`);
    }

    /** 从 effective config 摘 Pi trace 设置三元组（prepareRun / 无 frame 场景共用）。 */
    private piTraceSettings(config: EffectiveConfig): PiTraceSettings {
        return {
            enabled: config.observability.piTrace.enabled,
            capturePayload: config.observability.piTrace.capturePayload,
            maxRecords: config.observability.piTrace.maxRecords,
        };
    }

    /** 从 RunFrame 组装本轮 Pi 请求 trace 绑定：recorder + config 解析的开关 + 领域关联。 */
    private piTraceBinding(frame: RunFrame, kind: PiTraceKind = "turn"): PiTraceBinding {
        return {
            recorder: this.piTraceRecorder,
            settings: {
                enabled: frame.piTrace?.enabled ?? false,
                capturePayload: frame.piTrace?.capturePayload ?? false,
                maxRecords: frame.piTrace?.maxRecords ?? 100,
            },
            correlation: {
                kind,
                sessionId: frame.sessionId,
                invocationId: frame.invocationId,
                profileKey: frame.profileKey,
                turnIndex: frame.turnIndex,
                mode: frame.caller.kind,
            },
        };
    }

    /** 无 RunFrame 时（手动 compact / health-check）从 effective config 组装正式 trace 绑定。 */
    traceBinding(config: EffectiveConfig, correlation: PiTraceCorrelation): PiTraceBinding {
        return {
            recorder: this.piTraceRecorder,
            settings: this.piTraceSettings(config),
            correlation,
        };
    }

    private async streamAssistant(input: {
        snapshot: TurnSnapshot;
        sessionId: number;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        trace: PiTraceBinding;
    }): Promise<AssistantMessage> {
        const storedMessages = parseStoredMessages(input.snapshot.modelMessages);
        const authorizedMessages = await this.sessionAttachments.authorizeMessages(input.sessionId, storedMessages);
        const providerMessages = await this.attachmentCodec.hydrateForProvider(authorizedMessages, input.snapshot.model);
        const context = {
            systemPrompt: input.snapshot.systemPrompt,
            messages: providerMessages,
            tools: input.snapshot.tools,
        };
        const traceContext = {
            systemPrompt: input.snapshot.systemPrompt,
            messages: storedMessagesForText(authorizedMessages),
            tools: input.snapshot.tools,
        };
        // trace 关闭时不做任何归因计算（buildTraceSegments 会遍历全部消息）。
        const traceSegments = input.trace.settings.enabled
            ? buildTraceSegments({
                systemPrompt: input.snapshot.systemPrompt,
                tools: input.snapshot.tools,
                messages: authorizedMessages,
                prefix: input.snapshot.promptPrefix,
            })
            : undefined;
        const requestOptions = parsePiSimpleRequestOptions(input.snapshot.requestOptions);
        const options = {
            ...requestOptions,
            ...piRequestAuthOptions({
                api: input.snapshot.model.api,
                apiKey: input.snapshot.apiKey,
                env: requestOptions.env,
            }),
            headers: mergePiRequestHeaders(input.snapshot.model.headers, requestOptions.headers),
            sessionId: String(input.sessionId),
            reasoning: input.snapshot.thinkingLevel === "off" ? undefined : input.snapshot.thinkingLevel,
            timeoutMs: input.snapshot.timeoutMs ?? undefined,
            signal: input.abortSignal,
        };
        const stream = tracedStreamSimple(input.snapshot.models, input.snapshot.model, context, options, input.trace, {
            context: traceContext,
            segments: traceSegments,
            attribution: input.snapshot.promptPrefix?.mode,
            toolsHash: computeToolsHash(input.snapshot.tools),
            ...(hasStoredAttachment(authorizedMessages) ? {payloadOmittedReason: "attachment" as const} : {}),
        });

        let started = false;
        // provider SDK 用抛异常表达取消，异常一抛 stream.result() 就永远不会执行，已经收到的正文会烂在 stream 内部。
        // 留住最后一份 partial，取消时才有内容可以闭合成 interrupted 消息（Task 07 的 turn commit 契约）。
        let lastPartial: AssistantMessage | null = null;
        try {
            for await (const event of stream) {
                const message = "partial" in event ? event.partial : "message" in event ? event.message : "error" in event ? event.error : null;
                if (message && typeof message === "object" && "role" in message && message.role === "assistant") {
                    lastPartial = message as AssistantMessage;
                }
                if (event.type === "start" && message) {
                    started = true;
                    await input.emit({type: "message_start", message});
                    continue;
                }
                if (event.type === "done" || event.type === "error") {
                    const finalMessage = sanitizeProviderAssistant(await stream.result());
                    if (!started) {
                        await input.emit({type: "message_start", message: finalMessage});
                    }
                    await input.emit({type: "message_end", message: finalMessage});
                    return finalMessage;
                }
                if (message) {
                    await input.emit({
                        type: "message_update",
                        message,
                        assistantMessageEvent: event,
                    });
                }
            }

            const finalMessage = sanitizeProviderAssistant(await stream.result());
            if (!started) {
                await input.emit({type: "message_start", message: finalMessage});
            }
            await input.emit({type: "message_end", message: finalMessage});
            return finalMessage;
        } catch (error) {
            // 只接管「用户取消」：其余异常仍然按 provider 故障冒泡给 executeTurn。
            if (!input.abortSignal?.aborted || !lastPartial) {
                throw error;
            }
            // 不在这里跑 sanitizeProviderAssistant：流式中断处的 toolCall id 可能只收到一半，
            // 会撞上它的 public id 校验。持久化形态由下游 sanitizePartialAssistant 负责（它先剥掉 toolCall 再校验）。
            const abortedAssistant: AssistantMessage = {
                ...lastPartial,
                stopReason: "aborted",
                errorMessage: undefined,
            };
            if (!started) {
                await input.emit({type: "message_start", message: abortedAssistant});
            }
            await input.emit({type: "message_end", message: abortedAssistant});
            return abortedAssistant;
        }
    }

    private async runToolBatch(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        profileKey: string;
        invocationId?: string;
        /** 当前 session 工作模式；只读模式下写工具会被注入审批挂起（Task 90）。 */
        agentMode: AgentMode;
        assistant: AssistantMessage;
        toolCalls: AgentToolCall[];
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        messages?: AgentMessage[];
    }): Promise<RunToolBatchResult> {
        if (input.toolCalls.length === 0) {
            return {
                toolResults: [],
                shouldContinue: false,
            };
        }

        const toolResults: RuntimeToolResult[] = [];
        let reportResult: AgentInvocationResult["reportResult"] | undefined;
        let reportResultError: string | undefined;
        let allExecutedTerminate = true;
        let segment: Array<{toolCall: AgentToolCall; index: number}> = [];
        const flushSegment = async (): Promise<void> => {
            if (segment.length === 0) {
                return;
            }
            const segmentResult = await this.executeToolSegment({
                ...input,
                toolCalls: segment,
            });
            toolResults.push(...segmentResult.toolResults);
            allExecutedTerminate = allExecutedTerminate && segmentResult.allTerminate;
            if (segmentResult.reportResult) {
                reportResult = segmentResult.reportResult;
                reportResultError = undefined;
            }
            if (segmentResult.reportResultError) {
                reportResultError = segmentResult.reportResultError;
            }
            segment = [];
        };

        for (let index = 0; index < input.toolCalls.length; index += 1) {
            const toolCall = input.toolCalls[index]!;
            const tool = input.toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);

            // Task 90: switch_mode no-op 前置拦截 —— 已在目标模式时直接报错，不发起用户审批
            if (toolCall.name === "switch_mode" && this.readTargetMode(toolCall.arguments) === input.agentMode) {
                await flushSegment();
                const toolResult = this.runtimeTextToolResult({
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    text: `Already in ${input.agentMode} mode. No switch needed.`,
                    isError: true,
                });
                toolResults.push(toolResult);
                await input.emit({type: "message_start", message: toolResult.event});
                await input.emit({type: "message_end", message: toolResult.event});
                allExecutedTerminate = false;
                continue;
            }

            // 检查工具是否需要用户输入
            if (tool?.userInputRequest) {
                await flushSegment();
                const approvalError = await this.validateUserResolutionTool(input.executionToolKeys, input.toolOverrides, input.workspaceRoot, input.currentProject, toolCall);
                if (approvalError) {
                    const toolResult = this.runtimeTextToolResult({
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        text: approvalError,
                        isError: true,
                    });
                    toolResults.push(toolResult);
                    await input.emit({type: "message_start", message: toolResult.event});
                    await input.emit({type: "message_end", message: toolResult.event});
                    allExecutedTerminate = false;
                    continue;
                }
                try {
                    const userInputContext = {
                        args: toolCall.arguments,
                        session: {
                            sessionId: input.sessionId,
                            profileKey: input.profileKey,
                            workspaceRoot: input.workspaceRoot,
                            currentProject: input.currentProject,
                        },
                    };
                    const userInputRequest = await tool.userInputRequest.when(userInputContext);
                    if (userInputRequest) {
                        const formSpec = userInputRequest === true ? undefined : publicAgentUserInputFormSpec(userInputRequest);
                        // 需要用户输入，暂停执行
                        await input.emit({
                            type: "tool_user_input_required",
                            toolCallId: toolCall.id,
                            toolName: toolCall.name,
                            args: toolCall.arguments,
                            ...(formSpec ? {formSpec} : {}),
                        } as unknown as AgentEvent);
                        const skippedToolResults = this.skippedToolResultsAfterUserInput(input.toolCalls, toolCall);
                        await this.emitToolResultMessages(skippedToolResults, input.emit);
                        return {
                            toolResults: [
                                ...toolResults,
                                ...skippedToolResults,
                            ],
                            reportResult,
                            reportResultError,
                            waiting: {
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                ...(formSpec ? {formSpec} : {}),
                            },
                            shouldContinue: false,
                        };
                    }
                } catch (error) {
                    // userInputRequest.when() 执行失败，记录错误并继续
                    const toolResult = this.runtimeTextToolResult({
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        text: `Failed to check user input requirement: ${error instanceof Error ? error.message : String(error)}`,
                        isError: true,
                    });
                    toolResults.push(toolResult);
                    await input.emit({type: "message_start", message: toolResult.event});
                    await input.emit({type: "message_end", message: toolResult.event});
                    allExecutedTerminate = false;
                    continue;
                }
            }

            if (tool?.approvalRequired) {
                await flushSegment();
                        const approvalError = await this.validateUserResolutionTool(input.executionToolKeys, input.toolOverrides, input.workspaceRoot, input.currentProject, toolCall);
                if (approvalError) {
                    const toolResult = this.runtimeTextToolResult({
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        text: approvalError,
                        isError: true,
                    });
                    toolResults.push(toolResult);
                    await input.emit({type: "message_start", message: toolResult.event});
                    await input.emit({type: "message_end", message: toolResult.event});
                    allExecutedTerminate = false;
                    continue;
                }
                const skippedToolResults = this.skippedToolResultsAfterApproval(input.toolCalls, toolCall);
                await this.emitToolResultMessages(skippedToolResults, input.emit);
                return {
                    toolResults: [
                        ...toolResults,
                        ...skippedToolResults,
                    ],
                    reportResult,
                    reportResultError,
                    waiting: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                    },
                    shouldContinue: false,
                };
            }

            // Task 90: 只读模式（discuss/plan）下写工具注入审批挂起；plan 模式计划目录内 .md 写入豁免
            if (tool?.mutatesWorkspace && !tool.userInputRequest && !tool.approvalRequired && isReadonlyMode(input.agentMode)
                && !(input.agentMode === "plan" && this.planDirectoryWriteExempt(toolCall, input.workspaceRoot, input.currentProject))) {
                await flushSegment();
                const approvalError = await this.validateUserResolutionTool(input.executionToolKeys, input.toolOverrides, input.workspaceRoot, input.currentProject, toolCall);
                if (approvalError) {
                    const toolResult = this.runtimeTextToolResult({
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        text: approvalError,
                        isError: true,
                    });
                    toolResults.push(toolResult);
                    await input.emit({type: "message_start", message: toolResult.event});
                    await input.emit({type: "message_end", message: toolResult.event});
                    allExecutedTerminate = false;
                    continue;
                }
                const formSpec = publicAgentUserInputFormSpec(this.readonlyWriteApprovalFormSpec(input.agentMode, toolCall));
                await input.emit({
                    type: "tool_user_input_required",
                    toolCallId: toolCall.id,
                    toolName: toolCall.name,
                    args: toolCall.arguments,
                    formSpec,
                } as unknown as AgentEvent);
                const skippedToolResults = this.skippedToolResultsAfterUserInput(input.toolCalls, toolCall);
                await this.emitToolResultMessages(skippedToolResults, input.emit);
                return {
                    toolResults: [
                        ...toolResults,
                        ...skippedToolResults,
                    ],
                    reportResult,
                    reportResultError,
                    waiting: {
                        toolCallId: toolCall.id,
                        toolName: toolCall.name,
                        formSpec,
                    },
                    shouldContinue: false,
                };
            }

            if (toolCall.name === "report_result") {
                await flushSegment();
                const segmentResult = await this.executeToolSegment({
                    ...input,
                    toolCalls: [{toolCall, index}],
                });
                toolResults.push(...segmentResult.toolResults);
                if (segmentResult.reportResult) {
                    reportResult = segmentResult.reportResult;
                    reportResultError = undefined;
                    const skippedToolResults = this.skippedToolResultsAfterTerminal(input.toolCalls, toolCall);
                    await this.emitToolResultMessages(skippedToolResults, input.emit);
                    return {
                        toolResults: [
                            ...toolResults,
                            ...skippedToolResults,
                        ],
                        reportResult,
                        reportResultError,
                        shouldContinue: false,
                    };
                }
                if (segmentResult.reportResultError) {
                    reportResultError = segmentResult.reportResultError;
                }
                const skippedToolResults = this.skippedToolResultsAfterTerminal(input.toolCalls, toolCall);
                await this.emitToolResultMessages(skippedToolResults, input.emit);
                return {
                    toolResults: [
                        ...toolResults,
                        ...skippedToolResults,
                    ],
                    reportResult,
                    reportResultError,
                    shouldContinue: true,
                };
            }

            segment.push({toolCall, index});
        }
        await flushSegment();
        return {
            toolResults,
            reportResult,
            reportResultError,
            shouldContinue: !allExecutedTerminate,
        };
    }

    private async executeToolSegment(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCalls: Array<{toolCall: AgentToolCall; index: number}>;
        messages?: AgentMessage[];
    }): Promise<{
        toolResults: RuntimeToolResult[];
        reportResult?: AgentInvocationResult["reportResult"];
        reportResultError?: string;
        allTerminate: boolean;
    }> {
        const shouldRunSequentially = this.toolExecution === "sequential"
            || input.toolCalls.some(({toolCall}) => this.resolveToolExecutionMode(toolCall, input.toolOverrides) === "sequential");
        const executions = shouldRunSequentially
            ? await this.executeToolSegmentSequentially(input)
            : await Promise.all(input.toolCalls.map((toolCall) => this.executeToolWithEvents({...input, ...toolCall})));
        const orderedExecutions = executions.sort((left, right) => left.index - right.index);
        const toolResults: RuntimeToolResult[] = [];
        let reportResult: AgentInvocationResult["reportResult"] | undefined;
        let reportResultError: string | undefined;
        let allTerminate = true;
        for (const executed of orderedExecutions) {
            // stored/event 是同一工具结果的两种边界，必须共享时间戳，避免 durable
            // message 与 Pi event 在排序、恢复和调试关联时出现虚假的身份差异。
            const timestamp = Date.now();
            const stored = createStoredToolResultFromResult({
                    toolCallId: executed.toolCall.id,
                    toolName: executed.toolCall.name,
                    result: executed.result,
                    isError: executed.isError,
                    timestamp,
                });
            parseStoredMessage(stored);
            const toolResult: RuntimeToolResult = {
                stored,
                event: createToolResultFromResult({
                    toolCallId: executed.toolCall.id,
                    toolName: executed.toolCall.name,
                    result: executed.result,
                    isError: executed.isError,
                    timestamp,
                }),
            };
            toolResults.push(toolResult);
            await input.emit({type: "message_start", message: toolResult.event});
            await input.emit({type: "message_end", message: toolResult.event});
            allTerminate = allTerminate && executed.result.terminate === true;
            if (executed.toolCall.name === "report_result") {
                if (executed.isError) {
                    reportResultError = messageText(toolResult.event) || "report_result 工具调用失败。";
                } else {
                    reportResult = this.readReportResult(executed.result.details);
                    reportResultError = undefined;
                }
            }
        }
        return {
            toolResults,
            reportResult,
            reportResultError,
            allTerminate,
        };
    }

    private async emitToolResultMessages(toolResults: RuntimeToolResult[], emit: (event: AgentEvent) => Promise<void>): Promise<void> {
        for (const toolResult of toolResults) {
            await emit({type: "message_start", message: toolResult.event});
            await emit({type: "message_end", message: toolResult.event});
        }
    }

    private async executeToolSegmentSequentially(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCalls: Array<{toolCall: AgentToolCall; index: number}>;
        messages?: AgentMessage[];
    }): Promise<Array<{
        toolCall: AgentToolCall;
        index: number;
        result: NeuroToolResult;
        isError: boolean;
    }>> {
        const executions: Array<{
            toolCall: AgentToolCall;
            index: number;
            result: NeuroToolResult;
            isError: boolean;
        }> = [];
        for (const toolCall of input.toolCalls) {
            executions.push(await this.executeToolWithEvents({...input, ...toolCall}));
        }
        return executions;
    }

    private async executeToolWithEvents(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        abortSignal?: AbortSignal;
        emit: (event: AgentEvent) => Promise<void>;
        toolCall: AgentToolCall;
        index: number;
        messages?: AgentMessage[];
    }): Promise<{
        toolCall: AgentToolCall;
        index: number;
        result: NeuroToolResult;
        isError: boolean;
    }> {
        const {toolCall} = input;
        await input.emit({
            type: "tool_execution_start",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            args: toolCall.arguments,
        });
        const executed = await this.executeTool({
            sessionId: input.sessionId,
            workspaceRoot: input.workspaceRoot,
            currentProject: input.currentProject,
            profileKey: input.profileKey,
            invocationId: input.invocationId,
            executionToolKeys: input.executionToolKeys,
            toolOverrides: input.toolOverrides,
            enqueueSavePointWrite: input.enqueueSavePointWrite,
            toolCallIndex: input.index,
            abortSignal: input.abortSignal,
            toolCall,
            messages: input.messages,
        });
        await input.emit({
            type: "tool_execution_end",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: executed.result,
            isError: executed.isError,
        });
        return {
            toolCall,
            index: input.index,
            result: executed.result,
            isError: executed.isError,
        };
    }

    private resolveToolExecutionMode(toolCall: AgentToolCall, toolOverrides: Record<string, NeuroAgentTool>): "sequential" | "parallel" {
        const tool = toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);
        return tool?.executionMode ?? "parallel";
    }

    private skippedToolResultsAfterTerminal(toolCalls: AgentToolCall[], terminalToolCall: AgentToolCall): RuntimeToolResult[] {
        const terminalIndex = toolCalls.findIndex((toolCall) => toolCall.id === terminalToolCall.id);
        if (terminalIndex < 0) {
            return [];
        }
        return toolCalls.slice(terminalIndex + 1).map((toolCall) => this.runtimeTextToolResult({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            text: `Skipped because ${terminalToolCall.name} already reported the final result. This tool was not executed in this turn.`,
            isError: true,
        }));
    }

    private skippedToolResultsAfterApproval(toolCalls: AgentToolCall[], waitingToolCall: AgentToolCall): RuntimeToolResult[] {
        const waitingIndex = toolCalls.findIndex((toolCall) => toolCall.id === waitingToolCall.id);
        if (waitingIndex < 0) {
            return [];
        }
        return toolCalls.slice(waitingIndex + 1).map((toolCall) => this.runtimeTextToolResult({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            text: `Skipped because ${waitingToolCall.name} is waiting for user approval. This tool was not executed in this turn.`,
            isError: true,
        }));
    }

    private skippedToolResultsAfterUserInput(toolCalls: AgentToolCall[], waitingToolCall: AgentToolCall): RuntimeToolResult[] {
        const waitingIndex = toolCalls.findIndex((toolCall) => toolCall.id === waitingToolCall.id);
        if (waitingIndex < 0) {
            return [];
        }
        return toolCalls.slice(waitingIndex + 1).map((toolCall) => this.runtimeTextToolResult({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            text: `Skipped because ${waitingToolCall.name} is waiting for user input. This tool was not executed in this turn.`,
            isError: true,
        }));
    }

    private async validateUserResolutionTool(
        executionToolKeys: string[],
        toolOverrides: Record<string, NeuroAgentTool>,
        workspaceRoot: AbsoluteFsPath,
        currentProject: ReadyProjectSessionRef | null,
        toolCall: AgentToolCall,
    ): Promise<string | null> {
        const tool = toolOverrides[toolCall.name] ?? this.tools.get(toolCall.name);
        if (!tool) {
            return `Tool ${toolCall.name} not found`;
        }
        if (!executionToolKeys.includes(tool.key)) {
            return `Tool ${toolCall.name} is not allowed by this profile`;
        }
        if (toolCall.name === "switch_mode" && toolCall.arguments.targetMode === "normal" && typeof toolCall.arguments.planFilePath === "string" && toolCall.arguments.planFilePath.trim()) {
            try {
                await readFile(resolvePlanModeFile({
                    workspaceRoot,
                    currentProject,
                    planFilePath: toolCall.arguments.planFilePath,
                }).absolutePath, "utf-8");
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        }
        return null;
    }

    /**
     * plan 模式写豁免（Task 90 决策 10）：写目标全部是计划目录内的 .md 文件时免审批。
     * 解析失败或目标不可识别时不豁免（fail closed）。
     *
     * Plan Mode 复用计划文件解析器，只额外判定写工具的全部目标，不维护第二套路径规则。
     */
    private planDirectoryWriteExempt(
        toolCall: AgentToolCall,
        workspaceRoot: AbsoluteFsPath,
        currentProject: ReadyProjectSessionRef | null,
    ): boolean {
        const paths = this.mutationTargetPaths(toolCall);
        if (paths.length === 0) {
            return false;
        }
        const planRoot = normalize(planModeDirectory({workspaceRoot, currentProject}));
        return paths.every((path) => {
            if (!path.toLowerCase().endsWith(".md")) {
                return false;
            }
            try {
                const absolutePath = normalize(resolvePlanModeFile({
                    workspaceRoot,
                    currentProject,
                    planFilePath: path,
                }).absolutePath);
                const relativePath = relativeFilePathInside(absoluteFsPath(planRoot), absoluteFsPath(absolutePath));
                return Boolean(relativePath && relativePath !== ".");
            } catch {
                return false;
            }
        });
    }

    /**
     * 提取写工具的目标文件路径。apply_patch 解析 patch 文本内的全部目标文件；未知写工具返回空（不豁免）。
     */
    private mutationTargetPaths(toolCall: AgentToolCall): string[] {
        if (toolCall.name === "write" || toolCall.name === "edit") {
            const path = toolCall.arguments.path;
            return typeof path === "string" && path.trim() ? [path.trim()] : [];
        }
        if (toolCall.name === "apply_patch") {
            const patch = toolCall.arguments.patch;
            if (typeof patch !== "string") {
                return [];
            }
            // 复用 apply_patch 官方解析器，覆盖 Add/Update/Delete 与 Move to 目标；
            // 手写正则曾漏掉 Move to，导致 plan 目录写豁免被移动操作绕过（Task 90 修复）。
            return extractPatchTargetPaths(patch);
        }
        return [];
    }

    /**
     * 只读模式写审批表单（Task 90）。批准仅豁免该次调用。
     */
    private readonlyWriteApprovalFormSpec(agentMode: AgentMode, toolCall: AgentToolCall): UserInputFormSpec {
        const modeLabel = agentMode === "plan" ? "计划" : "讨论";
        const paths = this.mutationTargetPaths(toolCall);
        const target = paths.length > 0 ? paths.join("、") : `${toolCall.name} 目标文件`;
        return {
            form: {
                defaults: {
                    approved: true,
                },
                fields: [
                    {
                        path: "approved",
                        component: "radio" as const,
                        label: `是否允许本次写入 ${target}？`,
                        description: `${modeLabel}模式下 Agent 请求使用 ${toolCall.name} 写入文件。批准仅对本次调用生效。`,
                        required: true,
                        options: [
                            {value: true, label: "批准"},
                            {value: false, label: "拒绝"},
                        ],
                        defaultValue: true,
                    },
                ],
            },
            prompt: `${modeLabel}模式下请求写入文件`,
            layout: "dialog",
        };
    }

    /**
     * 消费只读模式写审批的 resolution（Task 90）。
     * 返回 null 表示 pending 不是注入的写审批；批准时真实执行工具并以执行结果落库，拒绝时落库引导文本。
     */
    private async writerApprovalToolResult(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        pending: {toolCallId: string; toolName: string; args: Record<string, unknown>},
        resolution: AgentResolution,
        invocationId?: string,
    ): Promise<StoredToolResultMessage | null> {
        const runtime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
        const tool = runtime.profile
            ? this.resolveProfileTool(runtime.profile, pending.toolName)
            : this.tools.get(pending.toolName);
        // 只处理"harness 注入"的写审批：工具自身没有 userInputRequest/approvalRequired
        if (!tool?.mutatesWorkspace || tool.userInputRequest || tool.approvalRequired) {
            return null;
        }
        const approved = this.resolutionApprovalDecision(resolution) === true;
        if (!approved) {
            const planning = context.agentMode === "plan";
            return createStoredTextToolResult({
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                text: `The user declined this file write in ${planning ? "plan" : "discuss"} mode. Stay read-only: continue the ${planning ? "planning" : "discussion"} or ask what should change instead. Do not retry the same write. If the user wants execution, request it via switch_mode with targetMode "normal".`,
                isError: true,
            });
        }
        const executed = await this.executeTool({
            sessionId: snapshot.metadata.sessionId,
            workspaceRoot: this.workspaceRoot,
            currentProject: invocationId
                ? this.projectForInvocation(invocationId)
                : this.readyProjectForMetadata(snapshot.metadata),
            profileKey: snapshot.metadata.profileKey,
            invocationId,
            executionToolKeys: [tool.key],
            toolOverrides: {[pending.toolName]: tool},
            toolCallIndex: 0,
            toolCall: {
                type: "toolCall",
                id: pending.toolCallId,
                name: pending.toolName,
                arguments: pending.args,
            },
        });
        const stored = createStoredToolResultFromResult({
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            result: executed.result,
            isError: executed.isError,
        });
        parseStoredMessage(stored);
        return stored;
    }

    /**
     * 消费声明式 `approvalRequired` 工具的审批 resolution（Task 111）。
     * 返回 null 表示 pending 不是声明式审批工具；批准时真实执行工具并以执行结果落库
     * （与 Task 90 写审批同一契约——审批不是结果，执行才是），拒绝时落库引导文本。
     * 注意：工具可能长时间运行（如 run_workflow 跑完整个编排），resume invocation 会阻塞到执行结束。
     */
    private async declaredApprovalToolResult(
        snapshot: SessionSnapshot,
        pending: {toolCallId: string; toolName: string; args: Record<string, unknown>},
        resolution: AgentResolution,
        invocationId?: string,
    ): Promise<StoredToolResultMessage | null> {
        const runtime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
        const tool = runtime.profile
            ? this.resolveProfileTool(runtime.profile, pending.toolName)
            : this.tools.get(pending.toolName);
        // 只处理声明式审批工具；userInputRequest / switch_mode 等有自己的 resolution 语义
        if (!tool?.approvalRequired || tool.userInputRequest || pending.toolName === "switch_mode") {
            return null;
        }
        const approved = this.resolutionApprovalDecision(resolution) === true;
        if (!approved) {
            return createStoredTextToolResult({
                toolCallId: pending.toolCallId,
                toolName: pending.toolName,
                text: `The user declined this ${pending.toolName} call. Do not retry the same call; ask the user what should change or continue without it.`,
                isError: true,
            });
        }
        const executed = await this.executeTool({
            sessionId: snapshot.metadata.sessionId,
            workspaceRoot: this.workspaceRoot,
            currentProject: invocationId
                ? this.projectForInvocation(invocationId)
                : this.readyProjectForMetadata(snapshot.metadata),
            profileKey: snapshot.metadata.profileKey,
            invocationId,
            executionToolKeys: [tool.key],
            toolOverrides: {[pending.toolName]: tool},
            toolCallIndex: 0,
            toolCall: {
                type: "toolCall",
                id: pending.toolCallId,
                name: pending.toolName,
                arguments: pending.args,
            },
        });
        const stored = createStoredToolResultFromResult({
            toolCallId: pending.toolCallId,
            toolName: pending.toolName,
            result: executed.result,
            isError: executed.isError,
        });
        parseStoredMessage(stored);
        return stored;
    }

    private async executeTool(input: {
        sessionId: number;
        workspaceRoot: AbsoluteFsPath;
        currentProject: ReadyProjectSessionRef | null;
        profileKey: string;
        invocationId?: string;
        executionToolKeys: string[];
        toolOverrides: Record<string, NeuroAgentTool>;
        enqueueSavePointWrite?: (plan: SessionWritePlan, source: {toolCallIndex: number; toolCallId: string}) => void;
        toolCallIndex: number;
        abortSignal?: AbortSignal;
        toolCall: AgentToolCall;
        messages?: AgentMessage[];
    }): Promise<{
        result: NeuroToolResult;
        isError: boolean;
    }> {
        const tool = input.toolOverrides[input.toolCall.name] ?? this.tools.get(input.toolCall.name);
        if (!tool) {
            return {
                result: this.errorToolResult(`Tool ${input.toolCall.name} not found`),
                isError: true,
            };
        }
        if (!input.executionToolKeys.includes(tool.key)) {
            return {
                result: this.errorToolResult(`Tool ${input.toolCall.name} is not allowed by this profile`),
                isError: true,
            };
        }

        try {
            const preparedToolCall = tool.prepareArguments
                ? {
                    ...input.toolCall,
                    arguments: tool.prepareArguments(input.toolCall.arguments) as Record<string, any>,
                }
                : input.toolCall;
            const validationTool = tool.validationSchema
                ? {
                    ...tool,
                    parameters: tool.validationSchema,
                }
                : tool;
            const args = validateToolArguments(validationTool, preparedToolCall);
            const context: ToolExecutionContext = {
                harness: this,
                sessionId: input.sessionId,
                profileKey: input.profileKey,
                workspaceRoot: input.workspaceRoot,
                currentProject: input.currentProject,
                invocationId: input.invocationId,
                vars: await this.createVariableAccessor(input.sessionId, input.invocationId),
                attachmentCodec: this.attachmentCodec,
                sessionWrites: new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: input.sessionId,
                    invocationId: input.invocationId,
                    toolCallIndex: input.toolCallIndex,
                    toolCallId: input.toolCall.id,
                    enqueueSavePoint: input.enqueueSavePointWrite,
                }),
            };

            // 从 messages 中提取 userInput（如果有 resolution）
            let userInput: unknown = undefined;
            if (input.messages && tool.executeWithContext) {
                const toolResultMessage = input.messages.find((msg): msg is ToolResultMessage =>
                    msg.role === "toolResult" && msg.toolCallId === input.toolCall.id
                );
                if (toolResultMessage?.details && typeof toolResultMessage.details === "object") {
                    const details = toolResultMessage.details as {kind?: string; data?: unknown; answers?: unknown};

                    // 优先从 resolution.data.userInput 提取；Low-Code Form 兼容直接 data。
                    if (details.data && typeof details.data === "object" && "userInput" in details.data) {
                        userInput = (details.data as {userInput: unknown}).userInput;
                    }
                    else if (details.kind === "user_input" && "data" in details) {
                        userInput = details.data;
                    }
                    // 向后兼容：从 resolution.answers 提取（旧格式）
                    else if (details.kind === "user_input" && details.answers) {
                        userInput = details.answers;
                    }
                }
            }

            let result: NeuroToolResult;
            if (tool.executeWithContext) {
                result = await tool.executeWithContext(context, input.toolCall.id, args, userInput, input.abortSignal);
            } else if (tool.execute) {
                result = await tool.execute(input.toolCall.id, args, input.abortSignal);
            } else {
                throw new Error(`Tool ${tool.key} 没有可执行入口`);
            }
            return {
                result,
                isError: false,
            };
        } catch (error) {
            return {
                result: this.errorToolResult(error instanceof Error ? error.message : String(error)),
                isError: true,
            };
        }
    }

    private assertSessionIdle(sessionId: number): void {
        if (this.activeInvocations.has(sessionId)) {
            throw new Error("active_invocation_exists");
        }
    }

    private enqueueSteer(sessionId: number, input: PreparedInvocationInput, caller: AgentInvokeCaller, messageIdentity: AgentMessageIdentity): AgentQueuedInvocationTruth {
        const item: AgentQueuedInvocationTruth = {
            id: randomUUID(),
            clientMessageId: input.clientMessageId,
            kind: "steer",
            message: input.message,
            input: input.payload,
            modelKey: input.modelKey,
            caller,
            messageIdentity,
            createdAt: Date.now(),
        };
        const queue = this.steerQueues.get(sessionId) ?? [];
        queue.push(item);
        this.steerQueues.set(sessionId, queue);
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "steer_queued",
                item: projectQueuedMessage(item),
            },
        });
        return item;
    }

    private async enqueueFollowUp(sessionId: number, input: PreparedInvocationInput, caller: AgentInvokeCaller, messageIdentity: AgentMessageIdentity): Promise<StoredFollowUpQueueItem> {
        const item: StoredFollowUpQueueItem = {
            id: randomUUID(),
            clientMessageId: input.clientMessageId,
            kind: "followup",
            message: input.message,
            input: input.payload,
            modelKey: input.modelKey,
            caller,
            messageIdentity,
            createdAt: Date.now(),
        };
        const queue = this.followUpQueueState(sessionId);
        await this.setFollowUpQueueState(sessionId, {
            status: "ready",
            items: [...queue.items, item],
        });
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "follow_up_queued",
                item: projectQueuedMessage(item),
            },
        });
        return item;
    }

    private async drainSteers(input: {
        sessionId: number;
        invocationId?: string;
    }): Promise<DrainedSteers> {
        const queue = this.steerQueues.get(input.sessionId) ?? [];
        if (queue.length === 0) {
            this.steerQueues.delete(input.sessionId);
            return {messages: []};
        }
        this.steerQueues.delete(input.sessionId);
        const messages: StoredUserMessage[] = [];
        const entries: AppendManySessionEntryDraft[] = [];
        for (const item of queue) {
            const message = this.createQueuedUserMessage(item, "steer");
            const messageIdentity = item.messageIdentity ?? "user";
            if (messageIdentity === "system") {
                entries.push({
                    type: "custom_message",
                    message,
                    visibleToModel: true,
                    sourceQueueItemId: item.id,
                });
            } else {
                entries.push({
                    type: "message",
                    message,
                    origin: "harness",
                    clientMessageId: item.clientMessageId,
                    intent: "steer",
                });
            }
            messages.push(message);
        }
        const written = await this.executeWritePlan({
            target: {sessionId: input.sessionId},
            cause: "steer.drain",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries,
            }],
        }, input.invocationId);
        return {
            messages,
            leafId: written.findLast((entry) => entry.type === "message" || entry.type === "custom_message")?.id,
        };
    }

    private async drainFollowUps(sessionId: number): Promise<void> {
        if (this.activeInvocations.has(sessionId)) {
            return;
        }
        while (!this.activeInvocations.has(sessionId)) {
            const queue = this.followUpQueueState(sessionId);
            const next = queue.items[0];
            if (!next) {
                if (queue.status !== "ready" || this.followUpQueues.has(sessionId)) {
                    await this.setFollowUpQueueState(sessionId, this.emptyFollowUpQueueState());
                }
                return;
            }

            const snapshot = await this.repo.readSession(sessionId);
            const committed = snapshot.entries.some((entry) => (entry.type === "message" || entry.type === "custom_message")
                && entry.message.role === "user"
                && entry.sourceQueueItemId === next.id);
            if (committed) {
                try {
                    await this.ackFollowUp(sessionId, next.id);
                } catch (error) {
                    void appLogger.warn("agent.followup.ackRecoveryFailed", {
                        sessionId,
                        queueItemId: next.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return;
                }
                continue;
            }
            if (queue.status === "paused") {
                return;
            }

            let prepared: PreparedInvocationInput;
            try {
                prepared = await this.prepareQueuedFollowUp(sessionId, next, snapshot);
            } catch (error) {
                await this.pauseFollowUpAdmission(sessionId, next.id, error).catch((pauseError) => {
                    void appLogger.warn("agent.followup.pauseAdmissionFailed", {
                        sessionId,
                        queueItemId: next.id,
                        error: pauseError instanceof Error ? pauseError.message : String(pauseError),
                    });
                });
                return;
            }

            try {
                const result = await this.invokeStored({
                    sessionId,
                    mode: "prompt",
                    clientMessageId: prepared.clientMessageId,
                    message: prepared.message,
                    payload: prepared.payload,
                    modelKey: prepared.modelKey,
                    caller: next.caller ?? {kind: "user", sessionId},
                    messageIdentity: next.messageIdentity ?? "user",
                    internalQueued: true,
                    sourceQueueItemId: next.id,
                });
                if (result.acceptance.state !== "persisted") {
                    await this.pauseFollowUpAdmission(sessionId, next.id, result.error ?? "follow-up 未完成 durable admission");
                }
            } catch (error) {
                await this.pauseFollowUpAdmission(sessionId, next.id, error).catch((pauseError) => {
                    void appLogger.warn("agent.followup.pauseInvokeFailed", {
                        sessionId,
                        queueItemId: next.id,
                        error: pauseError instanceof Error ? pauseError.message : String(pauseError),
                    });
                });
            }
            return;
        }
    }

    /** 队首 follow-up 的完整重新 admission；失败不得删除 durable queue item。 */
    private async prepareQueuedFollowUp(
        sessionId: number,
        item: StoredFollowUpQueueItem,
        snapshot: SessionSnapshot,
    ): Promise<PreparedInvocationInput> {
        const projection = await this.resolveSessionRuntimeProjection(sessionId, snapshot);
        if (projection.summary.interaction?.canInvoke !== true) {
            throw new Error(projection.context.archived
                ? "当前 Session 已归档，只能查看或恢复。"
                : "当前 Session 状态不允许执行 follow-up。");
        }
        const profile = await this.assertProfileRunnable(snapshot);
        await this.sessionAttachments.validateDurableOwnership(sessionId);
        return {
            clientMessageId: item.clientMessageId,
            ...(item.message ? {message: await this.authorizeStoredInvocationInput(sessionId, item.message)} : {}),
            ...(item.input === undefined ? {} : {payload: this.profiles.parsePayload(profile, item.input)}),
            ...(item.modelKey === undefined ? {} : {modelKey: item.modelKey}),
            messageIdentity: item.messageIdentity ?? "user",
        };
    }

    private async ensureProfileHome(profile: AgentProfile, projectWorkspace: ResolvedProjectWorkspace | undefined) {
        if (!this.profileNeedsHome(profile)) {
            return undefined;
        }
        const workspaceRoot = absoluteFsPath(this.repo.rootWorkspace);
        const globalHome = await ensureGlobalProfileHome({
            workspaceRoot,
            profileKey: profile.manifest.key,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        });
        if (!projectWorkspace) {
            return globalHome;
        }
        const projectHome = await ensureProfileHome({
            workspace: projectWorkspace,
            profileKey: profile.manifest.key,
            profileVersion: profile.manifest.version ?? 1,
            definition: profile.home,
        });
        return createLayeredProfileHomeFacade(projectHome, globalHome);
    }

    private profileNeedsHome(profile: AgentProfile): boolean {
        return Boolean(profile.home) || Boolean(profile.settingsForm?.fields.some((field) => field.component === "resource-preset"));
    }

    /**
     * 入队前按当前 profile 校验结构化 payload，避免无效 input 滞留到后续 drain 才失败。
     */
    private async prepareInvocationInput(input: InvocationCoreInput, messageIdentity = this.normalizeMessageIdentity(input.messageIdentity)): Promise<PreparedInvocationInput> {
        if (input.source.kind === "stored") {
            const snapshot = await this.repo.readSession(input.sessionId);
            const profile = await this.profiles.get(this.repo.reduce(snapshot).profileKey);
            return {
                clientMessageId: this.requireClientMessageId(input.clientMessageId, input.mode),
                message: input.source.message
                    ? await this.authorizeStoredInvocationInput(input.sessionId, input.source.message)
                    : undefined,
                payload: this.profiles.parsePayload(profile, input.payload),
                modelKey: input.modelKey,
                messageIdentity,
            };
        }
        const snapshot = await this.repo.readSession(input.sessionId);
        const profile = await this.profiles.get(this.repo.reduce(snapshot).profileKey);
        return {
            clientMessageId: this.requireClientMessageId(input.clientMessageId, input.mode),
            message: input.source.message
                ? await this.admitMarkdownUserInput(input.sessionId, input.source.message.text)
                : undefined,
            payload: this.profiles.parsePayload(profile, input.payload),
            modelKey: input.modelKey,
            messageIdentity,
        };
    }

    private createInvocationUserMessage(input: {message?: StoredAgentUserMessageInput; payload?: JsonValue}): StoredUserMessage {
        return {
            role: "user",
            content: appendInvocationPayload(input.message?.content ?? [], input.payload),
            timestamp: Date.now(),
        };
    }

    private createQueuedUserMessage(item: AgentQueuedInvocationTruth, mode: "steer" | "followup"): StoredUserMessage {
        const message = this.createInvocationUserMessage({
            message: item.message,
            payload: item.input,
        });
        if (mode === "steer") {
            return {
                role: "user",
                content: wrapStoredSteerContent(message.content),
                timestamp: Date.now(),
            };
        }
        return message;
    }

    /** 将 Composer Markdown 解析为严格有序的 stored blocks，并校验 Session Attachment 授权。 */
    private async admitMarkdownUserInput(sessionId: number, text: string): Promise<StoredAgentUserMessageInput> {
        const parts = parseAgentImageMarkdown(text);
        const ids = parts.flatMap((part) => {
            if (part.type !== "image") {
                return [];
            }
            const id = attachmentIdFromMarkdownTarget(part.target);
            if (!id) {
                throw new AttachmentError(
                    "invalid_reference",
                    "Markdown 图片必须先上传或快照为当前 Session Attachment。",
                );
            }
            return [id];
        });
        const authorized = await this.sessionAttachments.resolveDurableOwnership(sessionId, ids);
        const content: StoredContent[] = parts.map((part) => {
            if (part.type === "text") {
                return {type: "text", text: part.text};
            }
            const id = attachmentIdFromMarkdownTarget(part.target);
            const attachment = id ? authorized.get(id) : undefined;
            if (!attachment) {
                throw new AttachmentError("invalid_reference", "图片附件不属于当前 Session。");
            }
            return {
                type: "attachment",
                attachment: {...attachment.attachment},
                ...(part.label ? {name: part.label} : attachment.name ? {name: attachment.name} : {}),
            };
        });
        this.assertInvocationImageBudget(content);
        return {content};
    }

    /** queue truth 再进入 invocation 时重新验证引用归属、metadata 与图片预算。 */
    private async authorizeStoredInvocationInput(
        sessionId: number,
        input: StoredAgentUserMessageInput,
    ): Promise<StoredAgentUserMessageInput> {
        const ids = input.content.flatMap((block) => block.type === "attachment" ? [block.attachment.id] : []);
        const authorized = await this.sessionAttachments.resolveDurableOwnership(sessionId, ids);
        const content = input.content.map((block): StoredContent => {
            if (block.type === "text") {
                return {...block};
            }
            const stored = authorized.get(block.attachment.id);
            if (!stored
                || stored.attachment.mimeType !== block.attachment.mimeType
                || stored.attachment.bytes !== block.attachment.bytes) {
                throw new AttachmentError("invalid_reference", "Stored 图片附件引用已失效。");
            }
            return {
                type: "attachment",
                attachment: {...stored.attachment},
                ...(block.name === undefined ? stored.name === undefined ? {} : {name: stored.name} : {name: block.name}),
            };
        });
        this.assertInvocationImageBudget(content);
        return {content};
    }

    /** 每次发送按实际图片 block（包括重复引用）重验数量、单图与合计预算。 */
    private assertInvocationImageBudget(content: readonly StoredContent[]): void {
        const images = content.filter((block) => block.type === "attachment");
        if (images.length > AGENT_IMAGE_POLICY.maxInputImages) {
            throw new AttachmentError("limit_exceeded", "图片数量超过允许上限。");
        }
        let totalBytes = 0;
        for (const image of images) {
            if (!canonicalImageMime(image.attachment.mimeType)) {
                throw new AttachmentError("invalid_reference", "Session Attachment 不是受支持的图片。");
            }
            if (image.attachment.bytes > AGENT_IMAGE_POLICY.maxImageBytes) {
                throw new AttachmentError("limit_exceeded", "单张图片超过允许大小。");
            }
            totalBytes += image.attachment.bytes;
        }
        if (totalBytes > AGENT_IMAGE_POLICY.maxInputBytes) {
            throw new AttachmentError("limit_exceeded", "图片总大小超过允许上限。");
        }
    }

    private async pauseFollowUps(sessionId: number, invocationId: string, reason: "error" | "aborted" | "interrupted"): Promise<void> {
        const queue = this.followUpQueueState(sessionId);
        if (queue.items.length === 0) {
            return;
        }
        await this.setFollowUpQueueState(sessionId, {
            status: "paused",
            pausedBy: {
                invocationId,
                reason,
            },
            items: queue.items,
        });
    }

    private async finishInvocation(sessionId: number, invocationId?: string): Promise<void> {
        this.finishInvocationState(sessionId, invocationId);
        await this.publishSessionState(sessionId, invocationId);
    }

    /** 当前 session 的执行权是否仍属于指定 invocation；所有迟到 terminal 路径都必须经过该 fence。 */
    private ownsInvocation(sessionId: number, invocationId: string): boolean {
        return this.activeInvocations.get(sessionId)?.invocationId === invocationId;
    }

    /** 底层 provider/tool 不响应 AbortSignal 时，强制提交唯一 aborted 终态并释放 admission。 */
    private async forceAbortInvocation(sessionId: number, invocationId: string, reason?: string): Promise<void> {
        await this.withSessionMutation(sessionId, async () => {
            if (!this.ownsInvocation(sessionId, invocationId)) {
                return;
            }
            const abortGate = this.invocationAbortGates.get(invocationId);
            await this.pauseFollowUps(sessionId, invocationId, "aborted");
            // 宽限期到点的强制取消也是取消，同样不写英文兜底正文（理由见 failInvocation）。
            await this.writeLifecycle(sessionId, invocationId, "aborted", reason, reason ? {
                message: reason,
                phase: "unknown",
            } : undefined);
            this.finishInvocationState(sessionId, invocationId);
            // runLoop 可能仍卡在工具里。ownership 此刻已释放，它随后自己发的 agent_end 会被 emitRuntimeEvent 的
            // fence 丢弃，前端就再也等不到终态。所以必须由取消侧补发，且必须在 finishInvocationState 之后补，
            // 否则残留 runLoop 的 message_update 会抢在终态之后把前端重新拉回 running。
            this.publishRuntimeEvent(sessionId, invocationId, {type: "agent_end", status: "aborted"});
            await this.publishSessionState(sessionId, invocationId);
            abortGate?.resolve(this.forcedAbortResult(sessionId, invocationId));
        });
    }

    /** durable user entry 已提交后才确认并删除对应队首；重复 ack 无害。 */
    private async ackFollowUp(sessionId: number, itemId: string): Promise<void> {
        const queue = this.followUpQueueState(sessionId);
        const index = queue.items.findIndex((item) => item.id === itemId);
        if (index < 0) {
            return;
        }
        if (index !== 0) {
            throw new Error("follow-up queue ack 只能确认当前队首");
        }
        await this.setFollowUpQueueState(sessionId, {
            status: "ready",
            items: queue.items.slice(1),
        });
    }

    /** admission 失败时保留队首并公开有界错误；正文和附件不进入 durable message。 */
    private async pauseFollowUpAdmission(sessionId: number, itemId: string, error: unknown): Promise<void> {
        const queue = this.followUpQueueState(sessionId);
        if (queue.items[0]?.id !== itemId) {
            return;
        }
        const message = providerErrorText(error).replace(/\s+/gu, " ").trim().slice(0, 500)
            || "follow-up admission 失败";
        await this.setFollowUpQueueState(sessionId, {
            status: "paused",
            pausedBy: {
                invocationId: randomUUID(),
                itemId,
                reason: "admission_error",
                message,
            },
            items: queue.items,
        });
    }

    /** 强制取消对公开 invocation 调用方的稳定结果。 */
    private forcedAbortResult(sessionId: number, invocationId: string, startedAt = Date.now()): AgentInvocationResult {
        const errorInfo = this.toInvocationErrorInfo("invocation aborted", "unknown");
        return {
            sessionId,
            invocationId,
            status: "error",
            acceptance: this.invocationAcceptances.get(invocationId)?.value ?? {state: "none"},
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
            aborted: true,
            elapsedMs: Math.max(0, Date.now() - startedAt),
        };
    }

    /** 在 Session mutation 临界区原子提交 lifecycle，并进入 waiting 或释放 invocation。 */
    private async commitInvocationState(input: {
        sessionId: number;
        invocationId: string;
        lifecycleStatus: Extract<SessionEntryDraft, {type: "invocation_lifecycle"}>["status"];
        error?: string;
        errorInfo?: InvocationErrorInfo;
        nextState: "waiting" | "finished";
        pauseReason?: "aborted" | "error";
    }): Promise<boolean> {
        return this.withSessionMutation(input.sessionId, async () => {
            const active = this.activeInvocations.get(input.sessionId);
            const completesCancellation = active?.status === "aborting"
                && input.lifecycleStatus === "aborted"
                && input.nextState === "finished";
            if (!active || active.invocationId !== input.invocationId || (active.status === "aborting" && !completesCancellation)) {
                return false;
            }
            await this.writeLifecycle(input.sessionId, input.invocationId, input.lifecycleStatus, input.error, input.errorInfo);
            if (input.nextState === "waiting") {
                active.status = "waiting";
                this.settleInvocationRunState(input.sessionId, input.invocationId);
                await this.publishSessionState(input.sessionId, input.invocationId, true);
                return true;
            }
            if (input.pauseReason) {
                await this.pauseFollowUps(input.sessionId, input.invocationId, input.pauseReason);
            }
            await this.finishInvocation(input.sessionId, input.invocationId);
            return true;
        });
    }

    /**
     * 释放一次 running 段的 Project operation与取消控制面。
     * durable invocation状态在waiting时继续保留，resume会以同一invocationId建立新的running段。
     */
    private settleInvocationRunState(sessionId: number, invocationId: string): void {
        this.activeInvocationProjects.delete(sessionId);
        this.abortControllers.delete(sessionId);
        const variableState = this.invocationVariableStates.get(invocationId);
        if (variableState) {
            variableState.currentProject = null;
        }
        this.invocationCompletions.get(invocationId)?.resolve();
        this.invocationCompletions.delete(invocationId);
        this.invocationProjectOperations.delete(invocationId);
    }

    private finishInvocationState(sessionId: number, invocationId?: string): void {
        if (invocationId && !this.ownsInvocation(sessionId, invocationId)) {
            return;
        }
        if (invocationId) {
            this.settleInvocationRunState(sessionId, invocationId);
        }
        this.clearTranscriptReplayAnchor(sessionId);
        this.activeInvocations.delete(sessionId);
        this.steerableSessions.delete(sessionId);
        this.steerQueues.delete(sessionId);
        if (invocationId) {
            this.invocationAbortGates.delete(invocationId);
            this.invocationClientStates.delete(invocationId);
            this.invocationVariableStates.delete(invocationId);
            this.invocationRuntimeStates.delete(invocationId);
            this.invocationModelOverrides.delete(invocationId);
            this.rejectPendingClientPatches(invocationId);
        }
    }

    private async writeLifecycle(
        sessionId: number,
        invocationId: string,
        status: Extract<SessionEntryDraft, {type: "invocation_lifecycle"}>["status"],
        error?: string,
        errorInfo?: InvocationErrorInfo,
    ): Promise<void> {
        await this.executeWritePlan({
            target: {sessionId},
            cause: `lifecycle.${status}`,
            ops: [{
                kind: "append",
                entry: {
                    type: "invocation_lifecycle",
                    invocationId,
                    status,
                    error,
                    errorInfo,
                },
            }],
        }, invocationId);
    }

    /** 单 Session mutation 临界区。 */
    private async withSessionMutation<TResult>(sessionId: number, task: () => Promise<TResult>): Promise<TResult> {
        return this.withSessionMutations([sessionId], task);
    }

    /** 多 Session mutation 按 ID 升序获取，固定与关系锁、write lock 的全局顺序。 */
    private async withSessionMutations<TResult>(sessionIds: readonly number[], task: () => Promise<TResult>): Promise<TResult> {
        const ordered = [...new Set(sessionIds)].sort((left, right) => left - right);
        const acquire = async (index: number): Promise<TResult> => {
            const sessionId = ordered[index];
            if (sessionId === undefined) {
                return task();
            }
            return this.withSessionMutationLock(sessionId, () => acquire(index + 1));
        };
        return acquire(0);
    }

    /** 获取一个 Session 的底层 mutation queue；调用方不得在此后反向获取 relation lock。 */
    private async withSessionMutationLock<TResult>(sessionId: number, task: () => Promise<TResult>): Promise<TResult> {
        const previous = this.sessionMutationQueues.get(sessionId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => current);
        this.sessionMutationQueues.set(sessionId, queued);

        await previous.catch(() => undefined);
        try {
            return await task();
        } finally {
            release();
            if (this.sessionMutationQueues.get(sessionId) === queued) {
                this.sessionMutationQueues.delete(sessionId);
            }
        }
    }

    private async executeWritePlan(plan: SessionWritePlan, invocationId?: string, timing?: AgentOperationTiming): Promise<SessionEntry[]> {
        const result = await this.executeWritePlanResult(plan, invocationId, timing);
        return result.entries;
    }

    private async executeWritePlanResult(plan: SessionWritePlan, invocationId?: string, timing?: AgentOperationTiming): Promise<SessionWriteResult> {
        return this.writeExecutor.execute([plan], invocationId, {timing: this.sessionWriteTiming(timing)});
    }

    private async commandLiveStateResult(
        sessionId: number,
        status: Extract<AgentCommandResult, {kind: "live_state"}>["status"],
        result?: SessionWriteResult,
        timing?: AgentOperationTiming,
    ): Promise<Extract<AgentCommandResult, {kind: "live_state"}>> {
        const state = result?.liveStates.get(sessionId)
            ?? await measureAgentTimingStep(timing, "liveState", () => this.getSessionLiveState(sessionId));
        return {
            kind: "live_state",
            status,
            sessionId,
            state,
        };
    }

    private modelSelectionKey(model: Model<any> | DurableSessionModelRef | null): string | null {
        if (!model) {
            return null;
        }
        if ("modelId" in model) {
            return `${model.providerConfigId}/${model.modelId}`;
        }
        const providerConfigId = "providerConfigId" in model && typeof model.providerConfigId === "string" && model.providerConfigId.trim()
            ? model.providerConfigId
            : null;
        if (!providerConfigId) throw new Error("Resolved model缺少明确的Provider Config ID。");
        return `${providerConfigId}/${model.id}`;
    }

    /**
     * 按当前配置解析 profile/default 模型；解析失败返回 null，调用方决定是否报错。
     */
    private resolveConfiguredSessionModel(
        config: Pick<EffectiveConfig, "agent" | "models">,
        profileKey: string,
        override?: {modelKey?: string | null} | null,
    ): Model<any> | null {
        try {
            return override ? this.modelResolver(config, profileKey, override) : this.modelResolver(config, profileKey);
        } catch {
            return null;
        }
    }

    /**
     * 按session保存的selection key从当前配置重新解析完整metadata。
     * 已保存引用失效时严格阻断该Session；只有尚未绑定模型的Session才读取当前默认值。
     */
    private resolveEffectiveSessionModel(config: Pick<EffectiveConfig, "agent" | "models">, context: NeuroSessionContext): Model<any> | null {
        if (context.model === null) {
            return this.resolveConfiguredSessionModel(config, context.profileKey, null);
        }
        const modelKey = this.modelSelectionKey(context.model);
        try {
            return this.modelResolver(config, context.profileKey, {modelKey});
        } catch (error) {
            throw new Error(`Session模型引用已失效：${modelKey ?? "<missing>"}。请显式选择有效模型。`, {cause: error});
        }
    }

    /**
     * 运行前把缺失或已删除的 session 模型修正成当前有效默认模型。
     */
    private async ensureSessionModelConfigured(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        config: Pick<EffectiveConfig, "agent" | "models">,
    ): Promise<{snapshot: SessionSnapshot; context: NeuroSessionContext; model: Model<any> | null}> {
        const model = this.resolveEffectiveSessionModel(config, context);
        if (sessionModelsEqual(context.model, model)) {
            return {snapshot, context, model};
        }
        if (!model) {
            return {snapshot, context, model};
        }

        await this.executeWritePlan({
            target: {sessionId: snapshot.metadata.sessionId},
            cause: "agent.session.model_reconcile",
            ops: [{
                kind: "append",
                entry: {
                    type: "model_change",
                    model: canonicalSessionModel(model),
                },
            }],
        });
        const nextSnapshot = await this.repo.readSession(snapshot.metadata.sessionId);
        const nextContext = this.repo.reduce(nextSnapshot);
        return {
            snapshot: nextSnapshot,
            context: nextContext,
            model,
        };
    }

    private followUpQueueState(sessionId: number, context?: NeuroSessionContext): FollowUpQueueTruthState {
        const existing = this.followUpQueues.get(sessionId);
        if (existing) {
            return existing;
        }
        const persisted = context ? this.readFollowUpQueueState(context) : undefined;
        if (persisted) {
            this.followUpQueues.set(sessionId, persisted);
            return persisted;
        }
        return this.emptyFollowUpQueueState();
    }

    private followUpQueueSummary(sessionId: number, context?: NeuroSessionContext): AgentSessionLiveStateDto["followUpQueue"] {
        const queue = this.followUpQueueState(sessionId, context);
        return {
            status: queue.status,
            count: queue.items.length,
            ...(queue.status === "paused" ? {pausedBy: queue.pausedBy} : {}),
        };
    }

    private publicFollowUpQueue(queue: FollowUpQueueTruthState): AgentFollowUpQueueStateDto {
        const projected = projectQueuedMessages(queue.items);
        return {
            status: queue.status,
            ...(queue.status === "paused" ? {pausedBy: queue.pausedBy} : {}),
            items: projected.items,
            omittedItems: projected.omittedItems,
        };
    }

    private emptyFollowUpQueueState(): FollowUpQueueTruthState {
        return {
            status: "ready",
            items: [],
        };
    }

    private async setFollowUpQueueState(sessionId: number, queue: FollowUpQueueTruthState): Promise<void> {
        const previous = this.followUpQueues.get(sessionId);
        if (queue.items.length === 0 && queue.status === "ready") {
            this.followUpQueues.delete(sessionId);
        } else {
            this.followUpQueues.set(sessionId, queue);
        }
        try {
            await this.executeWritePlan({
                target: {sessionId},
                cause: "followup.queue",
                ops: [{
                    kind: "append",
                    projection: true,
                    entry: {
                        type: "custom",
                        key: AGENT_FOLLOW_UP_QUEUE_STATE_KEY,
                        value: encodeFollowUpQueue(queue),
                    },
                }],
            });
        } catch (error) {
            if (previous) {
                this.followUpQueues.set(sessionId, previous);
            } else {
                this.followUpQueues.delete(sessionId);
            }
            throw error;
        }
    }

    private readFollowUpQueueState(context: NeuroSessionContext): FollowUpQueueTruthState | undefined {
        const value = context.customState[AGENT_FOLLOW_UP_QUEUE_STATE_KEY];
        if (value === undefined) {
            return undefined;
        }
        return parseFollowUpQueue(value);
    }

    private async createVariableAccessor(sessionId: number, invocationId?: string): Promise<ProfileVariableAccessor> {
        const snapshot = await this.repo.readSession(sessionId);
        const profile = await this.profiles.get(this.repo.reduce(snapshot).profileKey);
        return this.createProfileVariableAccessor(snapshot, profile, {
            clientState: invocationId ? this.invocationClientStates.get(invocationId) : undefined,
            invocationId,
            onSessionEntry: (entry) => this.publishSessionEntry(sessionId, invocationId, entry),
        });
    }

    private async createProfileVariableAccessor(snapshot: SessionSnapshot, profile: AgentProfile, options: {
        clientState?: ClientStateSnapshot;
        dryRun?: boolean;
        invocationId?: string;
        onSessionEntry?: (entry: SessionEntry) => void | Promise<void>;
    } = {}): Promise<ProfileVariableAccessor> {
        const variableState = options.invocationId
            ? this.invocationVariableStates.get(options.invocationId)
            : undefined;
        if (options.invocationId && !variableState) {
            throw new Error(`invocation variable state不存在：${options.invocationId}`);
        }
        const currentProject = variableState?.currentProject ?? null;
        const registry = options.invocationId
            ? await createVariableRegistryForSession({
                profile,
                globalWorkspaceRoot: absoluteFsPath(this.repo.rootWorkspace),
                currentProject,
            })
            : createVariableRegistryForProfile(profile);
        return createProfileVariableAccessor({
            repo: this.repo,
            snapshot,
            registry,
            clientState: options.clientState,
            dryRun: options.dryRun,
            invocationId: options.invocationId,
            variableState,
            writeSessionEntry: options.dryRun
                ? undefined
                : (cause, entry) => new ToolSessionWriteSink({
                    executor: this.writeExecutor,
                    sessionId: snapshot.metadata.sessionId,
                    invocationId: options.invocationId,
                }).append(cause, entry),
            onSessionEntry: options.onSessionEntry,
            onClientPatch: options.invocationId
                ? (request) => this.requestClientVariablePatch(snapshot.metadata.sessionId, request)
                : undefined,
        });
    }

    private async requestClientVariablePatch(sessionId: number, request: VariablePatchRequest): Promise<VariablePatchAck> {
        if (!request.invocationId || request.toolCallId === undefined) {
            throw new Error("client.* patch 需要 invocationId 和 toolCallId。");
        }
        const toolCallId = assertPublicToolCallId(request.toolCallId);
        const validatedRequest: VariablePatchRequest = {...request, toolCallId};
        assertPublicClientVariablePatch(validatedRequest);
        const key = clientPatchKey(validatedRequest.invocationId, toolCallId, validatedRequest.path);
        if (this.pendingClientPatches.has(key)) {
            throw new Error(`client.* patch 已在等待 ack：${validatedRequest.path}`);
        }
        const promise = new Promise<VariablePatchAck>((resolvePatch, rejectPatch) => {
            const timeout = setTimeout(() => {
                this.pendingClientPatches.delete(key);
                rejectPatch(new Error(`client.* patch 等待前端 ack 超时：${validatedRequest.path}`));
            }, 10_000);
            this.pendingClientPatches.set(key, {
                request: validatedRequest,
                resolve: resolvePatch,
                reject: rejectPatch,
                timeout,
            });
        });
        this.eventHub.publish({
            sessionId,
            invocationId: validatedRequest.invocationId,
            kind: "session",
            event: {
                type: "client_variable_patch_requested",
                request: validatedRequest,
            },
        });
        return await promise;
    }

    private rejectPendingClientPatches(invocationId: string): void {
        for (const [key, pending] of [...this.pendingClientPatches.entries()]) {
            if (pending.request.invocationId !== invocationId) {
                continue;
            }
            clearTimeout(pending.timeout);
            this.pendingClientPatches.delete(key);
            pending.reject(new Error("invocation 已结束，client.* patch 未完成。"));
        }
    }

    private providerOptions(config: Pick<EffectiveConfig, "models">, model: Model<any>): {timeoutMs: number | null; requestOptions: Record<string, JsonValue>} {
        const modelIdentity = model as unknown as {providerConfigId?: unknown};
        const providerConfigId = typeof modelIdentity.providerConfigId === "string"
            && modelIdentity.providerConfigId.trim()
            ? modelIdentity.providerConfigId
            : null;
        if (!providerConfigId) throw new Error("Resolved model缺少明确的Provider Config ID。");
        const options = config.models.providers[providerConfigId]?.options;
        if (!options) throw new Error(`Provider Config不存在：${providerConfigId}`);
        return {
            timeoutMs: options.timeoutMs ?? null,
            requestOptions: parsePiSimpleRequestOptions(options.requestOptions),
        };
    }

    /**
     * 合并 session 显式 thinking 设置与 profile 默认 reasoningEffort。
     */
    private resolveThinkingLevel(
        context: ReturnType<JsonlSessionRepository["reduce"]>,
        config: Pick<EffectiveConfig, "agent">,
        model: Model<any>,
    ): ThinkingLevel {
        const requested = context.thinkingLevel
            ?? config.agent.profiles[context.profileKey]?.model.reasoningEffort
            ?? config.agent.profileModelDefaults.reasoningEffort
            ?? "off";
        return clampThinkingLevel(model, requested);
    }

    /**
     * 解析当前 profile 的 settings，运行时遇到坏配置时回退 profile defaults。
     */
    private async resolveProfileSettings(
        profile: AgentProfile,
        config: Pick<EffectiveConfig, "agent">,
        context: Pick<NeuroSessionContext, "profileKey">,
        project: ReadyProjectSessionRef | null,
    ): Promise<{settings: Record<string, JsonValue>; home?: ProfileHomeFacade}> {
        const projectWorkspace = project?.workspace;
        const home = await this.ensureProfileHome(profile, projectWorkspace);
        const customSettings = await resolveRuntimeProfileSettings(
            profile,
            config.agent.profiles[context.profileKey]?.settings,
            projectWorkspace
                ? {
                    profileKey: context.profileKey,
                    scope: "project",
                    projectWorkspace,
                    ...(home ? {home, allowGlobalResourceKeys: true} : {}),
                }
                : {
                    profileKey: context.profileKey,
                    scope: "global",
                    ...(home ? {home, allowGlobalResourceKeys: true} : {}),
                },
        );
        return {settings: customSettings, ...(home ? {home} : {})};
    }

    /** 解析 Harness 最终使用的通用运行策略。 */
    private resolveProfileRuntimeSettings(profile: AgentProfile, config: Pick<EffectiveConfig, "agent">): ProfileRuntimeSettings {
        return resolveRuntimeSettings(
            profile.runtimeDefaults,
            config.agent.profiles[profile.manifest.key]?.runtime ?? config.agent.profileRuntimeDefaults,
        );
    }

    private publishRuntimeEvent(sessionId: number, invocationId: string | undefined, event: AgentRuntimeStreamEventDto): AgentSessionEventDto {
        return this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "runtime",
            event,
        }).payload;
    }

    private createTranscriptReplayAnchor(frame: RunFrame, turnStartSeq: number): void {
        if (this.transcriptReplayAnchors.has(frame.sessionId)) {
            return;
        }
        const firstSeq = turnStartSeq;
        this.transcriptReplayAnchors.set(frame.sessionId, {
            invocationId: frame.invocationId,
            turnIndex: frame.turnIndex,
            after: firstSeq - 1,
            firstSeq,
        });
        this.eventHub.pinReplayFrom(frame.sessionId, firstSeq);
    }

    private clearPersistedTranscriptReplayAnchor(frame: RunFrame, ingest: TurnIngestResult): void {
        if (ingest.transcript !== "persist") {
            return;
        }
        const anchor = this.transcriptReplayAnchors.get(frame.sessionId);
        if (!anchor || anchor.turnIndex !== frame.turnIndex) {
            return;
        }
        if (anchor.invocationId && frame.invocationId && anchor.invocationId !== frame.invocationId) {
            return;
        }
        this.clearTranscriptReplayAnchor(frame.sessionId);
    }

    private clearTranscriptReplayAnchor(sessionId: number): void {
        this.transcriptReplayAnchors.delete(sessionId);
        this.eventHub.unpinReplay(sessionId);
    }

    private publishSessionEntry(sessionId: number, invocationId: string | undefined, entry: SessionEntry): void {
        const projected = projectAgentChatEntry(entry, {invocationId});
        if (!projected) {
            return;
        }
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_entry",
                entry: projected,
            },
        });
    }

    /**
     * 通知 target session 重新拉完整 snapshot，以刷新 linkedByAgents 这类跨 session 投影。
     */
    private publishLinkedAgentSnapshotRequired(sessionId: number): void {
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {
                type: "session_projection_invalidated",
                reason: "linked_agent_changed",
            },
        });
    }

    /** 轻量通知前端附件目录失效；不触发完整 Session recovery。 */
    private publishSessionAttachmentsChanged(sessionId: number): void {
        this.eventHub.publish({
            sessionId,
            kind: "session",
            event: {type: "session_attachments_changed"},
        });
    }

    private async publishSessionState(
        sessionId: number,
        invocationId?: string,
        invalidatePendingPlan = false,
    ): Promise<AgentSessionLiveStateDto> {
        const state = await this.getSessionLiveState(sessionId);
        this.eventHub.publish({
            sessionId,
            invocationId,
            kind: "session",
            event: {
                type: "session_state_changed",
                state,
            },
        });
        if (invalidatePendingPlan && state.pendingUserInputs.some((pending) => pending.toolName === "switch_mode" && pending.planFilePath)) {
            this.eventHub.publish({
                sessionId,
                invocationId,
                kind: "session",
                event: {type: "session_projection_invalidated", reason: "pending_plan_content_changed"},
            });
        }
        return state;
    }

    private resolveSessionStatus(
        sessionId: number,
        baseStatus: AgentSessionSummaryDto["status"],
        archived: boolean,
        active: AgentActiveInvocationDto | null = this.activeInvocations.get(sessionId) ?? null,
    ): AgentSessionSummaryDto["status"] {
        if (archived) {
            return "archived";
        }
        if (active?.status === "waiting") {
            return "waiting";
        }
        if (active) {
            return "running";
        }
        return baseStatus;
    }

    private async resolveSessionRuntimeProjection(
        sessionId: number,
        snapshot?: SessionSnapshot,
        timing?: AgentOperationTiming,
    ): Promise<SessionRuntimeProjection> {
        const currentSnapshot = snapshot
            ?? await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
        const context = measureAgentTimingStepSync(timing, "reduce", () => this.repo.reduce(currentSnapshot));
        const profileRuntime = await measureAgentTimingStep(
            timing,
            "profileRuntime",
            () => this.resolveProfileRuntime(context.profileKey),
        );
        const pendingMessages = storedMessagesForText(context.messages);
        const pendingApprovals = findPendingApprovalCalls(pendingMessages, await this.userResolutionToolKeysForSnapshot(currentSnapshot, profileRuntime.profile));
        const baseSummary = this.repo.summary(currentSnapshot);
        const activeInvocation = this.resolveActiveInvocation(sessionId, baseSummary.status, pendingApprovals, currentSnapshot);
        const status = this.resolveSessionStatus(sessionId, baseSummary.status, context.archived, activeInvocation);
        const summary = projectPublicSessionSummary({
            ...baseSummary,
            status,
            profileAvailability: profileRuntime.availability,
            ...(profileRuntime.issueMessage ? {profileIssueMessage: profileRuntime.issueMessage} : {}),
            interaction: sessionInteraction({
                archived: context.archived,
                status,
                profileAvailability: profileRuntime.availability,
            }),
        });
        return {
            snapshot: currentSnapshot,
            context,
            profile: profileRuntime.profile,
            profileAvailability: profileRuntime.availability,
            ...(profileRuntime.issueMessage ? {profileIssueMessage: profileRuntime.issueMessage} : {}),
            baseSummary,
            summary,
            pendingApprovals,
            activeInvocation,
        };
    }

    /**
     * 解析 session 引用的 profile 运行态；缺失或不可运行只影响继续运行，不影响历史读取。
     */
    private async resolveProfileRuntime(profileKey: string): Promise<{
        profile: AgentProfile | null;
        availability: AgentSessionProfileAvailability;
        issueMessage?: string;
    }> {
        try {
            return {
                profile: await this.profiles.get(profileKey),
                availability: "loaded",
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                const catalog = await this.profiles.snapshot();
                const catalogItem = catalog.profiles.find((profile) => profile.key === profileKey);
                if (catalogItem) {
                    return {
                        profile: null,
                        availability: "unloadable",
                        issueMessage: catalogItem.issue?.message ?? message,
                    };
                }
            } catch {
                return {
                    profile: null,
                    availability: "unloadable",
                    issueMessage: message,
                };
            }
            return {
                profile: null,
                availability: "missing",
                issueMessage: message,
            };
        }
    }

    /**
     * 确认当前 session 的 profile 仍可用于发起新运行。
     */
    private async assertProfileRunnable(snapshot: SessionSnapshot): Promise<AgentProfile> {
        const profileKey = this.repo.reduce(snapshot).profileKey;
        const runtime = await this.resolveProfileRuntime(profileKey);
        if (!runtime.profile) {
            throw new Error(this.profileUnavailableMessage(profileKey));
        }
        return runtime.profile;
    }

    /**
     * 返回 profile 不可继续运行时统一展示给用户的错误文案。
     */
    private profileUnavailableMessage(profileKey: string): string {
        return `当前 session 使用的 profile "${profileKey}" 已不存在或不可运行，无法继续运行。请恢复该 profile，或新建/切换到其他 profile。`;
    }

    /**
     * 生成 profile 不可运行时的 invoke error result。
     */
    private profileUnavailableInvokeResult(
        sessionId: number,
        profileKey: string,
        invocationId: string = randomUUID(),
        acceptance: import("nbook/shared/dto/agent-session.dto").AgentInvocationAcceptanceDto = {state: "none"},
    ): AgentInvocationResult {
        const errorInfo = this.toInvocationErrorInfo(this.profileUnavailableMessage(profileKey), "pre_loop");
        return {
            sessionId,
            invocationId,
            status: "error",
            acceptance,
            error: errorInfo.message,
            errorPhase: errorInfo.phase,
            errorInfo,
        };
    }

    /**
     * 组装上下文检查面板所需的全部只读事实（Task 126 批次 D）。
     *
     * 只读：不触发 prepare、不写 session、不调 provider。数据来自已落盘的 trace
     * 与 effective config，因此 trace 关闭时返回 `state: "disabled"` 而不是报错。
     *
     * @param traceId 指定要查看的请求；缺省取最近一条 `kind === "turn"`。
     */
    async getSessionContextInspection(sessionId: number, traceId?: string): Promise<AgentContextInspectionDto> {
        const snapshot = await this.repo.readSession(sessionId);
        const context = this.repo.reduce(snapshot);
        const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));

        if (!config.observability.piTrace.enabled) {
            return {state: "disabled", requests: [], timeline: [], facts: emptyContextFacts(), diagnostics: []};
        }

        const reader = new PiTraceReader({tracesRoot: this.repo.tracesRoot});
        // listIndex 最新在前；时间轴与诊断都按时间正序推理，这里翻回来。
        const timeline = (await reader.listIndex(String(sessionId))).reverse();
        const turns = timeline.filter((entry) => entry.kind === "turn");
        const facts = await this.contextInspectionFacts(snapshot, context, config);

        if (turns.length === 0) {
            return {state: "empty", requests: [], timeline: timelineDto(timeline), facts, diagnostics: []};
        }

        const requests = turns.map((entry) => ({
            id: entry.id,
            ts: entry.ts,
            ...(entry.turnIndex === undefined ? {} : {turnIndex: entry.turnIndex}),
            ...(entry.invocationId === undefined ? {} : {invocationId: entry.invocationId}),
            promptTokens: entry.usage ? entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite : null,
        }));
        const targetId = traceId && turns.some((entry) => entry.id === traceId) ? traceId : turns.at(-1)!.id;
        const record = await reader.readRecord(String(sessionId), targetId);
        const segments = record?.request.segments ?? [];

        return {
            state: "ok",
            requests,
            timeline: timelineDto(timeline),
            facts,
            ...(record
                ? {
                    selected: {
                        traceId: targetId,
                        ts: record.ts,
                        provider: record.request.provider,
                        model: record.request.model,
                        segments,
                        labelBreakdown: aggregateSegmentLabels(segments),
                        ...(record.response.usage
                            ? {
                                usage: {
                                    input: record.response.usage.input,
                                    output: record.response.usage.output,
                                    cacheRead: record.response.usage.cacheRead,
                                    cacheWrite: record.response.usage.cacheWrite,
                                },
                            }
                            : {}),
                        // 本功能之前的记录完全没有 segments，必须与「归因不完整」区分开。
                        ...(segments.length === 0
                            ? {attribution: "none" as const}
                            : record.request.attribution === "legacy" ? {attribution: "legacy" as const} : {}),
                    },
                }
                : {}),
            diagnostics: buildContextDiagnostics({
                segments,
                timeline: timeline.map((entry) => ({
                    id: entry.id,
                    ts: entry.ts,
                    kind: entry.kind,
                    model: entry.model,
                    ...(entry.toolsHash === undefined ? {} : {toolsHash: entry.toolsHash}),
                    ...(entry.usage === undefined ? {} : {usage: entry.usage}),
                })),
                provider: record?.request.provider ?? "",
                contextWindowTokens: facts.contextWindowTokens,
                compactionTriggerTokens: facts.compactionTriggerTokens,
                cacheRetention: facts.cacheRetention,
            }),
        };
    }

    /**
     * 解析面板需要的运行事实：窗口、压缩触发线、缓存保留期。
     *
     * 任一项解析失败都退化成 null 而不是让整个面板报错——面板是诊断工具，
     * 配置本身有问题时更应该打得开（`contextWindowUnset` 就是一条诊断）。
     */
    private async contextInspectionFacts(
        snapshot: SessionSnapshot,
        context: NeuroSessionContext,
        config: EffectiveConfig,
    ): Promise<AgentContextInspectionDto["facts"]> {
        try {
            const model = this.resolveEffectiveSessionModel(config, context) ?? this.modelResolver(config, context.profileKey);
            const contextWindowTokens = typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
                ? model.contextWindow
                : null;
            const profile = await this.profiles.get(context.profileKey);
            const compaction = resolveCompactionOptions(this.resolveProfileRuntimeSettings(profile, config).compaction, model);
            return {
                contextWindowTokens,
                compactionTriggerTokens: resolveCompactionTriggerTokens(compaction, contextWindowTokens),
                cacheRetention: resolveModelCacheRetention(model, this.providerOptions(config, model).requestOptions),
            };
        } catch {
            void snapshot;
            return emptyContextFacts();
        }
    }

    /**
     * 生成当前 active context 的 token 估算信息。
     */
    private async sessionContextUsage(snapshot: SessionSnapshot, context: NeuroSessionContext): Promise<AgentSessionContextUsageDto> {
        const usedTokens = estimateStoredContextTokens(context.messages).tokens;
        let limitTokens: number | null = null;
        try {
            const config = await loadEffectiveConfig(resolveNonInvocationConfigTarget(snapshot.metadata, this.workspaceRoot));
            const model = this.resolveEffectiveSessionModel(config, context) ?? this.modelResolver(config, context.profileKey);
            limitTokens = typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
                ? model.contextWindow
                : null;
        } catch {
            limitTokens = null;
        }
        return {
            usedTokens,
            limitTokens,
            percent: limitTokens ? usedTokens / limitTokens * 100 : null,
            estimated: true,
        };
    }

    private resolveActiveInvocation(
        sessionId: number,
        baseStatus: AgentSessionSummaryDto["status"],
        pendingApprovals: PendingApprovalLookup,
        snapshot: SessionSnapshot,
    ): AgentActiveInvocationDto | null {
        const active = this.activeInvocations.get(sessionId);
        if (active) {
            return active;
        }
        if (pendingApprovals.length === 0) {
            return null;
        }
        return this.hydrateWaitingInvocation(sessionId, baseStatus, snapshot);
    }

    private hydrateWaitingInvocation(sessionId: number, baseStatus: AgentSessionSummaryDto["status"], snapshot: SessionSnapshot): AgentActiveInvocationDto | null {
        if (baseStatus === "archived") {
            return null;
        }
        const path = this.repo.activePath(snapshot);
        for (let index = path.length - 1; index >= 0; index -= 1) {
            const entry = path[index];
            if (entry?.type !== "invocation_lifecycle") {
                continue;
            }
            if (entry.status !== "waiting") {
                return null;
            }
            return {
                invocationId: entry.invocationId,
                sessionId,
                status: "waiting",
                mode: "continue",
                startedAt: entry.timestamp,
            };
        }
        return null;
    }

    private isLeaderProfile(profileKey: string): boolean {
        return profileKey === "leader.default"
            || profileKey === "leader.assets"
            || profileKey === "rp.leader"
            || profileKey === "simulator.leader"
            || profileKey.startsWith("leader.");
    }

    private async moveLeafForPosition(
        sessionId: number,
        targetEntryId: SessionEntryId,
        position: "at" | "before",
        timing?: AgentOperationTiming,
    ): Promise<void> {
        const snapshot = await measureAgentTimingStep(timing, "readSession", () => this.repo.readSession(sessionId));
        const leafId = this.leafIdForPosition(snapshot, targetEntryId, position);
        await this.executeWritePlan({
            target: {sessionId},
            cause: `tree.${position}`,
            ops: [{
                kind: "moveLeaf",
                leafId,
            }],
        }, undefined, timing);
    }

    /** 只读解析 tree position 对应的新 leaf，供 preadmission 与实际写入共用。 */
    private leafIdForPosition(
        snapshot: SessionSnapshot,
        targetEntryId: SessionEntryId,
        position: "at" | "before",
    ): SessionEntryId | null {
        const target = snapshot.entries.find((entry) => entry.id === targetEntryId);
        if (!target || target.type === "leaf") {
            throw new Error(`未找到目标 entry：${targetEntryId}`);
        }
        return position === "before" ? target.parentId : target.id;
    }

    /** Session mutation 临界区内 claim compact；耗时 Provider 工作由调用方在锁外启动。 */
    private async claimCompactInvocationLocked(
        sessionId: number,
        currentProject: ReadyProjectSessionRef | null,
    ): Promise<{invocationId: string; abortSignal: AbortSignal}> {
        const invocationId = randomUUID();
        const activeInvocation: AgentActiveInvocationDto = {
            invocationId,
            sessionId,
            status: "running",
            mode: "compact",
            startedAt: Date.now(),
        };
        const controller = new AbortController();
        this.activeInvocations.set(sessionId, activeInvocation);
        this.abortControllers.set(sessionId, controller);
        this.invocationVariableStates.set(invocationId, {
            readFingerprints: new Map(),
            clientOverlay: normalizeClientState(undefined),
            currentProject,
        });
        this.invocationCompletions.set(invocationId, createInvocationCompletion());
        try {
            if (currentProject) {
                this.holdInvocationProject(sessionId, invocationId, currentProject, controller);
                this.activeInvocationProjects.set(sessionId, currentProject);
            }
            await this.writeLifecycle(sessionId, invocationId, "start");
        } catch (error) {
            this.finishInvocationState(sessionId, invocationId);
            throw error;
        }
        return {invocationId, abortSignal: controller.signal};
    }

    /** 已 claim 的 compact 在 Session mutation lock 外执行。 */
    private async runCompactCommand(
        sessionId: number,
        invocationId: string,
        abortSignal: AbortSignal,
        instructions?: string,
    ): Promise<void> {
        try {
            let snapshot = await this.repo.readSession(sessionId);
            let context = this.repo.reduce(snapshot);
            // manual compact与普通 invocation 一样，只消费 command admission 捕获的 Project generation。
            const config = await loadEffectiveConfig(this.configTargetForInvocation(invocationId));
            const preparedModel = await this.ensureSessionModelConfigured(snapshot, context, config);
            snapshot = preparedModel.snapshot;
            context = preparedModel.context;
            const model = preparedModel.model ?? this.modelResolver(config, context.profileKey);
            const models = this.runtimeResolver(config, model);
            const providerOptions = this.providerOptions(config, model);
            const thinkingLevel = this.resolveThinkingLevel(context, config, model);
            const profile = await this.profiles.get(context.profileKey);
            const compaction = this.resolveProfileRuntimeSettings(profile, config).compaction;
            await appendCompaction({
                repo: this.repo,
                snapshot,
                messages: context.messages,
                models,
                model,
                apiKey: resolvePiApiKeyForModelFromConfig(config, model),
                timeoutMs: providerOptions.timeoutMs,
                requestOptions: providerOptions.requestOptions,
                thinkingLevel,
                instructions,
                compaction,
                trace: this.traceBinding(config, {kind: "compaction", sessionId, invocationId, profileKey: context.profileKey}),
                signal: abortSignal,
                writeCompactionEntry: async (entry) => {
                    await new ToolSessionWriteSink({
                        executor: this.writeExecutor,
                        sessionId,
                        invocationId,
                    }).append("compact.append", entry);
                },
            });
            await this.commitInvocationState({
                sessionId,
                invocationId,
                lifecycleStatus: "end",
                nextState: "finished",
            });
        } catch (error) {
            const errorInfo = this.toInvocationErrorInfo(error, "compaction");
            const aborted = abortSignal.aborted;
            await this.commitInvocationState({
                sessionId,
                invocationId,
                lifecycleStatus: aborted ? "aborted" : "error",
                error: errorInfo.message,
                errorInfo,
                nextState: "finished",
                pauseReason: aborted ? "aborted" : "error",
            });
            return;
        }
        await this.drainFollowUps(sessionId);
    }

    private toInvocationErrorInfo(error: unknown, phase: InvocationErrorPhase): InvocationErrorInfo {
        return {
            message: providerErrorText(error),
            phase,
        };
    }

    private sessionSummary(snapshot: SessionSnapshot): AgentSummary {
        const context = this.repo.reduce(snapshot);
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: context.profileKey,
            currentProjectRoot: context.currentProjectRoot,
            title: context.title,
            summary: context.summary,
            status: "idle",
        };
    }

    private errorToolResult(message: string): NeuroToolResult {
        return {
            content: [{type: "text", text: message}],
            details: {},
        };
    }

    /** 同时构造 durable truth 与 Pi AgentEvent 文本投影，避免两条边界互相误用。 */
    private runtimeTextToolResult(input: {
        toolCallId: string;
        toolName: string;
        text: string;
        isError?: boolean;
        details?: JsonValue;
        timestamp?: number;
    }): RuntimeToolResult {
        const timestamp = input.timestamp ?? Date.now();
        return {
            stored: createStoredTextToolResult({...input, timestamp}),
            event: createTextToolResult({...input, timestamp}),
        };
    }

    /**
     * 普通 ReAct turn 的持久化边界在 turn_end：assistant 和 toolResult 成组落盘。
     * approval 工具是合法 suspend point，允许只落 assistant toolCall 等待用户 resolution。
     */
    private async commitTurn(input: {
        sessionId: number;
        invocationId?: string;
        assistant: AssistantMessage;
        toolResults: RuntimeToolResult[];
        waiting?: RunToolBatchResult["waiting"];
        messageStatus?: "partial" | "interrupted" | "error";
        profile: AgentProfile;
        runtimeState: RunRuntimeState;
        caller: AgentInvokeCaller;
        turnIndex: number;
        pendingWritePlans: PendingSessionWritePlan[];
        transcriptParentLeafId?: SessionEntryId | null;
    }): Promise<TurnIngestResult> {
        const orderedToolResults = this.orderToolResults(input.assistant, input.toolResults);
        this.assertTurnClosed(input.assistant, orderedToolResults, input.waiting);
        const snapshot = await this.repo.readSession(input.sessionId);
        const context = this.repo.reduce(snapshot);
        const ingest = await this.runRuntimeHooks({
            sessionId: input.sessionId,
            invocationId: input.invocationId ?? "",
            profile: input.profile,
            runtimeState: input.runtimeState,
            stage: "ingestTurn",
            snapshot,
            context,
            caller: input.caller,
            turnIndex: input.turnIndex,
            turn: {
                assistant: input.assistant,
                toolResults: orderedToolResults.map((toolResult) => toolResult.stored),
                waiting: input.waiting,
                messageStatus: input.messageStatus,
            },
        });
        const transcript = ingest.transcript ?? "runtime_only";
        if (transcript === "runtime_only") {
            if (input.waiting) {
                throw new Error("waiting turn 必须显式使用 persist transcript；resume 需要持久化 pending tool call。");
            }
            await this.flushPendingWritePlans(input.pendingWritePlans, input.invocationId);
            return {transcript: "runtime_only"};
        }
        const pendingUserResolutionEntry = this.pendingUserResolutionEntry(input.waiting);
        const transcriptPlan: SessionWritePlan = {
            target: {sessionId: input.sessionId},
            cause: "turn.ingest",
            durability: "savePoint",
            ops: [{
                kind: "appendMany",
                entries: [
                    {
                        type: "message",
                        message: input.assistant,
                        origin: "harness",
                        ...(input.transcriptParentLeafId !== undefined ? {parentId: input.transcriptParentLeafId} : {}),
                        status: input.messageStatus,
                    },
                    ...orderedToolResults.map((toolResult) => ({
                        type: "message" as const,
                        message: toolResult.stored,
                        origin: "harness" as const,
                    })),
                    ...(pendingUserResolutionEntry ? [pendingUserResolutionEntry] : []),
                ],
            }],
        };
        const transcriptResult = await this.writeExecutor.execute([transcriptPlan, ...this.orderedPendingWritePlans(input.pendingWritePlans)], input.invocationId);
        const transcriptEntryCount = 1 + orderedToolResults.length + (pendingUserResolutionEntry ? 1 : 0);
        const transcriptOnlyLeafId = transcriptResult.entries.slice(0, transcriptEntryCount).at(-1)?.id ?? input.transcriptParentLeafId;
        const savePointLeafId = transcriptResult.entries
            .filter((entry) => !("origin" in entry) || entry.origin !== "projection")
            .at(-1)?.id ?? transcriptOnlyLeafId;
        const transcriptLeafId = savePointLeafId;
        input.pendingWritePlans.splice(0, input.pendingWritePlans.length);
        return {transcript: "persist", transcriptLeafId};
    }

    private async flushPendingWritePlans(plans: PendingSessionWritePlan[], invocationId?: string): Promise<void> {
        if (plans.length === 0) {
            return;
        }
        await this.writeExecutor.execute(this.orderedPendingWritePlans(plans), invocationId);
        plans.splice(0, plans.length);
    }

    private orderedPendingWritePlans(plans: PendingSessionWritePlan[]): SessionWritePlan[] {
        return [...plans]
            .sort((left, right) => left.toolCallIndex - right.toolCallIndex || left.enqueueOrder - right.enqueueOrder)
            .map((pending) => pending.plan);
    }

    /**
     * 在固定 pipeline stage 执行 profile runtime hooks。
     *
     * hook 可以返回 write plan、runtimeState 和有限的 turn snapshot patch。
     */
    private async runRuntimeHooks(input: RuntimeHookExecutionInput): Promise<RuntimeHookExecutionResult> {
        const hooks = (input.profile.runtime?.hooks ?? [])
            .filter((hook): hook is AgentRuntimeHook => "stage" in hook && hook.stage === input.stage);
        const result: RuntimeHookExecutionResult = {
            runtimeMessages: [],
        };
        if (hooks.length === 0) {
            return result;
        }

        const hookSnapshot = input.snapshot ?? await this.repo.readSession(input.sessionId);
        const context = input.context ?? this.repo.reduce(hookSnapshot);
        const hookInitial = hookSnapshot.metadata.initial;
        const currentProject = input.invocationId
            ? this.projectForInvocation(input.invocationId)
            : this.readyProjectForMetadata(hookSnapshot.metadata);
        for (const hook of hooks) {
            if (hook.builtin && !this.isExecutableBuiltinHook(hook.name)) {
                continue;
            }
            const hookResult = await hook.run({
                stage: input.stage,
                sessionId: input.sessionId,
                invocationId: input.invocationId,
                profileKey: input.profile.manifest.key,
                initial: hookInitial,
                payload: input.payload,
                session: await this.createRuntimeSessionFacade({
                    sessionId: input.sessionId,
                    profileKey: input.profile.manifest.key,
                    initial: hookInitial,
                    context,
                    currentProject,
                }),
                runtimeState: input.runtimeState.get(hook.name),
                turnIndex: input.turnIndex,
                pendingUserMessage: input.pendingUserMessage,
                invocation: {
                    caller: input.caller,
                    payload: input.payload,
                    message: input.invocationMessage,
                },
                turn: input.turn,
                runResult: input.runResult,
                modelMessages: input.modelMessages,
            });
            await this.applyRuntimeHookResult({
                ...input,
                activeHookBuiltin: hook.builtin === true,
            }, hook.name, hookResult, result);
        }

        return result;
    }

    /**
     * 第一批只执行已经迁入 hook result 的 built-in hook。
     *
     * 其他 built-in hook 先作为默认 runtime 的结构标记，行为仍由 harness 现有路径提供。
     */
    private isExecutableBuiltinHook(name: string): boolean {
        return name === "builtin.profilePrompt"
            || name === "builtin.sessionContext"
            || name === "builtin.transcriptPersistence"
            || name === "builtin.runtimeOnlyTranscript"
            || name === "builtin.reportResult";
    }

    /**
     * 判断 profile runtime 是否组合了某个内置 hook。
     *
     * 有些默认行为需要在 hook stage 执行前参与 kernel 判定，例如 report_result reminder。
     */
    private hasBuiltinHook(profile: AgentProfile, hookName: string): boolean {
        return Boolean(profile.runtime?.hooks.some((hook) => "stage" in hook && hook.builtin && hook.name === hookName));
    }

    /**
     * 创建 runtime hook 可用的只读 session facade。
     *
     * 这里刻意不暴露 append/publish/enqueue；写入必须由 hook 返回 SessionWritePlan。
     */
    private async createRuntimeSessionFacade(input: {
        sessionId: number;
        profileKey: string;
        initial: JsonValue;
        context: NeuroSessionContext;
        currentProject: ReadyProjectSessionRef | null;
    }): Promise<RuntimeSessionFacade> {
        const index = await this.relationIndex();
        const currentContext = {
            ...input.context,
            linkedAgents: this.currentOwnedLinks(input.sessionId, index).map((linked) => ({
                sessionId: linked.targetSessionId,
                profileKey: linked.profileKey,
                detached: false,
            })),
        };
        return {
            ...currentContext,
            workspaceRoot: this.workspaceRoot,
            currentProject: input.currentProject,
            read: async (sessionId = input.sessionId) => {
                const snapshot = await this.repo.readSession(sessionId);
                const context = this.repo.reduce(snapshot);
                const readIndex = await this.relationIndex();
                return {
                    snapshot,
                    context: {
                        ...context,
                        linkedAgents: this.currentOwnedLinks(sessionId, readIndex).map((linked) => ({
                            sessionId: linked.targetSessionId,
                            profileKey: linked.profileKey,
                            detached: false,
                        })),
                    },
                };
            },
            agentDialogueContent: async (contentInput = {}) => {
                const snapshot = await this.repo.readSession(contentInput.sessionId ?? input.sessionId);
                return buildAgentDialogueContent({
                    repo: this.repo,
                    snapshot,
                    summarizerProfileKey: contentInput.profileKey ?? input.profileKey,
                    summarizerInput: contentInput.initial ?? input.initial,
                });
            },
        };
    }

    /**
     * 归并单个 hook result，并执行 hook 返回的 session write plans。
     */
    private async applyRuntimeHookResult(input: RuntimeHookExecutionInput, hookName: string, hookResult: AgentRuntimeHookResult, result: RuntimeHookExecutionResult): Promise<void> {
        if (hookResult.runtimeState !== undefined) {
            input.runtimeState.set(hookName, mergeRuntimeState(input.runtimeState.get(hookName), hookResult.runtimeState));
        }
        if (hookResult.runtimeMessages?.length) {
            if (input.stage !== "prepareRun" && input.stage !== "prepareNextTurn") {
                throw new Error(`runtime hook ${hookName} 的 runtimeMessages 只能在 prepareRun 或 prepareNextTurn stage 返回。`);
            }
            result.runtimeMessages.push(...parseStoredMessages(hookResult.runtimeMessages));
        }
        if (hookResult.turnSnapshotPatch?.requestOptions) {
            result.requestOptionsPatch = {
                ...result.requestOptionsPatch,
                ...hookResult.turnSnapshotPatch.requestOptions,
            };
        }
        if (hookResult.turnSnapshotPatch?.toolKeys) {
            result.toolKeysPatch = hookResult.turnSnapshotPatch.toolKeys;
        }
        if (hookResult.transcript) {
            if (input.stage !== "ingestTurn") {
                throw new Error(`runtime hook ${hookName} 的 transcript 只能在 ingestTurn stage 返回。`);
            }
            result.transcript = hookResult.transcript;
        }
        if (hookResult.builtinBehavior?.reportResultReminder !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.reportResultReminder = hookResult.builtinBehavior.reportResultReminder;
        }
        if (hookResult.builtinBehavior?.profilePrompt !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.profilePrompt = hookResult.builtinBehavior.profilePrompt;
        }
        if (hookResult.builtinBehavior?.sessionContext !== undefined) {
            if (input.activeHookBuiltin !== true) {
                throw new Error(`runtime hook ${hookName} 不能返回 builtinBehavior。`);
            }
            result.sessionContext = hookResult.builtinBehavior.sessionContext;
        }
        if (hookResult.writePlans?.length) {
            await this.writeExecutor.execute(hookResult.writePlans, input.invocationId);
        }
    }

    private orderToolResults(assistant: AssistantMessage, toolResults: RuntimeToolResult[]): RuntimeToolResult[] {
        const order = new Map(assistant.content
            .filter((block): block is AgentToolCall => block.type === "toolCall")
            .map((toolCall, index) => [toolCall.id, index]));
        return [...toolResults].sort((left, right) => (order.get(left.stored.toolCallId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.stored.toolCallId) ?? Number.MAX_SAFE_INTEGER));
    }

    private assertTurnClosed(assistant: AssistantMessage, toolResults: RuntimeToolResult[], waiting?: RunToolBatchResult["waiting"]): void {
        const completedToolCallIds = new Set(toolResults.map((toolResult) => toolResult.stored.toolCallId));
        const toolCalls = assistant.content.filter((block): block is AgentToolCall => block.type === "toolCall");
        const missing = toolCalls.filter((toolCall) => !completedToolCallIds.has(toolCall.id));
        if (missing.length === 0) {
            return;
        }
        if (waiting && missing.length === 1 && missing[0]?.id === waiting.toolCallId && missing[0].name === waiting.toolName) {
            return;
        }
        throw new Error(`turn 存在未闭合 tool call，拒绝写入 session：${missing.map((toolCall) => toolCall.name).join(", ")}`);
    }

    private assertNoUnclosedToolCallsForModel(messages: AgentMessage[], approvalToolKeys: readonly string[]): void {
        const completedToolCallIds = new Set(messages
            .filter((message) => message.role === "toolResult")
            .map((message) => message.toolCallId));
        const pendingToolCalls = messages
            .filter((message) => message.role === "assistant")
            .flatMap((message) => message.content.filter((block): block is AgentToolCall => block.type === "toolCall"))
            .filter((toolCall) => !completedToolCallIds.has(toolCall.id));
        if (pendingToolCalls.length === 0) {
            return;
        }
        const approvalToolKeySet = new Set(approvalToolKeys);
        const ordinaryToolCalls = pendingToolCalls.filter((toolCall) => !approvalToolKeySet.has(toolCall.name));
        if (ordinaryToolCalls.length > 0) {
            throw new Error(`当前 session 存在未闭合普通 tool call，不能继续发送给模型：${ordinaryToolCalls.map((toolCall) => toolCall.name).join(", ")}。请切换到干净分支或运行显式 session repair。`);
        }
        throw new Error("当前 session 正在等待用户审批或回答，请先完成 pending approval resolution。");
    }

    private readReportResult(details: unknown): AgentInvocationResult["reportResult"] | undefined {
        if (!details || typeof details !== "object" || !("result" in details) || typeof (details as {result?: unknown}).result !== "string") {
            return undefined;
        }
        const report = details as {result: string; data?: unknown};
        const data = "data" in report && isJsonValue(report.data) ? report.data : undefined;
        return {
            result: report.result,
            ...(data === undefined ? {} : {data}),
        };
    }

    /**
     * 根据当前 profile 派生模型可见工具 schema 与执行校验。
     */
    private async toolOverrides(toolKeys: readonly string[], profileKey: string, sessionInitial?: JsonValue): Promise<Record<string, NeuroAgentTool>> {
        const profile = await this.profiles.get(profileKey);
        const overrides: Record<string, NeuroAgentTool> = {};
        for (const toolKey of toolKeys) {
            const binding = profile.tools[toolKey];
            if (!binding) {
                continue;
            }
            if (toolKey === "report_result") {
                // per-session 动态 schema（adhoc）：initial 解析优先，静态 dataSchema / outputSchema 兜底
                const dynamicSchema = isReportResultBinding(binding) ? binding.dataSchemaFromInitial?.(sessionInitial ?? null) : undefined;
                const dataSchema = dynamicSchema
                    ?? (isReportResultBinding(binding) ? binding.dataSchema ?? profile.outputSchema : profile.outputSchema);
                overrides.report_result = createReportResultTool(reportResultSchemaForProfile(profile, dynamicSchema), {
                    dataSchema: dynamicSchema ?? (isEmptyObjectSchema(dataSchema) ? undefined : dataSchema),
                    dataRequired: dynamicSchema !== undefined,
                });
                continue;
            }
            const resolvedTool = this.resolveProfileTool(profile, toolKey);
            if (!resolvedTool) {
                continue;
            }
            if (isAgentToolDefinition(binding)) {
                overrides[toolKey] = resolvedTool;
                continue;
            }
            if (("definition" in binding && binding.definition)
                || binding.parameters || binding.validationSchema || binding.description) {
                overrides[toolKey] = resolvedTool;
            }
        }
        return overrides;
    }

    /**
     * 当前 session 的"等待用户 resolution"工具集合。
     * Task 90：无条件并入 mutatesWorkspace 工具，保证注入的写审批挂起在恢复/投影/列表路径都可被识别。
     */
    private async userResolutionToolKeysForSnapshot(snapshot: SessionSnapshot, profile?: AgentProfile | null): Promise<string[]> {
        if (profile) {
            return this.userResolutionToolKeysForProfile(profile);
        }
        const runtime = await this.resolveProfileRuntime(snapshot.metadata.profileKey);
        if (runtime.profile) {
            return this.userResolutionToolKeysForProfile(runtime.profile);
        }
        return this.baseUserResolutionToolKeys();
    }

    /**
     * 无 profile 可用时的 resolution 工具兜底集合：注册表声明的审批/输入工具 + 会写 workspace 的工具。
     * 后者可能被只读模式注入为写审批，识别时无条件计入（理由见 userResolutionToolKeysForProfile）。
     */
    private baseUserResolutionToolKeys(): string[] {
        const keys = new Set(this.tools.userResolutionToolKeys());
        for (const key of this.tools.workspaceMutatingToolKeys()) {
            keys.add(key);
        }
        return [...keys].sort((left, right) => left.localeCompare(right));
    }

    /**
     * 某 profile 的"等待用户 resolution"工具集合：审批工具 + userInputRequest 工具 + mutatesWorkspace 工具。
     *
     * mutatesWorkspace 工具（write/edit/apply_patch）无条件并入，与当前模式无关：只读模式注入的写审批
     * 保留原工具名，而 normal 模式下写工具永远立即产出 toolResult，所以"静止状态下未闭合的写工具调用"
     * 只可能是被注入的挂起审批。据此识别不依赖当前模式，修复重启/投影/列表路径认不出注入写审批、以及
     * 挂起期间切回 normal 后 pending 消失的问题（Task 90）。注入是否发生仍由执行循环的 isReadonlyMode
     * 门控，此集合只用于"识别一个已挂起的 resolution 点"。
     */
    private userResolutionToolKeysForProfile(profile: AgentProfile): string[] {
        const keys = new Set<string>();
        for (const toolKey of profile.rootToolKeys) {
            const tool = this.resolveProfileTool(profile, toolKey);
            if (tool?.approvalRequired || tool?.userInputRequest || tool?.mutatesWorkspace) {
                keys.add(tool.key);
            }
        }
        return [...keys].sort((left, right) => left.localeCompare(right));
    }

    private resolveProfileTool(profile: AgentProfile, toolKey: string): NeuroAgentTool | undefined {
        const binding = profile.tools[toolKey];
        if (!binding) {
            return this.tools.get(toolKey);
        }
        if (isAgentToolDefinition(binding)) {
            return binding.runtime();
        }
        const definition = "definition" in binding ? binding.definition : undefined;
        const baseTool = isAgentToolDefinition(definition)
            ? definition.runtime(binding)
            : this.tools.get(toolKey);
        if (!baseTool) {
            return undefined;
        }
        if (!binding.parameters && !binding.validationSchema && !binding.description) {
            return baseTool;
        }
        return {
            ...baseTool,
            parameters: binding.parameters ?? baseTool.parameters,
            validationSchema: binding.validationSchema ?? baseTool.validationSchema,
            description: binding.description ?? baseTool.description,
        };
    }

}

/** 创建只会 settle 一次的 invocation completion。 */
function createInvocationCompletion(): InvocationCompletion {
    let resolvePromise: (() => void) | undefined;
    const completion: InvocationCompletion = {
        promise: new Promise<void>((resolve) => {
            resolvePromise = resolve;
        }),
        settled: false,
        resolve() {
            if (completion.settled) {
                return;
            }
            completion.settled = true;
            resolvePromise!();
        },
    };
    return completion;
}

/** 创建只会向公开调用方发布一次强制取消结果的 gate。 */
function createInvocationAbortGate(): InvocationAbortGate {
    let resolvePromise: ((result: AgentInvocationResult) => void) | undefined;
    let settled = false;
    return {
        promise: new Promise<AgentInvocationResult>((resolve) => {
            resolvePromise = resolve;
        }),
        resolve(result) {
            if (settled) {
                return;
            }
            settled = true;
            resolvePromise!(result);
        },
    };
}

function estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** 只保留文件名语义，并把登记名称限制在公开 DTO 的稳定上限内。 */
function normalizeSessionAttachmentName(value: string | undefined, fallback: string): string | undefined {
    const candidate = (value?.trim() || fallback.trim())
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.replace(/\0/gu, "")
        .trim();
    return candidate ? candidate.slice(0, 255) : undefined;
}

/** Node 文件错误只在本地边界读取 code，不把绝对路径写入公开错误。 */
function isNodeErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveAgentModelLogName(model: Model<any>): string {
    const record = typeof model === "object" && model !== null ? model as unknown as Record<string, unknown> : {};
    for (const key of ["key", "id", "name", "model"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
            return value;
        }
    }
    return "unknown";
}

function stableJsonHash(value: JsonValue): string {
    return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function stableJsonStringify(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`).join(",")}}`;
}

/**
 * 合并同名 hook 在同一次 invocation 内返回的 runtimeState。
 *
 * 对象做浅合并，非对象按后一次返回替换，避免把数组/字符串误当 patch。
 */
function mergeRuntimeState(previous: JsonValue | undefined, next: JsonValue): JsonValue {
    if (isRecord(previous) && isRecord(next)) {
        return {
            ...previous,
            ...next,
        };
    }
    return next;
}

/** snapshot/control 等非 invocation 入口在调用链顶部解析一次 Project generation。 */
function resolveNonInvocationConfigTarget(input: SessionMetadata, workspaceRoot: AbsoluteFsPath): RuntimeConfigTarget {
    if (input.migrationReview) {
        throw new SessionCurrentProjectError(
            "migration_review_required",
            "该 Session 无法确定所属 Project，必须先重新绑定或明确改为 Workspace Root Session。",
            input.currentProjectRoot,
        );
    }
    if (input.currentProjectRoot) {
        return {
            scope: "project",
            workspaceRoot,
            project: requireActiveReadyProject(projectWorkspaceRef(input.currentProjectRoot)),
        };
    }
    return {scope: "global", workspaceRoot, project: null};
}

/** 使用结构化 target 读取配置；Project generation 必须由调用方在上游确定。 */
async function loadEffectiveConfig(target: RuntimeConfigTarget): Promise<EffectiveConfig> {
    const {loadEffectiveConfigFromTarget} = await import("nbook/server/config/config-service");
    return loadEffectiveConfigFromTarget(target);
}

function clientPatchKey(invocationId: string | undefined, toolCallId: string | undefined, path: string): string {
    return `${invocationId ?? ""}\n${toolCallId ?? ""}\n${path}`;
}

/** 判断未知工具结果是否可以安全进入公开 JSON DTO。 */
function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    if (typeof value === "object") {
        return Object.values(value).every(isJsonValue);
    }
    return false;
}
