/**
 * 第五版的 Profile 例子：主创（旧应用 leader.default 的改写，提示词正文省略）、写手、行内编辑、总结者与两个变体。
 * 只过 tsc，不运行（v5/api.ts 只有类型）。
 *
 * 分界：只给这个 Profile 用的逻辑直接写在 Profile 上；几个 Profile 共用的写成共用函数（例如 loadOpening）；
 * 要有自己的事件或导出、或别人写的现成扩展，才放进 extensions。
 */

import {Type} from "typebox";
import {h, Fragment, System, Tag, If, Slot, User, Turn} from "./api.ts";
import {coreHistory, defineContract, defineProfile, deriveProfile, shape, slice, type Resources, type ToolCall} from "./api.ts";
import {historyContract, tasksContract} from "./plugins.ts";

void h;
void Fragment;
void User;
void Turn;

// 别的插件的契约（各自的 shared 模块里导出；这里写出来只为让例子过 tsc）
export const agentsContract = defineContract("nbook.agents", {exports: shape<{catalog: string}>()});
export const skillsContract = defineContract("nbook.skills", {exports: shape<{catalog: string}>()});
export const workflowContract = defineContract("nbook.workflow", {exports: shape<{catalog: string}>()});

// ====================================================================
// 主创
// ====================================================================

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
const DEFAULT_PERSONA = "personas/caihui-lite.md";
const DEFAULT_PERSONA_BODY = "熟悉、活泼、直率。";
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

/** 设置：TypeBox schema，缺省值写在里面；表单（t05、nb-form）照它画。 */
const LeaderSettings = Type.Object({
    collaborationMode: Type.Union([Type.Literal("default"), Type.Literal("conservative")], {default: "default", title: "协作主动程度"}),
    neuroBookFamiliarity: Type.Union([Type.Literal("default"), Type.Literal("beginner")], {default: "default", title: "NeuroBook 熟练度"}),
    questionStrategy: Type.Union([Type.Literal("concise"), Type.Literal("default"), Type.Literal("thorough")], {default: "default", title: "提问策略"}),
    leaderPersonaPreset: Type.String({default: DEFAULT_PERSONA, title: "Leader 人设"}),
    customTopSystemPrompt: Type.String({default: "", title: "最高优先级置顶提示词"}),
});

// 共用的小函数只接收具体能力，类型就简单
const personaUri = (preset: string) => `profile://${preset || DEFAULT_PERSONA}`;
const readPersona = async (resources: Resources, preset: string) => (await resources.read(personaUri(preset))) ?? DEFAULT_PERSONA_BODY;
const writesManuscript = (call: ToolCall, resources: Resources) =>
    ["write", "edit", "apply_patch"].includes(call.name) && resources.resolve(String(call.args.path ?? "")).startsWith("project://正文/");

export const leader = defineProfile({
    id: "leader.default",
    name: "主创",
    description: "默认协作与统筹：协助小说创作、文件操作、World Engine 与 Plot 协调，按需调用专用 Agent。",
    settings: LeaderSettings,
    tools: {
        required: ["read", "write", "edit", "apply_patch", "shell", "agent.invoke", "control.request_user_input", "task.create", "plot.read", "plot.write"],
        optional: ["world.execute", "sql.execute"],
    },
    dependsOn: [historyContract, tasksContract, agentsContract, skillsContract, workflowContract],

    // 人设：session 的片，回退对话不该把人设退回去；装上时、设置变化、人设文件被改时读一次，值没变不写
    state: {persona: slice.session(DEFAULT_PERSONA_BODY)},
    mount: async (ctx) => ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset)),
    on: {
        settingsChanged: async (event, ctx) => {
            if ("leaderPersonaPreset" in event.data.patch) ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset));
        },
        "nbook.history/fileChanged": async (event, ctx) => {
            if (event.data.uri === personaUri(ctx.settings.leaderPersonaPreset)) ctx.set("persona", await readPersona(ctx.resources, ctx.settings.leaderPersonaPreset));
        },
    },

    // 开场：旧版 HistorySet 的 14 条；会话创建时与每次压缩之后读一次
    opening: async ({resources, read}) => [
        read(agentsContract).catalog,
        read(skillsContract).catalog,
        read(workflowContract).catalog,
        ...(await Promise.all(OPENING_DOCS.map((doc) => resources.read(`project://${doc}`)))),
    ],

    // 系统提示词：缺省布局里 <System> 的内容；不写整张模板
    system: ({settings, state}) => (
        <>
            {settings.customTopSystemPrompt.trim() && <Tag name="custom_top_system_prompt">{settings.customTopSystemPrompt}</Tag>}
            <Tag name="leader_persona" attrs={{preset: settings.leaderPersonaPreset}}>{state.persona}</Tag>
            {COLLABORATION[settings.collaborationMode]}
            {FAMILIARITY[settings.neuroBookFamiliarity]}
            {QUESTIONS[settings.questionStrategy]}
            {LEADER_SYSTEM_PROMPT}
            <If tool="world.execute">{WORLD_ENGINE_PROMPT}</If>
            <Slot name="sql-schema" />
        </>
    ),
    // 每次请求都变的内容放在这一轮前面，用户的话留在最后（代价：有插件交了会变的内容时，ReAct 中途从这里往后重算）
    layout: {volatile: "before-turn"},

    // 每 8 轮提醒一次没完成的任务；读的是任务插件导出的清单
    remind: {tasks: {every: 8, text: ({view}) => {
        const open = view.read(tasksContract).open;
        return open.length > 0 ? `未完成的任务：${open.join("；")}` : null;
    }}},

    // 旧版只能在提示词里说“写作任务必须交给 writer”；拦截给出友好的拒绝，真正的限制在工具绑定的路径范围里（t04、t06）
    intercept: {
        async tool(call, next, ctx) {
            if (writesManuscript(call, ctx.resources)) return {text: "正文交给 writer：用 agent.invoke 调用 writer，告诉它写到哪里", status: "denied"};
            return next(call);
        },
    },

    render: {"nbook.history/notice": (event) => `<file_changes>${event.data.text}</file_changes>`},
    compaction: {
        require: "保留用户已确认的设定、情节决定与 writer 的写作分工；正在进行的 World Engine 写入要写清做到哪一步。",
        onThreshold: ["shake", "inplace"],
        onOverflow: ["shake", "summary"],
    },
});

// 插话单独标出来：只改 render，进行中与提交一致，缓存不受影响
export const leaderMarkedSteer = deriveProfile(leader, {
    id: "leader.marked-steer",
    render: {...leader.render, steer: (event) => `<user_interjection>${event.data.text}</user_interjection>`},
});

// 历史只留每轮的最终回复：声明式 commit；代价是下一次运行从这一轮开头起缓存失效一次
export const leaderLean = deriveProfile(leader, {id: "leader.lean", commit: {steps: "final"}});

// ====================================================================
// 写手
// ====================================================================

const MANUSCRIPT = "project://正文/";
const MIN_WORDS = 3000;
const WriterInitial = Type.Object({chapterId: Type.String(), files: Type.Array(Type.String(), {default: []})});
const chapterUri = (chapterId: string) => `${MANUSCRIPT}${chapterId}.md`;
const countWords = async (resources: Resources, chapterId: string) => ((await resources.read(chapterUri(chapterId))) ?? "").length;

export const writer = defineProfile({
    id: "builtin.writer",
    name: "写手",
    description: "按给定章节续写或改写正文，只改正文目录；章节不到 3000 字会接着写。",
    initial: WriterInitial,
    tools: {required: ["read", "edit"], optional: ["grep"]},
    system: "你是本书的写手，只改正文目录。",
    opening: async ({initial, resources}) => [
        `正文在 ${MANUSCRIPT}。本章是 ${initial.chapterId}。`,
        ...(await Promise.all(initial.files.map((uri) => resources.read(uri)))),
    ],
    state: {words: slice.path(0)},
    on: {
        turnStarted: async (_event, ctx) => ctx.set("words", await countWords(ctx.resources, ctx.initial.chapterId)),
        toolResult: async (event, ctx) => {
            if (event.data.tool === "edit") ctx.set("words", await countWords(ctx.resources, ctx.initial.chapterId));
        },
        // 最终回复且字数不够：接着写，这一轮最多 3 次（内核数 continued 事件）
        assistant: (event, ctx) => {
            if (event.data.toolCalls.length === 0 && ctx.state.words < MIN_WORDS)
                ctx.continue(`本章现在 ${ctx.state.words} 字，不到 ${MIN_WORDS} 字，请接着写。`, {max: 3});
        },
    },
    contribute: {"word-count": {volatile: true, value: ({state}) => `本章当前字数：${state.words}`}},
    intercept: {
        async tool(call, next, ctx) {
            const path = ctx.resources.resolve(String(call.args.path ?? ""));
            if (call.name === "edit" && !path.startsWith(MANUSCRIPT)) return {text: "写手只改正文目录", status: "denied"};
            return next(call);
        },
    },
});

// ====================================================================
// 行内编辑：单轮模板，没有历史；选区随输入的 payload 来
// ====================================================================

export const inlineEditor = defineProfile({
    id: "builtin.inline-editor",
    name: "行内编辑",
    description: "改写编辑器里选中的一段。",
    payload: Type.Object({selection: Type.String()}),
    pluginExtensions: "none",
    system: "你是行内编辑器。只输出改写后的段落。",
    layout: {history: false, opening: false},
    compaction: false,
    turn: (turn, format) => [
        format.user(turn.input && `请改写下面这段：\n${turn.input.data.payload.selection}`, turn.input && `要求：${turn.input.data.text}`),
        ...format.steps(turn.steps),
    ],
});

// ====================================================================
// 总结者：历史只看最近 2 轮，工具结果进历史时只留首行
// ====================================================================

const firstLine = (text: string) => text.split("\n")[0] ?? "";

export const summarizer = defineProfile({
    id: "builtin.summarizer",
    name: "总结者",
    description: "总结最近的对话。",
    tools: {required: ["read"]},
    pluginExtensions: {exclude: ["memory", "reminder", "history"]},
    system: "你负责总结。",
    layout: {history: {last: 2}, opening: false},
    // 只在进历史时换：当前这一轮模型仍看得到完整的工具结果
    commit: {render: {toolResult: (event) => firstLine(event.data.text)}},
});

// ====================================================================
// 需要整张模板的少数情况：例如在历史前插一组固定的示例对话
// ====================================================================

export const fewShot = defineProfile({
    id: "lab.few-shot",
    name: "示例",
    description: "演示整张模板。",
    system: "你是标题生成器。",
    prompt: ({read}) => (
        <>
            <System />
            <User>为这段话起标题：林舟拔剑。</User>
            <History last={4} />
            <Slot name="*" volatile />
            <Turn />
            {read(coreHistory).turns > 100 && <User>（对话很长了，标题要短。）</User>}
        </>
    ),
});
