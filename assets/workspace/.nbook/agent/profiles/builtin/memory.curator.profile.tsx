/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {MemoryCuratorInitialSchema, MemoryCuratorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {Message, ModelContext, ProfilePrompt, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "memory.curator",
    name: "记忆整理",
    description: "通用记忆整理器：根据 facts 和当前 memory 集合产出 JSON Patch，由工具层校验并写回。",
} as const;

export const InitialSchema = MemoryCuratorInitialSchema;
export const OutputSchema = MemoryCuratorOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("memory.curator"),
    tools: toolset(
        builtin.result.main({dataSchema: OutputSchema}),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "memory.curator", preset: ctx.settings.personaPreset, home: ctx.home});
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
                <ModelContext>
                    <Message>{renderInput(ctx.initial)}</Message>
                </ModelContext>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(): string {
    return profileText`
        输入包含：
        - subjectPath
        - facts：本轮新增的 subject-facing facts 列表
        - currentMemories：当前 memory.jsonl 解析后的 SubjectMemory[]

        SubjectMemory schema:
        - topic: string
        - aliases?: string[]
        - view: string

        输出要求：
        - 必须调用 report_result。
        - report_result.result 写人类可读摘要，说明新增、更新、合并、删除或无需更新的结果。
        - report_result.data 必须符合 MemoryCuratorOutputSchema，只包含 patch。
        - patch 是应用到 currentMemories 这个数组上的 JSON Patch。
        - 无需更新时，patch 返回空数组。
        - patch 后结果必须仍是 SubjectMemory[]，topic/view 非空，topic 不重复。
    `;
}

function renderInput(input: Initial): string {
    return profileText`
        <memory_curator_input>
        subjectPath: ${input.subjectPath}

        facts:
        ${renderFacts(input.facts)}

        currentMemories:
        ${JSON.stringify(input.currentMemories, null, 2)}
        </memory_curator_input>
    `;
}

function renderFacts(facts: string[]): string {
    return facts.map((fact, index) => `${String(index + 1)}. ${fact}`).join("\n");
}
