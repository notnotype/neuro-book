/**
 * 父会话里子代理卡片的推导（docs/specs/agent/conversation.md 输出 33–39 的卡片矩阵）：一次 `agent_spawn`、`agent_send`、`agent_answer`
 * 调用画成一张卡，“调用的状态 × 子代理运行的状态”。纯函数，卡片组件只管画。
 *
 * 终态按这个顺序找（先找到的算）：调用自己的结果是终态 → 父会话后来任何一个工具结果的 `details` 里同 `runId` 的终态（`wait`、
 * `agent_send` 交回的）→ `tree` 项 `runs` 里同 `runId` 的收口 → 在跑的 `tree` 项。子会话按调用的 `invocation` 认（fork 出来的不认）。
 */

import type {MessageView, ToolCallView} from "@notnotype/nb-agent-ui";

import {MODE_SWITCH_KIND} from "../shared/permissions";
import type {TreeItem, TreePending} from "../shared/subagents";
import {displayToolName} from "./session-host";

/** `denied`、`invalid`：调用没执行（被拒、参数不合 schema），没有派出；`unknown`：不知道派没派出（调用 `unknown`、进程崩溃留下的）。 */
export type CardState = "preparing" | "dispatch-failed" | "denied" | "invalid" | "running" | "waiting" | "question" | "done" | "failed" | "aborted" | "interrupted" | "unknown";

export interface CardModel {
    readonly state: CardState;
    readonly childId: string | null;
    readonly name: string;
    readonly icon: string;
    /** 进度或结果的一行；状态的前缀由组件加。运行中有最近一步时为空，组件按 `step` 写。 */
    readonly line: string;
    /** 运行中最近的一步。 */
    readonly step?: Step;
    /** 运行中：这次运行的工具调用数与开始时刻。 */
    readonly tools?: number;
    readonly startedAt?: number;
    /** 调用先返回了（`async`、超时、插话），之后在后台跑。 */
    readonly background: boolean;
    /** 运行中、子会话的进度已到但还没有工具调用：写“正在思考”；进度还没到时写“正在启动”。 */
    readonly thinking?: true;
    /** 结果全文（点开看）。 */
    readonly result?: string;
    /** 派发失败的码。 */
    readonly code?: string;
    /** 等用户时等的是什么（`waiting`）：子会话最早的那个事项。 */
    readonly waitingFor?: WaitingFor;
}

/**
 * 子代理最近的一步：`tool` 是视图认的工具名（`displayToolName`，与对话视图注册表的键相同），组件据此写动作名；`target` 是
 * 对象，地址只留最后一段（`project://正文/第二章.md` 写 `第二章.md`）。
 */
export interface Step {
    readonly tool: string;
    readonly target?: string;
}

/** `approval` 的 `tool` 同 `Step.tool`。 */
export type WaitingFor = {readonly kind: "approval"; readonly tool: string} | {readonly kind: "question"; readonly text: string} | {readonly kind: "mode-switch"};

type Details = {readonly sessionId?: string; readonly jobId?: string; readonly runId?: string; readonly status?: string; readonly line?: string; readonly code?: string; readonly jobs?: readonly {readonly runId?: string; readonly state?: string; readonly line?: string}[]};

const TERMINAL: Readonly<Record<string, CardState>> = {completed: "done", failed: "failed", aborted: "aborted", interrupted: "interrupted"};
/** 运行的收口原因 → 状态；卡片与子代理浮层共用（输出 33、43 的“同一套状态”）。 */
export const RUN_REASON: Readonly<Record<string, "done" | "failed" | "aborted" | "interrupted">> = {finished: "done", completed: "done", error: "failed", aborted: "aborted", interrupted: "interrupted"};
const NAME_CHARS = 30;

const detailsOf = (call: ToolCallView): Details => (call.result?.details ?? {}) as Details;
const record = (value: unknown): Readonly<Record<string, unknown>> => (value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** 事项的请求是内核事件里的原文：审批带工具 id，提问带 `data.questions`，模式切换的 `data.kind` 是 `mode-switch`。 */
export function waitingOf(item: TreePending | undefined): WaitingFor | undefined {
    if (item === undefined) return undefined;
    const request = record(item.request);
    if (item.kind === "approval") {
        return {kind: "approval", tool: displayToolName(typeof request.tool === "string" ? request.tool : "")};
    }
    const data = record(request.data);
    if (data.kind === MODE_SWITCH_KIND) return {kind: "mode-switch"};
    const first = Array.isArray(data.questions) ? record(data.questions[0]) : {};
    return {kind: "question", text: typeof first.question === "string" ? first.question : ""};
}

/** 运行了多久，写成“分:秒”（卡片与子代理浮层的用时）。 */
export function duration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 对象以地址开头时（`project://正文/第二章 雨夜.md`，文件名可以带空格）只留最后一段；含地址的命令、搜索词等原样。 */
const ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//iu;

export function shortTarget(target: string): string {
    if (!ADDRESS.test(target)) return target;
    return target.slice(target.indexOf("://") + 3).split("/").filter((segment) => segment !== "").at(-1) ?? target;
}

function laterTerminal(messages: readonly MessageView[], runId: string, self: string): {readonly state: CardState; readonly line?: string; readonly result?: string} | null {
    for (const message of messages) {
        if (message.kind !== "assistant") continue;
        for (const call of message.toolCalls) {
            if (call.id === self || call.result === undefined) continue;
            const details = detailsOf(call);
            if (details.runId === runId && details.status !== undefined && TERMINAL[details.status] !== undefined) return {state: TERMINAL[details.status]!, ...(details.line === undefined ? {} : {line: details.line}), result: call.result.text};
            const job = details.jobs?.find((item) => item.runId === runId && item.state !== undefined && TERMINAL[item.state] !== undefined);
            if (job !== undefined) return {state: TERMINAL[job.state!]!, ...(job.line === undefined ? {} : {line: job.line}), ...(details.jobs?.[0] === job ? {result: call.result.text} : {})};
        }
    }
    return null;
}

/**
 * `parentIdle`：父会话没有在跑；这时调用还没有结果、也找不到子会话的，是进程崩溃留下的，写“状态未知”。
 */
export function cardModel(call: ToolCallView, tree: ReadonlyMap<string, TreeItem>, messages: readonly MessageView[], parentIdle: boolean): CardModel {
    const args = record(call.args);
    const details = detailsOf(call);
    const childId = call.name === "agent_spawn"
        ? details.sessionId ?? [...tree.values()].find((item) => !item.forked && item.invocation !== null && item.invocation === call.invocation)?.id ?? null
        : typeof args.id === "string" ? args.id : null;
    const item = childId === null ? undefined : tree.get(childId);
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    const name = item?.name ?? (typeof args.name === "string" ? args.name : prompt === "" ? childId ?? "" : [...prompt].slice(0, NAME_CHARS).join(""));
    const base = {childId, name, icon: item?.profileIcon ?? "i-lucide-bot"};

    if (call.status === "streaming") return {...base, state: "preparing", line: "", background: false};
    // 调用没执行：被拒（用户、规则、模式）或参数不对。工具没跑，所以既没有子会话也没有运行。
    if (call.status === "denied" || call.status === "invalid") return {...base, state: call.status, line: "", background: false, ...(call.result === undefined ? {} : {result: call.result.text})};
    // 还没有结果时认运行：子会话正跟着这次调用的运行；派发的运行是子会话的第一次运行（同一批里先收口的子代理，整批结束前就画出终态）。
    const runId = details.runId
        ?? (item?.runInvocation !== undefined && item.runInvocation === call.invocation ? item.runId : undefined)
        ?? (call.name === "agent_spawn" ? item?.runs[0]?.runId : undefined);
    // 派发或续用没成：有码、没有运行。
    if (details.code !== undefined || (call.status === "error" && runId === undefined)) return {...base, state: "dispatch-failed", line: "", background: false, ...(details.code === undefined ? {} : {code: details.code}), ...(call.result === undefined ? {} : {result: call.result.text})};

    const background = details.status === "running" || details.status === "question";
    const own = details.status === undefined ? undefined : TERMINAL[details.status];
    if (own !== undefined) return {...base, state: own, line: details.line ?? "", background: false, ...(call.result === undefined ? {} : {result: call.result.text})};
    if (runId !== undefined) {
        const later = laterTerminal(messages, runId, call.id);
        if (later !== null) return {...base, state: later.state, line: later.line ?? "", background, ...(later.result === undefined ? {} : {result: later.result})};
        const run = item?.runs.find((entry) => entry.runId === runId);
        if (run !== undefined) return {...base, state: RUN_REASON[run.reason] ?? "done", line: "", background};
        if (item !== undefined && item.runId === runId && item.state !== "idle") {
            const step = item.step === undefined ? undefined : {tool: displayToolName(item.step.tool), ...(item.step.target === undefined ? {} : {target: shortTarget(item.step.target)})};
            return {
                ...base,
                state: item.state === "question" ? "question" : item.state === "waiting" ? "waiting" : "running",
                line: item.state === "question" ? item.question?.text ?? "" : "",
                background,
                ...(step === undefined || item.state === "question" ? {} : {step}),
                ...(item.tools === undefined ? {} : {tools: item.tools}),
                ...(item.startedAt === undefined ? {} : {startedAt: item.startedAt}),
                ...(item.state === "waiting" ? {waitingFor: waitingOf(item.pending?.[0])} : {}),
                ...(item.state === "running" && item.step === undefined ? {thinking: true as const} : {}),
            };
        }
    }
    // 开始了但不知道有没有执行完（内核给的 `unknown`）：上面按运行找不到，就说不知道派没派出。
    if (call.status === "unknown") return {...base, state: "unknown", line: "", background};
    // 还在等结果的前台调用（子会话的进度还没推到）：照运行中画；父会话都不跑了还找不到，是崩溃留下的。
    if (call.result === undefined && !parentIdle) return {...base, state: "running", line: "", background: false};
    if (details.status === "question") return {...base, state: "question", line: "", background};
    return {...base, state: item !== undefined && item.state !== "idle" ? "running" : parentIdle ? "unknown" : "running", line: "", background};
}
