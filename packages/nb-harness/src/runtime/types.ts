/** 运行时模块的公开类型，逐字对应 docs/specs/harness/runtime.md 的“输入与前置条件”。 */

import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import type {AssistantMessage, ImageContent, Message, TextContent} from "@oh-my-pi/pi-ai";
import type {Compacted, CompactionRegistry} from "../compaction/compaction";
import type {ConfigStore} from "../config/config";
import type {Credentials, ModelCatalog} from "../models/models";
import type {Diagnostic, ProfileCatalog, ProfileHost} from "../profile/profile";
import type {ArtifactStore, InteractionData, InvocationPhase, JsonValue, PendingInteraction, SessionEntry, SessionLog, SessionStore, SessionSummary} from "../session/session";
import type {ApprovalMode, ToolInterceptor, ToolResultBudget, ToolSource} from "../tools/tools";

export type {ApprovalMode, Compacted, JsonValue, PendingInteraction, SessionEntry, SessionLog, SessionSummary, StreamFn};

export type UserInput = {content: string | (TextContent | ImageContent)[]};

export type RuntimeDeps = {
    config: ConfigStore;
    profiles: ProfileCatalog;
    /** 缺省 `createProfileHost()`；使用方要注册自己的节点与数据源时自己建一个传进来。 */
    host?: ProfileHost;
    /** 缺省按 `config` 建目录（跟着配置的 `replace` 走）。 */
    models?: ModelCatalog;
    credentials: Credentials;
    /** 缺省没有工具。 */
    tools?: ToolSource[];
    interceptor?: ToolInterceptor;
    /** 缺省 `createCompactionRegistry()`（只有 soft）。 */
    compaction?: CompactionRegistry;
    store: SessionStore;
    /** 工具结果超预算时的全文去处；缺省内存实现（进程退出即丢）。 */
    artifacts?: ArtifactStore;
    /** `toolResult` 缺的项按 harness.tools 的缺省预算。 */
    limits?: {maxTurns?: number; toolResult?: Partial<ToolResultBudget>};
    now?: () => Date;
    model?: {stream?: StreamFn};
    judge?: {stream?: StreamFn; timeoutMs?: number};
};

/** 填好缺省项的依赖：运行时内部只用这份。 */
export type ResolvedDeps = RuntimeDeps & Required<Pick<RuntimeDeps, "host" | "models" | "tools" | "compaction" | "artifacts">>;

export interface Runtime {
    createSession(input: {profileId: string; id?: string; title?: string}): Promise<RuntimeResult<AgentSession>>;
    openSession(id: string): Promise<RuntimeResult<AgentSession>>;
    listSessions(): Promise<RuntimeResult<SessionSummary[]>>;
}

export type SessionStatus = {
    phase: "idle" | "running" | "waiting-user" | "aborting";
    invocationId?: string;
    /** 冻结：多个调用方共用同一份缓存（Spec 输出 5）。 */
    pending: readonly PendingInteraction[];
    queue: {steer: number; followUp: number};
    profileId?: string;
    model?: string;
    /** 上下文用量：最近一次受理的模型与压缩设置可知时才有；还没有助手消息报告用量时 `tokens` 是按回放上下文的估算（`source: "estimated"`）。 */
    context?: Readonly<{tokens: number; source: "reported" | "estimated"; window: number; threshold: number}>;
};
export type PromptOptions = {streamingBehavior?: "steer" | "followUp"; profileId?: string; model?: string; signal?: AbortSignal};
export type ContinueOptions = {signal?: AbortSignal};
export type PreviewOptions = {profileId?: string; model?: string; signal?: AbortSignal};
/** 输出 17：此刻发起调用模型会收到什么。`seeds` 只在日志里还没有种子时非空；`request` 是按 Profile 渲染出的请求消息。 */
export type Preview = {model: string; tools: string[]; system: string[]; seeds: Message[]; appended: Message[]; request: Message[]; diagnostics: Diagnostic[]};
export type Invocation = {
    invocationId: string;
    done: Promise<InvocationResult>;
    /** 下一个需要调用方处理的点：这次调用进入等待用户（带待处理事项），或结束。等待中再调用立即返回同一组事项。 */
    next(): Promise<InvocationStep>;
};
export type InvocationStep = {kind: "waiting"; pending: readonly PendingInteraction[]} | {kind: "done"; result: InvocationResult};
export type InvocationError = {kind: "model" | "limit" | "log" | "profile" | "compaction"; message: string; overflow?: boolean};
export type InvocationResult = {status: "completed" | "waiting" | "aborted" | "failed"; error?: InvocationError; entries: readonly SessionEntry[]};
export type InteractionAnswer = {interactionId: string; decision: "approve" | "reject"; scope?: "once" | "session"; note?: string};

export interface AgentSession {
    readonly id: string;
    readonly log: SessionLog;
    readonly status: SessionStatus;
    prompt(input: UserInput, options?: PromptOptions): Promise<RuntimeResult<Invocation>>;
    continue(options?: ContinueOptions): Promise<RuntimeResult<Invocation>>;
    steer(input: UserInput): RuntimeResult<void>;
    followup(input: UserInput): RuntimeResult<void>;
    resolve(answer: InteractionAnswer): Promise<RuntimeResult<void>>;
    abort(options?: {clearQueue?: boolean}): RuntimeResult<void>;
    compact(options?: {signal?: AbortSignal}): Promise<RuntimeResult<Compacted | null>>;
    preview(input?: UserInput, options?: PreviewOptions): Promise<RuntimeResult<Preview>>;
    setApprovalMode(mode: ApprovalMode | undefined): void;
    subscribe(listener: (event: RuntimeEvent) => void): {release(): void};
    close(): Promise<void>;
}

export type RuntimeEvent = {seq: number; sessionId: string} & (
    | {type: "status"; status: SessionStatus}
    | {type: "invocation"; invocationId: string; phase: InvocationPhase; detail?: JsonValue}
    | {type: "queue"; steer: number; followUp: number}
    | {type: "stream"; invocationId: string; message: AssistantMessage}
    | {type: "tool"; invocationId: string; toolCallId: string; toolName: string; stage: "start" | "update" | "end"; args?: JsonValue; progress?: JsonValue; isError?: boolean}
    | {type: "interaction"; invocationId: string; interactionId: string; phase: "request" | "response"; data: InteractionData}
    | {type: "entry"; logSeq: number; entry: SessionEntry}
    | {type: "compaction"; result: {ok: true; method: string} | {ok: false; code: string; detail: string}}
);

export type RuntimeFailure = "busy" | "invalid-state" | "invalid-input" | "unknown-profile" | "invalid-profile" | "model-unavailable" | "credentials-missing"
    | "capability-missing" | "tool-conflict" | "unknown-interaction" | "already-answered" | "compaction-failed" | "session-exists" | "session-not-found"
    | "corrupt-session" | "closed" | "log-failed";
export type RuntimeResult<T> = {ok: true; value: T} | {ok: false; code: RuntimeFailure; detail: string};
