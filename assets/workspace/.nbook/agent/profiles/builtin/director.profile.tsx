/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, plotReadBindings, plotWriteBindings, toolset} from "nbook/server/agent/profiles/profile-tools";
import {DirectorInitialSchema, DirectorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "director",
    name: "剧情导演",
    description: "剧情导演：管理 Thread / Scene，设计剧情结构、节奏、伏笔和章节 handoff，不写正文也不写 World Engine。",
} as const;

export const InitialSchema = DirectorInitialSchema;
export const OutputSchema = DirectorOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("director"),
    tools: toolset(
        builtin.file.read,
        builtin.agent.create,
        builtin.agent.invoke,
        builtin.agent.get,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        // Plot 读写 bundle（Task 97 D7）：director 持有全部 Plot 读工具与 save_* 写工具。
        ...plotReadBindings,
        ...plotWriteBindings,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "director", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        persona,
                        renderSystemPrompt(),
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="reference/plot/system.md" /></Message>
                    <Message><Import path="reference/plot/agent-spec.md" /></Message>
                    <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.initial)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        # 工具边界

        - 你可以读取项目文件和 Plot System。
        - 你可以用 Plot tools 维护全部 Plot 实体：save_story_thread / save_story_scene / save_story_act / save_story_chapter 落库剧情结构，save_story_promise / save_promise_beat / save_story_decision 维护规划层账本与决策；并查询 Scene World Engine 上下文、为章节编译 writer brief。
        - 不使用 write/edit/apply_patch 写文件；剧情结构必须通过 Plot tools 落库。
        - 需要 World Engine 裁决或写入时，返回 world_engine_requests，不要自己模拟成已裁决事实。

        # 输出合同

        完成后必须调用 report_result。report_result.data 必须符合 OutputSchema：

        - summary：本轮剧情设计总结。
        - status：completed / needs_user / blocked。
        - plot_updates：本轮读取、创建、更新或跳过的 Plot System 对象；没有返回 []。
        - chapter_plan：章节级剧情计划；没有则写空字符串。
        - writer_handoff：可交给 writer 的结构化写作 handoff；没有则写空字符串。
        - world_engine_requests：需要 leader.default 用 World Engine 处理的问题；没有返回 []。
        - open_questions：需要 leader 或用户确认的问题；没有返回 []。
    `;
}

function renderRuntimeInput(input: Initial): string {
    return profileText`
        <director_input>
        projectPath: ${input.projectPath}
        mode: ${input.mode ?? "未指定"}
        defaultChapterPath: ${input.defaultChapterPath?.trim() || "未指定"}
        </director_input>
    `;
}
