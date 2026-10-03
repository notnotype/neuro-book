/**
 * 分轮规则：把按时间排列的消息整理成轮次，供分轮视图渲染。纯函数，不持有状态。
 *
 * 规则以 Spec「分轮视图」为准，核心是按注意力分三层：
 * - 常显层：Agent 说出的 content、人机交互控件（渲染器 `presentation: "node"`）、
 *   信息条目（系统提醒、自定义消息）、分隔线、steer、错误。
 * - 思维链：思考、普通工具调用、系统提示词。两个常显条目之间的思维链合成一条，默认折叠。
 * - 汇总层：本轮改动的文件与用量，放在轮末。
 *
 * 中间的 content 只在运行中常显；运行结束后并入思维链，常显层只留最终回复。
 * 已结束的轮次还可以整轮收起：翻看历史时只看最终回复与轮末汇总，其余内容收成一行过程摘要（见 `foldable`）。
 * 输出是纯数据，可以完整 JSON 化：工具步骤只带调用本身，渲染器由视图按工具名向注册表查询。
 *
 * 轮次从一条普通用户消息开始，到下一条普通用户消息之前结束；steer 不开启新轮次。
 * 最终回复是本轮最后一条正文非空、自身不调用工具、且其后再无工具调用的 assistant 消息。
 */
import type {
    AssistantMessageView,
    HistoryView,
    MessageView,
    RunView,
    SystemMessageView,
    ToolCallView,
    UserMessageView,
    ViewText,
} from "./agent-view.types";
import type {AgentViewRegistry, FileChangeView, ToolEffects, ToolRendererEntry} from "./agent-view-registry";

export type TurnStatus = "running" | "waiting" | "done" | "error" | "stopped";

export type ToolStep = {
    kind: "tool";
    id: string;
    messageId: string;
    call: ToolCallView;
};

export type ThinkingStep = {kind: "thinking"; id: string; messageId: string; text: string};

/** 运行结束后并入思维链的中间 content。 */
export type NarrationStep = {kind: "text"; id: string; messageId: string; text: string};

/** 系统提示词条目（source 为 `prompt`）；写给模型看的，只在思维链里出现。 */
export type PromptStep = {kind: "prompt"; id: string; message: SystemMessageView};

/** 思维链里一条新 assistant 消息的开始；展开后显示为细分隔，让人能数出消息的边界。 */
export type BoundaryStep = {kind: "boundary"; id: string; messageId: string};

/** 工具组内部按原顺序保留被它包住的思考与消息边界，展开时逐项显示。 */
export type ToolGroupItem = ToolStep | ThinkingStep | BoundaryStep;

export type ToolGroupStep = {
    kind: "toolGroup";
    id: string;
    items: ToolGroupItem[];
    tools: ToolStep[];
    /** 合并摘要的各段，例如“读取 5 个文件”“搜索 2 次”，按首次出现排序。 */
    phrases: ViewText[];
    /** 正在执行的那一项；组头实时显示它。 */
    active: ToolStep | null;
    /** 出错的项；组折叠时仍单独露出。 */
    failed: ToolStep[];
};

export type ChainEntry = ToolStep | ToolGroupStep | ThinkingStep | NarrationStep | PromptStep | BoundaryStep;

export type ChainSummary = {
    /** 工具调用次数。 */
    steps: number;
    filesRead: number;
    filesChanged: number;
    /** 成功但既没读也没改文件的工具调用次数，例如搜索、命令。 */
    others: number;
    /** 出错或参数无效的工具调用次数。 */
    failed: number;
    /** 包含思考。 */
    thinking: boolean;
    /** 涉及的 assistant 消息条数。 */
    messages: number;
};

/** 一条思维链：两个常显条目之间的全部思考与普通工具调用。 */
export type ChainBlock = {
    kind: "chain";
    /** 取第一项的 id，流式追加时保持不变。 */
    id: string;
    entries: ChainEntry[];
    summary: ChainSummary;
    /** 正在执行的工具；折叠时摘要行实时显示它。 */
    active: ToolStep | null;
};

export type TurnBlock =
    | ChainBlock
    | {kind: "content"; id: string; message: AssistantMessageView; final: boolean}
    | {kind: "node"; id: string; step: ToolStep}
    | {kind: "notice"; id: string; message: SystemMessageView}
    | {kind: "divider"; id: string; message: SystemMessageView}
    | {kind: "steer"; id: string; message: UserMessageView}
    | {kind: "error"; id: string; message: string};

export type TurnMetrics = {
    /** 开头不完整的轮次不知道起点，为 null。 */
    durationMs: number | null;
    /** 本轮工具调用次数。 */
    steps: number;
    /** 出错或参数无效的工具调用次数。 */
    failed: number;
    filesRead: number;
    filesChanged: number;
    /** 本轮没有任何用量数据时为 null。 */
    tokens: number | null;
    cost: number | null;
    /** tokens 的构成；没有用量数据时为 null。 */
    usage: {input: number; output: number; cacheRead: number; cacheWrite: number} | null;
};

/** 本轮改动过的一个文件；`toolCallId` 是最后一次改它的调用。 */
export type ChangedFile = {toolCallId: string; change: FileChangeView};

export type ConversationTurn = {
    /** 本轮第一条消息的 id。开头不完整的轮次在更早一页加载后会换成用户消息的 id。 */
    id: string;
    /** 开场轮次与开头不完整的轮次为 null。 */
    user: UserMessageView | null;
    /** 本轮的用户消息在尚未加载的更早历史里。 */
    truncatedStart: boolean;
    /** 用户消息之后的全部内容，按时间顺序。 */
    blocks: TurnBlock[];
    /** 最终回复之后的分隔线（压缩、分支摘要），显示在轮末汇总下方。 */
    trailing: TurnBlock[];
    finalReply: AssistantMessageView | null;
    status: TurnStatus;
    metrics: TurnMetrics;
    /** 按路径合并；只算成功的调用。 */
    changedFiles: ChangedFile[];
    /**
     * `blocks` 末尾“结果”部分的起点：从这里开始到末尾都是最终回复或错误。
     * 之前的是过程；没有结果时等于 `blocks.length`。
     */
    outcomeStart: number;
    /** 可以整轮收起：轮次已结束且有过程。收起时只露出结果，过程收成一行摘要。 */
    foldable: boolean;
};

function isOutcome(block: TurnBlock): boolean {
    return (block.kind === "content" && block.final) || block.kind === "error";
}

/**
 * 从末尾往前越过结果与信息条目，再从那里往后跳过打头的信息条目：最终回复之后追加的系统提醒
 * 跟着结果显示，不会把最终回复连同它一起收进过程；结果之前的提醒仍属于过程。
 */
function findOutcomeStart(blocks: readonly TurnBlock[]): number {
    let start = blocks.length;
    while (start > 0 && (isOutcome(blocks[start - 1]!) || blocks[start - 1]!.kind === "notice")) {
        start -= 1;
    }
    while (start < blocks.length && !isOutcome(blocks[start]!)) {
        start += 1;
    }
    return start;
}

/** 构建轮次需要的会话状态。 */
export type TurnEnvironment = {
    registry: AgentViewRegistry;
    run: RunView;
    history: HistoryView;
    now: number;
};

export type BuildTurnsInput = TurnEnvironment & {messages: readonly MessageView[]};

/** 一轮在整段对话中的位置：最新一轮跟随运行状态，第一轮可能开头不完整。 */
export type TurnPosition = {isLatest: boolean; isFirst: boolean};

export function buildTurns(input: BuildTurnsInput): ConversationTurn[] {
    const groups = splitIntoTurnGroups(input.messages);
    return groups.map((group, index) => buildTurn(group, input, {
        isLatest: index === groups.length - 1,
        isFirst: index === 0,
    }));
}

/** 按轮次边界切分；每组第一条要么是普通用户消息，要么是开场或开头不完整的内容。 */
export function splitIntoTurnGroups(messages: readonly MessageView[]): MessageView[][] {
    const groups: MessageView[][] = [];
    for (const message of messages) {
        const current = groups.at(-1);
        if ((message.kind === "user" && message.intent === "normal") || current === undefined) {
            groups.push([message]);
        } else {
            current.push(message);
        }
    }
    return groups;
}

/**
 * 给各组分配视图 key，尽量沿用上一次的：开头不完整的轮次在更早一页加载后，前面会补上更早的消息
 * （分页不按轮次切，补上的可能是它的用户消息，也可能只是更早的过程），第一条消息因此变了。
 * 沿用组里第一条“上次是组首”的消息的 key，视图才能保持同一个组件，手动展开的状态与阅读位置都不丢。
 * `previous` 是上一次的结果，按每组第一条消息的 id 索引。
 */
export function assignTurnKeys(groups: readonly (readonly MessageView[])[], previous: ReadonlyMap<string, string>): Map<string, string> {
    const keys = new Map<string, string>();
    for (const group of groups) {
        const kept = group.find((message) => previous.has(message.id));
        keys.set(group[0]!.id, kept === undefined ? group[0]!.id : previous.get(kept.id)!);
    }
    return keys;
}

type TurnContext = TurnEnvironment & TurnPosition;

/** 由 splitIntoTurnGroups 切出的一组消息构建一轮。 */
export function buildTurn(group: readonly MessageView[], environment: TurnEnvironment, position: TurnPosition): ConversationTurn {
    const context: TurnContext = {...environment, ...position};
    const head = group[0]!;
    const user = head.kind === "user" && head.intent === "normal" ? head : null;
    const body = user === null ? group : group.slice(1);
    const finalReply = findFinalReply(body);
    const status = resolveStatus(body, context);
    const finished = status !== "running" && status !== "waiting";
    const blocks = buildBlocks(body, finalReply, finished, context.registry);
    const trailing = splitTrailing(blocks);
    const outcomeStart = findOutcomeStart(blocks);
    const tools = collectTools(body);
    const truncatedStart = user === null && context.isFirst && context.history.hasMore;
    return {
        id: head.id,
        user,
        truncatedStart,
        blocks,
        trailing,
        finalReply,
        status,
        metrics: computeMetrics(group, tools, status, truncatedStart, context.now, context.registry),
        changedFiles: collectChangedFiles(tools, context.registry),
        outcomeStart,
        foldable: finished && outcomeStart > 0,
    };
}

function isDividerSource(message: SystemMessageView): boolean {
    return message.source === "compaction" || message.source === "branch_summary";
}

function findFinalReply(body: readonly MessageView[]): AssistantMessageView | null {
    for (let index = body.length - 1; index >= 0; index -= 1) {
        const message = body[index]!;
        if (message.kind !== "assistant") {
            continue;
        }
        if (message.toolCalls.length > 0) {
            return null;
        }
        if (message.text.trim() !== "") {
            return message;
        }
    }
    return null;
}

/** 线性思维链项；分组前的形状。 */
type FlatEntry = ToolStep | ThinkingStep | NarrationStep | PromptStep | BoundaryStep;

function buildBlocks(
    body: readonly MessageView[],
    finalReply: AssistantMessageView | null,
    finished: boolean,
    registry: AgentViewRegistry,
): TurnBlock[] {
    const blocks: TurnBlock[] = [];
    let chain: FlatEntry[] = [];
    /** 思维链里最后一项所属的 assistant 消息；换了消息才插边界，所以边界不会落在链尾。 */
    let chainMessageId: string | null = null;
    const flush = () => {
        if (chain.length > 0) {
            blocks.push(makeChain(chain, registry));
            chain = [];
            chainMessageId = null;
        }
    };
    const append = (entry: ThinkingStep | NarrationStep | ToolStep) => {
        if (chainMessageId !== null && chainMessageId !== entry.messageId) {
            chain.push({kind: "boundary", id: `${entry.messageId}:boundary`, messageId: entry.messageId});
        }
        chain.push(entry);
        chainMessageId = entry.messageId;
    };

    for (const message of body) {
        switch (message.kind) {
            case "user":
                flush();
                blocks.push({kind: "steer", id: message.id, message});
                break;
            case "system":
                if (message.source === "prompt") {
                    chain.push({kind: "prompt", id: message.id, message});
                } else {
                    flush();
                    blocks.push(isDividerSource(message)
                        ? {kind: "divider", id: message.id, message}
                        : {kind: "notice", id: message.id, message});
                }
                break;
            case "error":
                flush();
                blocks.push({kind: "error", id: message.id, message: message.message});
                break;
            case "assistant":
                if (message.thinking.trim() !== "") {
                    append({kind: "thinking", id: `${message.id}:thinking`, messageId: message.id, text: message.thinking});
                }
                if (message.text.trim() !== "") {
                    if (message === finalReply || !finished) {
                        flush();
                        blocks.push({kind: "content", id: `${message.id}:text`, message, final: message === finalReply});
                    } else {
                        append({kind: "text", id: `${message.id}:text`, messageId: message.id, text: message.text});
                    }
                }
                for (const call of message.toolCalls) {
                    const step: ToolStep = {kind: "tool", id: call.id, messageId: message.id, call};
                    if (registry.resolveTool(call.name).presentation === "node") {
                        flush();
                        blocks.push({kind: "node", id: call.id, step});
                    } else {
                        append(step);
                    }
                }
                if (message.status === "error" && message.error !== undefined && message.error !== "") {
                    flush();
                    blocks.push({kind: "error", id: `${message.id}:error`, message: message.error});
                }
                break;
        }
    }
    flush();
    return blocks;
}

/** 最终回复之后的分隔线移出 `blocks`，由视图放到轮末汇总下方。 */
function splitTrailing(blocks: TurnBlock[]): TurnBlock[] {
    const replyIndex = blocks.findIndex((block) => block.kind === "content" && block.final);
    if (replyIndex < 0) {
        return [];
    }
    let start = blocks.length;
    while (start > replyIndex + 1 && blocks[start - 1]!.kind === "divider") {
        start -= 1;
    }
    return blocks.splice(start);
}

function makeChain(flat: readonly FlatEntry[], registry: AgentViewRegistry): ChainBlock {
    const tools = flat.filter((entry): entry is ToolStep => entry.kind === "tool");
    const read = new Set<string>();
    const changed = new Set<string>();
    let touching = 0;
    for (const {effects} of settledEffects(tools, registry)) {
        effects.read.forEach((path) => read.add(path));
        effects.changed.forEach((change) => changed.add(change.path));
        if (effects.read.length > 0 || effects.changed.length > 0) {
            touching += 1;
        }
    }
    const messages = new Set(flat.flatMap((entry) => "messageId" in entry ? [entry.messageId] : []));
    return {
        kind: "chain",
        id: `chain:${flat[0]!.id}`,
        entries: groupExploreTools(flat, registry),
        summary: {
            steps: tools.length,
            filesRead: read.size,
            filesChanged: changed.size,
            others: tools.filter((tool) => tool.call.status === "success").length - touching,
            failed: tools.filter(isFailed).length,
            thinking: flat.some((entry) => entry.kind === "thinking"),
            messages: messages.size,
        },
        active: tools.findLast(isActive) ?? null,
    };
}

function isActive(tool: ToolStep): boolean {
    return tool.call.status === "running" || tool.call.status === "streaming";
}

function isFailed(tool: ToolStep): boolean {
    return tool.call.status === "error" || tool.call.status === "invalid";
}

function collectTools(body: readonly MessageView[]): ToolStep[] {
    return body.flatMap((message) => message.kind !== "assistant" ? [] : message.toolCalls.map((call): ToolStep => ({
        kind: "tool", id: call.id, messageId: message.id, call,
    })));
}

function isExploreTool(entry: FlatEntry, registry: AgentViewRegistry): entry is ToolStep {
    return entry.kind === "tool" && registry.resolveTool(entry.call.name).category === "explore";
}

/**
 * 把连续的探查工具合成工具组。思考与消息边界夹在两次探查之间时并入组内：
 * 带思考的模型几乎每一步都有思考、每次调用都是一条新消息，如果它们也打断分组，工具组就形同虚设。
 * 中间 content、其他类别的工具与系统提示词会结束当前组。只有一次探查时不成组。
 */
function groupExploreTools(entries: readonly FlatEntry[], registry: AgentViewRegistry): ChainEntry[] {
    const output: ChainEntry[] = [];
    let buffer: ToolGroupItem[] = [];

    const flush = () => {
        let lastTool = -1;
        buffer.forEach((item, index) => {
            if (item.kind === "tool") {
                lastTool = index;
            }
        });
        const enclosed = buffer.slice(0, lastTool + 1);
        const trailing = buffer.slice(lastTool + 1);
        const tools = enclosed.filter((item): item is ToolStep => item.kind === "tool");
        if (tools.length >= 2) {
            output.push(makeToolGroup(enclosed, tools, registry));
        } else {
            output.push(...enclosed);
        }
        output.push(...trailing);
        buffer = [];
    };

    for (const entry of entries) {
        if (isExploreTool(entry, registry)) {
            buffer.push(entry);
        } else if ((entry.kind === "thinking" || entry.kind === "boundary") && buffer.length > 0) {
            buffer.push(entry);
        } else {
            flush();
            output.push(entry);
        }
    }
    flush();
    return output;
}

function makeToolGroup(items: ToolGroupItem[], tools: ToolStep[], registry: AgentViewRegistry): ToolGroupStep {
    const counts = new Map<ToolRendererEntry, number>();
    for (const tool of tools) {
        const renderer = registry.resolveTool(tool.call.name);
        counts.set(renderer, (counts.get(renderer) ?? 0) + 1);
    }
    const phrases: ViewText[] = [];
    for (const [renderer, count] of counts) {
        phrases.push(renderer.groupPhrase?.(count) ?? {key: "agentView.toolGroup.generic", params: {count}});
    }
    const active = tools.findLast(isActive) ?? null;
    return {
        kind: "toolGroup",
        id: `group:${tools[0]!.id}`,
        items,
        tools,
        phrases,
        active,
        failed: tools.filter(isFailed),
    };
}

function resolveStatus(body: readonly MessageView[], context: TurnContext): TurnStatus {
    if (context.isLatest) {
        if (context.run.status === "running" || context.run.status === "stopping") {
            return "running";
        }
        if (context.run.status === "waiting") {
            return "waiting";
        }
    }
    const ending = body.findLast((message) => message.kind !== "system");
    if (ending === undefined) {
        return "done";
    }
    if (ending.kind === "error") {
        return "error";
    }
    if (ending.kind === "assistant") {
        if (ending.status === "error" || ending.status === "interrupted") {
            return "error";
        }
        if (ending.status === "stopped") {
            return "stopped";
        }
    }
    return "done";
}

function computeMetrics(
    group: readonly MessageView[],
    tools: readonly ToolStep[],
    status: TurnStatus,
    truncatedStart: boolean,
    now: number,
    registry: AgentViewRegistry,
): TurnMetrics {
    const read = new Set<string>();
    const changed = new Set<string>();
    for (const {effects} of settledEffects(tools, registry)) {
        effects.read.forEach((path) => read.add(path));
        effects.changed.forEach((change) => changed.add(change.path));
    }
    const totals = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
    let costTotal = 0;
    let hasUsage = false;
    for (const message of group) {
        if (message.kind === "assistant" && message.usage !== undefined) {
            const part = message.usage;
            totals.input += part.input;
            totals.output += part.output;
            totals.cacheRead += part.cacheRead;
            totals.cacheWrite += part.cacheWrite;
            costTotal += part.cost;
            hasUsage = true;
        }
    }
    const usage = hasUsage ? totals : null;
    const cost = hasUsage ? costTotal : null;
    const tokens = hasUsage ? totals.input + totals.output + totals.cacheRead + totals.cacheWrite : null;
    const live = status === "running" || status === "waiting";
    // 消息只有开始时间，结束于最后一条消息开始的时刻是近似值；运行中按宿主提供的 now 计算。
    const end = live ? now : group.at(-1)!.timestamp;
    return {
        durationMs: truncatedStart ? null : Math.max(0, end - group[0]!.timestamp),
        steps: tools.length,
        failed: tools.filter(isFailed).length,
        filesRead: read.size,
        filesChanged: changed.size,
        tokens,
        cost,
        usage,
    };
}

/** 只有成功的调用才算真正读过或改过文件。 */
function settledEffects(tools: readonly ToolStep[], registry: AgentViewRegistry): Array<{tool: ToolStep; effects: ToolEffects}> {
    return tools.flatMap((tool) => {
        const effects = tool.call.status === "success" ? registry.resolveTool(tool.call.name).effects : undefined;
        return effects === undefined ? [] : [{tool, effects: effects(tool.call)}];
    });
}

function collectChangedFiles(tools: readonly ToolStep[], registry: AgentViewRegistry): ChangedFile[] {
    const files = new Map<string, ChangedFile>();
    for (const {tool, effects} of settledEffects(tools, registry)) {
        for (const change of effects.changed) {
            const previous = files.get(change.path);
            files.set(change.path, previous === undefined
                ? {toolCallId: tool.id, change: {...change}}
                : {toolCallId: tool.id, change: mergeChange(previous.change, change)});
        }
    }
    return [...files.values()];
}

function mergeChange(previous: FileChangeView, next: FileChangeView): FileChangeView {
    return {
        path: previous.path,
        added: previous.added === null || next.added === null ? null : previous.added + next.added,
        removed: previous.removed === null || next.removed === null ? null : previous.removed + next.removed,
    };
}

/**
 * 可收起轮次的默认展开状态（用户没有手动操作过时）：最新一轮出错或被停止时展开，方便看清停在哪；其余收起。
 * 运行中与等待回答的轮次不可收起，不经过这里。
 */
export function defaultTurnExpanded(turn: ConversationTurn, isLatest: boolean): boolean {
    return isLatest && (turn.status === "error" || turn.status === "stopped");
}
