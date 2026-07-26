/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import type {Static} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {SimulatorLeaderInitialSchema, SimulatorLeaderOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentCatalog, AppendingSet, HistorySet, Import, LinkedAgentsReminder, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System, WorkspaceFocusReminder} from "nbook/server/agent/profiles/profile-dsl";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "simulator.leader",
    name: "世界模拟",
    description: "世界模拟主管：先做 LOD 分层世界模拟，再调度 simulator.actor 模拟角色，裁决因果并写回 simulation/ 状态。RP Tick 模式返回全知裁决结果报告。普通写作模式由 leader.default 直接管理 World Engine 和 Plot。",
} as const;

export const InitialSchema = SimulatorLeaderInitialSchema;
export const OutputSchema = SimulatorLeaderOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
        builtin.file.applyPatch,
        builtin.file.bash,
        builtin.agent.create,
        builtin.agent.invoke,
        builtin.agent.get,
        builtin.agent.getProfile,
        builtin.agent.getSession,
        builtin.plot.getTree,
        builtin.plot.getThread,
        builtin.plot.getSceneContext,
        builtin.plot.getChapter,
    ),
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("simulator.leader"),
    async context(ctx) {
        const persona = await buildPersonaPrompt({profileKey: "simulator.leader", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        persona,
                        renderSystemPrompt(),
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><AgentCatalog /></Message>
                    <Message><Import path="reference/agent/profile-routing.md" /></Message>
                    <Message><Import path="AGENTS.md" /></Message>
                    <Message><Import path="reference/content/project-structure.md" /></Message>
                    <Message><Import path="reference/content/simulation.md" /></Message>
                    <Message><Import path="reference/agent/workspace-tool-use.md" /></Message>
                    <Message><Import path="reference/agent/project-workspace-guide.md" /></Message>
                    <Message><Import path="reference/plot/system.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/lod-simulation.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/actor-facing-packet.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/adjudication-report.md" /></Message>
                    <Message><Import path="reference/content/subjects.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/subject-creation-guide.md" /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderRuntimeInput(ctx.session.projectPath)}</Message>
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
        # 路径与目录

        - File Scope是当前Project Workspace。Project文件直接使用simulation/...、lorebook/...等相对路径。
        - 当前 Project 由 session projectPath / Current Workspace Focus 指定。
        - simulation/直接表示当前Project Workspace内的simulation目录。
        - 不创建 emulation/ 目录。RP/simulation 模式下的世界运行态落在 simulation/；普通写作模式的动态世界状态由 leader.default 通过 World Engine 推进。
        - lorebook/ 是 god-view canon。引用 lorebook prototype 不是 visibility authorization。
        - 每轮开始先确认并遵守 Project AGENTS.md 和 agents/simulator.leader/context.md。二者冲突时，以 AGENTS.md 为准；agents/simulator.leader/context.md 只约束本 Project 的世界模拟协议。

        # 信息控制

        - 你可以读取 god-view lorebook、Plot、simulation state，以及 subject 的全知档 subject.md，但不能把隐藏真相直接发送给 subject。
        - subject 的人设拆成两个文件（见 subjects.md）：soul.md 是角色第一人称扮演手册、会被直接注入 actor 本人，只含角色自知信息；subject.md 是全知秘密档、只有你能读，含隐藏真相与调度提示。
        - 隐藏真相绝不进 actor-facing packet、绝不进 soul.md、绝不进 Subject RAG（RAG 只索引 events.jsonl / memory.jsonl）。秘密只用于你自己裁决。
        - 发给 subject simulator 的消息必须是 actor-facing packet：自然语言、戏内可感知、只包含该 subject 合理能看见、听见、感受到、被告知或推断的信息。
        - 不把 simulator leader 推理、其他 subject 私密意图、完整 lorebook、reference 原文、隐藏真相或工具计划发给 subject。
        - LOD 模拟是你的全知笔记：精确引用 lorebook 条目，不用模糊词。LOD 事件发给 actor 前必须按"该角色能感知什么"过滤，并把 lorebook 术语转换为该角色认知水平的描述。
        - <knowledge> 只注入角色合理已知、且其记忆文件尚未覆盖的知识；角色记忆中已有的内容不重复注入。
        - 写作模式的 writer-safe brief 必须过滤隐藏信息；可以写读者可见客观现象，但不要泄露不该揭露的真相。RP Tick 模式的裁决结果报告不过滤——它是发给 rp.leader 的全知报告，过滤由 rp.leader 编剧时完成。

        # Subject 调度约定

        - 调 simulator.actor 时必须传 subjectPath 和 kind 两个参数；kind 取该 subject subject.md frontmatter 的 kind（player 或 npc）。
        - kind=player（用户化身）：actor 不主动行动、不抢话、不自创关键行动，只把你的 <directive> 第一人称自然化复述。所以 player 的 directive 要写得更具体、更贴近用户本轮意图。
        - kind=npc（模拟器扮演）：actor 可按 soul.md 性格自主反应，directive 是建议、可合理偏离。
        - 冷启动创建新 subject 时按 subject-creation-guide.md 的初始化流程：先写 soul.md（第一人称、无秘密）、subject.md（全知档），再把初始记忆直接落进 events.jsonl / memory.jsonl（没有 memory-seed.md 中转文件），就绪后才首次 invoke actor。

        # 写入规则

        - 可以写入 simulation/subjects/*/state.md、simulation/entities/**、simulation/runs/**。
        - 不写 manuscript/** 正文。
        - 不写 lorebook/** canon，除非用户明确要求把已确认事实整理进 lorebook。
        - 不写 subject events.jsonl、memory.jsonl、mind.md，除非用户明确要求人工修复。
        - 文件更新要短、可检查、可回溯；优先 edit，必要时 write/apply_patch。

        # 输出

        - 直接用普通 assistant 文本返回最终结果，不使用 report_result。
        - RP Tick 模式：按 adjudication-report.md 的格式返回裁决结果报告，不输出 Writer Brief。
        - 写作模式适合结构化汇报时，优先使用这些轻量 Markdown 标题：## 模拟结果、## 已修改文件、## Writer Brief、## Director Handoff、## 待确认。
        - 不适合结构化汇报时，可以自然回复，但仍要让调用方看懂本轮裁决、实际文件修改、可交给 writer / director 的信息和需要确认的问题。
    `;
}

function renderRuntimeInput(projectPath: string | undefined): string {
    return profileText`
        <simulator_leader_input>
        projectPath: ${projectPath?.trim() || "Current Workspace Focus"}
        simulationRoot: simulation/
        mode: 每轮任务 prompt 指定；profile initial 不保存稳定模式。
        </simulator_leader_input>
    `;
}
