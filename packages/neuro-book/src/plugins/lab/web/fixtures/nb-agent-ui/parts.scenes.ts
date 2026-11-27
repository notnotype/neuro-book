import {
    conversationContext,
    longConversationMessages,
    messageStateMessages,
    runningConversationMessages,
    runningConversationNow,
    taskCallSamples,
    toolCallSamples,
    turnSamples,
} from "./data";
import type {UserMessageView} from "@notnotype/nb-agent-ui";
import {createAgentViewRegistry} from "@notnotype/nb-agent-ui";
import {builtinRolesContribution, builtinToolsContribution} from "@notnotype/nb-agent-ui/vue";
import type {AgentChainSummary, AgentCommandDetail, AgentConversationTurn, AgentStreamDivider, AgentFileChanges, AgentFileContentDetail, AgentMarkdown, AgentMessageActions, AgentRawView, AgentTaskList, AgentTaskListNode, AgentToolDetail, AgentTurnBlock, AgentUserContent} from "@notnotype/nb-agent-ui/lab";
import {buildTurns, type ConversationTurn, type TurnBlock} from "@notnotype/nb-agent-ui/lab";
import type {LabFixtureDefinition} from "../define";
import {labDomainToolsContribution} from "./domain-tools";

export const agentChainSummaryScenes: LabFixtureDefinition<typeof AgentChainSummary>["scenes"] = [
    {id: "collapsed", label: "折叠", input: {props: {icon: "i-lucide-brain", label: "思考 · 读了 7 个文件，改了 2 个 · 另有 3 次操作"}, model: {expanded: false}}},
    {id: "expanded", label: "展开，带失败提醒", input: {props: {icon: "i-lucide-brain", label: "思考 · 读了 2 个文件，改了 1 个", alert: "1 次失败"}, model: {expanded: true}}},
    {id: "turn", label: "整轮过程", input: {props: {label: "过程 · 14 次操作 · 读了 7 个文件，改了 2 个"}, model: {expanded: false}}},
    {id: "running", label: "运行中", input: {props: {running: true, label: "读取 notes/foreshadowing.md"}, model: {expanded: false}}},
    {id: "overflow", label: "放不下时截断", input: {props: {icon: "i-lucide-wrench", label: "思考 · 读了 64 个文件，改了 37 个 · 另有 128 次操作 · 另有若干说明文字与系统提示词", alert: "3 次失败"}, model: {expanded: false}}},
];

export const agentFileChangesScenes: LabFixtureDefinition<typeof AgentFileChanges>["scenes"] = [
    {id: "two-files", label: "两个文件", input: {props: {files: [
        {path: "chapters/03.md", added: 3, removed: 4},
        {path: "chapters/04.md", added: 0, removed: 1},
    ]}}},
    {id: "many-files", label: "超出上限", input: {props: {limit: 3, files: [
        {path: "chapters/03.md", added: 3, removed: 4},
        {path: "chapters/04.md", added: 0, removed: 1},
        {path: "characters/lin-mo.md", added: 12, removed: null},
        {path: "notes/foreshadowing.md", added: 2, removed: 0},
        {path: "worldbuilding/factions/old-city-watchmakers-guild-and-its-secret-ledger.md", added: 1, removed: 0},
    ]}}},
    {id: "unknown-stat", label: "增删未知", input: {props: {files: [{path: "chapters/05.md", added: null, removed: null}]}}},
];

const SAMPLE_MARKDOWN = "第三章已调整：\n\n- 中段三处回忆**合并为一段**，删去约 400 字重复交代；\n- 雨夜对话保留并前移；\n- 第四章开头删去一句多余的承接。\n\n> 下一步可以检查第六章的开头。\n\n涉及文件：`chapters/03.md`、`chapters/04.md`。";

export const agentMarkdownScenes: LabFixtureDefinition<typeof AgentMarkdown>["scenes"] = [
    {id: "rendered", label: "渲染", input: {props: {text: SAMPLE_MARKDOWN}}},
    {id: "code", label: "代码块", input: {props: {text: "统计字数：\n\n```bash\nwc -m chapters/06.md\n```\n\n结果是 4812 字。"}}},
    {id: "links", label: "引用、外链与图片", input: {props: {text: "参考 [第三章 雨夜](</正文/第三章 雨夜.md>) 与 [排版指南](https://example.com/guide)。\n\n![人物关系](/设定/人物关系.png)"}}},
    {id: "plain", label: "缺省实现（没有注入）", input: {props: {text: SAMPLE_MARKDOWN}}},
];

export const agentMessageActionsScenes: LabFixtureDefinition<typeof AgentMessageActions>["scenes"] = [
    {id: "actions", label: "常规操作", input: {props: {actions: [
        {id: "copy", icon: "i-lucide-copy", label: "复制"},
        {id: "retry", icon: "i-lucide-rotate-cw", label: "重新生成"},
        {id: "branch-from", icon: "i-lucide-git-branch-plus", label: "从此处新开分支"},
    ]}}},
    {id: "branch", label: "带分支切换", input: {props: {branch: {index: 2, total: 3}, actions: [{id: "copy", icon: "i-lucide-copy", label: "复制"}]}}},
    {id: "disabled", label: "运行中不可用", input: {props: {disabled: true, branch: {index: 1, total: 2}, actions: [{id: "copy", icon: "i-lucide-copy", label: "复制"}]}}},
];

const runningTurn = runningConversationMessages.slice(runningConversationMessages.findIndex((message) => message.id === "u5"));

export const agentConversationTurnScenes: LabFixtureDefinition<typeof AgentConversationTurn>["scenes"] = [
    {id: "long-react", label: "12 步 ReAct（折叠）", input: {props: {messages: turnSamples.longReact, ctx: conversationContext(), latest: false, first: false}}},
    {id: "simple", label: "只有回复", input: {props: {messages: turnSamples.simple, ctx: conversationContext(), latest: false, first: true}}},
    {id: "error", label: "出错（最新一轮）", input: {props: {messages: turnSamples.error, ctx: conversationContext(), latest: true, first: false}}},
    {id: "branch", label: "带分支", input: {props: {messages: turnSamples.patched, ctx: conversationContext(), latest: true, first: false}}},
    {
        id: "running", label: "运行中",
        input: {props: {messages: runningTurn, ctx: conversationContext({run: {status: "running", phase: "正在读取文件"}, now: runningConversationNow}), latest: true, first: false}},
    },
];

const TASK_ITEMS = [
    {id: "s1", text: "合并中段回忆", status: "completed", note: null},
    {id: "s2", text: "前移雨夜对话", status: "in_progress", note: "等待确认对话位置"},
    {id: "s3", text: "理顺第四章开头", status: "pending", note: null},
] as const;

export const agentTaskListScenes: LabFixtureDefinition<typeof AgentTaskList>["scenes"] = [
    {id: "created", label: "新建", input: {props: {title: "第三章节奏调整", items: [...TASK_ITEMS], changes: null}}},
    {id: "updated", label: "更新（只列变化）", input: {props: {title: "第三章节奏调整", items: [...TASK_ITEMS], changes: [
        {id: "s1", text: "合并中段回忆", from: "in_progress", to: "completed"},
        {id: "s2", text: "前移雨夜对话", from: "pending", to: "in_progress"},
    ]}}},
    {id: "untitled", label: "无标题", input: {props: {title: null, items: [...TASK_ITEMS], changes: null}}},
];

export const agentTaskListNodeScenes: LabFixtureDefinition<typeof AgentTaskListNode>["scenes"] = [
    {id: "created", label: "task_create：完整清单", input: {props: {call: taskCallSamples.created, ctx: conversationContext(), locale: "zh-CN"}}},
    {id: "updated", label: "task_set_status：与上一版比对", input: {props: {call: taskCallSamples.updated, ctx: conversationContext(), locale: "zh-CN"}}},
    {id: "running", label: "结果未返回：通用卡片", input: {props: {call: taskCallSamples.running, ctx: conversationContext(), locale: "zh-CN"}}},
];

/** 轮次块的样例：用分轮模型从 fixture 消息里算出来，与视图里看到的块一致。 */
const sampleRegistry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, labDomainToolsContribution]);
const [, reactTurn] = buildTurns({
    messages: turnSamples.simple.concat(turnSamples.longReact),
    registry: sampleRegistry,
    run: {status: "idle", phase: ""},
    history: {hasMore: false, loading: false, error: null},
    now: runningConversationNow,
});
const liveTurn = buildTurns({
    messages: runningTurn,
    registry: sampleRegistry,
    run: {status: "running", phase: "正在读取文件"},
    history: {hasMore: false, loading: false, error: null},
    now: runningConversationNow,
})[0]!;

function sampleBlock(turn: ConversationTurn, kind: TurnBlock["kind"], nth = 0): TurnBlock {
    const block = turn.blocks.filter((item) => item.kind === kind)[nth];
    if (block === undefined) {
        throw new Error(`样例轮次里没有第 ${nth + 1} 个 ${kind} 块`);
    }
    return block;
}

const blockProps = {ctx: conversationContext(), turnStatus: "done", last: false} as const;
const liveProps = {ctx: conversationContext({run: {status: "running", phase: "正在读取文件"}, now: runningConversationNow}), turnStatus: "running", last: false} as const;

export const agentTurnBlockScenes: LabFixtureDefinition<typeof AgentTurnBlock>["scenes"] = [
    {id: "chain", label: "思维链（结束后，含并入的中间 content）", input: {props: {...blockProps, block: sampleBlock(reactTurn!, "chain", 1)}}},
    {id: "chain-running", label: "思维链（运行中）", input: {props: {...liveProps, block: liveTurn.blocks.at(-1)!, last: true}}},
    {id: "reply", label: "最终回复", input: {props: {...blockProps, block: sampleBlock(reactTurn!, "content")}}},
    {id: "intermediate", label: "运行中的中间 content", input: {props: {...liveProps, block: sampleBlock(liveTurn, "content")}}},
    {id: "task-node", label: "任务清单（更新）", input: {props: {...blockProps, block: sampleBlock(reactTurn!, "node", 1)}}},
    {id: "workflow-node", label: "Workflow", input: {props: {...liveProps, block: sampleBlock(liveTurn, "node")}}},
    {id: "notice", label: "系统提醒", input: {props: {...blockProps, block: sampleBlock(reactTurn!, "notice")}}},
    {id: "divider", label: "上下文压缩（带摘要）", input: {props: {...blockProps, block: {kind: "divider", id: "c1", message: {
        kind: "system", id: "c1", timestamp: 0, source: "compaction", label: "上下文已压缩",
        text: "**较早对话摘要**\n\n- 第三章已调整节奏；\n- 第四章开头删去一句多余承接。",
    }}}}},
    {id: "divider-plain", label: "上下文压缩（无摘要）", input: {props: {...blockProps, block: {kind: "divider", id: "c2", message: {
        kind: "system", id: "c2", timestamp: 0, source: "compaction", label: "上下文已压缩", text: "",
    }}}}},
    {id: "steer", label: "补充说明", input: {props: {...blockProps, block: sampleBlock(reactTurn!, "steer")}}},
    {id: "error", label: "错误", input: {props: {...blockProps, turnStatus: "error", block: {kind: "error", id: "e1", message: "模型服务暂时不可用，请稍后重试。"}}}},
];

const detailCtx = conversationContext();

export const agentToolDetailScenes: LabFixtureDefinition<typeof AgentToolDetail>["scenes"] = [
    {id: "read", label: "read：文件内容适配", input: {props: {call: toolCallSamples.read, ctx: detailCtx}}},
    {id: "edit", label: "edit：两个片段的 diff", input: {props: {call: toolCallSamples.edit, ctx: detailCtx}}},
    {id: "write", label: "write：整文件新增", input: {props: {call: toolCallSamples.write, ctx: detailCtx}}},
    {id: "patch", label: "apply_patch", input: {props: {call: toolCallSamples.patch, ctx: detailCtx}}},
    {id: "bash", label: "bash：命令适配", input: {props: {call: toolCallSamples.bash, ctx: detailCtx}}},
    {id: "unadapted", label: "没有适配：原始参数与结果", input: {props: {call: toolCallSamples.unadapted, ctx: detailCtx}}},
    {id: "error", label: "出错：错误在上，下面照常显示", input: {props: {call: toolCallSamples.error, ctx: detailCtx}}},
];

export const agentFileContentDetailScenes: LabFixtureDefinition<typeof AgentFileContentDetail>["scenes"] = [
    {id: "full", label: "从第 1 行", input: {props: {call: toolCallSamples.read, ctx: detailCtx, locale: "zh-CN"}}},
    {id: "offset", label: "带 offset", input: {props: {call: toolCallSamples.readOffset, ctx: detailCtx, locale: "zh-CN"}}},
    {id: "running", label: "还没有结果", input: {props: {call: toolCallSamples.readRunning, ctx: detailCtx, locale: "zh-CN"}}},
];

export const agentCommandDetailScenes: LabFixtureDefinition<typeof AgentCommandDetail>["scenes"] = [
    {id: "bash", label: "bash", input: {props: {call: toolCallSamples.bash, ctx: detailCtx, locale: "zh-CN"}}},
    {id: "running", label: "还没有结果", input: {props: {call: {id: "d7r", name: "bash", status: "running", args: {command: "wc -m chapters/*.md"}}, ctx: detailCtx, locale: "zh-CN"}}},
];

function userSample(index: number): UserMessageView {
    const message = messageStateMessages[index];
    if (message?.kind !== "user") {
        throw new Error(`messageStateMessages[${index}] 不是用户消息`);
    }
    return message;
}

export const agentUserContentScenes: LabFixtureDefinition<typeof AgentUserContent>["scenes"] = [
    {id: "attachments", label: "文字、图片与文件", input: {props: {message: userSample(0)}}},
    {id: "omitted", label: "只公开了预览", input: {props: {message: userSample(2)}}},
    {id: "prompt-text", label: "文字写法：标签、附件与粘贴块", input: {props: {message: userSample(4)}}},
    {id: "text", label: "只有文字", input: {props: {message: userSample(6)}}},
];

/** 2026-11-22 的本地日序号（线上的今天、昨天按它算）；场景里的日子都相对它。 */
const DIVIDER_TODAY = Date.UTC(2026, 10, 22) / 86_400_000;
const localAt = (month: number, day: number, hour: number, year = 2026): number => new Date(year, month - 1, day, hour).getTime();
export const agentStreamDividerScenes: LabFixtureDefinition<typeof AgentStreamDivider>["scenes"] = [
    {id: "today", label: "按天：今天", input: {props: {kind: "day", at: localAt(11, 22, 9), today: DIVIDER_TODAY}}},
    {id: "yesterday", label: "按天：昨天", input: {props: {kind: "day", at: localAt(11, 21, 22), today: DIVIDER_TODAY}}},
    {id: "date", label: "按天：同一年写月日", input: {props: {kind: "day", at: localAt(11, 18, 21), today: DIVIDER_TODAY}}},
    {id: "other-year", label: "按天：别的年加上年", input: {props: {kind: "day", at: localAt(11, 18, 21, 2025), today: DIVIDER_TODAY}}},
    {id: "unread", label: "未读：以下是新消息", input: {props: {kind: "unread", today: DIVIDER_TODAY}}},
];

/** 没有数据 prop，登记处声明 noInput，场景不带 input。 */
export const agentDeliveryNoticeScenes: Array<{id: string; label: string}> = [
    {id: "default", label: "投递状态未知"},
];

export const agentRawViewScenes: LabFixtureDefinition<typeof AgentRawView>["scenes"] = [
    {id: "long-conversation", label: "多轮长对话", input: {props: {messages: longConversationMessages, ctx: conversationContext()}}},
    {id: "message-states", label: "附件与投递状态", input: {props: {messages: messageStateMessages, ctx: conversationContext({messages: messageStateMessages})}}},
];
