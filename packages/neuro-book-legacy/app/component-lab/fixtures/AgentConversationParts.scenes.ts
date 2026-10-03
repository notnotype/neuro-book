import type AgentCard from "../../components/agent/AgentCard.vue";
import type AgentFileChanges from "../../components/agent/AgentFileChanges.vue";
import type AgentMarkdown from "../../components/agent/AgentMarkdown.vue";
import type AgentMessageActions from "../../components/agent/AgentMessageActions.vue";
import type AgentConversationTurn from "../../components/agent/AgentConversationTurn.vue";
import {
    conversationContext,
    longConversationMessages,
    messageStateMessages,
    runningConversationMessages,
    runningConversationNow,
    taskCallSamples,
    toolCallSamples,
    turnSamples,
} from "./agent-conversation-fixture-data";
import type AgentRawView from "../../components/agent/AgentRawView.vue";
import type AgentUserContent from "../../components/agent/AgentUserContent.vue";
import type {UserMessageView} from "../../components/agent/agent-view.types";
import type AgentCodeBlock from "../../components/agent/AgentCodeBlock.vue";
import type AgentCommandDetail from "../../components/agent/AgentCommandDetail.vue";
import type AgentFileContentDetail from "../../components/agent/AgentFileContentDetail.vue";
import type AgentFileDiffDetail from "../../components/agent/AgentFileDiffDetail.vue";
import type AgentToolDetail from "../../components/agent/AgentToolDetail.vue";
import type AgentStepLine from "../../components/agent/AgentStepLine.vue";
import type AgentChainSummary from "../../components/agent/AgentChainSummary.vue";
import type AgentTaskList from "../../components/agent/AgentTaskList.vue";
import type AgentTaskListNode from "../../components/agent/AgentTaskListNode.vue";
import type AgentTurnBlock from "../../components/agent/AgentTurnBlock.vue";
import {createAgentViewRegistry} from "../../components/agent/agent-view-registry";
import {builtinRolesContribution} from "../../components/agent/builtin-roles";
import {builtinToolsContribution} from "../../components/agent/builtin-tools";
import {buildTurns, type ConversationTurn, type TurnBlock} from "../../components/agent/conversation-turns";
import type {LabFixtureDefinition} from "./index";

export const agentCardScenes: LabFixtureDefinition<typeof AgentCard>["scenes"] = [
    {id: "collapsed", label: "折叠", input: {props: {icon: "i-lucide-terminal", title: "运行命令", subtitle: "wc -m chapters/06.md", status: "success", expanded: false}, slots: {default: true}}},
    {id: "expanded", label: "展开", input: {props: {icon: "i-lucide-terminal", title: "运行命令", subtitle: "wc -m chapters/06.md", status: "success", expanded: true}, slots: {default: true}}},
    {id: "running", label: "运行中", input: {props: {icon: "i-lucide-workflow", title: "运行 Workflow", subtitle: "suspense-check", status: "running", expanded: false}, slots: {default: true}}},
    {id: "error", label: "出错", input: {props: {icon: "i-lucide-database", title: "执行 SQL", subtitle: "SELECT * FROM chapters WHERE id = 6", status: "error", expanded: true}, slots: {default: true}}},
    {id: "static-actions", label: "常显正文与操作", input: {props: {icon: "i-lucide-message-circle-question", title: "提问", subtitle: "主角的性别？", status: "waiting"}, slots: {default: true, actions: true}}},
];

export const agentStepLineScenes: LabFixtureDefinition<typeof AgentStepLine>["scenes"] = [
    {id: "read", label: "读取", input: {props: {icon: "i-lucide-file-text", label: "读取", detail: "chapters/03.md"}}},
    {id: "edit", label: "改文件", input: {props: {icon: "i-lucide-file-pen", label: "编辑", detail: "chapters/03.md", stat: {added: 3, removed: 4}}}},
    {id: "running", label: "运行中", input: {props: {icon: "i-lucide-search", label: "搜索", detail: "机械表 擒纵机构 工作原理", status: "running"}}},
    {id: "error", label: "出错", input: {props: {icon: "i-lucide-file-text", label: "读取", detail: "chapters/99.md", status: "error"}}},
    {id: "expandable", label: "可展开", input: {props: {icon: "i-lucide-layers", label: "读取 6 个文件，搜索 1 次", expanded: true}, slots: {default: true}}},
];

export const agentChainSummaryScenes: LabFixtureDefinition<typeof AgentChainSummary>["scenes"] = [
    {id: "collapsed", label: "折叠", input: {props: {expanded: false, icon: "i-lucide-brain", label: "思考 · 读了 7 个文件，改了 2 个 · 另有 3 次操作"}}},
    {id: "expanded", label: "展开，带失败提醒", input: {props: {expanded: true, icon: "i-lucide-brain", label: "思考 · 读了 2 个文件，改了 1 个", alert: "1 次失败"}}},
    {id: "turn", label: "整轮过程", input: {props: {expanded: false, label: "过程 · 14 次操作 · 读了 7 个文件，改了 2 个"}}},
    {id: "running", label: "运行中", input: {props: {expanded: false, running: true, label: "读取 notes/foreshadowing.md"}}},
    {id: "overflow", label: "放不下时截断", input: {props: {expanded: false, icon: "i-lucide-wrench", label: "思考 · 读了 64 个文件，改了 37 个 · 另有 128 次操作 · 另有若干说明文字与系统提示词", alert: "3 次失败"}}},
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
    {id: "created", label: "task_create：完整清单", input: {props: {call: taskCallSamples.created, ctx: conversationContext()}}},
    {id: "updated", label: "task_set_status：与上一版比对", input: {props: {call: taskCallSamples.updated, ctx: conversationContext()}}},
    {id: "running", label: "结果未返回：通用卡片", input: {props: {call: taskCallSamples.running, ctx: conversationContext()}}},
];

/** 轮次块的样例：用分轮模型从 fixture 消息里算出来，与视图里看到的块一致。 */
const sampleRegistry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution]);
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

export const agentCodeBlockScenes: LabFixtureDefinition<typeof AgentCodeBlock>["scenes"] = [
    {id: "numbered", label: "带行号", input: {props: {label: "chapters/03.md", startLine: 12, lines: [{text: "雨从傍晚开始下。"}, {text: "林默把最后一块表壳擦干净，抬头看了一眼门外。"}, {text: ""}, {text: "他想起那年冬天。"}]}}},
    {id: "diff", label: "diff", input: {props: {label: "chapters/03.md", lines: [{text: "他想起那年冬天。", tone: "removed"}, {text: "那年冬天很冷。", tone: "removed"}, {text: "他想起那年冬天，父亲冻裂的手。", tone: "added"}, {text: "⋯", tone: "muted"}, {text: "雨还在下。", tone: "added"}]}}},
    {id: "long-line", label: "长行在块内横向滚动，内容为预览", input: {props: {truncated: true, lines: [{text: "这是一行非常长的文本，".repeat(20)}, {text: "第二行"}]}}},
    {id: "empty", label: "无内容", input: {props: {label: "参数", lines: []}}},
];

const detailCtx = conversationContext();

export const agentToolDetailScenes: LabFixtureDefinition<typeof AgentToolDetail>["scenes"] = [
    {id: "read", label: "read：文件内容适配", input: {props: {call: toolCallSamples.read, ctx: detailCtx}}},
    {id: "edit", label: "edit：diff 适配", input: {props: {call: toolCallSamples.edit, ctx: detailCtx}}},
    {id: "bash", label: "bash：命令适配", input: {props: {call: toolCallSamples.bash, ctx: detailCtx}}},
    {id: "unadapted", label: "没有适配：原始参数与结果", input: {props: {call: toolCallSamples.unadapted, ctx: detailCtx}}},
    {id: "error", label: "出错：错误在上，下面照常显示", input: {props: {call: toolCallSamples.error, ctx: detailCtx}}},
];

export const agentFileContentDetailScenes: LabFixtureDefinition<typeof AgentFileContentDetail>["scenes"] = [
    {id: "full", label: "从第 1 行", input: {props: {call: toolCallSamples.read, ctx: detailCtx}}},
    {id: "offset", label: "带 offset", input: {props: {call: toolCallSamples.readOffset, ctx: detailCtx}}},
    {id: "running", label: "还没有结果", input: {props: {call: toolCallSamples.readRunning, ctx: detailCtx}}},
];

export const agentFileDiffDetailScenes: LabFixtureDefinition<typeof AgentFileDiffDetail>["scenes"] = [
    {id: "edit", label: "edit：两个片段", input: {props: {call: toolCallSamples.edit, ctx: detailCtx}}},
    {id: "write", label: "write：整文件新增", input: {props: {call: toolCallSamples.write, ctx: detailCtx}}},
    {id: "patch", label: "apply_patch", input: {props: {call: toolCallSamples.patch, ctx: detailCtx}}},
];

export const agentCommandDetailScenes: LabFixtureDefinition<typeof AgentCommandDetail>["scenes"] = [
    {id: "bash", label: "bash", input: {props: {call: toolCallSamples.bash, ctx: detailCtx}}},
    {id: "running", label: "还没有结果", input: {props: {call: {id: "d7r", name: "bash", status: "running", args: {command: "wc -m chapters/*.md"}}, ctx: detailCtx}}},
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
    {id: "text", label: "只有文字", input: {props: {message: userSample(4)}}},
];

/** 没有数据 prop，登记处声明 noInput，场景不带 input。 */
export const agentDeliveryNoticeScenes: Array<{id: string; label: string}> = [
    {id: "default", label: "投递状态未知"},
];

export const agentRawViewScenes: LabFixtureDefinition<typeof AgentRawView>["scenes"] = [
    {id: "long-conversation", label: "多轮长对话", input: {props: {messages: longConversationMessages, ctx: conversationContext()}}},
    {id: "message-states", label: "附件与投递状态", input: {props: {messages: messageStateMessages, ctx: conversationContext({messages: messageStateMessages})}}},
];
