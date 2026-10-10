/**
 * 会话：只追加的事件日志、回放与存储接口。行为合同见 docs/specs/harness/session.md（planned），按该 Spec 实现。
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
export {createMemorySessionStore} from "./memory-store";
