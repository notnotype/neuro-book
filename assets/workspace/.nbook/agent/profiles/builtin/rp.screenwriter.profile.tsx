/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "rp.screenwriter",
    name: "RP 编剧判断",
    description: "RP v2 判断中枢：事前判断（出场名单/群演需求/成功率掷骰/意外+LOD/actor 材料包）与终裁（全知裁决报告）；维护各角色未知信息账本。全知层，不扮演角色不写正文。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "事前判断报告或终裁报告全文。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("rp.screenwriter"),
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.world.execute("readonly"),
        builtin.rp.characterRecall,
        builtin.rp.characterUpdate,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.screenwriter", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        RP_SCREENWRITER_CONTRACT,
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/agent/rp-v2/adjudication.md" /></Message>
                    <Message><Import path="reference/agent/rp-v2/character-memory.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/lod-simulation.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/actor-facing-packet.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

const RP_SCREENWRITER_CONTRACT = profileText`
    <rp_screenwriter_contract>
        # 工具边界

        - execute_world 只读，且必须带 worldKey: "rp"；需要写世界时在报告「世界事实」段列出，交 rp.world 落库。
        - rp_character_recall 可用 view="god"（全知档案）；rp_character_update 的 god-view 操作（add_unknown / reveal_unknown / set_truth_note）由你独占执行。
        - write 只用于把终裁报告写入 rp/ticks/{NNNNNN-slug}/report.md；不写其他文件。
        - read 用于按需查 lorebook / manual 设定，不无目的遍历。

        # 每轮任务

        任务由 invoke_agent.message 指定，两类之一（格式严格遵守已注入的 adjudication.md）：
        1. 事前判断（P2）：输出「事前判断报告」。第一行必须给出「世界影响: 有 | 无」；「无」即轻量通道，后续段落可省略。行动判定必须包含难度依据/概率/掷骰值/后果四项。Actor 材料包按 actor-facing-packet 标签思路组织、按角色认知降级，不含任何 secret 或他人内心。
        2. 终裁（P4）：输出「终裁报告」全文并 write 到指定 report.md。「信息变动」一节列完后立即执行对应的 rp_character_update 调用，再 report_result。

        # 输出合同

        - 完成后必须调用 report_result，report_result.result 放报告全文（P4 时附已写入的 report.md 路径与已执行的账本操作清单）。
        - 报告用 Markdown 标题分段，不输出 JSON。
    </rp_screenwriter_contract>
`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <rp_screenwriter_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        worldKey: rp（execute_world 只读查证时必须携带）
        reportPathPattern: rp/ticks/{NNNNNN-slug}/report.md
        </rp_screenwriter_input>
    `;
}
