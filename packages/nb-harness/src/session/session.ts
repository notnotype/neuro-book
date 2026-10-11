/**
 * 会话：只追加的事件日志、回放与存储接口。行为合同见 docs/specs/harness/session.md，按该 Spec 实现。
 * JSONL 存储在子入口 `@notnotype/nb-harness/session/jsonl`。
 */

export type {
    DistributiveOmit,
    EntryBase,
    EntryInput,
    InteractionData,
    InteractionRequest,
    InteractionResponse,
    InvocationData,
    InvocationPhase,
    JsonValue,
    LogEndReason,
    Result,
    SessionEntry,
    SessionFailure,
    SessionHeader,
    SessionLog,
    SessionStore,
    SessionSummary,
} from "./types";
export {createSession, openSession} from "./log";
export {withoutUndefined} from "./entries";
export {createMemorySessionStore} from "./memory-store";
export {buildModelContext, defineProjection, fold, planRecovery, renderCompactionSummary, sessionSettings, sessionStatus} from "./replay";
export type {PendingInteraction, Projection, SessionSettings, SessionStatus} from "./replay";
export {readEntry, readPage} from "./paging";
export type {Page, PageCursor, PageOptions, TrimmedEntry} from "./paging";
