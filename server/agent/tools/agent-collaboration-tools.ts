import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";

const CreateAgentSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
    initial: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON object matching the target profile InitialSchema. Pass a real object, not a JSON string.",
    })),
    title: Type.Optional(Type.String({
        description: "Optional display title for the new agent session. Omit to use the target profile name.",
    })),
    currentProjectRoot: Type.Optional(Type.String({description: "Optional Project root name. Omit to inherit the current session Current Project."})),
});

const InvokeAgentSchema = Type.Object({
    sessionId: Type.Number({description: "Target agent session id."}),
    message: Type.Optional(Type.String({
        description: "User request to append to the target agent. Prefer the user's original wording or a minimal restatement; do not turn it into a long delegation prompt.",
    })),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "Structured invocation payload matching the target profile PayloadSchema. Pass a real object, not a JSON string.",
    })),
    title: Type.Optional(Type.String({
        description: "Optional display title to set on the target agent session when this invocation is accepted.",
    })),
    mode: Type.Optional(Type.Union([Type.Literal("prompt"), Type.Literal("continue"), Type.Literal("steer"), Type.Literal("followup")], {
        description: "Default is prompt when message or input is present, otherwise continue.",
    })),
    model: Type.Optional(Type.String({
        description: "Override the model for this invocation only (provider/model key). It does not change the target session's default model and must come from the Agent-visible Models allowlist in your context.",
    })),
    background: Type.Optional(Type.Boolean({
        description: "Default false. Set true to run in background: returns jobId immediately, the agent's result arrives later as a follow-up message. V1 requires an idle target and does not track user-input or approval waiting; use foreground mode for HITL agents.",
    })),
});

const GetAgentSchema = Type.Object({
    sessionId: Type.Optional(Type.Number()),
});

const GetSessionSchema = Type.Object({
    sessionId: Type.Optional(Type.Number({
        description: "Omit this field to inspect the current session: call get_session({}). Set it only when you already know the real target session id. Never guess, invent, or default it to 1.",
    })),
    includeRecentMessages: Type.Optional(Type.Boolean({description: "Default false. Set true to include recent messages from the current active path only."})),
    recentMessageLimit: Type.Optional(Type.Integer({minimum: 1, maximum: 10, description: "Number of recent active-path message entries to return when includeRecentMessages is true. Default 3, max 10. By default this counts user, assistant, and toolResult messages; set recentMessageRoles to filter first."})),
    recentMessageRoles: Type.Optional(Type.Array(Type.Union([
        Type.Literal("user"),
        Type.Literal("assistant"),
        Type.Literal("toolResult"),
    ]), {
        minItems: 1,
        uniqueItems: true,
        description: "Optional role filter for recentMessages. Use [\"assistant\"] to inspect only AI messages and exclude tool results.",
    })),
    tokenBudget: Type.Optional(Type.Integer({minimum: 100, maximum: 3000, description: "Maximum estimated tokens for recentMessages. Default 1200, max 3000."})),
});

const GetAgentProfileSchema = Type.Object({
    profileKey: Type.String({description: "Agent profile key from AgentCatalog, e.g. writer or retrieval."}),
});

const DetachAgentSchema = Type.Object({
    sessionId: Type.Number(),
});

type CreateAgentInput = Static<typeof CreateAgentSchema>;
type InvokeAgentInput = Static<typeof InvokeAgentSchema>;
type GetAgentInput = Static<typeof GetAgentSchema>;
type GetSessionInput = Static<typeof GetSessionSchema>;
type GetAgentProfileInput = Static<typeof GetAgentProfileSchema>;
type DetachAgentInput = Static<typeof DetachAgentSchema>;

export const agentCollaborationTools = {
    createAgent: defineAgentTool({
        key: "create_agent",
        name: "create_agent",
        label: "Create Agent",
        executionMode: "sequential",
        description: "Create a new agent session and link it to current agent. Before every create_agent call, call get_agent_profile({ profileKey }) to inspect the target InitialSchema, PayloadSchema, OutputSchema, and profile root tools. Pass initial as a real JSON object matching that InitialSchema, not a JSON string. Arrays, strings, numbers, booleans, and key=value text are rejected. This tool does not invoke the agent; use invoke_agent instead.",
        parameters: CreateAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const agentInput = params as CreateAgentInput;
            const result = await context.harness.createAgent({
                profileKey: agentInput.profileKey,
                initial: normalizeCreateAgentInitial(agentInput.profileKey, agentInput.initial) as never,
                title: agentInput.title,
                currentProjectRoot: agentInput.currentProjectRoot,
                parentSessionId: context.sessionId,
            });
            return {
                content: [{type: "text", text: `created agent session ${result.sessionId}`}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
    invokeAgent: defineAgentTool({
        key: "invoke_agent",
        name: "invoke_agent",
        label: "Invoke Agent",
        executionMode: "parallel",
        description: "Invoke an agent session. Before sending input to an unfamiliar profile, call get_agent_profile({ profileKey }) and inspect PayloadSchema. message is plain text; input is a structured payload object. Returns report_result when the profile reports one, otherwise the final assistant message. Set background=true for long non-interactive tasks: the target must be idle and must not request user input or approval; the result arrives later as a follow-up message, so end the current turn instead of polling the job.",
        parameters: InvokeAgentSchema,
        async executeWithContext(context, toolCallId, params: unknown, _userInput, signal) {
            const invocation = params as InvokeAgentInput;
            if (invocation.sessionId === context.sessionId) {
                throw new Error("invoke_agent 不能调用当前 session 自己；请直接继续当前对话，或 create_agent 后调用新 agent session。");
            }
            // 模型指定（PLAN-E E2）：只做 allowlist 校验，真正的单次覆盖随 invoke input 下沉到 Harness。
            if (invocation.model) {
                if (!context.invocationId) {
                    throw new Error("invoke_agent缺少invocationId，无法读取已捕获的Project generation。");
                }
                const {loadEffectiveConfigFromTarget} = await import("nbook/server/config/config-service");
                const {assertVisibleModel} = await import("nbook/server/agent/harness/agent-visible-models");
                assertVisibleModel(await loadEffectiveConfigFromTarget(
                    context.harness.configTargetForInvocation(context.invocationId),
                ), invocation.model);
            }
            const invokeInput = {
                sessionId: invocation.sessionId,
                mode: invocation.mode ?? (invocation.message || invocation.input !== undefined ? "prompt" as const : "continue" as const),
                message: invocation.message ? {text: invocation.message} : undefined,
                payload: normalizeInvokeAgentInput(invocation.input),
                modelKey: invocation.model,
                title: invocation.title,
                caller: {
                    kind: "agent" as const,
                    sessionId: context.sessionId,
                    profileKey: context.profileKey,
                    toolCallId,
                },
            };
            // 后台模式（PLAN-E）：立即返回 jobId，结果以 followup 消息回流
            if (invocation.background) {
                const {job, jobEventCursor} = context.harness.jobs.spawn({
                    kind: "invoke_agent",
                    title: `invoke agent #${invocation.sessionId}${invocation.message ? `：${invocation.message.slice(0, 40)}` : ""}`,
                    ownerSessionId: context.sessionId,
                    originToolCallId: toolCallId,
                    ref: {sessionId: invocation.sessionId},
                    run: async (jobContext) => {
                        const result = await context.harness.invokeAgent({
                            ...invokeInput,
                            block: true,
                            queueIfBusy: false,
                            signal: jobContext.signal,
                        });
                        if (result.status === "error") throw new Error(result.error ?? `agent #${invocation.sessionId} 调用失败`);
                        if (result.status === "waiting") {
                            throw new Error(`后台 invoke_agent V1 不追踪人工输入或审批等待；agent #${invocation.sessionId} 已停在 waiting，请先处理目标 session，后续交互改用前台调用。`);
                        }
                        const compact = compactInvokeAgentResult(result, invocation.sessionId);
                        return {
                            resultPreview: compact.finalMessage.slice(0, 300),
                            result: compact,
                            message: `agent #${invocation.sessionId} 返回：\n${JSON.stringify(compact, null, 2)}`,
                        };
                    },
                });
                return {
                    content: [{type: "text", text: `后台调用已启动：${job.jobId}（agent #${invocation.sessionId}）。结果将以后续消息回流；正常收尾本回合，不要轮询等待。`}],
                    details: normalizeToolResultDetails({
                        jobId: job.jobId,
                        jobEventCursor,
                        sessionId: invocation.sessionId,
                        status: "started",
                        data: null,
                        finalMessage: "",
                        background: true,
                    }),
                };
            }
            const result = await context.harness.invokeAgent({...invokeInput, signal});
            const compact = compactInvokeAgentResult(result, invocation.sessionId);
            const contentText = compact.finalMessage
                || (typeof compact.error === "string" ? compact.error : compact.status);
            return {
                content: [{type: "text", text: contentText}],
                details: compact,
            };
        },
    }),
    getAgent: defineAgentTool({
        key: "get_agent",
        name: "get_agent",
        label: "Get Agent",
        executionMode: "parallel",
        description: "Get owned agent list or a single agent summary.",
        parameters: GetAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetAgentInput;
            const result = await context.harness.getAgent(query.sessionId, context.sessionId);
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
    getAgentProfile: defineAgentTool({
        key: "get_agent_profile",
        name: "get_agent_profile",
        label: "Get Agent Profile",
        executionMode: "parallel",
        description: "Get one agent profile's schema summary, including InitialSchema for create_agent and PayloadSchema for invoke_agent. This is the required schema-discovery step before structured create/invoke calls. This queries profile catalog, not created agent sessions.",
        parameters: GetAgentProfileSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetAgentProfileInput;
            const result = await getAgentProfileDetail(context.harness, query.profileKey);
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
    getSession: defineAgentTool({
        key: "get_session",
        name: "get_session",
        label: "Get Session",
        executionMode: "parallel",
        description: [
            "Get lightweight session metadata, title, summary, usage, and linked agents.",
            "To inspect your current session, call get_session({}) and omit sessionId. The runtime automatically uses the current session id.",
            "Only pass sessionId when you already know the real target id from session context or another tool result. Never guess, invent, or default sessionId to 1.",
            "Default does not return history messages and never returns tree.",
            "Set includeRecentMessages=true for a small active-path-only recent message query.",
            "recentMessageLimit counts user, assistant, and toolResult messages by default; set recentMessageRoles to filter, for example [\"assistant\"].",
            "Use recentMessageLimit 1-10 and tokenBudget 100-3000; oversized output errors.",
            "For complex history, branch, or tree queries, inspect the session file directory yourself with bash/jq/rg instead of this tool.",
        ].join("\n"),
        parameters: GetSessionSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const query = params as GetSessionInput;
            const result = await context.harness.getSession({...query, sessionId: query.sessionId ?? context.sessionId}, context.sessionId);
            return {
                content: [{type: "text", text: JSON.stringify(result)}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
    detachAgent: defineAgentTool({
        key: "detach_agent",
        name: "detach_agent",
        label: "Detach Agent",
        executionMode: "sequential",
        description: "Detach an owned agent without deleting its session.",
        parameters: DetachAgentSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const detach = params as DetachAgentInput;
            const result = await context.harness.detachAgent(detach.sessionId, context.sessionId);
            const text = result.status === "detached"
                ? `detached ${detach.sessionId}`
                : result.status === "already_detached"
                    ? `agent ${detach.sessionId} was already detached`
                    : `agent ${detach.sessionId} was not linked`;
            return {
                content: [{type: "text", text}],
                details: normalizeToolResultDetails(result),
            };
        },
    }),
} as const;

function normalizeCreateAgentInitial(profileKey: string, value: unknown): JsonValue {
    if (value === undefined) {
        return {};
    }
    if (value === null) {
        throw new Error(`create_agent.initial 必须是 JSON object。profile ${profileKey} 收到 null；请省略 initial 或传入真实对象。`);
    }
    if (typeof value === "string") {
        throw new Error(`create_agent.initial 必须是 JSON object。profile ${profileKey} 收到的是 JSON string；请先调用 get_agent_profile 查看 InitialSchema，并把 initial 作为真实对象传入。`);
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`create_agent.initial 必须是 JSON object。profile ${profileKey} 不接受 array/string/number/boolean 或 key=value 文本；请先调用 get_agent_profile 查看 InitialSchema。`);
    }
    return Value.Parse(Type.Record(Type.String(), Type.Unknown()), value) as JsonValue;
}

function normalizeInvokeAgentInput(value: unknown): JsonValue | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("invoke_agent.input 必须是 JSON object。请先调用 get_agent_profile 查看 PayloadSchema。");
    }
    return Value.Parse(Type.Record(Type.String(), Type.Unknown()), value) as JsonValue;
}

function compactInvokeAgentResult(result: {
    status: "completed" | "waiting" | "error";
    finalMessage?: string;
    reportResult?: {result: string; data?: unknown};
    error?: string;
    usage?: {input: number; output: number; totalTokens: number};
    elapsedMs?: number;
}, sessionId: number): Record<string, JsonValue> & {status: "completed" | "waiting" | "error"; sessionId: number; finalMessage: string; data: JsonValue | null} {
    const output: Record<string, JsonValue> & {
        status: "completed" | "waiting" | "error";
        sessionId: number;
        finalMessage: string;
        data: JsonValue | null;
    } = {
        status: result.status,
        sessionId,
        finalMessage: result.reportResult?.result ?? result.finalMessage ?? "",
        data: result.reportResult?.data === undefined ? null : result.reportResult.data as JsonValue,
    };
    if (result.error) {
        output.error = result.error;
    }
    if (result.usage || result.elapsedMs !== undefined) {
        output.stats = {
            inputTokens: result.usage?.input ?? 0,
            outputTokens: result.usage?.output ?? 0,
            totalTokens: result.usage?.totalTokens ?? 0,
            elapsedMs: result.elapsedMs ?? 0,
        };
    }
    return output;
}

async function getAgentProfileDetail(harness: {profiles: {snapshot(): Promise<{profiles: Array<{key: string; name: string; description?: string; loadStatus: string; creationMode: "public" | "system_only"; initialSchema?: unknown; payloadSchema?: unknown; outputSchema?: unknown}>}>; get(profileKey: string): Promise<{rootToolKeys: readonly string[]; initialSchema?: unknown; payloadSchema?: unknown; outputSchema?: unknown}>}}, profileKey: string): Promise<Record<string, JsonValue>> {
    const {renderSchemaSummary} = await import("nbook/server/agent/profiles/profile-dsl");
    const snapshot = await harness.profiles.snapshot();
    const item = snapshot.profiles.find((profile) => profile.key === profileKey);
    if (!item || item.loadStatus !== "loaded") {
        throw new Error(`未找到可用 agent profile: ${profileKey}`);
    }
    const profile = await harness.profiles.get(profileKey);
    return {
        profileKey,
        name: item.name,
        description: item.description ?? "",
        creationMode: item.creationMode,
        createAgentAllowed: item.creationMode === "public",
        toolKeys: [...profile.rootToolKeys],
        initialSchema: item.initialSchema ? renderSchemaSummary(item.initialSchema as never) : "none",
        payloadSchema: item.payloadSchema ? renderSchemaSummary(item.payloadSchema as never) : "none",
        outputSchema: item.outputSchema ? renderSchemaSummary(item.outputSchema as never) : "none",
    };
}
