/**
 * 父会话里子代理卡片的推导（docs/specs/agent/conversation.md 输出 33–39 的卡片矩阵）：一次 `agent_spawn`、`agent_send`、`agent_answer`
 * 调用画成一张卡，“调用的状态 × 子代理运行的状态”。纯函数，卡片组件只管画。
 *
 * 终态按这个顺序找（先找到的算）：调用自己的结果是终态 → 父会话后来任何一个工具结果的 `details` 里同 `runId` 的终态（`wait`、
 * `agent_send` 交回的）→ `tree` 项 `runs` 里同 `runId` 的收口 → 在跑的 `tree` 项。子会话按调用的 `invocation` 认（fork 出来的不认）。
 */

import type {JsonValue, MessageView, ToolCallView} from "@notnotype/nb-agent-ui";

import type {TreeItem} from "../shared/subagents";

export type CardState = "preparing" | "dispatch-failed" | "running" | "waiting" | "question" | "done" | "failed" | "aborted" | "interrupted" | "unknown";

export interface CardModel {
    readonly state: CardState;
    readonly childId: string | null;
    readonly name: string;
    readonly icon: string;
    /** 进度或结果的一行；状态的前缀由组件加。 */
    readonly line: string;
    /** 运行中：这次运行的工具调用数与开始时刻。 */
    readonly tools?: number;
    readonly startedAt?: number;
    /** 调用先返回了（`async`、超时、插话），之后在后台跑。 */
    readonly background: boolean;
    /** 结果全文（点开看）。 */
    readonly result?: string;
    /** 派发失败的码。 */
    readonly code?: string;
}

type Details = {readonly sessionId?: string; readonly jobId?: string; readonly runId?: string; readonly status?: string; readonly line?: string; readonly code?: string; readonly jobs?: readonly {readonly runId?: string; readonly state?: string; readonly line?: string}[]};

const TERMINAL: Readonly<Record<string, CardState>> = {completed: "done", failed: "failed", aborted: "aborted", interrupted: "interrupted"};
const RUN_REASON: Readonly<Record<string, CardState>> = {finished: "done", completed: "done", error: "failed", aborted: "aborted", interrupted: "interrupted"};
const NAME_CHARS = 30;

const detailsOf = (call: ToolCallView): Details => (call.result?.details ?? {}) as Details;
const record = (value: JsonValue): Readonly<Record<string, JsonValue>> => (value !== null && typeof value === "object" && !Array.isArray(value) ? value : {});

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
    const runId = details.runId ?? (item?.runInvocation !== undefined && item.runInvocation === call.invocation ? item.runId : undefined);
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
            const step = item.step === undefined ? "" : `${item.step.tool}${item.step.target === undefined ? "" : ` ${item.step.target}`}`;
            return {
                ...base,
                state: item.state === "question" ? "question" : item.state === "waiting" ? "waiting" : "running",
                line: item.state === "question" ? item.question?.text ?? "" : step,
                background,
                ...(item.tools === undefined ? {} : {tools: item.tools}),
                ...(item.startedAt === undefined ? {} : {startedAt: item.startedAt}),
            };
        }
    }
    // 还在等结果的前台调用（子会话的进度还没推到）：照运行中画；父会话都不跑了还找不到，是崩溃留下的。
    if (call.result === undefined && !parentIdle) return {...base, state: "running", line: "", background: false};
    if (details.status === "question") return {...base, state: "question", line: "", background};
    return {...base, state: item !== undefined && item.state !== "idle" ? "running" : parentIdle ? "unknown" : "running", line: "", background};
}
