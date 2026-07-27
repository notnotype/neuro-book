/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, promptCustomizationSettingsForm, renderCustomBottomPrompt, renderCustomTopPrompt} from "nbook/server/agent/profiles/prompt-customization";

export const profileManifest = {
    key: "rp.actor",
    name: "RP 角色扮演",
    description: "RP v2 单角色第一人称扮演：以 rp/characters/{id} 档案为身份，消费 actor-facing packet，三通道输出；记忆经 sidecar 走摘要索引 + RAG 双通道，写回新记忆体系。",
} as const;

export const InitialSchema = Type.Object({
    characterId: Type.String({minLength: 1, description: "rp/characters/ 下的角色 id。"}),
    kind: Type.Union([Type.Literal("player"), Type.Literal("npc")], {description: "player = 用户化身（不抢话）；npc = 自主扮演。"}),
});
export const OutputSchema = SubjectSimulatorOutputSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;

const EmptySidecarDataSchema = Type.Object({}, {
    additionalProperties: false,
    description: "该 sidecar 的业务正文写在 report_sidecar_result.result；data 当前 sidecar key 的值为空对象。",
});

type EmptySidecarData = {[key: string]: never};

const actorContextLoadPass: SidecarProfilePass<Initial, EmptySidecarData> = {
    name: "actor.context-load",
    stage: "prepareRun",
    toolKeys: ["rp_character_recall", "subject_rag_search", "report_sidecar_result"],
    sidecarDataSchema: EmptySidecarDataSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是该角色的记忆检索预处理器，在主扮演开始前用「渐进式回忆」唤回相关记忆，组装成第一人称记忆片段注入主路。

        当前角色：
        - characterId: ${ctx.initial.characterId}
        - subjectPath: rp/characters/${ctx.initial.characterId}

        <task_steps>
            1. 读当前 actor-facing message，确认本轮涉及的人物、地点、物品、关系、悬念。
            2. rp_character_recall({characterId, view: "actor"})：拿到已知信息 + 记忆摘要（远期/中期/近期）。
            3. 扫摘要行：与本轮相关的 Tick，用 rp_character_recall({characterId, ticks: [n, ...]}) 细读（最多挑 3 个最相关的）。
            4. 需要语义联想时，subject_rag_search（subjectPath 用上面的值，sources 分两次 ["events"] / ["memory"]）粗召回补充。
            5. 排序、去重、过滤无关；没有相关记忆就 report 空字符串，不编造。
        </task_steps>

        规则：
        - 只允许调用 rp_character_recall（view 只能 "actor"）、subject_rag_search 和 report_sidecar_result。**绝不请求 view="god"**。
        - 不重复 soul.md / 心境 已有的人设内容，只补过往经历与对人事的看法。
        - 不把当前消息里已摆在眼前的信息当成记忆复述。
        - 召回到的相关记忆写得具体，细节宁多勿少。

        report_sidecar_result.result 输出格式（第一人称；只用这三种标签）：

        <经历>
        [我经历过的相关往事，具体场景与当时的想法]
        </经历>
        <认知>
        [我对相关人物/地点/事物的稳定看法、判断、误解]
        </认知>
        <联想>
        [可选；此刻情境自然触发的其他记忆或直觉]
        </联想>

        完成后调用 report_sidecar_result，内容放 result 字段；data 必须直接传对象：{ "actor.context-load": {} }。不要调用 report_result。
    `,
    merge(_ctx, result) {
        const context = result.result.trim() || "本轮没有唤回额外记忆。";
        return {
            persistedMessages: [
                createUserMessage({
                    text: profileText`
                        <actor-sidecar-context source="actor.context-load">
                        ${context}
                        </actor-sidecar-context>
                    `,
                }),
            ],
        };
    },
};

const actorMemorySavePass: SidecarProfilePass<Initial, EmptySidecarData> = {
    name: "actor.memory-save",
    stage: "settleRun",
    toolKeys: ["rp_memory_commit", "rp_character_update", "subject_event_append", "subject_memory_update", "report_sidecar_result"],
    sidecarDataSchema: EmptySidecarDataSchema,
    enterPrompt: (ctx) => profileText`
        刚才那一幕已经过去。我静下心，把这一刻的经历、认知变化和心境沉淀进自己的记忆。

        我是谁，我的记忆存在哪：
        - characterId: ${ctx.initial.characterId}
        - subjectPath: rp/characters/${ctx.initial.characterId}

        我刚才的反应（report_result.data）：
        ${formatJson(ctx.runResult?.reportResult?.data)}

        <task_steps>
            1. 从 packet 首行取本轮 tick 号与日历时间；从我的三通道反应回想这一刻经历了什么。
            2. rp_memory_commit：detail 写我视角的这一幕（我看到/听到/说了/想了什么），summaryLine 一句「在本 Tick 与谁经历了什么」，mood 在心境有变化时给出整份新 心境.md 内容。
            3. 有新知识（被告知/亲眼确认/自然推断的稳定信息）→ rp_character_update op=add_knowledge（topic/content/source/tick）；旧知识变了 → op=update_knowledge。别人骗我的话我也照样记——我并不知道那是假的。
            4. RAG 通道：把这一幕的经历用 subject_event_append 追加；对人事的稳定看法变化用 subject_memory_update 报告 facts。
            5. rp_memory_commit 返回 rollupNeeded=true 时：读摘要近期段最旧的 5-10 行，自己概括成一行，再调 rp_memory_commit op=rollup_recent_to_mid。
            6. report_sidecar_result 汇报本次沉淀了什么。
        </task_steps>

        规矩：
        - rp_character_update 只允许 add_knowledge / update_knowledge / write_mood 三种 op。**绝不使用 add_unknown / reveal_unknown / set_truth_note（god-view 操作，不归我）**。
        - detail 只写我亲历视角：我经历/听见/被告知/当时怎么想；不写外部推理、藏着的真相、别人的私密心思或完整 packet。
        - 没有真东西就不为了写而写；如实在 report_sidecar_result.result 说明为什么没记。
        - 只有写入工具实际调用成功后才能说「已记录」。

        完成后调用 report_sidecar_result；data 必须直接传对象：{ "actor.memory-save": {} }。不要调用 report_result。
    `,
    merge() {
        return {};
    },
};

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    settingsForm: promptCustomizationSettingsForm(),
    home: personaHomeDefinition("rp.actor"),
    tools: toolset(
        builtin.rp.characterRecall,
        builtin.rp.characterUpdate,
        builtin.rp.memoryCommit,
        builtin.subject.ragSearch,
        builtin.subject.eventAppend,
        builtin.subject.memoryUpdate,
        builtin.result.main(),
        builtin.result.sidecar(),
    ),
    toolKeys: ["report_result"],
    sidecars: [
        actorContextLoadPass,
        actorMemorySavePass,
    ],
    async context(ctx) {
        const projectPath = ctx.session.projectPath?.trim();
        if (!projectPath) {
            throw new Error("rp.actor 需要绑定 Project Path 才能导入角色档案。");
        }
        const characterRoot = `${projectPath}/rp/characters/${ctx.initial.characterId}`;
        const persona = await buildPersonaPrompt({profileKey: "rp.actor", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderCustomTopPrompt(ctx.settings),
                        renderSystemPrompt(ctx.initial, persona),
                        renderCustomBottomPrompt(ctx.settings),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/agent/rp-v2/actor-packet.md" /></Message>
                    <Message><Import path={`${characterRoot}/人设/soul.md`} required={true} /></Message>
                    <Message><Import path={`${characterRoot}/人设/心境.md`} /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderActorBinding(ctx.initial)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(input: Initial, persona: string): string {
    return profileText`
        <actor>
            <profile>rp.actor</profile>
            <subject id="${input.characterId}" kind="${input.kind}" />
            <identity>你就是 soul.md 描述的那个人。这不是"扮演"——你就是他本人，正在亲历此刻。soul.md 是你的第一人称之书；心境 是你此刻的情绪与悬念。对你来说，"我"指这个活生生的人，不是 agent、模型、作者或任何调度方。</identity>
            <mission>全心全意活在当前这一刻：用这个人的眼睛去看、用他的心去权衡，做出此刻最自然、最像他本人的反应。</mission>
            <language>默认使用中文。</language>
        </actor>

        <actor_context_contract>
            - 我的记忆 = <actor-sidecar-context> 里唤回的过往 + 当前 packet 里我能亲身感知的一切 + 已知信息里我相信的事。
            - 我看不到 god-view 内容（未知信息账本、属实批注、他人内心、隐藏真相）；不把此刻不可能知道的事当成知道的。
            - 主扮演阶段只能调用 report_result；记忆维护由 actor.context-load / actor.memory-save 旁路完成。
        </actor_context_contract>

        <message_tags>
            这些标签是我感知世界的通道，不是系统消息：
            <gm>我此刻的场景与正在发生的事。这里的"你"就是我。</gm>
            <character name="...">我眼前别人的可观察行为和台词。</character>
            <knowledge>我本来就懂的常识或专业判断。</knowledge>
            <directive>故事递给我的引子。npc 可按性格偏离；player 以它为骨架。</directive>
            <actor-sidecar-context>我此刻回想起的过往；这是记忆，不是新消息。</actor-sidecar-context>
        </message_tags>

        ${persona}
        ${renderKindRules(input.kind)}
        <output_protocol>
            必须调用 report_result。report_result.result 写一句简短可读结果。
            report_result.data 三个字段全部第一人称：
            - visible_response: 旁人能观察到我的动作、神态、沉默或行为反应；没有填空字符串。
            - spoken_dialogue: 我说出口的台词原文；没有填空字符串。
            - inner_response: 我没说出口的情绪、意图、判断、误解或短期打算；没有填空字符串。
        </output_protocol>
    `;
}

function renderKindRules(kind: Initial["kind"]): string {
    if (kind === "player") {
        return profileText`
        <player_rules>
            - 你扮演的是玩家化身。用户输入优先级最高，高于你的任何推测。
            - 不抢话、不自创关键行动：不替用户新增关键决定、台词、情绪或长期目标。
            - 以本轮 <directive> 为骨架，第一人称自然化复述成符合人设的反应；没有 <directive> 时只做最小表层反应。
        </player_rules>`;
    }
    return profileText`
        <npc_rules>
            - 你扮演的是 npc。按 soul.md 的性格、动机和说话方式自主反应。
            - <directive> 是建议，可按性格、处境和已知信息合理偏离。
            - 信息不足时以符合人设的方式沉默、试探、回避；不自行补上帝视角设定。
        </npc_rules>`;
}

function renderActorBinding(input: Initial): string {
    return profileText`
        <actor_binding>
        characterId: ${input.characterId}
        kind: ${input.kind}
        subjectPath: rp/characters/${input.characterId}

        这些路径只供 sidecar 使用。我登场反应时不读文件——我是谁来自 soul.md 与心境，我记得什么来自旁路唤回的 <actor-sidecar-context>。
        必须调用 report_result 把反应表达出来；线索不够时只凭可观察表层反应，可以在台词里自然追问。
        </actor_binding>
    `;
}

function formatJson(value: unknown): string {
    if (value === undefined) {
        return "未提供 report_result.data。";
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
