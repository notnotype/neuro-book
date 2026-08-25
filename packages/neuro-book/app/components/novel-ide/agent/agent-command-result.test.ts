import {describe, expect, it, vi} from "vitest";
import {applyAgentCommandResult, type AgentCommandResultApplyContext} from "nbook/app/components/novel-ide/agent/agent-command-result";
import type {AgentSessionLiveStateDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";

describe("applyAgentCommandResult", () => {
    it("普通 live_state 只更新 shell，不补 recovery", async () => {
        const context = createContext(12, false);
        const state = liveState(12, "plan");

        await applyAgentCommandResult({kind: "live_state", status: "completed", sessionId: 12, state}, context);

        expect(context.applyLiveState).toHaveBeenCalledWith(state);
        expect(context.syncSessionModelState).toHaveBeenCalledWith(state.summary);
        expect(context.syncRecovery).not.toHaveBeenCalled();
    });

    it("HTTP mutation 导致 revision 变化时立即进入统一 recovery single-flight", async () => {
        const context = createContext(12, true);

        await applyAgentCommandResult({kind: "live_state", status: "completed", sessionId: 12, state: liveState(12)}, context);

        expect(context.syncRecovery).toHaveBeenCalledTimes(1);
    });

    it("迟到的其它 session live_state 不更新当前状态", async () => {
        const context = createContext(13, true);
        await applyAgentCommandResult({kind: "live_state", status: "completed", sessionId: 12, state: liveState(12)}, context);
        expect(context.applyLiveState).not.toHaveBeenCalled();
        expect(context.syncRecovery).not.toHaveBeenCalled();
    });

    it("created_session 刷新列表后切换到新 session", async () => {
        const context = createContext(12, false);
        await applyAgentCommandResult({kind: "created_session", status: "completed", sessionId: 21, createdSession: summary(21)}, context);
        expect(context.refreshSessions).toHaveBeenCalledTimes(1);
        expect(context.loadSession).toHaveBeenCalledWith(21);
    });
});

function createContext(activeSessionId: number | null, needsRecovery: boolean): AgentCommandResultApplyContext {
    return {
        activeSessionId: () => activeSessionId,
        applyLiveState: vi.fn(),
        needsRecovery: () => needsRecovery,
        syncRecovery: vi.fn(async () => true),
        syncSessionModelState: vi.fn(),
        refreshSessions: vi.fn(async () => []),
        loadSession: vi.fn(async () => undefined),
    };
}

function summary(sessionId: number): AgentSessionSummaryDto {
    return {
        sessionId,
        sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        profileKey: "leader.default",
        status: "idle",
        updatedAt: 1,
        archived: false,
    };
}

function liveState(sessionId: number, agentMode: AgentSessionLiveStateDto["agentMode"] = "normal"): AgentSessionLiveStateDto {
    return {
        summary: summary(sessionId),
        activeLeafId: null,
        activePathRevision: null,
        pendingUserInputs: [],
        steerQueue: {count: 0},
        followUpQueue: {status: "ready", count: 0},
        activeInvocation: null,
        model: null,
        thinkingLevel: null,
        effectiveThinkingLevel: "off",
        agentMode,
    };
}
