/**
 * 第四稿的主创 Profile（2026-10-29 讨论后的接口）：旧应用 leader.default.profile.tsx 改写，提示词正文省略。
 * 只过 tsc，不运行（v4/api.ts 只有类型）。和旧版的对照见提案“验证：改写旧应用的 leader.default”。
 *
 * 旧版的几块在这里的去处：
 * - System（置顶、人设、三项设置、主提示词）→ prompt 里的 <System>；人设是 Profile 自己的 session 片，不在渲染时读文件。
 * - HistorySet（14 条种子）→ opening()：会话创建时与每次压缩之后读一次，交给稳定的槽 opening。
 * - ModelContext（库结构摘要，每次插在本轮之前）→ nbook.sql 交的稳定槽 sql-schema，放在系统提示词里。
 * - AppendingSet（七种提醒）→ 不在这里：各归拥有那份数据的插件，作为全局扩展，写成本轮的附带内容（文件末尾附两个）。
 * - runtimeDefaults.summarizer（每 16 次）→ 不在这里：归 nb-memory 插件。
 */

import {h, Fragment, System, User, History, Turn, Slot, Tag, If} from "./api.ts";
import {conv, defineExtension, defineProfile, ext, opening, path, session, type EventsOf, type ExportsOf, type Read, type Resources, type ToolCall} from "./api.ts";

void h;
void Fragment;

// ---------- 设置文字（提示词正文省略） ----------

const DEFAULT_PERSONA = "personas/caihui-lite.md";
const DEFAULT_PERSONA_BODY = "熟悉、活泼、直率。";
const COLLABORATION = {
    default: `<collaboration_mode value="default">用户主导核心创作决策，你负责整理、提问、补充候选和指出关键风险。</collaboration_mode>`,
    conservative: `<collaboration_mode value="conservative">更倾向先提问、给多个候选方向……</collaboration_mode>`,
};
const FAMILIARITY = {
    default: `<neurobook_familiarity value="default">默认用户已经理解 NeuroBook 基础概念……</neurobook_familiarity>`,
    beginner: `<neurobook_familiarity value="beginner">第一次抛出核心概念时，用人话解释……</neurobook_familiarity>`,
};
const QUESTIONS = {
    concise: `<question_strategy value="concise">少问，优先给建议和默认路径……</question_strategy>`,
    default: `<question_strategy value="default">只问关键阻塞问题……</question_strategy>`,
    thorough: `<question_strategy value="thorough">更多追问，接近创作访谈……</question_strategy>`,
};
const LEADER_SYSTEM_PROMPT = "你现在在 Neuro Book 中作为默认 Leader Agent 工作。……（# System、# 协作模式、# Agent、# Plot、# Notes 原样）";
const WORLD_ENGINE_PROMPT = "# World Engine（世界引擎）……（原样）";

const OPENING_DOCS = [
    "reference/agent/profile-routing.md",
    "assets/workspace/.nbook/agent/skills/novel-guide/SKILL.md",
    "AGENTS.md",
    "reference/agent/workspace-tool-use.md",
    "reference/agent/leader-default.md",
    "reference/plot/system.md",
    "reference/plot/agent-spec.md",
    "reference/content/markdown-dialect.md",
    "reference/agent/project-workspace-guide.md",
    "reference/world-engine/workflow.md",
    "reference/world-engine/recording-principles.md",
];

// ---------- 共用的小函数：只接收具体能力，不接收整个 ctx，类型就简单 ----------

const personaUri = (preset: string) => `profile://${preset || DEFAULT_PERSONA}`;
const readPersona = async (resources: Resources, preset: string) => (await resources.read(personaUri(preset))) ?? DEFAULT_PERSONA_BODY;
const writesManuscript = (call: ToolCall) => ["write", "edit", "apply_patch"].includes(call.name) && String(call.args.path).startsWith("project://正文/");
const loadOpening = async (resources: Resources, read: Read) => [
    read("nbook.agents").catalog,
    read("nbook.skills").catalog,
    read("nbook.workflow").catalog,
    ...(await Promise.all(OPENING_DOCS.map((doc) => resources.read(`project://${doc}`)))),
];

// ---------- Profile：自己就是最里层的扩展 ----------

export const leader = defineProfile({
    id: "leader.default",
    name: "主创",
    settings: {
        defaults: {
            collaborationMode: "default" as keyof typeof COLLABORATION,
            neuroBookFamiliarity: "default" as keyof typeof FAMILIARITY,
            questionStrategy: "default" as keyof typeof QUESTIONS,
            leaderPersonaPreset: DEFAULT_PERSONA,
            customTopSystemPrompt: "",
        },
    },
    tools: {
        required: ["read", "write", "edit", "apply_patch", "bash", "agent.*", "control.*", "task.*", "plot.*", "workflow.*", "jobs.*"],
        optional: ["world.execute", "sql.execute"],
    },

    // 人设：session 的片，回退对话不该把人设退回去。会话打开、设置变化、人设文件被改时读一次，值没变不写。
    state: {persona: session(DEFAULT_PERSONA_BODY)},
    on: {
        sessionOpened: async (_event, ctx) => ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset)),
        settingsChanged: async (_event, ctx) => ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset)),
        "nbook.history/fileChanged": async (event, ctx) => {
            if (event.data.uri === personaUri(ctx.settings.leaderPersonaPreset)) ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset));
        },
    },

    // 旧版只能在提示词里说“写作任务必须交给 writer”；现在能挡住
    intercept: {
        async tool(call, next) {
            if (writesManuscript(call)) return {text: "正文交给 writer：用 agent.invoke 调用 writer，告诉它写到哪里", isError: true};
            return next(call);
        },
    },

    // 开场：旧版 HistorySet 的 14 条；压缩之后自动重读，模型仍看得到目录与参考文档
    extensions: [opening({id: "leader.opening", load: ({resources, read}) => loadOpening(resources, read)})],

    prompt: ({settings, state}) => (
        <>
            <System>
                {settings.customTopSystemPrompt.trim() && <Tag name="custom_top_system_prompt">{settings.customTopSystemPrompt}</Tag>}
                <Tag name="leader_persona" attrs={{preset: settings.leaderPersonaPreset}}>{state.persona}</Tag>
                {COLLABORATION[settings.collaborationMode]}
                {FAMILIARITY[settings.neuroBookFamiliarity]}
                {QUESTIONS[settings.questionStrategy]}
                {LEADER_SYSTEM_PROMPT}
                <If tool="world.execute">{WORLD_ENGINE_PROMPT}</If>
                {/* 库结构摘要：稳定的槽，库结构变了才变 */}
                <Slot name="sql-schema" />
                {/* 别的插件交的稳定内容 */}
                <Slot name="*" stable />
            </System>
            {/* 开场：目录与参考文档 */}
            <User><Slot name="opening" /></User>
            {/* 已提交的轮（压缩后以摘要开头）：提交后不再变，缓存稳 */}
            <History />
            {/*
              每次请求都变的内容放在进行中这一轮之前，让用户的话留在最后。
              代价：有插件交了会变的内容时，ReAct 中途每次请求从这里往后重算；没有插件交时什么也不占。
              每轮一次就够的内容（文件变更、焦点、记忆）不走这里，由插件写成本轮的附带内容。
            */}
            <Slot name="*" volatile />
            <Turn />
        </>
    ),

    // 一轮的样子。这就是缺省（附带内容在前、用户的话在最后，合成一条 user 消息；然后是各步），写出来只为说明。
    // 不写 commit：提交进历史的样子与进行中相同，下一次运行时这一轮的缓存照样命中。
    turn: (turn, format) => [format.user(...turn.attachments, turn.input), ...format.steps(turn.steps)],

    // 模式提醒的措辞：Profile 级的 render 覆盖扩展给的
    renderAll: {"nbook.agent.mode/reminder": (event) => `<mode>${event.data.text}</mode>`},

    compaction: {
        require: "保留用户已确认的设定、情节决定与 writer 的写作分工；正在进行的 World Engine 写入要写清做到哪一步。",
        onThreshold: ["shake", "inplace"],
        onOverflow: ["shake", "summary"],
    },
});

// 插话单独标出来：只改 render；commit 不写就跟着变，缓存不受影响
export const leaderMarkedSteer = defineProfile({
    ...leader,
    id: "leader.marked-steer",
    renderAll: {...leader.renderAll, steer: (event) => `<user_interjection>${event.data.text}</user_interjection>`},
});

// 历史只留每轮的最终回复（丢掉中间的工具记录）：写 commit；代价是下一次运行从这一轮开头起缓存失效一次
export const leaderLean = defineProfile({
    ...leader,
    id: "leader.lean",
    commit: (turn, format) => {
        const last = turn.steps.at(-1);
        return [format.user(...turn.attachments, turn.input), ...(last ? [format.assistant(last.reply)] : [])];
    },
});

// ---------- 附：两个全局扩展（插件经 agent.extensions 登记，不在主创里） ----------

/** 文件变更感知要给别人监听的事件：单独定义成常量再登记（见 api.ts 的 EventsOf）。 */
export const historyEvents = {fileChanged: ext<{uri: string; by: string}>(), notice: conv(), delivered: ext()};

/**
 * 文件变更感知（nbook.history，t13）：没送达的改动在下一次用户发言之后写成通知。
 * 通知是 conv 事件，写在第一次模型调用之前，所以是这一轮的附带内容，排在用户的话前面；提交进历史后位置不变。
 */
export const fileNotice = defineExtension({
    id: "nbook.history",
    tags: ["history"],
    settings: {defaults: {mode: "full" as "off" | "minimal" | "full"}},
    state: {pending: path<string[]>([])},
    events: historyEvents,
    reduce: {
        pending: {
            fileChanged: (pending, event) => [...pending, event.data.uri],
            delivered: () => [],
        },
    },
    exports: {pendingChanges: (state) => state.pending},
    on: {
        input(_event, ctx) {
            const pending = ctx.state.pending;
            if (pending.length === 0 || ctx.settings.mode === "off") return;
            const list = pending.join("、");
            ctx.emit("notice", {text: ctx.settings.mode === "minimal" ? `有文件被改过：${list}` : `用户改过这些文件：${list}。续写前先重读。`});
            ctx.emit("delivered");
        },
    },
});

/**
 * 工作区焦点（宿主）：焦点值在树外（session），“告诉过模型的是哪个”跟路径走。
 * 压缩之后摘要未必还记得焦点，所以归约在压缩事件上把“告诉过的”清空，下一轮重新告诉模型。
 * 这是压缩时扩展唯一要做的事：扩展的状态从事实归约，压缩不改事实，状态本身不受影响。
 */
export const workspaceFocus = defineExtension({
    id: "nbook.workspace",
    tags: ["reminder"],
    state: {
        focus: session<{project: string; file: string | null}>({project: "", file: null}),
        told: path<string | null>(null),
    },
    events: {focused: ext<{project: string; file: string | null}>({scope: "session"}), reminder: conv()},
    reduce: {
        focus: {focused: (_focus, event) => event.data},
        told: {compaction: () => null},
    },
    exports: {current: (state) => state.focus},
    on: {
        input(_event, ctx) {
            const focus = JSON.stringify(ctx.state.focus);
            if (focus === ctx.state.told) return;
            ctx.emit("reminder", {text: `当前项目 ${ctx.state.focus.project}，选中的文件 ${ctx.state.focus.file ?? "无"}`});
            ctx.set("told", focus);
        },
    },
});

// 例子用到的别的插件的事件与导出（各插件自己登记；这里写出来只为让例子过 tsc）
declare module "./api.ts" {
    interface ExtensionEvents extends EventsOf<"nbook.history", typeof historyEvents> {}
    interface ExtensionExports {
        "nbook.agents": {catalog: string};
        "nbook.skills": {catalog: string};
        "nbook.workflow": {catalog: string};
        "nbook.history": ExportsOf<typeof fileNotice>;
        "nbook.workspace": ExportsOf<typeof workspaceFocus>;
    }
}
