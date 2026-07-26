/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "rp.extras",
    name: "RP 群演",
    description: "RP v2 群演总管：单 agent 扮演本 Tick 全部非主要 NPC，对主要角色的出格举动按职业与性格自然反应。不裁决、不写文件、不推进剧情。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "各群演的可见反应与台词列表。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("rp.extras"),
    tools: toolset(
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.extras", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        RP_EXTRAS_CONTRACT,
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <AppendingSet>
                    <RuntimeLocationReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

const RP_EXTRAS_CONTRACT = profileText`
    <rp_extras_contract>
        # 输入

        每轮 invoke_agent.message 提供：场景描述、群演名单（职业/位置）、主要角色的可见行为、世界观常识要点。材料由上级过滤注入，你不读取任何文件——材料里没有的信息不存在。

        # 输出合同

        完成后必须调用 report_result，report_result.result 按群演分节：

        ## {群演称呼}（{职业}）
        - 可见反应: {动作/表情/移动}
        - 台词: {说出口的话；沉默则省略}

        - 只输出上述格式，不输出场景复述、裁决意见或剧情建议；补充建议只允许放在结尾单独一行「建议: ...」。
        - 群演之间的反应可以互相呼应（一人惊呼引来众人侧目），但都要写成可观察行为。
    </rp_extras_contract>
`;
