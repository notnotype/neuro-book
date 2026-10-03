import {beforeEach, describe, expect, it, vi} from "vitest";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const mocks = vi.hoisted(() => ({
    requireReadyModuleHandle: vi.fn(),
    readUnseenForAgent: vi.fn(async () => []),
}));

vi.mock("nbook/server/runtime/product-project", () => ({
    requireReadyModuleHandle: mocks.requireReadyModuleHandle,
}));

vi.mock("nbook/server/workspace-history/project-history", () => ({
    PROJECT_HISTORY_MODULE_TOKEN: {name: "history", kind: "required"},
    readUnseenForAgent: mocks.readUnseenForAgent,
    advanceAgentCursor: vi.fn(async () => undefined),
}));

describe("Profile turn context generation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("只查询 invocation 捕获的 ready generation，不在 close/reopen 后改查新 generation", async () => {
        const oldReady = {generation: 1} as ReadyProjectSessionRef;
        const newReady = {generation: 2} as ReadyProjectSessionRef;
        const oldHistory = {generation: 1};
        const newHistory = {generation: 2};
        let current = oldReady;
        mocks.requireReadyModuleHandle.mockImplementation((ready: ReadyProjectSessionRef) => (
            ready === oldReady ? oldHistory : newHistory
        ));
        const {materializeProfileTurnContexts} = await import("nbook/server/agent/profiles/profile-turn-context");
        const captured = current;
        current = newReady;

        await materializeProfileTurnContexts({
            plans: [{kind: "file-change-notice", mode: "minimal", appendingIndex: 0}],
            project: captured,
            sessionId: 7,
            diffMaxChars: 512,
        });

        expect(current).toBe(newReady);
        expect(mocks.requireReadyModuleHandle).toHaveBeenCalledOnce();
        expect(mocks.requireReadyModuleHandle).toHaveBeenCalledWith(oldReady, expect.objectContaining({name: "history"}));
        expect(mocks.readUnseenForAgent).toHaveBeenCalledWith(oldHistory, 7);
        expect(mocks.readUnseenForAgent).not.toHaveBeenCalledWith(newHistory, 7);
    });
});
