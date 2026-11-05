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
import type {Text} from "@notnotype/nb-ui/text";

import type {
    AssistantMessageView,
    HistoryView,
    MessageView,
    RunView,
    SystemMessageView,
    ToolCallView,
    UserMessageView,
} from "./types";
import type {AgentViewRegistry, FileChangeView, ToolEffects, ToolRendererEntry} from "./registry";
import {agentRef} from "./text";
import {toolCallPhase} from "./tool-status";

export type TurnStatus = "running" | "waiting" | "done" | "error" | "stopped";

export type ToolStep = {
    kind: "tool";
    id: string;
    messageId: string;
    call: ToolCallView;
};

export type ThinkingStep = {kind: "thinking"; id: string; messageId: string; text: string};

/** 运行结束后并入思维链的中间 content；带着消息，它的附注画在文字之后。`text` 即 `message.text`，与 `ThinkingStep` 同形。 */
export type NarrationStep = {kind: "text"; id: string; messageId: string; text: string; message: AssistantMessageView};

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
    phrases: Text[];
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
    /** 没有文字的助手消息上的附注，单独一行；分轮时与信息条目同样对待。有文字时附注跟着文字画，不成块。 */
    | {kind: "annotations"; id: string; message: AssistantMessageView}
    | {kind: "divider"; id: string; message: SystemMessageView}
    | {kind: "steer"; id: string; message: UserMessageView}
    | {kind: "error"; id: string; message: Text};

export type TurnMetrics = {
    /** 开头不完整的轮次不知道起点，为 null。 */
    durationMs: number | null;
    /** 本轮工具调用次数。 */
    steps: number;
    /** 本轮模型回了几次（助手消息条数）；provider 丢弃后重试的请求看不到，不算。 */
    requests: number;
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
    /** 过程里的分隔线（一轮中途的压缩）：整轮收起时也要看得到，视图放在整轮摘要行与结果之间；展开时它们就在过程里。 */
    processDividers: TurnBlock[];
    finalReply: AssistantMessageView | null;
    /**
     * 结果所在的消息：最后一个结果块（最终回复或结果节点）所属的 assistant 消息；助手一侧的消息操作作用于它。
     * 只有错误、没有结果时为 null。
     */
    outcomeMessage: AssistantMessageView | null;
    /** 结果是结果节点时，那次调用的 id；结果是最终回复时为 null。 */
    outcomeCallId: string | null;
    status: TurnStatus;
    metrics: TurnMetrics;
    /** 按路径合并；只算成功的调用。 */
    changedFiles: ChangedFile[];
    /**
     * `blocks` 末尾“结果”部分的起点：从这里开始到末尾都是最终回复、结果节点或错误。
     * 之前的是过程；没有结果时等于 `blocks.length`。
     */
    outcomeStart: number;
    /** 可以整轮收起：轮次已结束且有过程。收起时只露出结果，过程收成一行摘要。 */
    foldable: boolean;
};

/** 最终回复与成功的结果节点：一轮的答案。错误另算，它也是结果，但不当作“结果所在的消息”。 */
function isAnswer(block: TurnBlock, registry: AgentViewRegistry): boolean {
    if (block.kind === "content") return block.final;
    return block.kind === "node" && block.step.call.status === "success" && registry.resolveTool(block.step.call.name).outcome === true;
}

/** 信息条目与单独成行的附注：跟着前面的结果显示，不算结果也不切开结果区。 */
function isNoticeLike(block: TurnBlock): boolean {
    return block.kind === "notice" || block.kind === "annotations";
}

function isOutcome(block: TurnBlock, registry: AgentViewRegistry): boolean {
    return isAnswer(block, registry) || block.kind === "error";
}

/**
 * 从末尾往前越过结果与信息条目，再从那里往后跳过打头的信息条目：最终回复之后追加的系统提醒
 * 跟着结果显示，不会把最终回复连同它一起收进过程；结果之前的提醒仍属于过程。
 */
function findOutcomeStart(blocks: readonly TurnBlock[], registry: AgentViewRegistry): number {
    let start = blocks.length;
    while (start > 0 && (isOutcome(blocks[start - 1]!, registry) || isNoticeLike(blocks[start - 1]!))) {
        start -= 1;
    }
    while (start < blocks.length && !isOutcome(blocks[start]!, registry)) {
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

/**
 * 新切出的分组里，消息与上一次逐条相同的那组沿用上一次的数组。宿主每秒整体替换 ctx 打节拍时，消息没变的轮次拿到的是
 * 同一个数组，不必重新整理（消息本身由适配器保证没改动时引用不变）。
 */
export function reuseTurnGroups(previous: readonly MessageView[][], next: MessageView[][]): MessageView[][] {
    const byHead = new Map(previous.map((group) => [group[0]!.id, group]));
    return next.map((group) => {
        const old = byHead.get(group[0]!.id);
        return old !== undefined && old.length === group.length && old.every((message, index) => message === group[index]) ? old : group;
    });
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
    const trailing = splitTrailing(blocks, context.registry);
    const outcomeStart = findOutcomeStart(blocks, context.registry);
    const answer = findLastAnswer(blocks, outcomeStart, context.registry);
    const outcomeCallId = answer?.kind === "node" ? answer.step.call.id : null;
    // 结果区里的结果节点显示为结果，不是过程：不计入整轮摘要的操作次数。它们改的文件照常算进改动文件与读改文件数。
    const outcomeCalls = new Set(blocks.slice(outcomeStart).flatMap((block) => (block.kind === "node" && isAnswer(block, context.registry) ? [block.step.call.id] : [])));
    const tools = collectTools(body);
    const truncatedStart = user === null && context.isFirst && context.history.hasMore;
    return {
        id: head.id,
        user,
        truncatedStart,
        blocks,
        trailing,
        processDividers: blocks.slice(0, outcomeStart).filter((block) => block.kind === "divider"),
        finalReply,
        outcomeMessage: answer === null ? null : answerMessage(answer, body),
        outcomeCallId,
        status,
        metrics: computeMetrics(group, tools, outcomeCalls, status, truncatedStart, context.now, context.registry),
        changedFiles: collectChangedFiles(tools, context.registry),
        outcomeStart,
        foldable: finished && outcomeStart > 0,
    };
}

function findLastAnswer(blocks: readonly TurnBlock[], outcomeStart: number, registry: AgentViewRegistry): Extract<TurnBlock, {kind: "content" | "node"}> | null {
    for (let index = blocks.length - 1; index >= outcomeStart; index -= 1) {
        const block = blocks[index]!;
        if ((block.kind === "content" || block.kind === "node") && isAnswer(block, registry)) return block;
    }
    return null;
}

function answerMessage(answer: Extract<TurnBlock, {kind: "content" | "node"}>, body: readonly MessageView[]): AssistantMessageView | null {
    if (answer.kind === "content") return answer.message;
    const found = body.find((message) => message.kind === "assistant" && message.id === answer.step.messageId);
    return found?.kind === "assistant" ? found : null;
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
                        append({kind: "text", id: `${message.id}:text`, messageId: message.id, text: message.text, message});
                    }
                }
                for (const call of message.toolCalls) {
                    const step: ToolStep = {kind: "tool", id: call.id, messageId: message.id, call};
                    const renderer = registry.resolveTool(call.name);
                    // 结果工具被退回（出错、参数无效，或运行结束时还没有结果）的那几次属于过程：进思维链画成一行，不画宿主的
                    // 节点组件，免得和作数的那张并排（Spec“术语”的结果节点）。运行中的照旧是节点，宿主组件看得到正在写的答案；
                    // 运行已结束却仍在写的（宿主没把它标成出错）同样算退回，不留一张永远在写的卡片。
                    const phase = toolCallPhase(call.status);
                    const rejectedOutcome = renderer.outcome === true && (phase === "error" || (finished && phase === "running"));
                    if (renderer.presentation === "node" && !rejectedOutcome) {
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
                if (message.text.trim() === "" && (message.annotations?.length ?? 0) > 0) {
                    flush();
                    blocks.push({kind: "annotations", id: `${message.id}:annotations`, message});
                }
                break;
        }
    }
    flush();
    return blocks;
}

/**
 * 答案（最终回复或结果节点）之后的分隔线移出 `blocks`，由视图放到轮末汇总下方。锚点不能只认最终回复：结果节点之后
 * 跟着压缩或分支摘要时，分隔线留在末尾会挡住 `findOutcomeStart` 的倒扫，答案就被折进过程。答案之后由分隔线与信息条目
 * 混成的一段里，分隔线都移走、信息条目留在原处：只摘末尾连续的分隔线时，“回复、压缩、提醒”里的压缩会留下来挡住倒扫。
 */
function splitTrailing(blocks: TurnBlock[], registry: AgentViewRegistry): TurnBlock[] {
    const replyIndex = blocks.findLastIndex((block) => isAnswer(block, registry));
    if (replyIndex < 0) {
        return [];
    }
    let start = blocks.length;
    while (start > replyIndex + 1 && (blocks[start - 1]!.kind === "divider" || isNoticeLike(blocks[start - 1]!))) {
        start -= 1;
    }
    const tail = blocks.splice(start);
    blocks.push(...tail.filter((block) => block.kind !== "divider"));
    return tail.filter((block) => block.kind === "divider");
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
    return toolCallPhase(tool.call.status) === "running";
}

function isFailed(tool: ToolStep): boolean {
    return toolCallPhase(tool.call.status) === "error";
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
    // 按渲染器收集调用，Map 保留首次出现的顺序，短语也按它排。
    const callsByRenderer = new Map<ToolRendererEntry, ToolCallView[]>();
    for (const tool of tools) {
        const renderer = registry.resolveTool(tool.call.name);
        const calls = callsByRenderer.get(renderer);
        if (calls === undefined) callsByRenderer.set(renderer, [tool.call]);
        else calls.push(tool.call);
    }
    const phrases: Text[] = [];
    for (const [renderer, calls] of callsByRenderer) {
        // 类型要求 explore 都给 groupPhrase；回退留给不经类型检查的 JS 宿主，不是死代码。
        phrases.push(renderer.groupPhrase?.(calls) ?? agentRef("toolGroup.generic", {count: calls.length}));
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
    // 只压缩的运行不属于任何一轮：上一轮不算运行中，也不转圈。
    if (context.isLatest && context.run.kind !== "compact") {
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
    outcomeCalls: ReadonlySet<string>,
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
    // 有一条消息单价未知，整轮的费用就是未知：把它算成 0 会少报。
    let costKnown = true;
    let hasUsage = false;
    for (const message of group) {
        if (message.kind === "assistant" && message.usage !== undefined) {
            const part = message.usage;
            totals.input += part.input;
            totals.output += part.output;
            totals.cacheRead += part.cacheRead;
            totals.cacheWrite += part.cacheWrite;
            if (part.cost === null) costKnown = false;
            else costTotal += part.cost;
            hasUsage = true;
        }
    }
    const usage = hasUsage ? totals : null;
    const cost = hasUsage && costKnown ? costTotal : null;
    const tokens = hasUsage ? totals.input + totals.output + totals.cacheRead + totals.cacheWrite : null;
    const live = status === "running" || status === "waiting";
    // 消息只有开始时间，结束于最后一条消息开始的时刻是近似值；运行中按宿主提供的 now 计算。
    // 系统条目不算：手动压缩的分隔线可以在回复完成很久之后才进这一轮的 group。
    const end = live ? now : (group.findLast((message) => message.kind !== "system") ?? group.at(-1)!).timestamp;
    return {
        durationMs: truncatedStart ? null : Math.max(0, end - group[0]!.timestamp),
        steps: tools.filter((tool) => !outcomeCalls.has(tool.call.id)).length,
        requests: group.filter((message) => message.kind === "assistant").length,
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
