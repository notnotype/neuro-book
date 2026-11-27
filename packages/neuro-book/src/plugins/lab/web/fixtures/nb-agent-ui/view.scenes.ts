import type {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import {createHarnessTranscript} from "@notnotype/nb-agent-ui";
import {agentRef} from "@notnotype/nb-agent-ui";
import type {AgentConversationContext, MessageView, PendingInputView, ToolCallView} from "@notnotype/nb-agent-ui";
import type {LabFixtureDefinition} from "../define";
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

/** Lab 不连服务端，bot 的头像用一张内联的图代替（产品里是 `nbook.bots` 的头像地址）。 */
const BOT_AVATAR = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><circle cx='10' cy='10' r='10' fill='#c9a7e8'/><circle cx='7' cy='9' r='1.5' fill='#5b3a7a'/><circle cx='13' cy='9' r='1.5' fill='#5b3a7a'/></svg>")}`;

/**
 * bot 档（ui/agent-conversation-view.md 的“用法档”）：顶栏是 bot 的名字与头像，没有新建与会话列表；审批在停靠区、输入框照常可用；
 * 不能改写历史，命令只有白名单里的几个。
 */
function botScene(): Scene {
    const base = hostScene("bot", "bot 档：头像、停靠区里的审批、没有新建与会话列表", {
        ...WAITING,
        session: {...conversationContext().session!, title: "星璃", avatar: BOT_AVATAR},
        interaction: {...conversationContext().interaction, canMutateHistory: false, canArchive: false, canRestore: false, canOpenTree: false, commands: ["compact", "plan", "mode"], placement: "dock", canCreate: false},
        pendingInputs: [editApproval("bot-a"), editApproval("bot-b", "project://正文/第四章.md")],
    });
    return base;
}

/** 本地时区的时刻：按天的线按本地的日历日分。 */
const localAt = (month: number, day: number, hour: number, minute = 0): number => new Date(2026, month - 1, day, hour, minute).getTime();
const chatTurn = (id: string, at: number, ask: string, answer: string): MessageView[] => [
    {kind: "user", id: `${id}-u`, timestamp: at, intent: "normal", blocks: [{kind: "text", text: ask}], contentOmitted: false},
    {kind: "assistant", id: `${id}-a`, timestamp: at + 40_000, status: "done", text: answer, thinking: "", model: "deepseek/deepseek-flash", toolCalls: [], contentOmitted: false},
];
const DIVIDER_CHATS = {
    "zh-CN": [
        chatTurn("t1", localAt(11, 18, 21, 5), "第三章写到哪了？", "写到雨夜进药铺，柜台后面没有人那一段。"),
        chatTurn("t2", localAt(11, 21, 22, 30), "明早帮我把读者评论整理一下。", "好，明早整理好放在这里。"),
        chatTurn("t3", localAt(11, 22, 8, 0), "早。", "早！昨晚的评论整理好了：三条说第三章节奏慢，两条想多看苏晴。"),
        chatTurn("t4", localAt(11, 22, 9, 10), "节奏慢的那三条具体说哪段？", "都指回忆那两段，建议合并成一段。"),
    ],
    "en-US": [
        chatTurn("t1", localAt(11, 18, 21, 5), "Where did chapter three stop?", "At the rainy night in the apothecary, with nobody behind the counter."),
        chatTurn("t2", localAt(11, 21, 22, 30), "Sort the reader comments for me tomorrow morning.", "Sure, they will be here in the morning."),
        chatTurn("t3", localAt(11, 22, 8, 0), "Morning.", "Morning! Last night's comments are sorted: three say chapter three drags, two want more of Su Qing."),
        chatTurn("t4", localAt(11, 22, 9, 10), "Which part do the three mean?", "Both flashback passages; they suggest merging them."),
    ],
};

/** bot 档的按天与未读的线（ui/agent-conversation-view.md 的“分轮视图”）：四轮跨三天，今天早上那条回复起是新消息。 */
function botDividersScene(locale: "zh-CN" | "en-US"): Scene {
    const messages = DIVIDER_CHATS[locale].flat();
    const scene = hostScene(locale === "zh-CN" ? "bot-dividers" : "bot-dividers-en", locale === "zh-CN" ? "bot 档：按天的线与“以下是新消息”" : "bot 档：按天与未读的线（英文）", {
        session: {...conversationContext().session!, title: locale === "zh-CN" ? "星璃" : "Xingli", avatar: BOT_AVATAR},
        interaction: {...conversationContext().interaction, canMutateHistory: false, canArchive: false, canRestore: false, canOpenTree: false, commands: ["compact", "plan", "mode"], placement: "dock", canCreate: false},
        messages,
        now: localAt(11, 22, 12),
        dividers: {day: true, unreadFrom: "t3-a"},
    });
    return {...scene, input: {...scene.input, props: {...scene.input.props, locale}}};
}
type Queued = AgentConversationContext["composer"]["queued"];
const HELD_ZH: Queued = [
    {id: "h1", text: "保留雨夜那段对话，别删。", delivery: "steer", held: {reason: "上一轮出错"}},
    {id: "h2", text: "改完第三章顺便检查第五章的错别字。", delivery: "followup", held: {reason: "你停止了这一轮"}},
    {id: "h3", text: "每天早上整理昨天的修改记录。", delivery: "followup", author: {label: "日程", icon: "i-lucide-calendar-clock"}, editable: false, held: {reason: "空闲时排的"}},
];
const HELD_EN: Queued = [
    {id: "h1", text: "Keep the dialogue in the rainy-night scene.", delivery: "steer", held: {reason: "The run couldn't start: the model role isn't bound to a model"}},
    {id: "h2", text: "After chapter three, check chapter five for typos.", delivery: "followup", held: {reason: "You stopped this turn"}},
    {id: "h3", text: "Every morning, tidy up yesterday's edit log.", delivery: "followup", author: {label: "Morning digest schedule", icon: "i-lucide-calendar-clock"}, editable: false, held: {reason: "Queued while idle"}},
];
/** 合并留着的话发出的一条：宿主的两条话先跑（ui/agent-conversation-view.md 的 `ahead`）。 */
const AHEAD_MESSAGE: MessageView = {kind: "user", id: "ahead-u", timestamp: conversationContext().now - 2_000, intent: "normal", delivery: "pending", ahead: 2, blocks: [{kind: "text", text: "保留雨夜那段对话，别删。\n\n再补一句：钟声要写十二下。"}], contentOmitted: false};

/** 压缩分隔线的几种详情（docs/specs/ui/agent-conversation-view.md）：数字与字符串，适配器从事件里取。 */
const compactionDivider = (id: string, patch: Partial<Extract<MessageView, {kind: "system"}>>): MessageView => ({kind: "system", id, timestamp: 900, source: "compaction", label: agentRef("harness.compaction"), text: "", ...patch});
const SUMMARIZED = {method: "nbook.agent.summary", tokensBefore: 92_400, tokensAfter: 11_300, model: {name: "deepseek/deepseek-flash", input: 3_000, output: 1_900, cacheRead: 75_000, cacheWrite: 0, cost: 0.0213}, require: ["保留人物关系与每一章的时间线"], restored: [{kind: "file" as const, target: "project://正文/第三章.md", tokens: 4_200, truncated: false}, {kind: "file" as const, target: "project://正文/第二章.md", tokens: 8_000, truncated: true}, {kind: "plan" as const, target: "session://plan.md", tokens: 600, truncated: false}, {kind: "log" as const, target: "sessions://lab/session.jsonl", tokens: 0, truncated: false}], omitted: 0, keptTurns: 2};
const SUMMARY_TEXT = "## 用户的要求\n- 先写第三章，视角用第三人称限知。\n\n## 进度\n第一、二章已完成，第三章写到雨夜进药铺。\n\n## 下一步\n接着写“柜台后面没有人”这一段。";
const compactionBase = (): AgentConversationContext["messages"] => longConversationMessages.slice(0, 4);

/** 第一屏的最近对话：一条没有标题，时间跨今天、昨天与更早。 */
export const WELCOME_RECENT = [
    {id: "w1", title: "第三章节奏调整", at: Date.UTC(2026, 10, 16, 9, 50)},
    {id: "w2", title: "", at: Date.UTC(2026, 10, 15, 21, 5)},
    {id: "w3", title: "查第五章的错别字，并顺手统一人物称谓", at: Date.UTC(2026, 10, 12, 8, 0)},
];
/** 主创的三条开场指令（与 `main.ts` 的同一份文字）。 */
export const WELCOME_STARTERS = [
    {icon: "i-lucide-feather", text: "帮我润色一段环境描写：暴雨中的蒸汽工业城市，充满湿冷的金属味、雾气与钟声。文风克制冷峻，突出压抑感。"},
    {icon: "i-lucide-git-merge", text: "规划第三幕高潮“雨夜钟楼对决”的细纲，设计三段递进的冲突转折，并让两条暗线在此处收束。"},
    {icon: "i-lucide-shield-check", text: "对当前章节进行一致性体检，排查时间线冲突、战力体系失衡、伏笔漏洞以及高频重复词。"},
];

/**
 * eval 的卡片（w00032 t21）：代码里批量读章节、按结果改两章。子调用的计数、卡片下的子行、运行中的用时是对话视图对带子调用的卡片
 * 做的，eval 的渲染器与详情是 `nbook.agent` 登记的（`labAgentRegistry`）。
 */
const EVAL_CODE = "const chapters = await tool.glob({pattern: 'project://正文/*.md'});\nlet longest = 0;\nfor (const path of chapters.split('\\n')) {\n  const text = await tool.read({path});\n  longest = Math.max(longest, text.length);\n}\nlongest";
/** 1 到 39 的中文数字（章节名用）。 */
const chineseNumber = (n: number): string => {
    const digits = "零一二三四五六七八九";
    const tens = Math.floor(n / 10);
    return `${tens === 0 ? "" : tens === 1 ? "十" : `${digits[tens]!}十`}${n % 10 === 0 ? "" : digits[n % 10]!}`;
};
const evalRead = (index: number, status: "success" | "running" = "success") => ({id: `ev-r${String(index)}`, name: "read", status, args: {path: `project://正文/第${chineseNumber(index)}章.md`}, ...(status === "success" ? {result: {text: "…", truncated: true}} : {})});
// 场景都让这一轮处在运行或等待中：跑完的一轮缺省整轮收起，看不到卡片（产品里点开整轮与思维链才看到）。
function evalScene(id: string, label: string, call: Pick<ToolCallView, "status"> & Partial<ToolCallView>, patch: Partial<AgentConversationContext> = {}): Scene {
    const now = 2_000_000;
    const messages: MessageView[] = [
        {kind: "user", id: "ev-u", timestamp: now - 90_000, intent: "normal", blocks: [{kind: "text", text: "统计一下每章的字数，把最长的两章各压缩一段回忆。"}], contentOmitted: false},
        {kind: "assistant", id: "ev-a", timestamp: now - 80_000, status: patch.run?.status === "idle" ? "done" : "streaming", text: "", thinking: "先批量读一遍各章，算字数。", model: "deepseek-chat", contentOmitted: false,
            toolCalls: [{id: "ev-1", name: "eval", args: {title: "统计各章字数并压缩最长的两章", code: EVAL_CODE}, invocation: "ev-1", startedAt: now - 62_000, ...call}]},
    ];
    return {id, label, input: {props: {ctx: conversationContext({messages, run: {status: "running", phase: ""}, now, ...patch}), processDisclosure: "live", teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}}};
}

export const agentConversationViewScenes: Scene[] = [
    hostScene("idle-host", "宿主接好的样子：状态栏、审批模式", {}),
    {...hostScene("status-line", "状态栏可右键：勾选菜单与“状态栏设置…”（设置为空）", {}), input: {...hostScene("status-line", "", {}).input, props: {...hostScene("status-line", "", {}).input.props, statusLine: {}}}},
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
    hostScene("host-cost", "费用超过告警线；全部放行只在工具栏标红", {usage: {...USAGE, cost: 1.02, costState: "warned"}, composer: {approval: {...APPROVAL_MODES, value: "yolo"}}}),
    hostScene("host-context-high", "上下文 91%", {usage: {...USAGE, contextTokens: 116_480}}),
    hostScene("host-offline", "断线", {connection: {status: "disconnected", actionRequired: false}}),
    hostScene("host-resume", "中断的会话：占位文字与继续按钮", {composer: {resume: true}}),
    hostScene("approval-edit", "审批：改一个文件，一句话的改动", {...WAITING, pendingInputs: [editApproval("one")]}),
    hostScene("approval-long", "审批：长 diff，向导内部滚动", {...WAITING, pendingInputs: [editApproval("long", CHAPTER, LONG_BEFORE, LONG_AFTER)]}),
    hostScene("approval-batch", "审批：一条回复三个调用，一步一个", {...WAITING, pendingInputs: [editApproval("a"), shellApproval, editApproval("c", "project://正文/第四章.md")]}),
    botScene(),
    botDividersScene("zh-CN"),
    botDividersScene("en-US"),
    hostScene("modes-normal", "两个控件并排：普通模式", {composer: {modes: MODES, mode: "normal", approval: {...APPROVAL_MODES, value: "allow-writes"}}}),
    hostScene("modes-plan-allow-writes", "两个控件并排：计划模式加放行写入，审批控件变淡", {composer: {modes: MODES, mode: "plan", approval: {...APPROVAL_MODES, value: "allow-writes"}}}),
    hostScene("modes-with-role", "选了模型角色：角色名、实际用的模型、思考档位", {composer: {modes: MODES, mode: "normal", approval: {...APPROVAL_MODES, value: "allow-writes"}, roles: [{key: "role:main", name: "主力", axis: "gradient", modelLabel: "Claude Sonnet"}], modelKey: "role:main", effectiveModel: "Claude Sonnet", thinkingLevels: ["low", "medium", "high"], thinking: "medium"}}),
    hostScene("modes-plan-yolo", "计划模式加全部放行：工具栏的红色警告保留，状态栏不另标", {composer: {modes: MODES, mode: "plan", approval: {...APPROVAL_MODES, value: "yolo"}}}),
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
        id: "held",
        label: "停止后留着的话（点继续或写字回车：自己的合成一条，日程的单独一条在前）",
        input: {props: {ctx: conversationContext({composer: {...conversationContext().composer, queued: HELD_ZH}}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        // 排队区头行与标签宽度固定：英文原因长，按 390 宽看原因先截断、Continue 完整（ui-development 的第 5 条）。
        id: "held-english",
        label: "留着的话（英文）",
        input: {props: {ctx: conversationContext({composer: {...conversationContext().composer, queued: HELD_EN}}), teleportTarget: false, locale: "en-US"}, model: {viewMode: "turns"}},
    },
    {
        id: "ahead",
        label: "合并的一条前面还有 2 条",
        input: {props: {ctx: conversationContext({messages: [...conversationContext().messages, AHEAD_MESSAGE], run: {status: "running", phase: "正在思考", startedAt: conversationContext().now - 4_000}}), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "plain",
        label: "缺省实现（没有注入渲染组件）",
        input: {props: {ctx: conversationContext(), teleportTarget: false, locale: "zh-CN"}, model: {viewMode: "turns"}},
    },
    {
        id: "no-session",
        label: "没选会话：头写“新对话”，第一屏有最近对话与开场指令",
        input: {
            props: {
                ctx: conversationContext({
                    session: null,
                    messages: [],
                    availability: {status: "unselected", message: "选择或新建一个会话后开始对话。", actions: []},
                    now: Date.UTC(2026, 10, 16, 10, 0),
                }),
                newSession: true, draftProfile: {name: "主创", icon: "i-lucide-feather"},
                welcome: {title: "NeuroBook 创作工作区", recent: WELCOME_RECENT, total: 12, starters: WELCOME_STARTERS},
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "welcome-first",
        label: "第一次用：没有最近对话，只有开场指令",
        input: {
            props: {
                ctx: conversationContext({session: null, messages: [], availability: {status: "unselected", message: "", actions: []}}),
                newSession: true, draftProfile: {name: "主创", icon: "i-lucide-feather"},
                welcome: {title: "NeuroBook 创作工作区", recent: [], total: 0, starters: WELCOME_STARTERS},
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "welcome-bare",
        label: "第一屏什么都没有：Profile 没有开场指令，也没有别的会话",
        input: {
            props: {
                ctx: conversationContext({messages: []}),
                newSession: true,
                welcome: {title: "NeuroBook 创作工作区", recent: [], total: 0, starters: []},
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "model-notice-role",
        label: "模型用不了：角色没绑定，提示卡写出角色，按钮去绑定",
        input: {
            props: {
                ctx: conversationContext({availability: {status: "profile-unavailable", title: "“写作”角色还没绑定模型", message: "主创用“写作”角色的模型对话。", icon: "i-lucide-link-2-off", actions: [{id: "bind-role", label: "去绑定"}]}}),
                newSession: true,
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "model-notice-provider",
        label: "模型用不了：一家服务商都没有，第一屏上压着“添加服务商”",
        input: {
            props: {
                ctx: conversationContext({
                    session: null,
                    messages: [],
                    availability: {status: "profile-unavailable", title: "还没有可用的模型", message: "先添加一个服务商（DeepSeek、OpenAI、本机的 Ollama 都行），再回来对话。", icon: "i-lucide-plug-zap", actions: [{id: "add-provider", label: "添加服务商"}]},
                }),
                newSession: true, draftProfile: {name: "主创", icon: "i-lucide-feather"},
                welcome: {title: "NeuroBook 创作工作区", recent: [], total: 0, starters: WELCOME_STARTERS},
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    {
        id: "child-session",
        label: "子会话：头的左边是返回，中间是子代理的图标与标题",
        input: {
            props: {
                ctx: conversationContext({
                    session: {...conversationContext().session!, id: "child", title: "查第三章的称谓是否前后一致", profileName: "核对员", profileIcon: "i-lucide-spell-check", path: [{id: "root", title: "第三章节奏调整"}]},
                }),
                newSession: true,
                teleportTarget: false, locale: "zh-CN",
            },
            model: {viewMode: "turns"},
        },
    },
    evalScene("eval-running", "eval 运行中：已调用几次、正在调的那一个、已用时", {status: "running", children: [...Array.from({length: 11}, (_, index) => evalRead(index + 1)), evalRead(12, "running")]}),
    evalScene("eval-done", "eval 跑完：副标题写计数，改了的、被拒的、出错的子调用露在卡片下", {
        status: "success",
        result: {text: "第三章 11,820 字、第七章 10,960 字最长，各压缩了一段回忆。\n12034", truncated: false, details: {cell: 3, bytes: 62, images: 0}},
        children: [
            ...Array.from({length: 28}, (_, index) => evalRead(index + 1)),
            {id: "ev-w1", name: "edit", status: "success", args: {path: "project://正文/第三章.md", old_string: "那年冬天", new_string: "那年"}, result: {text: "改好了", truncated: false}},
            {id: "ev-w2", name: "write", status: "denied", args: {path: "project://正文/第七章.md", content: "整章重写"}, note: agentRef("kernel.tool.deniedByUser")},
            {id: "ev-w3", name: "read", status: "error", args: {path: "project://正文/番外.md"}, error: "文件不存在"},
        ],
    }, {run: {status: "running", phase: ""}}),
    evalScene("eval-approval", "eval 里的调用在等审批：向导标题写来源，卡片下是占位的子调用", {status: "running", children: [evalRead(1), evalRead(2), {id: "ev-w1", name: "write", status: "running", args: {path: "project://正文/第三章.md", content: "压缩后的第三章"}}]}, {
        run: {status: "waiting", phase: ""},
        pendingInputs: [{kind: "approval", id: "ev-ap", toolCallId: "ev-w1", tool: "write", within: {tool: "eval"}, args: {path: "project://正文/第三章.md", content: "压缩后的第三章"}, preview: {state: "ready", files: [{address: "project://正文/第三章.md", kind: "diff", before: BEFORE, after: AFTER}]}}],
    }),
];
