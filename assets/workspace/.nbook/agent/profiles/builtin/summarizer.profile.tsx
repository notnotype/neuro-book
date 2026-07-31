/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {agentRuntimeBuiltins, defineAgentRuntime} from "nbook/server/agent/profiles/define-agent-runtime";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {SessionSummarizerInitialSchema, SessionSummarizerOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {readTitleOwner} from "nbook/server/agent/session/custom-state-keys";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";

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
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("summarizer"),
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    runtime: defineAgentRuntime<Initial>({
        hooks: [
            agentRuntimeBuiltins.profilePrompt<Initial>(),
            agentRuntimeBuiltins.sessionContext<Initial>(),
            agentRuntimeBuiltins.reportResult<Initial>(),
            agentRuntimeBuiltins.runtimeOnlyTranscript<Initial>(),
            {
                name: "write-source-summary",
                stage: "settleRun",
                async run(ctx) {
                    const data = normalizeSummaryResult(ctx.runResult?.reportResult?.data);
                    const source = await ctx.session.read(ctx.initial.sourceSessionId);
                    const state = readSourceState(source.context.customState["summarizer.state"]);
                    if (!data || !state.running || state.sourceLeafId !== source.snapshot.leafId) {
                        return {
                            writePlans: [{
                                target: {sessionId: ctx.initial.sourceSessionId},
                                cause: "summarizer.stale",
                                ops: [{
                                    kind: "append",
                                    projection: true,
                                    entry: {
                                        type: "custom",
                                        key: "summarizer.state",
                                        value: jsonState({
                                            ...state,
                                            running: false,
                                            dirty: true,
                                            ...(data ? {} : {lastError: "summarizer 缺少有效 report_result.data。"}),
                                        }),
                                    },
                                }],
                            }],
                        };
                    }
                    // 用户手动改过名（titleOwner=user）时只更新 summary，不覆盖标题。
                    const titleLocked = readTitleOwner(source.context.customState) === "user";
                    return {
                        writePlans: [{
                            target: {sessionId: ctx.initial.sourceSessionId},
                            cause: "summarizer.writeback",
                            ops: [
                                {
                                    kind: "append",
                                    projection: {
                                        scope: "activeLeaf",
                                        leafId: state.sourceLeafId,
                                    },
                                    entry: {
                                        type: "session_update",
                                        updates: titleLocked ? {summary: data.summary} : data,
                                    },
                                },
                                {
                                    kind: "append",
                                    projection: true,
                                    entry: {
                                        type: "custom",
                                        key: "summarizer.state",
                                        value: jsonState({
                                            ...state,
                                            running: false,
                                            dirty: state.dirty === true,
                                            lastRunAt: Date.now(),
                                            lastDialogueContentFingerprint: state.runningDialogueContentFingerprint,
                                            lastDialogueContentTokens: state.runningDialogueContentTokens,
                                            sourcePromptUserTurnCount: state.runningSourcePromptUserTurnCount,
                                        }),
                                    },
                                },
                            ],
                        }],
                    };
                },
            },
        ],
    }),
    async context(ctx) {
        const dialogue = await ctx.session.agentDialogueContent({
            sessionId: ctx.initial.sourceSessionId,
            profileKey: "summarizer",
            initial: ctx.initial,
        });
        const persona = await buildPersonaPrompt({profileKey: "summarizer", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        persona,
                        "必须调用 report_result，report_result.data 必须是 { title, summary }。",
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <ModelContext>
                    <Message>{dialogue.text || "当前 source session 没有可摘要的 Agent Dialogue Content。"}</Message>
                </ModelContext>
            </ProfilePrompt>
        );
    },
});

function normalizeSummaryResult(value: unknown): Output | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as {title?: unknown; summary?: unknown};
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 80) : "";
    const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 500) : "";
    if (!title || !summary) {
        return null;
    }
    return {title, summary};
}

/**
 * 从 source session customState 的 summarizer.state 值解析后台维护状态；非法值按空状态处理。
 */
function readSourceState(value: unknown): {
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    sessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
    sourcePromptUserTurnCount?: number;
    runningDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningSourcePromptUserTurnCount?: number;
    summarizerInputFingerprint?: string;
} {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function jsonState(state: {
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    sessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
    sourcePromptUserTurnCount?: number;
    runningDialogueContentTokens?: number;
    runningDialogueContentFingerprint?: string;
    runningSourcePromptUserTurnCount?: number;
    summarizerInputFingerprint?: string;
}): Record<string, string | number | boolean | null> {
    return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== undefined)) as Record<string, string | number | boolean | null>;
}
