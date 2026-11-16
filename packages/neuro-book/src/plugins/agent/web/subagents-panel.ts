/**
 * 子代理管理的数据（docs/specs/agent/conversation.md 输出 43）：把 `tree` 排成按派生关系缩进的行，算个数与红点。出错看过没有、
 * 收口结果的缓存是插件作用域的两个小对象，右栏与编辑区页面两个对话位置共用；组件只管画。
 */

import {shallowRef} from "vue";
import type {RunResult} from "@notnotype/nb-harness/kernel/contracts";

import type {TreeItem} from "../shared/subagents";
import {displayToolName} from "./session-host";
import {shortTarget, waitingOf} from "./subagent-card";
import type {Step, WaitingFor} from "./subagent-card";

/** 与子代理卡片同一套状态（输出 33）；`unknown` 是还没运行过、也不在跑的。 */
export type RowState = "running" | "waiting" | "question" | "done" | "failed" | "aborted" | "interrupted" | "unknown";

export interface PanelRow {
    readonly id: string;
    readonly depth: number;
    readonly icon: string;
    readonly profile: string | null;
    /** 子会话的标题；没有时为空串。 */
    readonly task: string;
    readonly state: RowState;
    /** 最近一次收口的运行；在跑、等人时不看它（第二行按当前的写）。 */
    readonly ended: {readonly runId: string; readonly endedAt: number} | null;
    readonly waitingFor?: WaitingFor;
    readonly question?: string;
    /** 运行中的动态字段：子树太大时服务端截掉（`DETAILED_LIMIT`），这时三项都没有，行上只写状态。 */
    readonly tools?: number;
    readonly startedAt?: number;
    readonly step?: Step;
}

const RUN_REASON: Readonly<Record<string, RowState>> = {finished: "done", completed: "done", error: "failed", aborted: "aborted", interrupted: "interrupted"};

function rowOf(item: TreeItem, depth: number): PanelRow {
    const base = {id: item.id, depth, icon: item.profileIcon ?? "i-lucide-bot", profile: item.profile, task: item.name ?? ""};
    switch (item.state) {
        case "running": return {
            ...base,
            state: "running",
            ended: null,
            ...(item.tools === undefined ? {} : {tools: item.tools}),
            ...(item.startedAt === undefined ? {} : {startedAt: item.startedAt}),
            ...(item.step === undefined ? {} : {step: {tool: displayToolName(item.step.tool), ...(item.step.target === undefined ? {} : {target: shortTarget(item.step.target)})}}),
        };
        case "waiting": {
            const waitingFor = waitingOf(item.pending?.[0]);
            return {...base, state: "waiting", ended: null, ...(waitingFor === undefined ? {} : {waitingFor})};
        }
        case "question": return {...base, state: "question", ended: null, ...(item.question === undefined ? {} : {question: item.question.text})};
        case "idle": {
            const last = item.runs.at(-1);
            if (last === undefined) return {...base, state: "unknown", ended: null};
            return {...base, state: RUN_REASON[last.reason] ?? "done", ended: {runId: last.runId, endedAt: last.endedAt}};
        }
    }
}

/**
 * 从当前会话往下深度优先排：子会话挂在父会话下，同一个父会话的按 `tree` 给的顺序。父会话不在树里的（服务端截掉了中间一层）
 * 排在最后、不缩进，个数照样算它。
 */
export function panelRows(root: string | null, tree: ReadonlyMap<string, TreeItem>): PanelRow[] {
    if (root === null) return [];
    const children = new Map<string, TreeItem[]>();
    for (const item of tree.values()) children.set(item.parent, [...(children.get(item.parent) ?? []), item]);
    const rows: PanelRow[] = [];
    const placed = new Set<string>();
    const walk = (parent: string, depth: number): void => {
        for (const item of children.get(parent) ?? []) {
            if (placed.has(item.id)) continue;
            placed.add(item.id);
            rows.push(rowOf(item, depth));
            walk(item.id, depth + 1);
        }
    };
    walk(root, 0);
    for (const item of tree.values()) {
        if (placed.has(item.id)) continue;
        placed.add(item.id);
        rows.push(rowOf(item, 0));
    }
    return rows;
}

export interface PanelSummary {
    readonly total: number;
    readonly running: number;
    readonly waiting: number;
    /** 入口的红点：有等你处理的，或有没看过的出错。 */
    readonly dot: boolean;
}

export function panelSummary(rows: readonly PanelRow[], seen: SeenErrors): PanelSummary {
    const waiting = rows.filter((row) => row.state === "waiting").length;
    return {
        total: rows.length,
        running: rows.filter((row) => row.state === "running").length,
        waiting,
        dot: waiting > 0 || rows.some((row) => seen.unseen(row)),
    };
}

/**
 * 出错看过没有：按会话记“看到哪个时刻为止”，最近一次以错误收口、收口晚于它的才算没看过。还没记过的会话按插件激活的时刻算，
 * 激活前收口的都算看过。`endedAt` 是服务端的时钟，激活时刻与切会话的时刻是浏览器的；两者在同一台机器上。
 */
export interface SeenErrors {
    unseen(row: PanelRow): boolean;
    /** 打开浮层：列出的出错都算看过。 */
    markRows(rows: readonly PanelRow[]): void;
    /** 切到这个会话：它在 `at` 之前收口的出错算看过。 */
    markSession(sessionId: string, at: number): void;
}

export function createSeenErrors(activatedAt: number): SeenErrors {
    const until = shallowRef<ReadonlyMap<string, number>>(new Map());
    const seenUntil = (id: string): number => until.value.get(id) ?? activatedAt;
    const mark = (entries: readonly (readonly [string, number])[]): void => {
        const next = new Map(until.value);
        for (const [id, at] of entries) next.set(id, Math.max(next.get(id) ?? activatedAt, at));
        until.value = next;
    };
    return {
        unseen: (row) => row.state === "failed" && row.ended !== null && row.ended.endedAt > seenUntil(row.id),
        markRows: (rows) => mark(rows.flatMap((row) => (row.state === "failed" && row.ended !== null ? [[row.id, row.ended.endedAt] as const] : []))),
        markSession: (sessionId, at) => mark([[sessionId, at]]),
    };
}

/** 收口了的运行结果不会变：按 `会话:运行` 只取一次。取不到（交回 null 或调用失败）的不记，下次打开浮层再取。 */
export interface RunResults {
    get(sessionId: string, runId: string): RunResult | undefined;
    load(sessionId: string, runId: string, fetch: () => Promise<RunResult | null>): void;
}

export function createRunResults(report: (message: string) => void): RunResults {
    const results = shallowRef<ReadonlyMap<string, RunResult>>(new Map());
    const loading = new Set<string>();
    const keyOf = (sessionId: string, runId: string): string => `${sessionId}:${runId}`;
    return {
        get: (sessionId, runId) => results.value.get(keyOf(sessionId, runId)),
        load: (sessionId, runId, fetch) => {
            const key = keyOf(sessionId, runId);
            if (results.value.has(key) || loading.has(key)) return;
            loading.add(key);
            void fetch().then((value) => {
                if (value !== null) results.value = new Map(results.value).set(key, value);
            }, (error: unknown) => report(`run result ${key} failed: ${String(error)}`)).finally(() => loading.delete(key));
        },
    };
}
