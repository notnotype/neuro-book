/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {RetrievalInitialSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Import, Message, ProfilePrompt, RuntimeLocationReminder, SkillCatalog, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "retrieval",
    name: "内容检索",
    description: "内容节点召回和候选判断 agent：为 Leader 查找 lorebook/manuscript 相关节点，输出 entries 给调用方判断，不直接替 writer 写正文。",
} as const;

export const InitialSchema = RetrievalInitialSchema;
export const OutputSchema = RetrievalOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("retrieval"),
    tools: toolset(
        builtin.file.bash,
        builtin.file.read,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "retrieval", preset: ctx.settings.personaPreset, home: ctx.home});
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
                    <Message><Import path="reference/content/retrieval.md" /></Message>
                    <Message><Import path="reference/agent/profile-context-memory.md" /></Message>
                    <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                    <Message><SkillCatalog /></Message>
                </HistorySet>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <WorkspaceFocusReminder />
                    <Message>{`Search prompt:\n${ctx.initial.prompt}`}</Message>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        # 输出合同

        - 必须调用 report_result；report_result.data 必须是 { entries, note? }。

        - entries 是给 Leader 的候选列表，不是 writer 的直接输入。
        - entries[].path 是唯一会被 Leader 传给 writer 的字段。
        - entries[].reason 必填，说明这个节点为什么应该传给 writer；按当前写作任务概括，不要完整复述内容节点 summary。
        - entries[].use 可选，说明建议 writer 重点使用节点里的哪类信息。
        - entries[].risk 可选，说明弱相关、状态可能过时、需要用户确认或可能冲突的风险。
        - note 可选，用于整体说明没有强相关条目、结果偏少、建议补充搜索条件等情况。
        - 不要输出上述合同以外的旧字段或自造字段。
        - report_result.result 只写一句简短说明。不要编辑文件，不要用 prose-only final answer 代替 report_result。
    `;
}
