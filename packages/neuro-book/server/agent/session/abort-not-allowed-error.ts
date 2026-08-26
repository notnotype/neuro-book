/** Session 当前状态不允许执行 abort 时的稳定领域错误。 */
export class AgentAbortNotAllowedError extends Error {
    readonly statusCode = 409;
    readonly code = "session_abort_not_allowed" as const;

    constructor(message = "当前 Session 状态不允许停止运行。") {
        super(message);
        this.name = "AgentAbortNotAllowedError";
    }
}

/** 跨 HMR/HTTP seam 按稳定 name 与 code 识别 abort 状态错误。 */
export function isAgentAbortNotAllowedError(error: unknown): error is AgentAbortNotAllowedError {
    if (!(error instanceof Error) || error.name !== "AgentAbortNotAllowedError" || !("code" in error)) {
        return false;
    }
    return error.code === "session_abort_not_allowed";
}
