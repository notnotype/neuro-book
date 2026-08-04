import type {JsonValue, ThinkingLevel} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import type {DurableSessionModelRef} from "nbook/server/agent/session/session-model-redaction";
import type {VariableJsonPatchOperation, VariableNamespace} from "nbook/server/agent/variables/types";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import type {ChatEntryKind} from "nbook/shared/dto/agent-public-event.dto";
import type {AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";

export type SessionId = number;
export type SessionEntryId = string;

export type SessionMetadata = {
    schemaVersion: 2;
    sessionId: SessionId;
    profileKey: string;
    initial: JsonValue;
    /** 缺失表示 Workspace Root Session；非空时必须是单段 Project root。 */
    currentProjectRoot?: string;
    /** 仅离线迁移写入；重绑或清除 Current Project 后消失。 */
    migrationReview?: {
        status: "required";
        reason: "current_project_unresolved";
    };
    parentSessionId?: SessionId;
    createdAt: number;
    title?: string;
    summary?: string;
    /** system session 默认从普通列表隐藏；summarizer 表示 session 展示元数据维护者。 */
    systemRole?: "summarizer";
    /**
     * Session 类别（Task 110 D15）：为空视为 chat。
     * workflow = workflow run 载体或 workflow 创建的参与者；system 将吸收 systemRole（迁移未做）。
     */
    kind?: "chat" | "workflow" | "system";
    /** 寻址标签（Task 110 acquire 持久参与者按 (profileKey, tag) 复用）；为空视为无标签。 */
    tags?: string[];
};

export type SessionProjectionScope = {
    scope: "activeLeaf";
    leafId: SessionEntryId | null;
};

type MessageSessionEntryBase = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "message";
    /** 为空表示旧 entry 或手工追加；prompt 表示真实用户 prompt；workflow 表示 workflow run 写入。 */
    origin?: "prompt" | "harness" | "manual" | "ingest" | "workflow";
    /** partial 表示 provider stream 中途失败后保存的半截 assistant。 */
    status?: "partial" | "interrupted" | "error";
};

/** message entry 按 role 约束关联字段；正文不再承担用户消息身份或 steer 判断。 */
export type MessageSessionEntry = MessageSessionEntryBase & (
    | {
        message: Extract<StoredAgentMessage, {role: "user"}>;
        clientMessageId: string;
        intent: "normal" | "steer";
        /** follow-up drain 对应的 durable queue item；普通消息为空。 */
        sourceQueueItemId?: string;
    }
    | {
        message: Exclude<StoredAgentMessage, {role: "user"}>;
        clientMessageId?: never;
        intent?: never;
        sourceQueueItemId?: never;
    }
);

export type SessionUpdateEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_update";
    /** projection 表示后台元数据更新，不改变 active leaf，但参与 session reduce。 */
    origin?: "projection";
    /** 限制 projection 只在特定 active leaf 下参与 reduce。 */
    projectionScope?: SessionProjectionScope;
    updates: {
        title?: string;
        summary?: string;
    };
};

export type CustomSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "custom";
    /** projection 表示后台状态投影，不改变 active leaf，但参与 session reduce。 */
    origin?: "projection";
    /** 限制 projection 只在特定 active leaf 下参与 reduce。 */
    projectionScope?: SessionProjectionScope;
    key: string;
    value: JsonValue;
};

/** 用户上传或文件快照对当前 Session 建立的附件授权事实。 */
export type SessionAttachmentEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_attachment";
    /** projection entry 不移动 active leaf，也不进入模型上下文。 */
    origin: "projection";
    attachment: AttachmentRef;
    /** 本次登记使用的展示名称；为空表示来源没有名称。 */
    name?: string;
    source: "upload" | "file_snapshot";
};

export type CustomMessageSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "custom_message";
    message: StoredAgentMessage;
    visibleToModel: boolean;
    /** follow-up queue item 的 durable 回执；用于重启恢复时避免重复投递。 */
    sourceQueueItemId?: string;
    /**
     * Profile Prompt 归因（Task 126）。纯可观测：不参与 reduce、不影响可见性、不进入发给模型的消息体。
     *
     * 之所以必须落盘——HistorySet 只在首轮注入，第二轮从 session 读回时已无从判断
     * 哪条来自哪个文件，也无从把它和历史里沉淀的旧 AppendingSet 提醒区分开。
     * 旧 session 无此字段，上下文面板显示「未标注」，不做数据迁移。
     */
    promptSource?: {
        /**
         * 该消息的运行时分区语义。
         *
         * 只有这两个值会落盘：ModelContext 本体每轮重新生成且从不写入 session，
         * 而 ModelContext 内的 Reminder 走的是 AppendingSet 写入语义，因此记为 appending
         * ——它在消息数组里的位置和生命周期都与 AppendingSet 一致。DSL 里的书写位置
         * 仍可从 labels 看出（如 `Reminder:agent-mode`）。
         */
        zone: "historySet" | "appending";
        /** Profile DSL 具名节点来源，如 `Import:AGENTS.md`、`SkillCatalog`。匿名消息无此字段。 */
        labels?: readonly string[];
    };
};

export type LeafSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "leaf";
    leafId: SessionEntryId | null;
    /** auto 表示普通 append 后自动移动；move 表示用户/控制面显式重定位 active path。 */
    origin?: "auto" | "move";
};

export type CompactionSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "compaction";
    summary: string;
    firstKeptEntryId: SessionEntryId | null;
    tokensBefore: number;
    details?: {
        instructions?: string;
        reserveTokens?: number;
        keepRecentTokens?: number;
        triggerPercent?: number;
        triggerTokens?: number;
        promptSource?: "default" | "profile";
        summaryPrefixSource?: "default" | "profile";
        recentTokens?: number;
        summarizedTokens?: number;
        visibleTokensBefore?: number;
        firstKeptEntryType?: "message" | "custom_message";
        visibleEntryCountBefore?: number;
        recentEntryCount?: number;
        summarizedEntryCount?: number;
    };
};

export type BranchSummaryEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "branch_summary";
    fromLeafId: SessionEntryId;
    toLeafId: SessionEntryId;
    summary: string;
};

export type LabelSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "label";
    targetEntryId: SessionEntryId;
    label: string;
};

export type ModelChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "model_change";
    model: DurableSessionModelRef | null;
};

export type ThinkingLevelChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "thinking_level_change";
    /** null 表示清除 session 覆盖，重新跟随 Agent Profile。 */
    thinkingLevel: ThinkingLevel | null;
};

export type ProfileChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "profile_change";
    profileKey: string;
    input?: JsonValue;
};

export type VariablePatchSessionEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "variable_patch";
    namespace: VariableNamespace;
    path: string;
    operations: VariableJsonPatchOperation[];
    source: "agent" | "profile" | "frontend" | "user";
    invocationId?: string;
    toolCallId?: string;
};

export type ClientVariablePatchAckEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "client_variable_patch_ack";
    namespace: "client";
    path: string;
    operations: VariableJsonPatchOperation[];
    appliedValue?: JsonValue;
    error?: string;
    invocationId?: string;
    toolCallId?: string;
};

export type SessionArchivedEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_archived";
    reason?: string;
};

/** 恢复已归档 Session；关系账本不随归档或恢复改写。 */
export type SessionRestoredEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "session_restored";
};

/** append-only 的 Current Project 重绑事实；null 表示清除归属。 */
export type CurrentProjectChangeEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "current_project_change";
    projectRoot: string | null;
};

export type InvocationErrorPhase = "prepare" | "pre_loop" | "model" | "tool" | "ingest" | "compaction" | "settleRun" | "unknown";

export type InvocationErrorInfo = {
    message: string;
    phase: InvocationErrorPhase;
    retryable?: boolean;
    code?: string;
};

export type InvocationLifecycleEntry = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    timestamp: number;
    type: "invocation_lifecycle";
    invocationId: string;
    status: "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted";
    error?: string;
    errorInfo?: InvocationErrorInfo;
};

export type SessionEntry =
    | MessageSessionEntry
    | SessionUpdateEntry
    | CustomSessionEntry
    | SessionAttachmentEntry
    | CustomMessageSessionEntry
    | LeafSessionEntry
    | CompactionSessionEntry
    | BranchSummaryEntry
    | LabelSessionEntry
    | ModelChangeEntry
    | ThinkingLevelChangeEntry
    | ProfileChangeEntry
    | VariablePatchSessionEntry
    | ClientVariablePatchAckEntry
    | SessionArchivedEntry
    | SessionRestoredEntry
    | CurrentProjectChangeEntry
    | InvocationLifecycleEntry;

export type SessionFileRecord =
    | {
        kind: "header";
        metadata: SessionMetadata;
    }
    | {
        kind: "entry";
        entry: SessionEntry;
    }
    | {
        kind: "batch";
        entries: SessionEntry[];
    };

export type SessionSnapshot = {
    metadata: SessionMetadata;
    entries: SessionEntry[];
    leafId: SessionEntryId | null;
};

export type NeuroSessionContext = {
    systemPrompt: string;
    messages: StoredAgentMessage[];
    model: DurableSessionModelRef | null;
    /** Session 级显式 thinking 覆盖；null 表示跟随 Agent Profile 默认。 */
    thinkingLevel: ThinkingLevel | null;
    profileKey: string;
    currentProjectRoot?: string;
    customState: Record<string, JsonValue>;
    linkedAgents: LinkedAgentSummary[];
    title?: string;
    summary?: string;
    archived: boolean;
    /** 当前 Agent 工作模式（normal / discuss / plan），由 ui.agentMode custom state 归约。 */
    agentMode: AgentMode;
};

export type LinkedAgentSummary = {
    sessionId: SessionId;
    profileKey: string;
    detached: boolean;
};

export type SessionTreeNode = {
    id: SessionEntryId;
    parentId: SessionEntryId | null;
    type: SessionEntry["type"];
    timestamp: number;
    active: boolean;
    terminal: boolean;
    childCount: number;
    role?: string;
    /**
     * 该 entry 会渲染成哪种 Chat Flow 气泡；缺失表示它不进入 Chat Flow。
     *
     * 由 `chatEntryKind()` 计算，与 Chat Flow 投影同源。气泡 id 就是 `id`，不再单独下发。
     * 前端据此判断哪些节点可以充当对话分支的锚点——记账 entry（lifecycle、model_change、
     * custom 等）缺失该字段，因此不会被误当成一条分支。
     */
    chatEntry?: ChatEntryKind;
    preview?: string;
    toolName?: string;
    label?: string;
};

export type SessionEntryDraft = SessionEntry extends infer TEntry
    ? TEntry extends SessionEntry
        ? Omit<TEntry, "id" | "parentId" | "timestamp">
        : never
    : never;
