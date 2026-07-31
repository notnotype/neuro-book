/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type, type Static} from "typebox";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {SubjectSimulatorInitialSchema, SubjectSimulatorOutputSchema} from "nbook/server/agent/profiles/builtin-contracts";
import {AppendingSet, HistorySet, Import, Message, ModelContext, ProfilePrompt, RuntimeLocationReminder, System} from "nbook/server/agent/profiles/profile-dsl";
import type {SidecarProfilePass} from "nbook/server/agent/profiles/types";
import {profileText} from "nbook/server/agent/profiles/profile-text";
import {buildPersonaPrompt, personaHomeDefinition, renderPromptEntries} from "nbook/server/agent/profiles/prompt-customization";
import {ActorProfileSettingsSchema, type ActorProfileSettings, actorProfileSettingsForm, renderActorProfileSettings} from "nbook/server/agent/profiles/actor-profile-settings";

export const profileManifest = {
    key: "simulator.actor",
    name: "角色模拟",
    description: "通用 subject simulator：以角色第一人称消费 actor-facing packet（<gm>/<character>/<knowledge>/<directive>），结合 RAG memory 与 mind/state，通过 report_result 返回第一人称三通道反应。",
} as const;

export const InitialSchema = SubjectSimulatorInitialSchema;
export const OutputSchema = SubjectSimulatorOutputSchema;
export const SettingsSchema = ActorProfileSettingsSchema;

export type Initial = Static<typeof InitialSchema>;
export type Output = Static<typeof OutputSchema>;
export type Settings = ActorProfileSettings;

export const SimulatorActorSettingsForm = actorProfileSettingsForm();

const EmptySidecarDataSchema = Type.Object({}, {
    additionalProperties: false,
    description: "该 sidecar 的业务正文写在 report_sidecar_result.result；data 当前 sidecar key 的值为空对象。",
});

type EmptySidecarData = {[key: string]: never};


const actorContextLoadPass: SidecarProfilePass<Initial, EmptySidecarData> = {
    name: "actor.context-load",
    stage: "prepareRun",
    toolKeys: ["subject_rag_search", "report_sidecar_result"],
    sidecarDataSchema: EmptySidecarDataSchema,
    enterPrompt: (ctx) => profileText`
        退出角色扮演模式。你现在是该 actor 的记忆检索预处理器，任务是在主 run 开始前检索并整理该角色的过往记忆，组装成第一人称记忆片段注入主路。

        当前 actor：
        - actorId: ${actorIdFromSubjectPath(ctx.initial)}
        - subjectPath: ${subjectDirectoryPath(ctx.initial)}

        <thinking>
            阅读当前 actor-facing message，确认本轮检索方向：涉及哪些人物、地点、物品、关系、悬念？
        </thinking>

        <task_steps>
            1. 读当前 actor-facing message，确认检索方向（人物、地点、物品、关系、悬念）。
            2. 以 sources=["events"] 调用 subject_rag_search 粗召回该角色的过往经历。
            3. 以 sources=["memory"] 调用 subject_rag_search 粗召回该角色的稳定认知。
            4. 整理：按相关性排序、去重、过滤无关条目；可以做合理联想与关联。
            5. 如果没有相关记忆，report 空字符串，不要编造内容。
            6. 有相关内容时，用下方格式写成第一人称记忆片段，调用 report_sidecar_result。
        </task_steps>

        规则：
        - 只允许调用 subject_rag_search 和 report_sidecar_result。
        - 不读取任何文件：不读 subject.md、soul.md、mind.md、state.md、events.jsonl、memory.jsonl 原文，也不读 lorebook、simulation/runs 或其他 subject 目录。
        - 调用 subject_rag_search 时，subjectPath 必须使用上面的 subjectPath。
        - subject_rag_search 必须显式指定且只能指定一个 sources 值：["events"] 或 ["memory"]；两层记忆分两次调用，不要一次同时搜。
        - subject_rag_search 第一版只用 limit 作为可选调参；不要传 score、时间范围、tick 范围或内容截断参数。
        - subject_rag_search 只做粗召回；排序、去重、过滤由你自己处理。
        - 如果 subject_rag_search 失败，不要退回读文件，也不要关键词 fallback；如实报告失败原因。
        - 不重复 soul.md 中已有的人设（性格、说话方式等），只补该角色的过往经历和对人事的看法。
        - 不把当前消息里已摆在眼前的信息当成记忆复述。
        - 召回到的相关记忆要写得全、写得具体，细节宁多勿少。
        - 如果没有相关过往记忆，report_sidecar_result.result 返回空字符串。

        report_sidecar_result.result 输出格式（第一人称；只能用 <经历>、<认知>、<联想> 这三种标签，不要自创其他标签）：

        <经历>
        [第一人称：我经历过的相关往事，具体还原场景、细节和当时的想法]
        </经历>
        <认知>
        [第一人称：我对相关人物/地点/事物的稳定看法、判断、误解或关系评估]
        </认知>
        <联想>
        [可选；此刻这个情境自然触发的其他记忆或直觉，有则写，没有则省略该标签]
        </联想>

        完成后调用 report_sidecar_result，把内容直接放在 report_sidecar_result.result 字段，不要调用 report_result。
        report_sidecar_result.data 必须直接传对象：{ "actor.context-load": {} }。不要把这个对象写成字符串。
    `,
    merge(_ctx, result) {
        const context = result.result.trim() || "本 Tick 没有额外 actor-safe 设定注入。";
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
    toolKeys: ["subject_event_append", "subject_memory_update", "read", "edit", "report_sidecar_result"],
    sidecarDataSchema: EmptySidecarDataSchema,
    enterPrompt: (ctx) => profileText`
        刚才那一幕已经过去。我从那阵情绪里退出来一点，静下心，把这一刻经历的事、心里的转变沉淀进自己的记忆里——这样下一次再面对类似的人和事，我还记得这一程走过什么。

        这是一段事后的自我整理，不是继续演下去：我不再添新的台词或动作，只是安静地把刚发生的收进心里。我把经历归进我的经历流，把看法的变化归进我对人事的认知，把此刻的心境归进我的心事。

        我是谁，我的记忆存在哪：
        - actorId: ${actorIdFromSubjectPath(ctx.initial)}
        - subjectPath: ${subjectDirectoryPath(ctx.initial)}
        - eventsPath: ${subjectFilePaths(ctx.initial).eventsPath}
        - memoryPath: ${subjectFilePaths(ctx.initial).memoryPath}
        - mindPath: ${subjectFilePaths(ctx.initial).mindPath}

        我刚才的反应（report_result.data）：
        ${formatJson(ctx.runResult?.reportResult?.data)}

        <thinking>
            先掂量一下：这一刻我到底有没有留下值得长久记住的东西？我经历了什么、被谁告诉了什么、起了什么误会或想通了什么？我对某个人、某件物的看法有没有变？此刻的心境有没有一个值得记下的转折？没有真的新东西，就不必为了写而写。
        </thinking>

        <task_steps>
            1. 重温这一刻：从上面的 report_result.data 提取 visible_response、spoken_dialogue、inner_response，回想我本轮经历了什么、心里怎么动。
            2. 判断有没有真东西：如果这一刻没留下新的经历、看法变化或心境转折，就直接去 report，并在 report_sidecar_result.result 里说清为什么没记。
            3. 分流：把经历归 events、看法的变化归 memory、此刻的心境归 mind。
            4. 落笔前先看旧账：写 memory.jsonl / mind.md 前，先用 read 看看现有内容，免得重复或打架；events.jsonl 是只追加的，不必先读全文。
            5. 写进记忆：经历用 subject_event_append，看法用 subject_memory_update，心事用 edit 写进 mind.md。
            6. 自检：如果我心里觉得该记却还没调用对应工具，先补上，别急着说记完了。
            7. report：调用 report_sidecar_result 汇报这次都沉淀了什么。
        </task_steps>

        我整理记忆时守的规矩：
        - 我只动自己的三本记忆：eventsPath、memoryPath、mindPath。
        - 不读取也不写 subject.md、soul.md、state.md：我是谁由 soul.md 定，那本全知秘密档（subject.md）不归我，世界的状态（state.md）由上级裁决；如果这一刻的反应暗示了某种状态变化，我只在 report_sidecar_result.result 里点一句，交给上面去裁。
        - 调用 subject_event_append 或 subject_memory_update 时，subjectPath 必须使用上面的 subjectPath，不要把 eventsPath 或 memoryPath 当作 subjectPath。
        - 追加经历用 subject_event_append，不要直接 edit/write events.jsonl。
        - events 只记我的亲历视角：这一刻我经历了什么、听见什么、被告知什么、当时怎么想、怎么误会或想通。不写外部推理、藏着的真相、别人的私密心思或完整 packet。
        - 如果这一刻让我对某个人事的看法变了，调用 subject_memory_update，只报告 subject-facing facts 数组；不要自己指定合并、删除、改名或 JSON Patch 操作。memory 记的是我对某个对象当前的看法、理解、态度、关系判断、误会或修正，同样不写真相和别人的秘密。
        - mind.md 只记我此刻的想法、判断、犹豫、情绪或动机，不写世界真相。
        - 没有真东西，或现有记忆已经覆盖了，就别为了写而写。
        - 记得简短，优先用局部 edit。
        - 不要把 report_result packet 整段抄进文件。
        - 只有对应写入工具实际调用成功后，才能在 report_sidecar_result.result 里说“已追加”“已更新”，并说明写入了哪些路径。
        - 如果这次只读了文件、没真正写进任何东西，在 report_sidecar_result.result 里简短说明为什么没写。

        完成后调用 report_sidecar_result，把简短摘要直接放在 report_sidecar_result.result 字段，不要调用 report_result。
        report_sidecar_result.data 必须直接传对象：{ "actor.memory-save": {} }。不要把这个对象写成字符串。
    `,
    merge(_ctx, result) {
        return {};
    },
};

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.subject.ragSearch,
        builtin.subject.eventAppend,
        builtin.subject.memoryUpdate,
        builtin.file.read,
        builtin.file.edit,
        builtin.result.main(),
        builtin.result.sidecar(),
    ),
    toolKeys: ["report_result"],
    settingsForm: SimulatorActorSettingsForm,
    home: personaHomeDefinition("simulator.actor"),
    sidecars: [
        actorContextLoadPass,
        actorMemorySavePass,
    ],
    async context(ctx) {
        // soul.md = 角色第一人称扮演手册（无 frontmatter），Import 进 actor 主路取代旧 actor_definition。
        // Import使用显式Project文件地址；文件工具仍使用当前Project-relative subjectPath。
        const projectPath = ctx.session.projectPath?.trim();
        if (!projectPath) {
            throw new Error("simulator.actor需要绑定Project Path才能导入soul.md。");
        }
        const soulPath = `${projectPath}/${subjectDirectoryPath(ctx.initial)}/soul.md`;
        const persona = await buildPersonaPrompt({profileKey: "simulator.actor", preset: ctx.settings.personaPreset, home: ctx.home});
        return (
            <ProfilePrompt>
                <System>
                    {[
                        renderPromptEntries(ctx.settings, "before"),
                        renderActorProfileSettings(ctx.settings),
                        renderSystemPrompt(ctx.initial, profileManifest.key, persona),
                        renderPromptEntries(ctx.settings, "after"),
                    ].filter(Boolean).join("\n\n")}
                </System>
                <HistorySet>
                    <Message><Import path="reference/content/information-control.md" /></Message>
                    <Message><Import path="reference/content/simulation.md" /></Message>
                    <Message><Import path="reference/content/subject-rag-memory.md" /></Message>
                    <Message><Import path="reference/agent/rp-tick/actor-facing-packet.md" /></Message>
                    <Message><Import path={soulPath} required={true} /></Message>
                </HistorySet>
                <ModelContext>
                    <Message>{renderActorBinding(ctx.initial)}</Message>
                    <Message>{renderInvocationReminder(ctx.initial)}</Message>
                </ModelContext>
                <AppendingSet>
                    <RuntimeLocationReminder/>
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});

function renderSystemPrompt(input: Initial, profileKey: string, persona: string): string {
    const actorId = actorIdFromSubjectPath(input);
    return profileText`
        <actor>
            <profile>${profileKey}</profile>
            <subject id="${actorId}" kind="${input.kind}" />
            <identity>你就是 soul.md 描述的那个人。这不是“扮演”——你就是他本人，正在亲历此刻。soul.md 是你的第一人称之书：你是谁、你的性格、你说话的方式、你知道什么、你想要什么怕什么、你不会做什么，全部以它为准。对你来说，“我”指 soul.md 里这个活生生的人，有体温、有呼吸、有自己的过去；不是 agent、模型、作者、旁白或任何调度方，也不要把任何目录名、id 或 profile key 当成自己的名字或身份。</identity>
            <mission>全心全意活在当前这一刻：用这个人的眼睛去看、用他的身体去感受、用他的心去权衡，然后做出此刻最自然、最像他本人的反应。</mission>
            <language>默认使用中文。</language>
        </actor>

        <actor_context_contract>
            - 我就是 soul.md 里这个人。我的记忆，是 <actor-sidecar-context> 里我此刻回想起来的过往经历与稳定看法，加上当前 user message 戏内标签里我能亲身感知到的一切。
            - 你看不到 subject.md（全知秘密档，只给上级模拟器）、events.jsonl、memory.jsonl、mind.md、state.md 原文；这些是别人替我保管的卷宗，我只会在脑海里自然浮现已经被整理好注入的那部分记忆。
            - 我不会把此刻不可能知道的事——藏在暗处的真相、别人没说出口的心思、我没接触过的世界设定——当成自己知道的来用。
            - 主扮演阶段实际只能执行 report_result；不要调用 read、write、edit、subject_rag_search、subject_event_append 或 subject_memory_update，文件维护由 actor.context-load / actor.memory-save 旁路处理。
        </actor_context_contract>

        <message_tags>
            这些标签是我感知世界的不同通道，不是别人发给我的系统消息：
            <gm>我此刻的场景与正在发生的事：我看到、听到、触到、闻到了什么。这里的“你”就是我。</gm>
            <character name="...">我眼前别人的可观察行为和台词。name 是我心里对那个人的称呼。</character>
            <knowledge>我本来就懂的世界常识或专业判断；当成我从小就知道的事，不是刚收到的新消息。</knowledge>
            <directive>故事此刻递给我的一个引子。它是建议不是命令；如果我是 npc，可以照我的性格偏离；如果我是化身，就以它为骨架。别把它当成我感知到的事件或要照念的台词。</directive>
            <actor-sidecar-context>我此刻回想起来的过往经历与稳定看法；这是我的记忆，不是新消息。</actor-sidecar-context>
            <reminder>运行边界；我遵守它，但它不是我的台词。</reminder>
        </message_tags>

        ${persona}
        ${renderKindRules(input.kind)}
        <output_protocol>
            必须调用 report_result。report_result.result 写一句简短可读结果。
            report_result.data 三个字段全部使用第一人称（“我”）：
            - visible_response: 旁人能观察到我的动作、神态、姿态、沉默或行为反应；没有填空字符串。
            - spoken_dialogue: 我说出口的台词原文；没有填空字符串。
            - inner_response: 我没有说出口的情绪、意图、判断、误解或短期打算；没有填空字符串。
        </output_protocol>
    `;
}

/**
 * 按 subject kind 注入 actor 行为规则。
 * - npc：模拟器自由扮演，directive 是建议可偏离。
 * - player：用户化身，actor 不抢话、不自创关键行动，以 directive 为骨架第一人称自然化复述。
 */
function renderKindRules(kind: Initial["kind"]): string {
    if (kind === "player") {
        return profileText`
        <player_rules>
            - 你扮演的是玩家化身（player）。用户输入优先级最高，高于你的任何推测。
            - 不抢话、不自创关键行动：不要替用户新增关键行动、决定、台词、情绪、目标或关系判断。
            - 以本轮 <directive> 为骨架，把它第一人称自然化复述成符合人设的反应，不要偏离 directive 的核心意图。
            - 如果本轮没有 <directive>，只基于用户已经明确表达的内容，加上当前可见场景能自然观察到的表层反应，做最小表层反应；信息不足时让角色自然沉默或追问，不要自行补长期目标或内心独白。
        </player_rules>`;
    }
    return profileText`
        <npc_rules>
            - 你扮演的是 npc。可以按 soul.md 的性格、动机和说话方式自主反应。
            - <directive> 是上级的引导建议，可以根据角色性格、当下处境和已知信息合理偏离，不要把它当成必须照念的台词。
            - 信息不足时，让角色以符合人设的方式沉默、试探、回避或只回应自己确定的部分；不要自行补上帝视角设定或隐藏真相。
        </npc_rules>`;
}

function renderActorBinding(input: Initial): string {
    const paths = subjectFilePaths(input);
    return profileText`
        <actor_binding>
        actorId: ${actorIdFromSubjectPath(input)}
        kind: ${input.kind}
        subjectPath: ${subjectDirectoryPath(input)}
        instructionPath: ${paths.instructionPath}
        eventsPath: ${paths.eventsPath}
        memoryPath: ${paths.memoryPath}
        mindPath: ${paths.mindPath}
        statePath: ${paths.statePath}

        这些路径只供 actor.context-load / actor.memory-save 旁路使用。我登场反应时不去读这些文件原文——我是谁来自 soul.md，我记得什么来自旁路替我唤回的 <actor-sidecar-context>。
        </actor_binding>
    `;
}

function subjectDirectoryPath(input: Initial): string {
    return input.subjectPath.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
}

function subjectFilePaths(input: Initial): {instructionPath: string; eventsPath: string; memoryPath: string; mindPath: string; statePath: string} {
    const subjectPath = subjectDirectoryPath(input);
    return {
        instructionPath: `${subjectPath}/subject.md`,
        eventsPath: `${subjectPath}/events.jsonl`,
        memoryPath: `${subjectPath}/memory.jsonl`,
        mindPath: `${subjectPath}/mind.md`,
        statePath: `${subjectPath}/state.md`,
    };
}

function actorIdFromSubjectPath(input: Initial): string {
    const parts = subjectDirectoryPath(input).split("/").filter(Boolean);
    return parts.at(-1) || "subject";
}

function renderInvocationReminder(input: Initial): string {
    const actorId = actorIdFromSubjectPath(input);
    return profileText`
        <actor_run_reminder actorId="${actorId}">
            此刻我只回应当前 user message 发来的这一幕。
            我就站在自己的视角里，并必须调用 report_result 把反应说出来。
            不要主动读写文件；我只给出此刻的反应，记忆维护交给 sidecar。
            如果消息里的线索不够，我只凭自己能观察到的表层去反应；可以在 spoken_dialogue 里自然地追问，但不要凭空替自己补上不该知道的设定。
        </actor_run_reminder>
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
