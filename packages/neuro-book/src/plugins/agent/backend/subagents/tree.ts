/**
 * 子代理的进度（docs/specs/agent/subagents.md 输出 21、22）：远程 `tree({sessionId})` 交回一个会话的全部后代，`treeChanged` 在任一项
 * 变化时推整份。
 *
 * 不为取进度去打开会话：结构查关系表，标题、Profile 与运行收口读各后代的索引（`entry`，只读那一个文件），状态只看打开着的句柄
 * （关着的一定空闲）。在跑的后代的最近一步与工具次数从它的当前路径数，至多给 16 个；有等用户事项的一律给全。
 */

import type {JsonValue, LogEvent, SessionIndexEntry, SessionSnapshot, StorageResult} from "@notnotype/nb-harness/kernel/contracts";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {SessionUnavailable, type SessionTable} from "@notnotype/nb-harness/kit/sessions";

import {PushThrottle} from "nbook/shared/push-throttle";

import type {ProfileEntry} from "../../shared/contracts";
import type {TreeItem, TreeState} from "../../shared/subagents";
import type {JobCenter} from "../jobs/center";
import {isLive} from "../jobs/center";
import type {SessionRelations} from "./relations";
import {forUser, isModeSwitch, pendingOf, questionText, type PendingItem} from "./result";

/** 给动态字段（`step`、`tools`）的在跑后代至多几个（按开始时间取最近的）。 */
export const DETAILED_LIMIT = 16;

const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * 树放进一条消息（subagents.md 输出 21）：超过 `limit` 字节时先去掉历史运行的首句、每项只留最近一次运行的，再不够去掉全部首句；
 * 仍放不下交回 null。首句只是卡片“完成”那一行的文字，去掉了卡片写“已完成”；后代、状态与等你的事项不丢。
 */
export function fitTree(items: readonly TreeItem[], limit: number): readonly TreeItem[] | null {
    if (encodedBytes(items) <= limit) return items;
    const withoutLines = (keepLast: boolean): TreeItem[] => items.map((item) => ({
        ...item,
        runs: item.runs.map((run, index) => {
            if (run.line === undefined || (keepLast && index === item.runs.length - 1)) return run;
            const {line: _line, ...rest} = run;
            return rest;
        }),
    }));
    for (const keepLast of [true, false]) {
        const trimmed = withoutLines(keepLast);
        if (encodedBytes(trimmed) <= limit) return trimmed;
    }
    return null;
}
const TARGET_CHARS = 120;
const QUESTION_CHARS = 200;
/** 推送至多每秒 4 次。 */
export const TREE_PUSH_MS = 250;
/** `step.target` 依次取参数里的这几个。 */
const TARGET_KEYS = ["path", "pattern", "command", "query", "url"] as const;

export interface SubagentTreeOptions {
    readonly relations: SessionRelations;
    readonly table: SessionTable;
    readonly jobs: JobCenter;
    readonly entry: (id: string) => Promise<StorageResult<SessionIndexEntry>>;
    readonly catalog: () => readonly ProfileEntry[];
    readonly clock: RuntimeClock;
}

const clip = (text: string, limit: number): string => ([...text].length <= limit ? text : `${[...text].slice(0, limit).join("")}…`);

function targetOf(args: Readonly<Record<string, JsonValue>>): string | undefined {
    for (const key of TARGET_KEYS) {
        const value = args[key];
        if (typeof value === "string" && value !== "") return clip(value, TARGET_CHARS);
    }
    return undefined;
}

/** 当前路径上这次运行的开始时刻、工具调用数与最近一步。 */
function progressOf(path: readonly LogEvent[], runId: string): {startedAt?: number; tools: number; step?: TreeItem["step"]} {
    let start = -1;
    for (let index = path.length - 1; index >= 0; index -= 1) {
        const event = path[index]!;
        if (event.type === "runStarted" && (event.data as {runId: string}).runId === runId) {
            start = index;
            break;
        }
    }
    if (start === -1) return {tools: 0};
    let tools = 0;
    let step: TreeItem["step"];
    for (const event of path.slice(start)) {
        if (event.type !== "toolStarted") continue;
        tools += 1;
        const data = event.data as {tool: string; args: Readonly<Record<string, JsonValue>>};
        const target = targetOf(data.args);
        step = {tool: data.tool, ...(target === undefined ? {} : {target})};
    }
    return {startedAt: path[start]!.at, tools, ...(step === undefined ? {} : {step})};
}

/** 审批请求里的长字符串（`write` 的整份正文）截到这么多字：停靠区的预览另经 `approvalPreview` 取，这里只要看得出是什么。 */
const REQUEST_STRING_CHARS = 2_000;

function trimRequest(value: JsonValue): JsonValue {
    if (typeof value === "string") return [...value].length <= REQUEST_STRING_CHARS ? value : `${[...value].slice(0, REQUEST_STRING_CHARS).join("")}…（已截断，共 ${String([...value].length)} 字）`;
    if (Array.isArray(value)) return value.map(trimRequest);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimRequest(item)]));
    return value;
}

type IndexCache = {readonly entry: SessionIndexEntry | null; readonly whileOpen: boolean};
type DynamicCache = {readonly key: string; readonly item: TreeItem};

/**
 * 算一项的代价主要在读打开着的后代的路径（经出站过滤）与读索引文件，所以两样都缓存：
 * - 索引按会话缓存，会话写了日志就作废；句柄打开时缓存的，关掉之后再读一次（关会话时写下的收口不经日志帧）。
 * - 打开着的后代的项按“日志最新 seq、运行状态、跟着它的任务与提问”缓存，没变就不读路径。
 */
export class SubagentTree {
    readonly #indexed = new Map<string, IndexCache>();
    readonly #dynamic = new Map<string, DynamicCache>();
    /** 正在读索引的会话：读的途中写了日志，读到的是写之前的，标成过时、不放进缓存。只在读的期间有项。 */
    readonly #reading = new Map<string, Set<{stale: boolean}>>();

    constructor(private readonly options: SubagentTreeOptions) {
        options.table.onLog((id) => {
            this.#indexed.delete(id);
            for (const read of this.#reading.get(id) ?? []) read.stale = true;
        });
    }

    async #index(id: string): Promise<SessionIndexEntry | null> {
        const open = this.options.table.isOpen(id);
        const cached = this.#indexed.get(id);
        if (cached !== undefined && !(cached.whileOpen && !open)) return cached.entry;
        const token = {stale: false};
        const reads = this.#reading.get(id) ?? new Set();
        reads.add(token);
        this.#reading.set(id, reads);
        try {
            const read = await this.options.entry(id);
            const entry = read.ok ? read.value : null;
            // 读的途中写了日志（例如子会话刚收口）：这一份照样交回，但不缓存，否则失效已经过去，旧的收口会一直留到句柄关闭。
            if (!token.stale) this.#indexed.set(id, {entry, whileOpen: open});
            return entry;
        } finally {
            reads.delete(token);
            if (reads.size === 0 && this.#reading.get(id) === reads) this.#reading.delete(id);
        }
    }

    async tree(sessionId: string): Promise<TreeItem[]> {
        const {relations} = this.options;
        const icons = new Map(this.options.catalog().map((entry) => [entry.key, entry.icon]));
        const items = await Promise.all(relations.descendantsOf(sessionId).map((id) => this.#item(id, icons)));
        // 动态字段至多给 16 个在跑的后代（按开始时间取最近的）；有等用户事项的一律给全。
        const active = items.filter((item) => item.state !== "idle" && item.pending === undefined).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
        const trimmed = new Set(active.slice(DETAILED_LIMIT).map((item) => item.id));
        return items.map((item) => {
            if (!trimmed.has(item.id)) return item;
            const {step: _step, tools: _tools, ...rest} = item;
            return rest;
        });
    }

    async #item(id: string, icons: ReadonlyMap<string, string | undefined>): Promise<TreeItem> {
        const {relations, table, jobs} = this.options;
        const call = relations.callOf(id);
        const index = await this.#index(id);
        const profile = index?.profile ?? null;
        const icon = profile === null ? undefined : icons.get(profile);
        const base = {
            id,
            parent: relations.parentOf(id) ?? "",
            callId: call?.callId ?? null,
            invocation: call?.invocation ?? null,
            forked: relations.isForked(id),
            profile,
            name: index?.title ?? null,
            ...(icon === undefined ? {} : {profileIcon: icon}),
            runs: index?.runs ?? [],
        };
        // 关着的一定空闲（运行与等待都持着句柄）；也不为读它的事项去打开。
        if (!table.isOpen(id)) {
            this.#dynamic.delete(id);
            return {...base, state: "idle"};
        }
        const view = table.view(id);
        let snapshot: Awaited<ReturnType<typeof view.snapshot>>;
        let path: LogEvent[];
        try {
            snapshot = await view.snapshot();
            const tracking = snapshot.status.state === "idle" || snapshot.status.state === "broken" ? undefined : jobs.forRun(id, snapshot.status.runId);
            const key = `${String(snapshot.head)}|${snapshot.status.state}|${tracking?.invocation ?? ""}|${tracking?.state ?? ""}|${tracking?.question?.id ?? ""}|${index?.title ?? ""}`;
            const cached = this.#dynamic.get(id);
            if (cached?.key === key) return {...cached.item, ...base, profile: cached.item.profile, name: cached.item.name};
            path = await view.path();
            const item = this.#openItem(id, base, snapshot, path);
            this.#dynamic.set(id, {key, item});
            return item;
        } catch (error) {
            // 刚好在这期间关掉、又打不开了：按空闲给，下一次推送再看。
            if (error instanceof SessionUnavailable) return {...base, state: "idle"};
            throw error;
        }
    }

    /** 打开着的后代：状态、等用户的事项、这次运行的进度，从快照与当前路径算。 */
    #openItem(id: string, base: Omit<TreeItem, "state">, snapshot: SessionSnapshot, path: readonly LogEvent[]): TreeItem {
        const {jobs} = this.options;
        const unanswered = pendingOf(path);
        const toUser = (item: PendingItem) => forUser(item.kind, snapshot.header.questions, isModeSwitch(item));
        const pending = unanswered.filter(toUser).map(({id: itemId, kind, callId, request}) => ({id: itemId, kind, callId, request: trimRequest(request)}));
        const status = snapshot.status;
        const named = {...base, profile: snapshot.profile.id, name: snapshot.title, ...(pending.length === 0 ? {} : {pending})};
        if (status.state === "idle" || status.state === "broken") return {...named, state: "idle"};
        const job = jobs.forRun(id, status.runId);
        const live = job !== undefined && isLive(job.state) ? job : undefined;
        // 运行停在同步事项上：其中有等用户的就是 `waiting`，全是交给调用方的提问就是 `question`。
        const blocking = status.state === "waiting" ? unanswered.filter((item) => status.pending.some((summary) => summary.id === item.id)) : [];
        const state: TreeState = blocking.length === 0 ? "running" : blocking.some(toUser) ? "waiting" : "question";
        const asked = blocking[0];
        // 第一题的文字（输出 21）；任务上记的是交给模型的全部题目。
        const question = state !== "question" ? undefined : asked !== undefined ? {id: asked.id, text: questionText(asked.request, {first: true})} : live?.question;
        return {
            ...named,
            state,
            runId: status.runId,
            ...(live === undefined ? {} : {runInvocation: live.invocation}),
            ...progressOf(path, status.runId),
            ...(question === undefined ? {} : {question: {id: question.id, text: clip(question.text, QUESTION_CHARS)}}),
        };
    }

    /**
     * 订阅一个会话的子树：后代写了日志、句柄状态变了、任务变了、登记了新的子会话时重算，合并后至多每 `TREE_PUSH_MS` 推一次。
     * 交回的函数取消订阅。计算抛错交给 `failed`（写诊断），下一次变化照常重算。
     */
    watch(sessionId: string, push: (items: TreeItem[]) => void, failed: (error: unknown) => void): () => void {
        const {relations, table, jobs, clock} = this.options;
        // 结果没变就不推：后代写一条日志不一定改变任何一项（例如流式中的助手消息之外的事件）。
        let pushed = "";
        const pushChanged = (items: TreeItem[]) => {
            const text = JSON.stringify(items);
            if (text === pushed) return;
            pushed = text;
            push(items);
        };
        const throttle = new PushThrottle({clock, intervalMs: TREE_PUSH_MS, compute: () => this.tree(sessionId), push: pushChanged, failed});
        const inTree = (id: string) => relations.ancestorsOf(id).includes(sessionId);
        // 活动变化不带是哪个会话：只在这棵树里的会话的活动变了时重算。
        let activity = "";
        const treeActivity = () => JSON.stringify(table.activity().filter((item) => inTree(item.id)));
        const stops = [
            table.onLog((id) => {
                if (inTree(id)) throttle.trigger();
            }),
            table.onActivityChanged(() => {
                const now = treeActivity();
                if (now === activity) return;
                activity = now;
                throttle.trigger();
            }),
            jobs.onChanged((owner) => {
                if (owner === sessionId || inTree(owner)) throttle.trigger();
            }),
            relations.onRegistered((id) => {
                if (inTree(id)) throttle.trigger();
            }),
        ];
        return () => {
            throttle.close();
            for (const stop of stops) stop();
        };
    }
}
