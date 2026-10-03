/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import type {Static} from "nbook/profile-sdk";
import {defineAgentProfile} from "nbook/profile-sdk";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/profile-sdk";
import {builtin, toolset} from "nbook/profile-sdk";
import {SessionSummarizerInitialSchema, SessionSummarizerOutputSchema} from "nbook/profile-sdk";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/profile-sdk";

export const profileManifest = {
    key: "summarizer",
    name: "会话摘要",
    description: "后台元数据维护 agent：自动维护 Agent session 的显示标题与摘要。",
} as const;

export const InitialSchema = SessionSummarizerInitialSchema;
export const OutputSchema = SessionSummarizerOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    capabilities: {
        creation: "system_only",
    },
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    runtime: defineAgentRuntime<Initial>({
        hooks: [
            agentRuntimeBuiltins.profilePrompt<Initial>(),
            agentRuntimeBuiltins.sessionContext<Initial>(),
            agentRuntimeBuiltins.reportResult<Initial>(),
            agentRuntimeBuiltins.runtimeOnlyTranscript<Initial>(),
        ],
    }),
    async context(ctx) {
        const dialogue = await ctx.session.agentDialogueContent({
            sessionId: ctx.initial.sourceSessionId,
            profileKey: "summarizer",
            initial: ctx.initial,
        });
        return (
            <ProfilePrompt>
                <System>
                    {[
                        "你是 NeuroBook 的后台 session 展示元数据摘要器。",
                        "你会收到一段 Agent Dialogue Content，它是源 session 当前 active path 的可见正文。",
                        "只根据这段正文生成展示用 title 和 summary，不要编造文件、工具结果或未出现的结论。",
                        "title 必须简短具体，不超过 32 个中文字符。",
                        "summary 用一句话概括当前会话目标、已完成进展或最新状态，不超过 240 个中文字符。",
                        "必须调用 report_result，report_result.data 必须是 { title, summary }。",
                    ].join("\n")}
                </System>
                <ModelContext>
                    <Message>{dialogue.text || "当前 source session 没有可摘要的 Agent Dialogue Content。"}</Message>
                </ModelContext>
            </ProfilePrompt>
        );
    },
});
