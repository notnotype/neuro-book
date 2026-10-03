import type {AgentCommandResult, AgentSessionLiveStateDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

export type AgentCommandResultApplyContext = {
    activeSessionId(): number | null;
    applyLiveState(state: AgentSessionLiveStateDto): void;
    needsRecovery(): boolean;
    syncRecovery(): Promise<boolean>;
    syncSessionModelState(summary: AgentSessionSummaryDto | null): void;
    refreshSessions(): Promise<unknown>;
    loadSession(sessionId: number): Promise<unknown>;
};

/**
 * 应用 command HTTP 返回。active path mutation 只返回 live state；若 revision
 * 变化，则立即进入与 SSE 共用的 recovery single-flight，不能等待未来事件兜底。
 */
export async function applyAgentCommandResult(result: AgentCommandResult, context: AgentCommandResultApplyContext): Promise<void> {
    if (result.kind === "live_state") {
        if (result.sessionId !== context.activeSessionId()) {
            return;
        }
        context.applyLiveState(result.state);
        context.syncSessionModelState(result.state.summary);
        if (context.needsRecovery()) {
            await context.syncRecovery();
        }
        return;
    }
    await context.refreshSessions();
    await context.loadSession(result.createdSession.sessionId);
}
