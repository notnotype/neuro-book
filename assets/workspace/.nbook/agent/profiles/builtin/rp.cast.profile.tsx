/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

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

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("rp.cast"),
    tools: toolset(
        builtin.agent.create,
        builtin.agent.invoke,
        builtin.agent.get,
        builtin.agent.getProfile,
        builtin.rp.characterRecall,
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.cast", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        RP_CAST_CONTRACT,
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/agent/rp-v2/actor-packet.md" /></Message>
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

const RP_CAST_CONTRACT = profileText`
    <rp_cast_contract>
        # 调度流程

        1. 从 invoke_agent.message 读取本 Tick 编号、出场名单与每角色材料包（上级已过滤，不含 secret）。
        2. 对每个角色：characterId **必须用出场名单给出的注册表 id**（不要自己音译角色名）。create 前先 rp_character_recall 确认档案存在；档案缺失或 id 未登记时，如实报告 rp.leader 请求建档，**不要**猜别的 id 或带着缺档继续。已有 linked rp.actor session 则复用；没有则 create_agent({profileKey: "rp.actor", initial: {characterId, kind}, title: "rp.actor: {characterId}"})。kind 取材料包标注（player = 用户化身，npc = 自主角色）。
        3. 把材料包装配为 actor-facing packet（<gm> / <character name="..."> / <knowledge> / <directive> 标签），作为 invoke_agent.message 发送。packet 首行标注当前 tick 号与日历时间（actor 的记忆维护需要）。
        4. **并行调度**：所有 actor 的 invoke 互不依赖，必须在同一轮一起发出，不要逐个串行等待。
        5. 收集三通道返回，按角色汇总；某个 actor 失败或超时时如实标注，不要编造它的反应。

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
