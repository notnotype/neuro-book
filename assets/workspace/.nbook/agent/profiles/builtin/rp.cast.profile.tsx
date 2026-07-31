/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, profileFeatureFormFields, profileSettingsPresets, promptCustomizationDefaults, promptCustomizationFormFields, promptCustomizationSchemaFields, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";
import {defineLowCodeForm} from "nbook/server/low-code-form";

export const profileManifest = {
    key: "rp.cast",
    name: "RP 主角调度",
    description: "RP v2 主角调度员：按出场名单创建/复用 rp.actor（一角色一 session），装配 actor-facing packet 并行 invoke，收集三通道返回原样汇总。不裁决不扮演不接触 god-view。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "各角色三通道返回的汇总。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export const SettingsSchema = Type.Object({
    ...promptCustomizationSchemaFields,
    retryLimit: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("once"), Type.Literal("twice")])),
    summaryDetail: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("full")])),
    materialCheck: Type.Optional(Type.Boolean()),
    missingActorPolicy: Type.Optional(Type.Union([Type.Literal("fail-fast"), Type.Literal("report")])),
}, {additionalProperties: false});

export type Settings = Static<typeof SettingsSchema>;

export const RpCastSettingsForm = defineLowCodeForm({
    schema: SettingsSchema,
    defaults: {...promptCustomizationDefaults, retryLimit: "once", summaryDetail: "full", materialCheck: true, missingActorPolicy: "fail-fast"},
    fields: [
        ...promptCustomizationFormFields(),
        ...profileFeatureFormFields([
        {path: "retryLimit", component: "radio", label: "Actor 重试", options: [
            {value: "none", label: "不重试"}, {value: "once", label: "重试一次"}, {value: "twice", label: "重试两次"},
        ]},
        {path: "summaryDetail", component: "radio", label: "汇总详细度", options: [
            {value: "compact", label: "精简"}, {value: "full", label: "完整三通道"},
        ]},
        {path: "materialCheck", component: "switch", label: "检查 Actor 材料", description: "调度前检查角色档案、出场名单与材料包是否齐全。"},
        {path: "missingActorPolicy", component: "radio", label: "缺失角色处理", options: [
            {value: "fail-fast", label: "立即失败", description: "阻止缺员提交，避免代演或编造。"},
            {value: "report", label: "汇报后停止", description: "整理缺失项交还 Leader，不发起其余调用。"},
        ]},
        ]),
    ],
    presets: profileSettingsPresets(),
});

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: RpCastSettingsForm,
    home: personaHomeDefinition("rp.cast"),
    tools: toolset(
        builtin.agent.create,
        builtin.agent.invoke,
        builtin.agent.get,
        builtin.agent.getProfile,
        builtin.rp.characterRecall,
        builtin.rp.pipeline,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.cast", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        persona,
                        renderRpCastSettings(ctx.settings),
                        RP_CAST_CONTRACT,
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/agent/rp-v2/actor-packet.md" /></Message>
                    <Message><Import path="reference/agent/rp-v2/pipeline-focus-runtime.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                    <LinkedAgentsReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

/** 将调度特色设置映射为动态上下文。 */
function renderRpCastSettings(settings: Settings): string {
    const retries = settings.retryLimit === "none" ? 0 : settings.retryLimit === "twice" ? 2 : 1;
    return profileText`
        <cast_dispatch_strategy>
        - 所有 Actor 始终并行调度；单个失败最多重试 ${retries} 次，且只能复用同一角色 session。
        - 汇总详细度：${settings.summaryDetail === "full" ? "保留每个角色的可见反应、台词和内心三通道" : "压缩措辞，但不得遗漏角色关键动作与台词"}。
        - 材料检查：${settings.materialCheck ? "调度前逐个核对出场名单、角色 id、档案和材料包" : "只执行合同要求的最低档案存在性检查"}。
        - 缺失角色：${settings.missingActorPolicy === "fail-fast" ? "立即 report_failure，禁止缺员汇总" : "汇总缺失项并停止本轮调度，交还 Leader 处理"}。
        </cast_dispatch_strategy>
    `;
}

const RP_CAST_CONTRACT = profileText`
    <rp_cast_contract>
        # 调度流程

        1. 从 invoke_agent.message 读取 turnId、snapshotId、本 Tick 编号、出场名单与每角色材料包（上级已过滤，不含 secret）。snapshotId 必须原样用于最终提交，不能自行读取新世界状态。
        2. 对每个角色：characterId **必须用出场名单给出的注册表 id**（不要自己音译角色名）。create 前先 rp_character_recall 确认档案存在；档案缺失或 id 未登记时，如实报告 rp.leader 请求建档，**不要**猜别的 id 或带着缺档继续。已有 linked rp.actor session 则复用；没有则 create_agent({profileKey: "rp.actor", initial: {characterId, kind}, title: "rp.actor: {characterId}"})。kind 取材料包标注（player = 用户化身，npc = 自主角色）。
        3. 把材料包装配为 actor-facing packet（<gm> / <character name="..."> / <knowledge> / <directive> 标签），作为 invoke_agent.message 发送。packet 首行标注当前 tick 号与日历时间（actor 的记忆维护需要）。
        4. **并行调度**：所有 actor 的 invoke 互不依赖，必须在同一轮一起发出，不要逐个串行等待。
        5. 收集三通道返回，按角色汇总，并调用 rp_pipeline submit_actor_proposals 一次提交全部 expectedActorIds。某个 actor 失败或超时时立即 report_failure kind=major_actor + actorId；不要编造它的反应，也不要提交缺员汇总。主要 actor 只能重试同一 session/角色，不能交给 extras 或你代演。

        # 汇总格式（report_result.result）

        ## {角色名}({characterId})
        - 可见反应: ...
        - 台词: ...
        - 内心: ...

        # 铁律

        - rp_character_recall 只允许 view="actor"（确认角色档案存在/查基本状态）；绝不请求 god 视图。
        - 材料包里没有的信息不存在：不补设定、不替 screenwriter 泄底。
        - 不修改任何文件；actor 的记忆由它自己的 sidecar 维护。
    </rp_cast_contract>
`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <rp_cast_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        actorProfileKey: rp.actor
        </rp_cast_input>
    `;
}
