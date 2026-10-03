/** Forced-abort lifecycle 尚未被 durable write queue 接受时的可重试领域错误。 */
export class AgentAbortDurabilityError extends Error {
    readonly statusCode = 503;
    readonly code = "session_abort_durability_unavailable" as const;
    readonly retryable = true;

    constructor(readonly causeError?: unknown) {
        super("Session abort 的持久化暂不可用，请重试。", {cause: causeError});
        this.name = "AgentAbortDurabilityError";
    }
}

/** 跨 HMR/HTTP seam 按稳定 name 与 code 识别 abort durability 错误。 */
export function isAgentAbortDurabilityError(error: unknown): error is AgentAbortDurabilityError {
    if (!(error instanceof Error) || error.name !== "AgentAbortDurabilityError" || !("code" in error)) {
        return false;
    }
    return error.code === "session_abort_durability_unavailable";
}
