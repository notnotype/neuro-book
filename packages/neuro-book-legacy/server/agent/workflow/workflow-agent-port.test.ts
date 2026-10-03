import {HarnessAgentPort} from "nbook/server/agent/workflow/workflow-agent-port";
import {describe, expect, it, vi} from "vitest";

describe("HarnessAgentPort", () => {
    it("将 Workflow Run signal 传入精确 Harness invocation", async () => {
        const controller = new AbortController();
        const invokeAgent = vi.fn(async (_input: unknown) => ({
            sessionId: 12,
            invocationId: "workflow-child",
            status: "completed" as const,
            finalMessage: "done",
        }));
        const readSession = vi.fn(async () => ({leafId: "leaf-1"}));
        const port = new HarnessAgentPort({
            repo: {
                readSession,
                moveLeaf: vi.fn(),
            },
            invokeAgent,
        } as never);

        await port.invoke(12, "leaf-1", {message: "run", signal: controller.signal});

        expect(invokeAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 12,
            signal: controller.signal,
        }));
    });

    it("缺省 input 不生成 payload，显式 null 保留 payload", async () => {
        const invokeAgent = vi.fn(async (_input: unknown) => ({
            sessionId: 12,
            invocationId: "workflow-child",
            status: "completed" as const,
            finalMessage: "done",
        }));
        const readSession = vi.fn(async () => ({leafId: "leaf-1"}));
        const port = new HarnessAgentPort({
            repo: {
                readSession,
                moveLeaf: vi.fn(),
            },
            invokeAgent,
        } as never);

        await port.invoke(12, "leaf-1", {message: "run"});
        await port.invoke(12, "leaf-1", {message: "run", input: null});

        expect(invokeAgent).toHaveBeenCalledTimes(2);
        expect(invokeAgent.mock.calls[0]![0]).not.toHaveProperty("payload");
        expect(invokeAgent.mock.calls[1]![0]).toHaveProperty("payload", null);
    });
});
