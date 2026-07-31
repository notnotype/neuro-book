import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {agentCollaborationTools, createBuiltinTools} from "nbook/server/agent/tools/index";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const collaborationEntries = Object.entries(agentCollaborationTools).map(([name, definition]) => ({
    name,
    definition,
}));

describe("agent collaboration tool definitions", () => {
    it.each(collaborationEntries)("$name 必须通过 executeWithContext 执行", async ({definition}) => {
        const runtime = definition.runtime();

        expect(runtime.executeWithContext).toBeTypeOf("function");
        await expect(runtime.execute!("direct-call", {})).rejects.toThrow("必须在 agent session context 内执行");
    });

    it("createBuiltinTools 无需 harness 参数并聚合协作、控制与领域工具", () => {
        const toolKeys = createBuiltinTools().map((tool) => tool.key);

        expect(toolKeys).toEqual(expect.arrayContaining([
            "read",
            "report_result",
            "request_user_input",
            "create_agent",
            "invoke_agent",
            "get_agent_profile",
        ]));
    });

    it("create_agent 使用 initial，invoke_agent 支持 mode 和结构化 input", () => {
        const createAgent = agentCollaborationTools.createAgent.runtime();
        const invokeAgent = agentCollaborationTools.invokeAgent.runtime();

        expect(Value.Check(createAgent.parameters, {
            profileKey: "writer",
            initial: {},
        })).toBe(true);
        expect(Value.Check(createAgent.parameters, {
            profileKey: "writer",
            initial: "{\"prompt\":\"write\"}",
        })).toBe(false);
        expect(Value.Check(invokeAgent.parameters, {
            sessionId: 2,
            mode: "steer",
            input: {plotId: "plot-1"},
        })).toBe(true);
        expect(Value.Check(invokeAgent.parameters, {
            sessionId: 2,
            mode: "followup",
            message: "继续",
        })).toBe(true);
        expect(Value.Check(invokeAgent.parameters, {
            sessionId: 2,
            input: "plot-1",
        })).toBe(false);
    });

    it("invoke_agent 将 input 映射为 payload，并返回 compact result", async () => {
        let captured: unknown;
        const context = toolContext({
            invokeAgent: async (input: unknown) => {
                captured = input;
                return {
                    sessionId: 2,
                    invocationId: "raw-invocation",
                    status: "completed",
                    finalMessage: "plain fallback",
                    reportResult: {
                        result: "structured result",
                        data: {plotId: "plot-1"},
                    },
                    usage: {input: 10, output: 5, totalTokens: 15},
                    elapsedMs: 42,
                };
            },
        });
        const tool = agentCollaborationTools.invokeAgent.runtime();

        const result = await tool.executeWithContext!(context, "tool-1", {
            sessionId: 2,
            input: {plotId: "plot-1"},
            title: "Plot Followup",
        });

        expect(captured).toEqual(expect.objectContaining({
            sessionId: 2,
            mode: "prompt",
            payload: {plotId: "plot-1"},
            title: "Plot Followup",
            caller: expect.objectContaining({
                kind: "agent",
                sessionId: 1,
                invocationId: "parent-invocation",
                profileKey: "leader.default",
                toolCallId: "tool-1",
            }),
        }));
        expect(result.details).toEqual({
            status: "completed",
            result: {
                message: "structured result",
                data: {plotId: "plot-1"},
            },
            stats: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                elapsedMs: 42,
            },
        });
        expect(JSON.stringify(result.details)).not.toContain("invocationId");
        expect(JSON.stringify(result.details)).not.toContain("finalMessage");
        expect(JSON.stringify(result.details)).not.toContain("reportResult");
        expect(JSON.stringify(result.details)).not.toContain("\"usage\"");
    });

    it("get_agent_profile 只返回 agent-facing schema 摘要", async () => {
        const context = toolContext({
            profiles: {
                async snapshot() {
                    return {
                        profiles: [{
                            key: "writer",
                            name: "Writer",
                            description: "Write prose",
                            loadStatus: "loaded",
                            creationMode: "public" as const,
                            source: "system",
                            initialSchema: Type.Object({}),
                            payloadSchema: Type.Object({path: Type.String()}),
                            outputSchema: Type.Object({path: Type.String()}),
                            reportResultSchema: Type.Object({hidden: Type.String()}),
                        }],
                    };
                },
                async get() {
                    return {
                        rootToolKeys: ["read", "report_result"],
                        initialSchema: Type.Object({}),
                        payloadSchema: Type.Object({path: Type.String()}),
                        outputSchema: Type.Object({path: Type.String()}),
                    };
                },
            },
        });
        const tool = agentCollaborationTools.getAgentProfile.runtime();

        const result = await tool.executeWithContext!(context, "tool-1", {profileKey: "writer"});

        expect(result.details).toEqual(expect.objectContaining({
            profileKey: "writer",
            name: "Writer",
            description: "Write prose",
            creationMode: "public",
            createAgentAllowed: true,
            toolKeys: ["read", "report_result"],
            initialSchema: "- no fields",
            payloadSchema: "- path: required string",
            outputSchema: "- path: required string",
        }));
        expect(JSON.stringify(result.details)).not.toContain("source");
        expect(JSON.stringify(result.details)).not.toContain("reportResultSchema");
        expect(JSON.stringify(result.details)).not.toContain("reportSidecarResultSchema");
    });
});

function toolContext(harness: Record<string, unknown>): ToolExecutionContext {
    return {
        harness: harness as never,
        sessionId: 1,
        profileKey: "leader.default",
        workspaceRootRef: "workspace",
        workspaceFsRoot: absoluteFsPath(process.cwd()),
        workspaceKey: "global",
        projectPath: "workspace/project",
        invocationId: "parent-invocation",
    };
}
