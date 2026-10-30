/**
 * 内置问答的引擎（docs/specs/story/qa.md）：一个对话一个 Agent、一个会话，每问一轮；一轮从开始答到交卷、文字回复、
 * 失败或被取消，结束时写下整条对话记录。`nbstory ask` 与网页问答页都调这里。
 *
 * 一轮的顺序：
 * 1. 读配置得模型。新对话：固定书的一代，用 `book.info` 落定阅读位置，账本从空开始。续问（`continueFrom`）：读记录
 *    与会话日志，书、这一代、阅读位置、做法与章数上限都取记录里的，账本带上前几轮读过的段。查询类失败在这里以
 *    StoryError 抛出，全读超上限与续问不了以 QaError 抛出：这时还没开始运行，不写记录。
 * 2. 为这一轮新建登记表、登记工具，建内存里的会话日志（续问时带着读回的旧条目）与 harness，`turn(问题)`。
 * 3. 按停止原因定这一轮的结果（输出 10）。Markdown 作答的回复里有没核实的出处时，在同一个 harness 上再跑一次
 *    `turn` 让模型改一次（出处复查），之后不再提醒。
 * 4. 关 harness，把会话日志排成 JSONL 与对话记录一起保存。运行期间书库里不写任何东西：删除书的改名与
 *    递归删除不会和写入交错（见 core/qa-records.ts）。
 * 第 2、3 步里 harness 抛出的错误（不是作为结果返回的）都是本机故障：收成 `model_failed`（`local`）的失败轮，
 * 不让它逃出这个函数；续问时恢复会话就失败的（Profile 或工具与快照不一致）在任何请求之前报 `qa_not_continuable`。
 * 保存失败不改变这一轮的结果，只在返回值里说明记录没保存。
 *
 * 第 1 步与建 harness 在 `prepareQuestion` 里做完，开始前的错误都从它抛出；`run` 做其余几步。
 */

import {createHarness, createToolRegistry, HarnessError, registerPlugin, type Harness, type HarnessOptions, type TurnResult} from "@notnotype/nb-harness";
import {createMemorySessionLog, parseEntryLine, type JsonValue, type SessionEntry, type SessionLog} from "@notnotype/nb-session";

import {refsInText} from "../contract/refs";
import type {StoryApi} from "../core/api";
import type {BookFeatures, Position} from "../core/dataset";
import {StoryError} from "../core/errors";
import type {PositionInput} from "../core/position";
import type {QaAnswerMode} from "../contract/qa-record";
import {answerModeOf, currentPosition, newQaRecordId, QaRecords, type QaConversation, type QaMode, type QaReply, type QaTurn, type QaUsage} from "../core/qa-records";
import {qaLimits, type QaConfig} from "./config";
import type {KeyEnv} from "../platform/startup-env";
import {keyVariables, onlyKeysIn, resolveQaModel, thinkingOption, type QaModelChoice} from "./harness-model";
import {QaError} from "./errors";
import {clipRead, ReadLedger} from "./read-ledger";
import {readRange, resolveReach, type Reach} from "./reach";
import {recheckMessage} from "./rules";
import {createVisibility} from "./spoiler";
import profile from "./story-qa.profile";
import {storyQaPlugin, type QaToolState} from "./tools";
import {webEventOf, type QaAgentEvent} from "./web-events";

export type QaProgress = {kind: "tool"; tool: string; text: string} | {kind: "rejected"; text: string} | {kind: "recheck"; refs: string[]} | {kind: "answered"};

export interface AskInput {
    api: StoryApi;
    book?: string;
    /** 新对话的阅读位置；续问时不给（取记录里的）。 */
    at?: PositionInput;
    /** 新对话的做法；续问时不给。 */
    mode?: QaMode;
    question: string;
    config: QaConfig;
    /**
     * 这一轮用的模型与推理档。不给时：新对话用配置的默认模型；续问用这个对话最近一轮的模型（还在候选里时），否则用
     * 默认模型。
     */
    model?: QaModelChoice;
    /** 新对话的作答方式；不给时按配置的 `qa.answer`，再缺省是 Markdown。续问时不给（取记录里的）。 */
    answer?: QaAnswerMode;
    /** 在这个对话里追问（qa.md 输出 26）。 */
    continueFrom?: string;
    signal?: AbortSignal;
    onProgress?: (event: QaProgress) => void;
    /**
     * 新对话的 id：网页问答由服务端先定下（`newQaRecordId()`），这一轮开始前就能告诉页面。不给时照旧生成；续问时忽略。
     */
    conversationId?: string;
    /** 运行中的事件，只留网页用得到的部分（见 `web-events.ts`）。回调抛错不影响这一轮。 */
    onAgentEvent?: (event: QaAgentEvent) => void;
    /** 会话日志新写入的条目（带 seq，按写入顺序）。续问时读回的旧条目不再发。回调抛错不影响这一轮。 */
    onLogEntries?: (entries: readonly SessionEntry[]) => void;
    /** 透传给 nb-harness 的 `createHarness`（它的公开选项）；测试用脚本化模型。 */
    streamFn?: HarnessOptions["streamFn"];
    /** 给了就只认这份环境里的密钥（命令行与服务给启动环境的快照，docs/adr/0032）；不给时照 OMP 的取法读实时的环境。 */
    keyEnv?: KeyEnv;
}

/** 记录没保存的原因：书删了或换了代、格式不认识只读、对话被同时追问了，或写盘失败（附说明）。 */
export type NotSaved = {reason: "book_not_found" | "unsupported_format" | "conflict"} | {reason: "write_failed"; message: string};

/** 这一轮的结果（qa.md 输出 11）：对话的固定信息加这一轮；`id` 是对话 id，`turn` 从 1 数。`ask --json` 输出它。 */
export type QaTurnResult = Pick<QaConversation, "id" | "book" | "generation" | "at" | "mode"> & QaTurn & {turn: number};

export type QaOutcome = {result: QaTurnResult; conversation: QaConversation} & ({recordSaved: true} | {recordSaved: false; notSaved: NotSaved});

function emptyUsage(): QaUsage {
    return {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true};
}

function addUsage(total: QaUsage, usage: TurnResult["usage"]): QaUsage {
    return {
        input: total.input + usage.input,
        output: total.output + usage.output,
        cacheRead: total.cacheRead + usage.cacheRead,
        cacheWrite: total.cacheWrite + usage.cacheWrite,
        cost: total.cost === null || usage.cost === null ? null : total.cost + usage.cost,
        complete: total.complete && usage.complete,
    };
}

function positionText(position: {chapter: number; paragraph?: number}): string {
    return position.paragraph === undefined ? `${position.chapter}` : `${position.chapter}.${position.paragraph}`;
}

/** 进度里给人看的一句：工具名加主要参数。 */
function describeTool(tool: string, args: Record<string, unknown>): string {
    const words: Record<string, string> = {
        info: "看目录", chapter: "看本章变化", find: "找对象", card: "查人物卡", knowledge: "查他知道的事", statements: "查关于他的说法", appearances: "查他参与的情节",
        ties: "查关系", between: "查两人之间", relations: "查关系总表", knows: "查秘密矩阵", ledger: "查数值", track: "查数值流水", questions: "查悬念", timeline: "查时间线",
        episodes: "查情节", arcs: "查主线", search: "搜索", read: "读原文", para: "查某段的记录", answer: "交卷",
    };
    const word = words[tool] ?? tool;
    if (tool === "read" && typeof args.from === "object" && args.from !== null) {
        const from = positionText(args.from as PositionInput);
        return `${word} ${from}${typeof args.to === "object" && args.to !== null ? `—${positionText(args.to as PositionInput)}` : ""}`;
    }
    if (tool === "chapter" || tool === "para") return `${word}：第 ${String(args.chapter)} 章${args.paragraph === undefined ? "" : `第 ${String(args.paragraph)} 段`}`;
    const subject = [args.entity, args.other, args.query, args.track].filter(value => typeof value === "string").join("、");
    return subject === "" ? word : `${word}：${subject}`;
}

/** 全读的第一条消息：P 以前的全部原文，再接问题。超上限报 full_read_unavailable（F3）。 */
async function fullReadMessage(input: AskInput, book: Awaited<ReturnType<StoryApi["openBook"]>>, reach: Reach, maxChars: number): Promise<string> {
    const at = reach.at;
    const outcome = await readRange(book, reach, {chapter: 1, paragraph: 1}, at);
    if ("error" in outcome) throw outcome.error;
    const paragraphs = outcome.paragraphs;
    const chars = paragraphs.reduce((sum, item) => sum + item.text.length, 0);
    if (chars > maxChars) throw new QaError("full_read_unavailable", `阅读位置 ${at.chapter}.${at.paragraph} 以前的原文有 ${chars} 字，超过全读上限 ${maxChars} 字：改用图当目录，或调大 fullReadMaxChars`);
    return `${FULL_READ_HEAD}\n${paragraphs.map(item => `${item.chapter}.${item.paragraph} ${item.text}`).join("\n")}${FULL_READ_QUESTION}${input.question}`;
}

const FULL_READ_HEAD = "以下是阅读位置以前的全部原文：";
const FULL_READ_QUESTION = "\n\n问题：";

/**
 * 全读对话第一轮的用户消息换成问题加一句说明，不带原文：网页拿到的日志（`qa.get` 与运行中推送的条目）都经过它，
 * 免得每次打开对话都传一整本书（qa.md 输出 34）。调用方只对全读对话第一轮的条目调用，并给出那一轮的问题：消息要
 * 正好是“开头 + 原文 + 问题”才换，不从正文里猜分界（段落里可能有空行，普通问题也可能写成同样的开头）。存盘的日志不变，
 * 续问照旧交回模型原文。
 */
export function withoutFullText(entry: SessionEntry, question: string): SessionEntry {
    if (entry.kind !== "agent_message" || typeof entry.message !== "object" || entry.message === null || Array.isArray(entry.message)) return entry;
    const message = entry.message as {readonly [key: string]: JsonValue};
    if (message.role !== "user") return entry;
    const content = message.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map(block => (typeof block === "object" && block !== null && !Array.isArray(block) && typeof block.text === "string" ? block.text : "")).join("") : "";
    const tail = `${FULL_READ_QUESTION}${question}`;
    if (!text.startsWith(FULL_READ_HEAD) || !text.endsWith(tail)) return entry;
    const body = text.slice(FULL_READ_HEAD.length, text.length - tail.length);
    const paragraphs = body.split("\n").filter(line => /^\d+\.\d+ /u.test(line)).length;
    return {...entry, message: {...message, content: [{type: "text", text: `${question}\n\n（已附阅读位置以前的全部原文，共 ${paragraphs} 段，这里不显示）`}]}};
}

/** 一轮开始之前定下的东西：新对话现建，续问从记录读回。 */
interface Start {
    book: Awaited<ReturnType<StoryApi["openBook"]>>;
    features: BookFeatures;
    /** 这一问能到达的范围：已提交的章加未抽取的尾部（qa/reach.ts）。 */
    reach: Reach;
    /** 续问时的上一份对话；新对话为 null。 */
    previous: QaConversation | null;
    id: string;
    at: Position;
    mode: QaMode;
    maxChapters: number | null;
    answer: QaAnswerMode;
    ledger: ReadLedger;
    /** 这一轮开始时对话的位置改动次数；保存时核对，期间位置被别处改了就不保存（t25）。 */
    positionChanges: number;
    /** 续问时读回的会话日志条目。 */
    entries: SessionEntry[] | null;
    firstMessage: string;
}

async function startNew(input: AskInput, started: number): Promise<Start> {
    const limits = qaLimits(input.config);
    const mode = input.mode ?? "graph";
    const book = await input.api.openBook(input.book);
    const reach = await resolveReach(book, input.at);
    const at: Position = reach.at;
    const maxChapters = mode === "graph" ? limits.maxChapters : null;
    return {
        book,
        features: reach.features,
        reach,
        previous: null,
        id: input.conversationId ?? newQaRecordId(new Date(started)),
        at,
        mode,
        maxChapters,
        answer: input.answer ?? input.config.qa?.answer ?? "markdown",
        ledger: new ReadLedger({paragraphs: reach.paragraphs, at, maxChapters, readAll: mode === "full"}),
        positionChanges: 0,
        entries: null,
        firstMessage: mode === "full" ? await fullReadMessage(input, book, reach, limits.fullReadMaxChars) : input.question,
    };
}

/** 读对话的记录与会话日志并核对能不能接着用；对不上的报 `notContinuable` 给的错。 */
async function readConversation(input: {api: StoryApi; book?: string | undefined}, id: string, notContinuable: (why: string) => QaError): Promise<{book: Awaited<ReturnType<StoryApi["openBook"]>>; previous: QaConversation; entries: SessionEntry[]}> {
    const book = await input.api.openBook(input.book);
    const records = new QaRecords(input.api.library, book.id);
    const {conversation: previous, log} = await records.getWithLog(id, book.generation);
    if (!log.ok) throw notContinuable(log.problem);
    const entries: SessionEntry[] = [];
    for (const line of log.jsonl.split("\n")) {
        if (line === "") continue;
        const entry = parseEntryLine(line);
        if (entry === null) throw notContinuable("会话日志有读不成的行");
        entries.push(entry);
    }
    const problem = continuationProblem(entries[0]);
    if (problem !== null) throw notContinuable(problem);
    return {book, previous, entries};
}

/**
 * 续问：读记录与会话日志；读不成、对不上的在任何请求之前报 qa_not_continuable（F8）。续问带了新位置时，位置改动只在
 * 内存里算好（`planPositionChange`），跟着这一轮的记录一起保存：这一问在开始前失败或被放弃，记录与日志都不变（t25）。
 */
async function startContinued(input: AskInput, id: string): Promise<Start> {
    const notContinuable = (why: string) => new QaError("qa_not_continuable", `对话 ${id} 不能续问：${why}。请开新对话`);
    const read = await readConversation(input, id, notContinuable);
    const {book} = read;
    // 磁盘上的位置改动次数：保存时核对，期间位置被别处改了就不保存，不悄悄换成别的位置。
    const diskChanges = read.previous.positionChanges ?? 0;
    let {previous, entries} = read;
    if (input.at !== undefined) {
        const planned = await planPositionChange(book, previous, entries, input.at);
        if (planned !== null) ({conversation: previous, entries} = planned);
    }
    // 这一问用的位置：对话里改过位置的取改后的（`currentPosition`），不是开始时的 `at`（t25）。
    const at = currentPosition(previous);
    let reach: Reach;
    try {
        reach = await resolveReach(book, at);
    } catch (error) {
        // 位置落在未抽取的尾部、而这一代的尾部已经读不到了（抽取记录没了）：接不上，不改成别的位置。
        if (error instanceof StoryError && error.code === "position_out_of_range") throw notContinuable(`阅读位置 ${at.chapter}.${at.paragraph} 所在的章现在读不到了`);
        throw error;
    }
    let ledger: ReadLedger;
    try {
        // 位置往回调过：晚于现在位置的已读范围不再算读过。
        ledger = new ReadLedger({paragraphs: reach.paragraphs, at, maxChapters: previous.maxChapters, readAll: previous.mode === "full", read: clipRead(previous.read, at)});
    } catch (error) {
        throw notContinuable(error instanceof Error ? error.message : String(error));
    }
    return {book, features: reach.features, reach, previous, id, at, mode: previous.mode, maxChapters: previous.maxChapters, answer: answerModeOf(previous), ledger, positionChanges: diskChanges, entries, firstMessage: input.question};
}

/**
 * 会话里最近一条位置提醒（其后紧跟的 `qa.position` 元数据）写了“图只抽到第 N 章”，而图现在已抽到别处时，给出前后两个数。
 * 提醒是历史记录，不改；每个图工具的结果末尾补一句现在的进度，模型以工具结果为准（t30 实现审查第 11 条）。
 */
export function staleGraphOf(entries: readonly SessionEntry[] | null, committed: number): {was: number; now: number} | null {
    for (let index = (entries?.length ?? 0) - 1; index >= 0; index -= 1) {
        const entry = entries![index]!;
        if (entry.kind !== "meta" || entry.key !== POSITION_META_KEY) continue;
        const was = (entry.value as {graphThrough?: unknown} | null)?.graphThrough;
        return typeof was === "number" && was !== committed ? {was, now: committed} : null;
    }
    return null;
}

/** 位置在提醒里的写法：停在一章最后一段的写“第 N 章”，否则写“N.M”。 */
function reminderPosition(position: Position, paragraphs: readonly number[]): string {
    return position.paragraph === paragraphs[position.chapter - 1] ? `第 ${position.chapter} 章` : `${position.chapter}.${position.paragraph}`;
}

/**
 * 改位置时写进会话的提醒（`<system-reminder>` 包着的程序生成文字，不含用户输入）：往后调说可以访问了，往回调说之后的
 * 内容不能再访问或引用。
 */
export function positionReminder(from: Position, to: Position, paragraphs: readonly number[], graphThrough: number | null = null): string {
    const a = reminderPosition(from, paragraphs);
    const b = reminderPosition(to, paragraphs);
    const body =
        (before(from, to)
            ? `阅读位置从${a}改为${b}。你可以访问${b}及之前的内容了。`
            : `阅读位置从${a}改为${b}。${b}之后的内容现在不能访问或引用，即使前面的对话里出现过也不要再用。`) +
        // 目标在没抽取的尾部里：图只到抽取进度，之后的章只能读原文（w00024 t30）。
        (graphThrough === null ? "" : `图只抽到第 ${graphThrough} 章，第 ${graphThrough + 1} 章之后只能用 read 读原文。`);
    return `<system-reminder>\n${body}\n</system-reminder>`;
}

function before(a: Position, b: Position): boolean {
    return a.chapter < b.chapter || (a.chapter === b.chapter && a.paragraph < b.paragraph);
}

/** 会话日志里记位置改动的 `meta` 条目的键：紧跟在提醒消息之后，网页靠它认出提醒（不看文字）。 */
export const POSITION_META_KEY = "qa.position";

/**
 * 在对话中途改阅读位置（t25）：往会话日志追加两条（完整的用户消息形状的提醒与紧跟的 `meta`），记录写上新的当前位置，
 * 照追问的写法复制新日志、记录改名发布；不发模型请求。只有图当目录的对话能改；位置没变不写。返回改后的对话，没变时
 * `changed` 为 false。
 */
export async function changePosition(input: {api: StoryApi; book: string | undefined; conversation: string; at: PositionInput}): Promise<{conversation: QaConversation; changed: boolean}> {
    const notChangeable = (why: string) => new QaError("qa_not_continuable", `对话 ${input.conversation} 不能改阅读位置：${why}`);
    const {book, previous, entries} = await readConversation(input, input.conversation, notChangeable);
    const planned = await planPositionChange(book, previous, entries, input.at);
    if (planned === null) return {conversation: previous, changed: false};
    const {conversation: next, entries: nextEntries} = planned;
    const {log: _log, ...fixed} = next;
    const jsonl = nextEntries.map(entry => `${JSON.stringify(entry)}\n`).join("");
    const saved = await new QaRecords(input.api.library, book.id).save(fixed, jsonl, {expectTurns: previous.turns.length, expectChanges: previous.positionChanges ?? 0});
    if (!saved.saved) throw new QaError("qa_conflict", saved.reason === "conflict" ? `对话 ${input.conversation} 在这期间被别处改了（追问、改位置或删除），阅读位置没有改` : `阅读位置没有改：书${saved.reason === "book_not_found" ? "已被删除或换了代" : "的格式不认识"}`);
    return {conversation: saved.conversation, changed: true};
}

/**
 * 算出改位置之后的对话与会话日志条目（追加提醒与紧跟的 `meta`），不写盘。位置没变返回 null。`changePosition` 单独保存它；
 * 续问带新位置时跟着这一轮一起保存。
 */
async function planPositionChange(book: Awaited<ReturnType<StoryApi["openBook"]>>, previous: QaConversation, entries: readonly SessionEntry[], target: PositionInput): Promise<{conversation: QaConversation; entries: SessionEntry[]} | null> {
    if (previous.mode === "full") throw new QaError("qa_position_fixed", `对话 ${previous.id} 是全读对话，阅读位置不能改：开新对话`);
    const reach = await resolveReach(book, target);
    const to = reach.at;
    const graphThrough = to.chapter > reach.committed ? book.meta.extractedThrough.chapter : null;
    const from = currentPosition(previous);
    if (to.chapter === from.chapter && to.paragraph === from.paragraph) return null;
    const seq = (entries.at(-1)?.seq ?? 0) + 1;
    const now = new Date();
    const reminder: SessionEntry = {kind: "agent_message", seq, at: now.toISOString(), message: {role: "user", content: [{type: "text", text: positionReminder(from, to, reach.paragraphs, graphThrough)}], timestamp: now.getTime()}};
    const meta: SessionEntry = {kind: "meta", seq: seq + 1, at: now.toISOString(), key: POSITION_META_KEY, value: {chapter: to.chapter, paragraph: to.paragraph, from: {chapter: from.chapter, paragraph: from.paragraph}, ...(graphThrough === null ? {} : {graphThrough})}};
    return {conversation: {...previous, currentAt: to, positionChanges: (previous.positionChanges ?? 0) + 1}, entries: [...entries, reminder, meta]};
}

/**
 * 会话日志能不能接着用当前的 Profile 续问；能时为 null。只看第一条快照的 Profile 版本（harness 恢复时还会核对工具
 * 声明）：网页在提交之前就要知道能不能续问（`qa.get` 的 `continuable`），不等到恢复会话才失败。
 */
export function continuationProblem(snapshot: SessionEntry | undefined): string | null {
    if (snapshot?.kind !== "session_snapshot") return "会话日志没有快照，是早先的格式，只能查看";
    const {key, version} = profile.manifest;
    if (snapshot.profile.key !== key || snapshot.profile.version !== version) return "这个对话是用早先版本的问答开始的，只能查看";
    return null;
}

/** 续问没指定模型时接着用最近一轮的（还在候选里时）；早先记录里的裸模型名不在候选里，用默认模型。 */
function continuedChoice(config: QaConfig, previous: QaConversation): QaModelChoice {
    const last = previous.turns.at(-1)?.model;
    return last !== undefined && config.models.includes(last) ? {model: last} : {};
}

/**
 * 观察者的回调与运行隔离：抛错只写一条诊断。日志的 `append` 一旦失败，harness 会把会话判坏、这一轮以本机错误结束，
 * 而条目其实已经写进去了；网页断开等观察者一侧的错误不能改变这一轮的结果与保存。
 */
function notify(call: () => void): void {
    try {
        call();
    } catch (error) {
        console.error(`nbstory：问答的观察者出错，已忽略：${error instanceof Error ? error.message : String(error)}`);
    }
}

/** 包一层会话日志：底层 `append` 返回已编号的条目之后通知观察者。 */
function observed(log: SessionLog, onEntries: AskInput["onLogEntries"]): SessionLog {
    if (onEntries === undefined) return log;
    return {
        ...log,
        async append(inputs) {
            const entries = await log.append(inputs);
            notify(() => onEntries(entries));
            return entries;
        },
    };
}

/** 停下时的文字回复：去掉首尾空白后为空就没有回复（输出 10）；正文里没核实的出处列出来（输出 24）。 */
function replyOf(result: TurnResult, ledger: ReadLedger): QaReply | null {
    const text = result.text.trim();
    if (text === "") return null;
    const unverifiedRefs = [...new Set(refsInText(text))].filter(ref => ledger.checkRef(ref) !== null);
    // 没有出处，这一轮也没读过原文：回答没有可核对的依据，单独标出来（输出 24）。
    const ungrounded = unverifiedRefs.length === 0 && ledger.chapters().length === 0;
    return {text, truncated: result.stopReason === "length", unverifiedRefs, ...(ungrounded ? {ungrounded: true} : {})};
}

/** 问一轮：先准备（会抛出开始前的错误），再运行。`nbstory ask` 用它；网页问答分两步调（见 `prepareQuestion`）。 */
export async function askQuestion(input: AskInput): Promise<QaOutcome> {
    return (await prepareQuestion(input)).run();
}

/**
 * 准备好、还没开始的一轮。开始前的错误（查询失败、全读超上限、续问不了）都在 `prepareQuestion` 里抛出，不会推迟到
 * `run`：网页问答在准备成功后才登记运行、回复页面，失败的直接作为请求的错误返回，运行表里不会留下没人收口的一项。
 * 准备好之后必须二选一：`run()` 一次，或者不运行了就 `abandon()` 关掉已建的 harness。
 */
export interface PreparedQuestion {
    /** 对话 id：新对话是 `conversationId` 或新生成的，续问是原对话的。 */
    readonly id: string;
    /** 这一轮是对话的第几轮（从 1 数）。 */
    readonly turn: number;
    /** 这一轮在会话日志里从哪一条开始（同记录的 `logFrom`）。 */
    readonly logFrom: number;
    /** 这一轮用的模型，`服务商/模型名`。 */
    readonly model: string;
    /** 对话的阅读位置与做法（续问时是记录里的）。 */
    readonly at: Position;
    readonly mode: QaMode;
    /** 这一轮固定在哪本书（书 id）的哪一代上：同 id 删掉又导入的书是另一代，这一轮不属于它。 */
    readonly book: string;
    readonly generation: string;
    /** 准备时磁盘上记录的位置改动次数（新对话为 0）：网页用它判断运行是否还接得上记录。 */
    readonly baseChanges: number;
    run(): Promise<QaOutcome>;
    abandon(): Promise<void>;
}

export async function prepareQuestion(input: AskInput): Promise<PreparedQuestion> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const start = input.continueFrom === undefined ? await startNew(input, started) : await startContinued(input, input.continueFrom);
    const {book, at, mode, ledger, previous, id} = start;
    // 没选模型（包括只给了推理档）时续问接着用上一轮的模型（qa.md 输出 40）。
    const chosen = resolveQaModel(input.config, {...(previous === null ? {} : continuedChoice(input.config, previous)), ...input.model});
    const qaModel = input.keyEnv === undefined ? chosen : {...chosen, resolved: onlyKeysIn(chosen.resolved, keyVariables(input.config, chosen.ref), input.keyEnv)};

    const state: QaToolState = {book, at, graphAt: start.reach.graphAt, reach: start.reach, staleGraph: staleGraphOf(start.entries, start.reach.committed), ledger, answer: null};
    // 作答被退回的次数：不只是我们的校验，OMP 的参数校验与“收尾要单独调用”的退回也算，所以按工具结束事件数。
    let rejections = 0;
    const registry = createToolRegistry();
    registerPlugin(registry, storyQaPlugin(state, start.features, start.answer));
    // 这一轮在日志里从哪一条开始（记进记录，网页按它对轮次）。
    const logFrom = (start.entries?.length ?? 0) + 1;
    // 给人看的东西（进度、网页的日志与事件）先过一遍剧透检查（spoiler.ts）。检查要查询，所以是异步的；进度、日志条目、事件
    // 排在同一条队列里，保持先后，这一轮结束前等队列走完。会话日志本身与交给模型的内容不过检查。
    const visibility = createVisibility(book, start.reach);
    let shown: Promise<void> = Promise.resolve();
    const show = (task: () => Promise<void>): void => {
        shown = shown.then(task).catch(error => console.error(`nbstory：问答过程的剧透检查出错，这一条不显示：${error instanceof Error ? error.message : String(error)}`));
    };
    const sessionLog = observed(
        createMemorySessionLog({sessionId: id, ...(start.entries === null ? {} : {entries: start.entries})}),
        input.onLogEntries === undefined ? undefined : entries => show(async () => {
            const safe = await Promise.all(entries.map(entry => visibility.entry(entry)));
            notify(() => input.onLogEntries!(safe));
        }),
    );

    let usage = emptyUsage();
    let outcome: Pick<QaTurn, "status" | "answer" | "reply" | "error"> = {status: "interrupted", answer: null, reply: null, error: null};
    let recheck: QaTurn["recheck"];
    const localFailure = (what: string, error: unknown): typeof outcome => ({status: "failed", answer: null, reply: null, error: {code: "model_failed", kind: "local", message: `${what}：${error instanceof Error ? error.message : String(error)}`}});
    let harness: Harness | null = null;
    try {
        harness = await createHarness({
            profile,
            ...(previous === null ? {initial: {title: book.meta.title, at: `${at.chapter}.${at.paragraph}`, mode, maxChapters: start.maxChapters, ...(start.features.ledger ? {} : {ledger: false}), answer: start.answer}} : {}),
            registry,
            model: qaModel.resolved,
            sessionLog,
            ...thinkingOption(qaModel),
            ...(input.streamFn === undefined ? {} : {streamFn: input.streamFn}),
        });
    } catch (error) {
        // 续问时恢复不了会话（Profile 版本或工具声明与快照不一致等）：还没发任何请求，不写记录。
        if (previous !== null && error instanceof HarnessError) throw new QaError("qa_not_continuable", `对话 ${id} 不能续问：${error.message}。请开新对话`);
        outcome = localFailure("本机错误", error);
    }

    /** 一次 `turn` 的结果 → 这一轮的结果；中断（aborted）为 null，保持初值。 */
    function outcomeOf(result: TurnResult): typeof outcome | null {
        if (result.stopReason === "finished" && state.answer !== null) return {status: "answered", answer: state.answer, reply: null, error: null};
        if (result.stopReason === "error") {
            const error = result.error!;
            return {status: "failed", answer: null, reply: null, error: {code: "model_failed", kind: error.kind, message: error.message}};
        }
        if (result.stopReason === "stop" || result.stopReason === "length") {
            const reply = replyOf(result, ledger);
            return reply === null
                ? {status: "failed", answer: null, reply: null, error: {code: "no_answer", message: "模型停下时既没有用 answer 交卷，也没有文字回复"}}
                : {status: "answered", answer: null, reply, error: null};
        }
        return null;
    }

    /**
     * 跑这一轮：一次 `turn`，Markdown 作答而回复里有没核实的出处时再跑一次（出处复查，qa.md 的“出处复查”）。订阅在两次
     * 之间共用一份、结束时取消：每次各订一份而不取消，第二次的事件会被处理两遍（退回次数、网页事件都会重复）。
     */
    async function runTurns(harness: Harness): Promise<void> {
        const unsubscribe = harness.subscribe(event => {
            const web = input.onAgentEvent === undefined ? null : webEventOf(event);
            if (web !== null) show(async () => {
                const safe = await visibility.event(web);
                notify(() => input.onAgentEvent!(safe));
            });
            if (event.type === "tool_execution_start") show(async () => {
                const args = await visibility.args((event.args ?? {}) as Record<string, unknown>, event.toolCallId);
                notify(() => input.onProgress?.({kind: "tool", tool: event.toolName, text: describeTool(event.toolName, args)}));
            });
            if (event.type === "tool_execution_end" && event.toolName === "answer" && event.isError) {
                rejections += 1;
                const result = event.result as {content?: {type: string; text?: string}[]} | undefined;
                show(async () => input.onProgress?.({kind: "rejected", text: result?.content?.map(block => block.text ?? "").join("") ?? ""}));
            }
        });
        const options = input.signal === undefined ? undefined : {signal: input.signal};
        try {
            const first = await harness.turn(start.firstMessage, options);
            usage = addUsage(usage, first.usage);
            outcome = outcomeOf(first) ?? outcome;
            const refs = start.answer === "markdown" ? (outcome.reply?.unverifiedRefs ?? []) : [];
            if (refs.length > 0) {
                // 审计用：日志里看得出这一轮为什么多了一条用户消息。meta 不进模型上下文，问题清单写在复查消息里。
                await sessionLog.append([{kind: "meta", key: "nb-story.reply-check", value: {unverified: refs}}]);
                show(async () => input.onProgress?.({kind: "recheck", refs}));
                const second = await harness.turn(recheckMessage(refs), options);
                usage = addUsage(usage, second.usage);
                const rewritten = outcomeOf(second);
                // 第二次出错、被取消或没有文字：保留第一次的回复（用户已经看到它了），只记下复查没完成。
                if (rewritten?.reply != null) {
                    outcome = rewritten;
                    recheck = {unverified: refs.length, outcome: "rewritten"};
                } else recheck = {unverified: refs.length, outcome: second.stopReason === "aborted" ? "aborted" : "failed"};
            }
            if (outcome.answer !== null) show(async () => input.onProgress?.({kind: "answered"}));
        } finally {
            unsubscribe();
            await shown;
        }
    }

    async function finish(): Promise<QaOutcome> {
        await shown;
        const turn: QaTurn = {question: input.question, ...outcome, chaptersRead: ledger.chapters(), rejections, usage, ms: Date.now() - started, model: qaModel.ref, startedAt, logFrom, at, ...(recheck === undefined ? {} : {recheck})};
        const fixed = previous ?? {id, book: book.id, generation: book.generation, at, mode, maxChapters: start.maxChapters, startedAt};
        const conversation: Omit<QaConversation, "log"> = {
            id: fixed.id,
            book: fixed.book,
            generation: fixed.generation,
            at: fixed.at,
            mode: fixed.mode,
            maxChapters: fixed.maxChapters,
            answer: start.answer,
            read: ledger.snapshot(),
            turns: [...(previous?.turns ?? []), turn],
            ...(previous?.currentAt === undefined ? {} : {currentAt: previous.currentAt}),
            ...(previous?.positionChanges === undefined ? {} : {positionChanges: previous.positionChanges}),
            startedAt: fixed.startedAt,
        };
        const result: QaTurnResult = {id, book: conversation.book, generation: conversation.generation, at, mode, turn: conversation.turns.length, ...turn};
        const entries = await sessionLog.read();
        let saved: Awaited<ReturnType<QaRecords["save"]>>;
        try {
            saved = await new QaRecords(input.api.library, book.id).save(conversation, entries.map(entry => `${JSON.stringify(entry)}\n`).join(""), {expectTurns: previous?.turns.length ?? 0, expectChanges: start.positionChanges});
        } catch (error) {
            return {result, conversation: {...conversation, log: null}, recordSaved: false, notSaved: {reason: "write_failed", message: error instanceof Error ? error.message : String(error)}};
        }
        return saved.saved ? {result, conversation: saved.conversation, recordSaved: true} : {result, conversation: {...conversation, log: null}, recordSaved: false, notSaved: {reason: saved.reason}};
    }

    const created = harness;
    let settled = false;
    const claim = (what: string) => {
        if (settled) throw new Error(`这一轮已经${what}过了`);
        settled = true;
    };
    return {
        id,
        turn: (previous?.turns.length ?? 0) + 1,
        logFrom,
        model: qaModel.ref,
        at,
        mode,
        book: book.id,
        generation: book.generation,
        baseChanges: start.positionChanges,
        async run() {
            claim("运行或放弃");
            if (created !== null) {
                try {
                    await runTurns(created);
                } catch (error) {
                    outcome = localFailure("本机错误", error);
                }
                try {
                    await created.close();
                } catch (error) {
                    if (outcome.status !== "failed") outcome = localFailure("关闭会话失败", error);
                }
            }
            return finish();
        },
        async abandon() {
            claim("运行或放弃");
            await created?.close();
        },
    };
}
