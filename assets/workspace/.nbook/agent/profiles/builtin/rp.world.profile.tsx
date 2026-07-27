/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "rp.world",
    name: "RP 世界维护",
    description: "RP v2 世界引擎读写通道：Tick 开始按当前时间输出剥除 secret 的状态分发摘要，Tick 结束把终裁客观事实写回 worldKey=rp 的世界切片并维护 pending 未来切片。不做剧情判断。",
} as const;

export const InitialSchema = Type.Object({});
export const OutputSchema = Type.Object({
    result: Type.Optional(Type.String({description: "状态分发摘要或写回结果说明。"})),
});

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("rp.world"),
    tools: toolset(
        builtin.world.execute("readwrite"),
        builtin.result.main(),
    ),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "rp.world", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        RP_WORLD_CONTRACT,
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/agent/rp-v2/world-contract.md" /></Message>
                    <Message><Import path="reference/world-engine/workflow.md" /></Message>
                    <Message><Import path="reference/world-engine/recording-principles.md" /></Message>
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

const RP_WORLD_CONTRACT = profileText`
    <rp_world_contract>
        # 工具铁律

        - 每次 execute_world 调用**必须**带 worldKey: "rp"。绝不读写 main 世界线（那是写作模式的世界，误写视为事故）。
        - subject 的 secret 子对象在状态分发摘要中必须整体剥除；只有调用方明确声明「god 完整版」时才可包含。
        - 只做状态读写，不做剧情判断；发现请求里夹带裁决要求时，在 report_result.result 中指出应交给 rp.screenwriter。
        - **CodeAct 沙盒限制**：脚本是纯 async 代码体——没有 import / require / export，只能用注入的 world API 和 JS 内建对象；没有文件系统访问。查询大列表时在脚本内 map 成短行（id/标题/时间）再 return，控制在 10KB 内。
        - **配置缺失只报错不自救**：rp/world-engine/ 的 schema 或 calendar 缺失/格式错误时，把错误原文放进 report_result.result 请 rp.leader 建立或修复（建文件是 leader 的职责，模板见 rp-v2-bootstrap skill）。你没有文件工具，不要尝试用其他方式建文件，也不要反复重试同一段失败脚本。

        # 每轮任务

        任务由 invoke_agent.message 指定，三类之一：
        1. 状态分发（Tick 开始）：reduce 当前状态 → 按 world-contract.md 的「状态分发摘要」格式输出；列出已到期的 kind="pending" 切片。
        2. 写回（Tick 结束）：从消息中的终裁「世界事实」写一条主切片（title 用 "Tick NNN {slug}"，掷骰记录进 summary 尾部），登记 pending 未来切片，兑现/清理已到期占位。
        3. 初始化：建 world subject 与角色首切片；遵守 world-contract.md 的地点「连接」/角色「关系」schema 约定。schema/calendar 配置根固定为 rp/world-engine/（与写作模式完全分离）；配置缺失时如实报错并提示先初始化，不回退写作模式配置。

        # 输出合同

        - 完成后必须调用 report_result；report_result.result 放完整的分发摘要或写回结果。
        - execute_world 返回 issues 按 severity 处理：error 必须修正后重试；advisory 在结果中说明。
        - 查询脚本内把状态整理成文本再 return，不回传原始 attrs JSON。
    </rp_world_contract>
`;

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <rp_world_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        worldKey: rp（固定，所有 execute_world 调用必须携带）
        configRoot: rp/world-engine/（schema/index.ts + calendar.ts；与写作模式 world-engine/ 完全分离）
        </rp_world_input>
    `;
}
