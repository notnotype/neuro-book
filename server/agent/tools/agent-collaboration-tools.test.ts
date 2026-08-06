import {afterEach, describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {agentCollaborationTools, createBuiltinTools} from "nbook/server/agent/tools/index";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import * as configService from "nbook/server/config/config-service";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";

const collaborationEntries = Object.entries(agentCollaborationTools).map(([name, definition]) => ({
    name,
    definition,
}));

afterEach(() => {
    vi.restoreAllMocks();
});

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
            model: "local/allowed",
            background: true,
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
                profileKey: "leader.default",
                toolCallId: "tool-1",
            }),
        }));
        expect(result.details).toEqual({
            status: "completed",
            sessionId: 2,
            finalMessage: "structured result",
            data: {plotId: "plot-1"},
            stats: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
                elapsedMs: 42,
            },
        });
        expect(result.content).toEqual([{type: "text", text: "structured result"}]);
        expect(JSON.stringify(result.details)).not.toContain("invocationId");
        expect(JSON.stringify(result.details)).not.toContain("reportResult");
        expect(JSON.stringify(result.details)).not.toContain("\"usage\"");
    });

    it("invoke_agent 前台调用把父 invocation signal 传给精确子调用", async () => {
        let capturedSignal: AbortSignal | undefined;
        const controller = new AbortController();
        const context = toolContext({
            invokeAgent: vi.fn(async (input: {signal?: AbortSignal}) => {
                capturedSignal = input.signal;
                return {
                    sessionId: 2,
                    invocationId: "child-invocation",
                    status: "completed" as const,
                    finalMessage: "done",
                };
            }),
        });
        const tool = agentCollaborationTools.invokeAgent.runtime();

        await tool.executeWithContext!(context, "tool-signal", {sessionId: 2, message: "执行"}, undefined, controller.signal);

        expect(capturedSignal).toBe(controller.signal);
    });

    it("invoke_agent model 与 run_workflow 共用 Agent 可见模型校验", async () => {
        const config = createVisibleModelConfig();
        vi.spyOn(configService, "loadEffectiveConfigFromTarget").mockResolvedValue(config);
        const runCommand = vi.fn(async () => undefined);
        const invokeAgent = vi.fn(async () => ({
            status: "completed" as const,
            finalMessage: "done",
        }));
        const context = toolContext({runCommand, invokeAgent});
        const tool = agentCollaborationTools.invokeAgent.runtime();

        await tool.executeWithContext!(context, "tool-visible", {
            sessionId: 2,
            message: "执行任务",
            model: "local/allowed",
        });

        expect(runCommand).not.toHaveBeenCalled();
        expect(invokeAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 2,
            modelKey: "local/allowed",
        }));
        await expect(tool.executeWithContext!(context, "tool-hidden", {
            sessionId: 2,
            message: "执行任务",
            model: "local/hidden",
        })).rejects.toThrow("不在 agent 可见模型清单内");
        expect(invokeAgent).toHaveBeenCalledTimes(1);
    });

    it("invoke_agent background 即时返回 job，完成结果卡沿用规范化结果合同", async () => {
        let runJob: ((context: {signal: AbortSignal}) => Promise<{resultPreview: string; result?: unknown; message?: string}>) | undefined;
        const invokeAgent = vi.fn(async () => ({
            sessionId: 2,
            invocationId: "background-invocation",
            status: "completed" as const,
            finalMessage: "plain fallback",
            reportResult: {result: "background result", data: {chapterCount: 3}},
        }));
        const context = toolContext({
            invokeAgent,
            abortInvocation: vi.fn(async () => undefined),
            jobs: {
                spawn(spec: {run: (context: {signal: AbortSignal}) => Promise<{resultPreview: string; result?: unknown; message?: string}>}) {
                    runJob = spec.run;
                    return {
                        job: {jobId: "job-test"},
                        jobEventCursor: {eventEpoch: "epoch-jobs", after: 3},
                    };
                },
            },
        });
        const tool = agentCollaborationTools.invokeAgent.runtime();

        const started = await tool.executeWithContext!(context, "tool-background", {
            sessionId: 2,
            message: "分析章节",
            background: true,
        });

        expect(started.details).toEqual({
            jobId: "job-test",
            jobEventCursor: {eventEpoch: "epoch-jobs", after: 3},
            sessionId: 2,
            status: "started",
            data: null,
            finalMessage: "",
            background: true,
        });
        expect(started.content[0]).toEqual(expect.objectContaining({text: expect.stringContaining("不要轮询等待")}));
        expect(runJob).toBeTypeOf("function");

        const controller = new AbortController();
        const outcome = await runJob!({signal: controller.signal});
        expect(outcome.resultPreview).toBe("background result");
        expect(outcome.result).toMatchObject({
            status: "completed",
            sessionId: 2,
            finalMessage: "background result",
            data: {chapterCount: 3},
        });
        expect(outcome.message).toContain('"status": "completed"');
        expect(outcome.message).toContain('"sessionId": 2');
        expect(outcome.message).toContain('"finalMessage": "background result"');
        expect(outcome.message).toContain('"chapterCount": 3');
        expect(invokeAgent).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 2,
            block: true,
            queueIfBusy: false,
            signal: controller.signal,
        }));
    });

    it("invoke_agent background 遇到 HITL waiting 时失败关闭，不伪报完成", async () => {
        let runJob: ((context: {signal: AbortSignal}) => Promise<{resultPreview: string; message?: string}>) | undefined;
        const context = toolContext({
            invokeAgent: vi.fn(async () => ({
                sessionId: 2,
                invocationId: "background-waiting",
                status: "waiting" as const,
                finalMessage: "waiting for request_user_input",
            })),
            abortInvocation: vi.fn(async () => undefined),
            jobs: {
                spawn(spec: {run: (context: {signal: AbortSignal}) => Promise<{resultPreview: string; message?: string}>}) {
                    runJob = spec.run;
                    return {
                        job: {jobId: "job-waiting"},
                        jobEventCursor: {eventEpoch: "epoch-jobs", after: 4},
                    };
                },
            },
        });
        const tool = agentCollaborationTools.invokeAgent.runtime();

        await tool.executeWithContext!(context, "tool-background-waiting", {
            sessionId: 2,
            message: "需要人工确认的任务",
            background: true,
        });

        await expect(runJob!({signal: new AbortController().signal})).rejects.toThrow("不追踪人工输入或审批等待");
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

    it("get_session 省略 id 时查询当前 session，显式 id 时查询目标 session", async () => {
        const getSession = vi.fn(async (query: {sessionId: number}) => ({sessionId: query.sessionId}));
        const context = toolContext({getSession}, 947);
        const tool = agentCollaborationTools.getSession.runtime();

        await tool.executeWithContext!(context, "tool-current", {});
        await tool.executeWithContext!(context, "tool-known", {sessionId: 23});

        expect(getSession).toHaveBeenNthCalledWith(1, {sessionId: 947}, 947);
        expect(getSession).toHaveBeenNthCalledWith(2, {sessionId: 23}, 947);
        expect(tool.description).toContain("get_session({})");
        expect(JSON.stringify(tool.parameters)).toContain("Never guess");
    });
});

function toolContext(harness: Record<string, unknown>, sessionId = 1): ToolExecutionContext {
    const workspaceRoot = absoluteFsPath(process.cwd());
    return {
        harness: {
            configTargetForInvocation: vi.fn(() => ({scope: "global", workspaceRoot, project: null})),
            ...harness,
        } as never,
        sessionId,
        profileKey: "leader.default",
        workspaceRoot,
        currentProject: null,
        invocationId: "parent-invocation",
    };
}

/** 构造 invoke_agent 模型覆盖测试所需的完整有效配置。 */
function createVisibleModelConfig() {
    const config = createDefaultEffectiveConfig();
    config.models = {
        defaultModelKey: "local/allowed",
        providers: {
            local: {
                name: "Local",
                enabled: true,
                modelApi: "openai-completions",
                options: {apiKey: "secret", baseURL: "https://example.com/v1", proxy: "", timeoutMs: null, requestOptions: {}},
                models: {
                    allowed: {
                        name: "Allowed",
                        id: "allowed",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8_192,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                        contextWindowTokens: 128_000,
                    },
                    hidden: {
                        name: "Hidden",
                        id: "hidden",
                        group: null,
                        enabled: true,
                        api: "openai-completions",
                        reasoning: false,
                        input: ["text"],
                        maxTokens: 8_192,
                        cost: null,
                        compat: null,
                        headers: null,
                        thinkingLevelMap: null,
                        contextWindowTokens: 128_000,
                    },
                },
            },
        },
    };
    config.agent.visibleModels = [{modelKey: "local/allowed", note: "允许"}];
    return config;
}
