/** 运行时模块的公开类型，逐字对应 docs/specs/harness/runtime.md 的“输入与前置条件”。 */

import type {StreamFn} from "@oh-my-pi/pi-agent-core";
import type {AssistantMessage, ImageContent, TextContent} from "@oh-my-pi/pi-ai";
import type {Compacted, CompactionRegistry} from "../compaction/compaction";
import type {ConfigStore} from "../config/config";
import type {Credentials, ModelCatalog} from "../models/models";
import type {ProfileCatalog, ProfileHost} from "../profile/profile";
import type {InteractionData, InvocationPhase, JsonValue, PendingInteraction, SessionEntry, SessionLog, SessionStore, SessionSummary} from "../session/session";
import type {ApprovalMode, ToolInterceptor, ToolSource} from "../tools/tools";

export type {ApprovalMode, Compacted, JsonValue, SessionEntry, SessionLog, SessionSummary, StreamFn};

export type UserInput = {content: string | (TextContent | ImageContent)[]};

export type RuntimeDeps = {
    config: ConfigStore;
    profiles: ProfileCatalog;
    host: ProfileHost;
    models: ModelCatalog;
    credentials: Credentials;
    tools: ToolSource[];
    interceptor?: ToolInterceptor;
    compaction: CompactionRegistry;
    store: SessionStore;
    limits?: {maxTurns?: number};
    now?: () => Date;
    model?: {stream?: StreamFn};
    judge?: {stream?: StreamFn; timeoutMs?: number};
};

export interface Runtime {
    createSession(input: {profileId: string; id?: string; title?: string}): Promise<RuntimeResult<AgentSession>>;
    openSession(id: string): Promise<RuntimeResult<AgentSession>>;
    listSessions(): Promise<RuntimeResult<SessionSummary[]>>;
}

export type SessionStatus = {
    phase: "idle" | "running" | "waiting-user" | "aborting";
    invocationId?: string;
    pending: PendingInteraction[];
    queue: {steer: number; followUp: number};
    profileId?: string;
    model?: string;
};
export type PromptOptions = {streamingBehavior?: "steer" | "followUp"; profileId?: string; model?: string; signal?: AbortSignal};
export type ContinueOptions = {signal?: AbortSignal};
export type Invocation = {invocationId: string; done: Promise<InvocationResult>};
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
