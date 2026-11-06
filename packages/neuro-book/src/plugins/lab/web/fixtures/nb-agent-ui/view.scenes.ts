import type {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import {createHarnessTranscript} from "@notnotype/nb-agent-ui";
import {agentRef} from "@notnotype/nb-agent-ui";
import type {AgentConversationContext, MessageView, PendingInputView} from "@notnotype/nb-agent-ui";
import type {LabFixtureDefinition} from "../index";
import {harnessReplayLog} from "./harness-replay";
import {
    answerMessages,
    longConversationMessages,
    unverifiedReplyMessages,
    conversationContext,
    messageStateMessages,
    pagedConversationMessages,
    runningConversationMessages,
    runningConversationNow,
    streamingMessages,
    streamingNow,
} from "./data";

type Scene = LabFixtureDefinition<typeof AgentConversationView>["scenes"][number];

/** 真实 harness 日志经适配器画成的消息。 */
function replayMessages() {
    const transcript = createHarnessTranscript();
    for (const entry of harnessReplayLog) transcript.applyLogEntry(entry);
    return [...transcript.messages()];
}

const BEFORE = "雨越下越大，巷子里只剩下卖炭人的独轮车还在吱呀作响。\n陈砚推开药铺的后门时，天刚擦黑，他没有回头，只是把那包从城外带回来的干草放在门槛上，先听了听屋里的动静。柜台后面没有人，算盘却摆在正中，珠子停在一个他看不懂的数上。\n巷口的灯灭了。";
const AFTER = "雨越下越大，巷子里只剩下卖炭人的独轮车还在吱呀作响。\n陈砚推开药铺的后门时，天刚擦黑，他回头看了一眼，又很快转回去，把那包从城外带回来的干草放在门槛上，先听了听屋里的动静。柜台后面没有人，算盘却摆在正中，珠子停在一个他看不懂的日子上。\n巷口的灯灭了。";
const LONG_BEFORE = Array.from({length: 40}, (_, index) => `第 ${String(index + 1)} 段没有变的文字，写得很长也会自动换行，不横向滚动。`).join("\n");
const LONG_AFTER = LONG_BEFORE.split("\n").map((line, index) => (index % 6 === 2 ? line.replace("没有变的文字", "改过的文字，紧凑一些") : line)).join("\n");
const CHAPTER = "project://正文/第三章.md";

const editApproval = (id: string, path = CHAPTER, before = BEFORE, after = AFTER): PendingInputView => ({kind: "approval", id, toolCallId: `call-${id}`, tool: "edit", args: {path}, preview: {state: "ready", files: [{address: path, kind: "diff", before, after}]}});
const shellApproval: PendingInputView = {kind: "approval", id: "shell", toolCallId: "call-shell", tool: "shell", args: {command: "wc -m project://正文/第三章.md && rg -n \"钟声\" project://正文/", cwd: "project://", timeout: 120}, preview: {state: "ready", files: []}};
const PERSPECTIVE = {question: "这章用什么视角？", header: "视角", options: [{label: "第一人称", description: "贴近主角，读者只知道他知道的。"}, {label: "第三人称限知", description: "能写他没注意到的细节，和前两章一致。"}, {label: "全知视角", description: "可以写多人心理，但要改前两章。"}]};
const FORESHADOW = {question: "这章回收哪些伏笔？", multiSelect: true, options: [{label: "钟声", description: "第 2 章埋下，第 12 章回收。"}, {label: "父亲的表", description: "第 5 章埋下，还没回收。"}, {label: "没寄出的信", description: "第 7 章埋下，还没回收。"}]};
const CHARACTER = {
    question: "补全人物卡",
    options: [{label: "先不写"}, {label: "按我填的"}],
    form: {type: "object", title: "苏晴", required: ["name", "age"], properties: {name: {type: "string", title: "名字"}, age: {type: "number", title: "年龄"}, role: {type: "string", title: "在故事里的位置", enum: ["主角", "配角", "反派", "路人"]}, secret: {type: "boolean", title: "主角知道她的真实身份"}}},
};
const APPROVAL_MODES = {
    options: [
        {key: "ask", label: "每次询问", description: "除读取外，每次调用都需要批准（默认）", icon: "i-lucide-shield-question"},
        {key: "allow-writes", label: "放行写入", description: "修改文件无需批准，运行命令仍需批准", icon: "i-lucide-pencil-line"},
        {key: "yolo", label: "全部放行", description: "所有调用都无需批准，仅拒绝规则可拦截", icon: "i-lucide-triangle-alert", danger: true},
    ],
    value: "ask",
};
const USAGE = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 162_400, input: 101_200, output: 3_100, cacheRead: 58_100, cacheWrite: 0, cacheHitRate: 0.62, cost: 0.07, currency: "USD" as const};

const MODES = [
    {key: "normal", label: "普通", icon: "i-lucide-feather"},
    {key: "discuss", label: "讨论", icon: "i-lucide-messages-square"},
    {key: "plan", label: "计划", icon: "i-lucide-clipboard-list"},
];
const SHORT_PLAN = "## 第三章节奏调整\n\n1. 压缩中段的回忆，保留雨夜那段对话。\n2. 把钟声的伏笔提前到开头。\n3. 改完检查第五章有没有引用被删的段落。";
const LONG_PLAN = `## 第三章到第六章的节奏调整\n\n${Array.from({length: 14}, (_, index) => `### 第 ${String(index + 1)} 步\n\n先读相关章节，列出要改的段落，再动手。改完对照人物卡检查一遍有没有前后矛盾。`).join("\n\n")}`;
const modeSwitchPlan = (plan: string): PendingInputView => ({kind: "mode-switch", id: "ms", toolCallId: "call-ms", fromLabel: "计划", toLabel: "普通", plan, approval: {...APPROVAL_MODES, value: "allow-writes"}});

/** 真实宿主那样的状态栏与审批模式，加上等用户的事项。 */
function hostScene(id: string, label: string, patch: Omit<Partial<AgentConversationContext>, "composer"> & {composer?: Partial<AgentConversationContext["composer"]>}): Scene {
    const base = conversationContext();
    return {id, label, input: {props: {ctx: {...base, ...patch, usage: {...base.usage, ...USAGE, ...patch.usage}, composer: {...base.composer, modes: [], approval: APPROVAL_MODES, ...patch.composer}}, statusBar: true, newSession: true, teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}}};
}

const WAITING: Partial<AgentConversationContext> = {run: {status: "waiting", phase: ""}};

/** 压缩分隔线的几种详情（docs/specs/ui/agent-conversation-view.md）：数字与字符串，适配器从事件里取。 */
const compactionDivider = (id: string, patch: Partial<Extract<MessageView, {kind: "system"}>>): MessageView => ({kind: "system", id, timestamp: 900, source: "compaction", label: agentRef("harness.compaction"), text: "", ...patch});
const SUMMARIZED = {method: "nbook.agent.summary", tokensBefore: 92_400, tokensAfter: 11_300, model: {name: "deepseek/deepseek-flash", input: 3_000, output: 1_900, cacheRead: 75_000, cacheWrite: 0, cost: 0.0213}, require: ["保留人物关系与每一章的时间线"], restored: [{kind: "file" as const, target: "project://正文/第三章.md", tokens: 4_200, truncated: false}, {kind: "file" as const, target: "project://正文/第二章.md", tokens: 8_000, truncated: true}, {kind: "plan" as const, target: "session://plan.md", tokens: 600, truncated: false}, {kind: "log" as const, target: "sessions://lab/session.jsonl", tokens: 0, truncated: false}], omitted: 0, keptTurns: 2};
const SUMMARY_TEXT = "## 用户的要求\n- 先写第三章，视角用第三人称限知。\n\n## 进度\n第一、二章已完成，第三章写到雨夜进药铺。\n\n## 下一步\n接着写“柜台后面没有人”这一段。";
const compactionBase = (): AgentConversationContext["messages"] => longConversationMessages.slice(0, 4);

export const agentConversationViewScenes: Scene[] = [
    hostScene("idle-host", "宿主接好的样子：状态栏、审批模式", {}),
    hostScene("compaction-summary", "压缩分隔线：摘要、放回、要求（点开看详情）", {messages: [...compactionBase(), compactionDivider("c1", {text: SUMMARY_TEXT, compaction: SUMMARIZED})]}),
    hostScene("compaction-shake", "压缩分隔线：整理工具结果，没有摘要也没有放回", {messages: [...compactionBase(), compactionDivider("c1", {compaction: {method: "nbook.agent.shake", tokensBefore: 92_400, tokensAfter: 41_000, model: null, require: [], restored: [], omitted: 6, keptTurns: null}})]}),
    hostScene("compaction-grew", "压缩分隔线：只有一轮，压缩后反而更大（不写节省）", {messages: [...compactionBase(), compactionDivider("c1", {text: SUMMARY_TEXT, compaction: {...SUMMARIZED, tokensBefore: 3_200, tokensAfter: 6_900, restored: [], require: [], model: {name: "p/m", input: 3_000, output: 1_900, cacheRead: 0, cacheWrite: 0, cost: null}, keptTurns: null}})]}),
    hostScene("compaction-mid-turn", "一轮中途压缩过：整轮收起时分隔线仍在摘要行下面", {messages: [
        compactionBase()[0]!,
        {kind: "assistant", id: "ca1", timestamp: 902, status: "done", text: "", thinking: "", model: "m", toolCalls: [{id: "ct1", name: "read", status: "success", args: {path: "project://正文/第三章.md"}}], contentOmitted: false},
        compactionDivider("c1", {text: SUMMARY_TEXT, compaction: SUMMARIZED}),
        {kind: "assistant", id: "ca2", timestamp: 904, status: "done", text: "第三章已经改好了。", thinking: "", model: "m", toolCalls: [], contentOmitted: false},
    ]}),
    hostScene("host-running", "运行中：阶段与用时", {messages: runningConversationMessages, run: {status: "running", phase: "生成中", startedAt: runningConversationNow - 12_000}, now: runningConversationNow}),
    hostScene("host-retry", "等重发", {messages: runningConversationMessages, run: {status: "running", phase: "请求中", retry: {attempt: 2, max: 5, resumeAt: runningConversationNow + 8_000}}, now: runningConversationNow}),
    hostScene("host-stopping", "正在停止，超过 10 秒", {messages: runningConversationMessages, run: {status: "stopping", phase: "", startedAt: runningConversationNow - 60_000}, stopRequestedAt: runningConversationNow - 12_000, now: runningConversationNow}),
    hostScene("host-cost", "费用超过告警线、全部放行", {usage: {...USAGE, cost: 1.02, costState: "warned"}, composer: {approval: {...APPROVAL_MODES, value: "yolo"}}}),
    hostScene("host-context-high", "上下文 91%", {usage: {...USAGE, contextTokens: 116_480}}),
    hostScene("host-offline", "断线", {connection: {status: "disconnected", actionRequired: false}}),
    hostScene("host-resume", "中断的会话：占位文字与继续按钮", {composer: {resume: true}}),
    hostScene("approval-edit", "审批：改一个文件，一句话的改动", {...WAITING, pendingInputs: [editApproval("one")]}),
    hostScene("approval-long", "审批：长 diff，向导内部滚动", {...WAITING, pendingInputs: [editApproval("long", CHAPTER, LONG_BEFORE, LONG_AFTER)]}),
    hostScene("approval-batch", "审批：一条回复三个调用，一步一个", {...WAITING, pendingInputs: [editApproval("a"), shellApproval, editApproval("c", "project://正文/第四章.md")]}),
    hostScene("modes-normal", "两个控件并排：普通模式", {composer: {modes: MODES, mode: "normal", approval: {...APPROVAL_MODES, value: "allow-writes"}}}),
    hostScene("modes-plan-allow-writes", "两个控件并排：计划模式加放行写入，审批控件变淡，状态栏标出", {composer: {modes: MODES, mode: "plan", approval: {...APPROVAL_MODES, value: "allow-writes"}}}),
    hostScene("modes-with-role", "选了模型角色：角色名、实际用的模型、思考档位", {composer: {modes: MODES, mode: "normal", approval: {...APPROVAL_MODES, value: "allow-writes"}, roles: [{key: "role:main", name: "主力", axis: "主力", modelLabel: "Claude Sonnet"}] as never, modelKey: "role:main", effectiveModel: "Claude Sonnet", thinkingLevels: ["low", "medium", "high"], thinking: "medium"}}),
    hostScene("modes-plan-yolo", "计划模式加全部放行：红色警告保留", {composer: {modes: MODES, mode: "plan", approval: {...APPROVAL_MODES, value: "yolo"}}}),
    hostScene("mode-switch-plan", "退出计划：批准计划", {...WAITING, composer: {modes: MODES, mode: "plan"}, pendingInputs: [modeSwitchPlan(SHORT_PLAN)]}),
    hostScene("mode-switch-plan-long", "退出计划：长计划，内容区滚动，按钮固定", {...WAITING, composer: {modes: MODES, mode: "plan"}, pendingInputs: [modeSwitchPlan(LONG_PLAN)]}),
    hostScene("mode-switch-simple", "别的切换：一句话", {...WAITING, composer: {modes: MODES, mode: "normal"}, pendingInputs: [{kind: "mode-switch", id: "ms", toolCallId: "call-ms", fromLabel: "普通", toLabel: "计划", approval: APPROVAL_MODES}]}),
    hostScene("approval-shell", "审批：命令", {...WAITING, pendingInputs: [shellApproval]}),
    hostScene("approval-shell-remember", "审批：命令，按钮写明要记住的规则", {...WAITING, pendingInputs: [{...shellApproval, remember: {label: "git diff *、touch *"}} as PendingInputView]}),
    hostScene("approval-shell-no-remember", "审批：命令太宽，不能本会话都批准", {...WAITING, pendingInputs: [{...shellApproval, remember: false} as PendingInputView]}),
    hostScene("approval-other", "审批：别的工具，列参数", {...WAITING, pendingInputs: [{kind: "approval", id: "other", toolCallId: "call-other", tool: "publish_chapter", args: {chapter: 3, draft: false, tags: ["连载", "第三卷"]}, preview: {state: "ready", files: []}}]}),
    hostScene("approval-multi-file", "审批：一次改两个文件，一个太大、一个算不出来", {...WAITING, pendingInputs: [{kind: "approval", id: "multi", toolCallId: "call-multi", tool: "edit", args: {input: "[project://正文/第三章.md#ab12]\nPUT 2.=2:\n+改了"}, preview: {state: "ready", files: [{address: CHAPTER, kind: "diff", before: BEFORE, after: AFTER}, {address: "project://正文/全书.md", kind: "too-large", bytes: 2_000_000}, {address: "project://正文/第四章.md", kind: "failed", code: "edit-stale"}]}}]}),
    hostScene("approval-loading", "审批：预览还在算", {...WAITING, pendingInputs: [{kind: "approval", id: "loading", toolCallId: "call-loading", tool: "write", args: {path: CHAPTER, content: "整章"}, preview: {state: "loading"}}]}),
    hostScene("approval-preview-failed", "审批：预览查询失败，显示参数", {...WAITING, pendingInputs: [{kind: "approval", id: "failed", toolCallId: "call-failed", tool: "write", args: {path: CHAPTER, content: "整章的内容"}, preview: {state: "failed"}}]}),
    hostScene("approval-collapsed", "收起成小条", {...WAITING, wizardState: {collapsed: true, step: 0, approvals: {}, notes: {}, answers: {}}, pendingInputs: [editApproval("a"), shellApproval, editApproval("c")]}),
    hostScene("ask-choice", "提问：单选加其它", {...WAITING, pendingInputs: [{kind: "question", id: "q1", toolCallId: "call-q1", questions: [PERSPECTIVE, FORESHADOW]}]}),
    hostScene("ask-multi", "提问：多选（第 2 题）", {...WAITING, wizardState: {collapsed: false, step: 1, approvals: {}, notes: {}, answers: {q2: [{selected: ["第三人称限知"]}, {selected: ["父亲的表"]}]}}, pendingInputs: [{kind: "question", id: "q2", toolCallId: "call-q2", questions: [PERSPECTIVE, FORESHADOW]}]}),
    hostScene("ask-form", "提问：表单", {...WAITING, pendingInputs: [{kind: "question", id: "q3", toolCallId: "call-q3", questions: [CHARACTER]}]}),
    {
        id: "answer",
        label: "结果节点：答案卡片在整轮收起后仍露出",
        input: {props: {ctx: conversationContext({messages: answerMessages, branches: {}}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "reply-unverified",
        label: "附注：宿主的条目渲染器在回复气泡里画没核实的出处",
        input: {props: {ctx: conversationContext({messages: unverifiedReplyMessages, branches: {}}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "long-conversation",
        label: "多轮长对话",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "running",
        label: "运行中",
        input: {
            props: {
                ctx: conversationContext({
                    messages: runningConversationMessages,
                    run: {status: "running", phase: "正在读取文件"},
                    now: runningConversationNow,
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "running-live",
        label: "运行中逐步展开（processDisclosure: live）",
        input: {
            props: {
                ctx: conversationContext({
                    messages: runningConversationMessages,
                    run: {status: "running", phase: "正在读取文件"},
                    now: runningConversationNow,
                }),
                processDisclosure: "live",
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "running-no-steer",
        label: "运行中不能补充说明与排队",
        input: {
            props: {
                ctx: conversationContext({
                    messages: runningConversationMessages,
                    run: {status: "running", phase: "正在读取文件"},
                    now: runningConversationNow,
                    interaction: {...conversationContext().interaction, canSteer: false, canQueue: false},
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "embedded",
        label: "嵌入别的页面：没有顶栏、模型与模式",
        input: {
            props: {
                ctx: conversationContext({
                    messages: answerMessages,
                    branches: {},
                    composer: {...conversationContext().composer, models: [], modelKey: null, thinkingLevels: [], thinking: null, modes: []},
                }),
                header: false,
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "streaming",
        label: "流式输出",
        input: {
            props: {
                ctx: conversationContext({
                    messages: streamingMessages,
                    run: {status: "running", phase: "正在输出"},
                    branches: {},
                    now: streamingNow,
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-paged",
        label: "历史分页",
        input: {
            props: {
                ctx: conversationContext({messages: pagedConversationMessages, history: {hasMore: true, loading: false, error: null}}),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "history-error",
        label: "历史加载失败",
        input: {
            props: {
                ctx: conversationContext({
                    messages: pagedConversationMessages,
                    history: {hasMore: true, loading: false, error: "网络连接中断，更早的内容没有加载。"},
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "message-states",
        label: "消息状态",
        input: {
            props: {ctx: conversationContext({messages: messageStateMessages, branches: {}, now: messageStateMessages.at(-1)!.timestamp}), teleportTarget: false, locale: "zh-CN"},
            model: {viewMode: "turns"},
        },
    },
    {
        id: "raw",
        label: "原始视图",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "raw"}},
    },
    {
        id: "harness-replay",
        label: "harness 记录回放",
        input: {props: {ctx: conversationContext({messages: replayMessages()}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "english",
        label: "英文界面",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "en-US"}, model: {viewMode: "turns"}},
    },
    {
        id: "plain",
        label: "缺省实现（没有注入渲染组件）",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "no-session",
        label: "未选择会话",
        input: {
            props: {
                ctx: conversationContext({
                    session: null,
                    messages: [],
                    availability: {status: "unselected", message: "选择或新建一个会话后开始对话。", actions: []},
                }),
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
];
