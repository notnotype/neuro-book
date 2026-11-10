/**
 * 子代理的进度（docs/specs/agent/subagents.md 输出 21、22）：远程 `tree({sessionId})` 交回一个会话的全部后代，`treeChanged` 在任一项
 * 变化时推整份。
 *
 * 不为取进度去打开会话：结构查关系表，标题、Profile 与运行收口读各后代的索引（`entry`，只读那一个文件），状态只看打开着的句柄
 * （关着的一定空闲）。在跑的后代的最近一步与工具次数从它的当前路径数，至多给 16 个；有等用户事项的一律给全。
 */

import type {JsonValue, LogEvent, SessionIndexEntry, StorageResult} from "@notnotype/nb-harness/kernel/contracts";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {ProfileEntry} from "../../shared/contracts";
import type {TreeItem, TreeState} from "../../shared/subagents";
import {PushThrottle} from "../push-throttle";
import {AgentSessionUnavailable, type SessionTable} from "../sessions";
import type {JobCenter} from "../jobs/center";
import {isLive} from "../jobs/center";
import type {SessionRelations} from "./relations";
import {isModeSwitch, pendingOf, questionText, type PendingItem} from "./result";

/** 给动态字段（`step`、`tools`）的在跑后代至多几个（按开始时间取最近的）。 */
export const DETAILED_LIMIT = 16;
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

export class SubagentTree {
    constructor(private readonly options: SubagentTreeOptions) {}

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
        const indexed = await this.options.entry(id);
        const index = indexed.ok ? indexed.value : null;
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
        if (!table.isOpen(id)) return {...base, state: "idle"};
        const view = table.view(id);
        let snapshot: Awaited<ReturnType<typeof view.snapshot>>;
        let path: LogEvent[];
        try {
            [snapshot, path] = await Promise.all([view.snapshot(), view.path()]);
        } catch (error) {
            // 刚好在这期间关掉、又打不开了：按空闲给，下一次推送再看。
            if (error instanceof AgentSessionUnavailable) return {...base, state: "idle"};
            throw error;
        }
        const unanswered = pendingOf(path);
        const toUser = (item: PendingItem) => item.kind === "approval" || isModeSwitch(item) || snapshot.header.questions === "user";
        const pending = unanswered.filter(toUser).map(({id: itemId, kind, callId, request}) => ({id: itemId, kind, callId, request}));
        const status = snapshot.status;
        const named = {...base, profile: snapshot.profile.id, name: snapshot.title, ...(pending.length === 0 ? {} : {pending})};
        if (status.state === "idle" || status.state === "broken") return {...named, state: "idle"};
        const job = jobs.forRun(id, status.runId);
        const live = job !== undefined && isLive(job.state) ? job : undefined;
        // 运行停在同步事项上：其中有等用户的就是 `waiting`，全是交给调用方的提问就是 `question`。
        const blocking = status.state === "waiting" ? unanswered.filter((item) => status.pending.some((summary) => summary.id === item.id)) : [];
        const state: TreeState = blocking.length === 0 ? "running" : blocking.some(toUser) ? "waiting" : "question";
        const asked = blocking[0];
        const question = state !== "question" ? undefined : live?.question ?? (asked === undefined ? undefined : {id: asked.id, text: questionText(asked.request)});
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
        const throttle = new PushThrottle({clock, intervalMs: TREE_PUSH_MS, compute: () => this.tree(sessionId), push, failed});
        const inTree = (id: string) => relations.ancestorsOf(id).includes(sessionId);
        const stops = [
            table.onLog((id) => {
                if (inTree(id)) throttle.trigger();
            }),
            table.onActivityChanged(() => throttle.trigger()),
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
