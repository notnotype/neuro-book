/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, profileFeatureFormFields, profileSettingsPresets, promptCustomizationDefaults, promptCustomizationFormFields, promptCustomizationSchemaFields, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";
import {defineLowCodeForm} from "nbook/server/low-code-form";

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

export const SettingsSchema = Type.Object({
    ...promptCustomizationSchemaFields,
    reactionDensity: Type.Optional(Type.Union([Type.Literal("sparse"), Type.Literal("balanced"), Type.Literal("dense")])),
    dialogueLength: Type.Optional(Type.Union([Type.Literal("brief"), Type.Literal("natural"), Type.Literal("extended")])),
    occupationalVariation: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("balanced"), Type.Literal("high")])),
    crowdCoordination: Type.Optional(Type.Union([Type.Literal("independent"), Type.Literal("responsive")])),
    improvisationLevel: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("balanced"), Type.Literal("high")])),
}, {additionalProperties: false});

export type Settings = Static<typeof SettingsSchema>;

export const RpExtrasSettingsForm = defineLowCodeForm({
    schema: SettingsSchema,
    defaults: {...promptCustomizationDefaults, reactionDensity: "balanced", dialogueLength: "natural", occupationalVariation: "balanced", crowdCoordination: "responsive", improvisationLevel: "low"},
    fields: [
        ...promptCustomizationFormFields(),
        ...profileFeatureFormFields([
        {path: "reactionDensity", component: "radio", label: "反应密度", options: [
            {value: "sparse", label: "稀疏"}, {value: "balanced", label: "适中"}, {value: "dense", label: "密集"},
        ]},
        {path: "dialogueLength", component: "radio", label: "台词长度", options: [
            {value: "brief", label: "短句"}, {value: "natural", label: "自然"}, {value: "extended", label: "较完整"},
        ]},
        {path: "occupationalVariation", component: "radio", label: "职业差异", options: [
            {value: "low", label: "弱"}, {value: "balanced", label: "适中"}, {value: "high", label: "鲜明"},
        ]},
        {path: "crowdCoordination", component: "radio", label: "群体联动", options: [
            {value: "independent", label: "独立反应"}, {value: "responsive", label: "自然联动"},
        ]},
        {path: "improvisationLevel", component: "radio", label: "加戏程度", options: [
            {value: "low", label: "克制"}, {value: "balanced", label: "适量"}, {value: "high", label: "积极"},
        ]},
        ]),
    ],
    presets: profileSettingsPresets(),
});

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: RpExtrasSettingsForm,
    home: personaHomeDefinition("rp.extras"),
    tools: toolset(
        builtin.rp.pipeline,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.extras", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        persona,
                        renderRpExtrasSettings(ctx.settings),
                        RP_EXTRAS_CONTRACT,
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <AppendingSet>
                    <RuntimeLocationReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

/** 将群演特色设置映射为动态上下文。 */
function renderRpExtrasSettings(settings: Settings): string {
    return profileText`
        <extras_performance_strategy>
        - 反应密度：${settings.reactionDensity === "sparse" ? "只挑最相关的少数群演反应" : settings.reactionDensity === "dense" ? "覆盖多数在场群演，但不重复同质反应" : "覆盖能体现现场变化的代表性群演"}。
        - 台词长度：${settings.dialogueLength === "brief" ? "以短句、惊呼和片段对话为主" : settings.dialogueLength === "extended" ? "允许完整交流，但不抢主要角色戏份" : "按现场关系使用自然长度"}。
        - 职业差异：${settings.occupationalVariation === "high" ? "鲜明体现职业知识、习惯与措辞差异" : settings.occupationalVariation === "low" ? "只保留必要职业反应，不刻意强调" : "在关键动作和措辞中自然体现职业差异"}。
        - 群体联动：${settings.crowdCoordination === "responsive" ? "允许目光、议论、退让和跟随等连锁反应" : "各群演以自己的所见所闻独立反应"}。
        - 加戏程度：${settings.improvisationLevel === "low" ? "克制，不新增支线、关键信息或新冲突" : settings.improvisationLevel === "high" ? "可增加不改变事实的小动作与短互动，但不得推进剧情" : "可补充少量现场细节，不改变剧情方向"}。
        </extras_performance_strategy>
    `;
}

const RP_EXTRAS_CONTRACT = profileText`
    <rp_extras_contract>
        # 输入

        每轮 invoke_agent.message 提供：turnId、snapshotId、场景描述、群演名单（职业/位置）、主要角色的可见行为、世界观常识要点。材料由上级过滤注入，你不读取任何文件——材料里没有的信息不存在。只处理普通具名 NPC 和未具名群演，主要角色永远不由你代演。

        # 输出合同

        完成后必须调用 report_result，report_result.result 按群演分节：

        ## {群演称呼}（{职业}）
        - 可见反应: {动作/表情/移动}
        - 台词: {说出口的话；沉默则省略}

        - 只输出上述格式，不输出场景复述、裁决意见或剧情建议；补充建议只允许放在结尾单独一行「建议: ...」。
        - 群演之间的反应可以互相呼应（一人惊呼引来众人侧目），但都要写成可观察行为。
        - 汇总完成后调用 rp_pipeline submit_extras，原样使用输入 snapshotId。失败时调用 report_failure kind=extras；leader 可重建新的 extras session，但仍必须提交群演提案后才能推进。
    </rp_extras_contract>
`;
