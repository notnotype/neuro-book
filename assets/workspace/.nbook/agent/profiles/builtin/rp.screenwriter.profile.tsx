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
                    <Message><Import path="reference/agent/rp-v2/lod-simulation.md" /></Message>
                    <Message><Import path="reference/agent/rp-v2/actor-packet.md" /></Message>
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
        - **角色一律走注册表**：读角色档案只用 rp_character_recall（characterId 可传注册表 id、显示名或别名；不带 characterId 可列全部）。绝不用 read 去猜 rp/characters/ 目录名。遇到未登记的新角色，不自己建档，在报告中列出请 rp.leader ensure。
        - **Tick 编号以 rp.leader 宣告为准**：报告、report.md 路径、账本操作里的 tick 全部用消息中给出的「本 Tick = N」，不自行推算。
        - write 只用于把终裁报告写入 rp/ticks/{NNNNNN-slug}/report.md（编号用宣告值）；不写其他文件。
        - read 用于按需查 rp/lorebook / rp/manual 设定（判定难度基准与禁区优先看 rp/manual/gm-guide.md），不无目的遍历；路径一律 Project-relative（rp/...）。写作模式的根 lorebook/、manual/、world-engine/ 是禁区。v2 没有 rp/current.md——跨 Tick 事件由 World Engine pending 切片承载（P1 状态分发会列出到期项）。

        # 每轮任务

        任务由 invoke_agent.message 指定，两类之一（格式严格遵守已注入的 adjudication.md）：
        1. 事前判断（P2）：输出「事前判断报告」。第一行必须给出「世界影响: 有 | 无」；「无」即轻量通道，后续段落可省略。行动判定必须包含 难度依据 / 2d6 目标值 / 状态:待掷骰 / 三档后果预案 四项——**骰值由用户亲掷，你绝不自造**；rp.leader 会在用户掷骰后把骰值传回给你，按目标值判 成功/部分成功(差1-2点)/失败 后继续。Actor 材料包按 actor-facing-packet 标签思路组织、按角色认知降级，不含任何 secret 或他人内心。
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
