import type {SessionId} from "nbook/server/agent/session/types";

/** 请求的 Session 不属于当前在线 Session Store。 */
export class AgentSessionNotFoundError extends Error {
    readonly code = "SESSION_NOT_FOUND";

    constructor(readonly sessionId: SessionId) {
        super(`Session ${String(sessionId)} 不存在或已不可用`);
        this.name = "AgentSessionNotFoundError";
    }
}

/** 跨 HMR/HTTP seam 按稳定名称、错误码和 Session ID 识别 Not Found。 */
export function isAgentSessionNotFoundError(error: unknown): error is AgentSessionNotFoundError {
    return error instanceof Error
        && error.name === "AgentSessionNotFoundError"
        && "code" in error
        && error.code === "SESSION_NOT_FOUND"
        && "sessionId" in error
        && typeof error.sessionId === "number"
        && Number.isInteger(error.sessionId)
        && error.sessionId > 0;
}
