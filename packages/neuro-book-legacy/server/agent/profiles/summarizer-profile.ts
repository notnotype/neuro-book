import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {SessionSummarizerInitialSchema, SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";

/**
 * 最小内置 summarizer profile。真实提示词从 assets/workspace/.nbook 加载。
 */
export const summarizerProfile = defineAgentProfile({
    manifest: {
        key: "summarizer",
        name: "Session Summarizer",
        description: "Maintains display title and summary for an Agent session.",
    },
    capabilities: {
        creation: "system_only",
    },
    initialSchema: SessionSummarizerInitialSchema,
    outputSchema: SessionSummarizerOutputSchema,
    tools: toolset(
        builtin.result.main({dataSchema: SessionSummarizerOutputSchema}),
    ),
    runtimeDefaults: {
        compaction: {enabled: false},
    },
    runtime: defineAgentRuntime({
        hooks: [
            agentRuntimeBuiltins.profilePrompt(),
            agentRuntimeBuiltins.sessionContext(),
            agentRuntimeBuiltins.reportResult(),
            agentRuntimeBuiltins.runtimeOnlyTranscript(),
        ],
    }),
    prepare() {
        return {
            systemPrompt: [
                "你是 NeuroBook 的后台 session 展示元数据摘要器。",
                "你只根据本轮用户消息中的 Agent Dialogue Content 生成展示用 title 和 summary。",
                "必须调用 report_result，data 必须包含 title 和 summary。",
                "title 简短具体，summary 用一句话概括当前会话进展。",
            ].join("\n"),
        };
    },
});
