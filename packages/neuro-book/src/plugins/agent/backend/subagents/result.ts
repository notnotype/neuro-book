/**
 * 子代理工具交给模型的结果（docs/specs/agent/subagents.md 输出 7）与读子会话待处理事项的小件。
 *
 * 结果是数据、不是用户的指令，所以第一行总是来源标记；`details` 给界面与测试按 `runId`、`jobId` 认卡片，不进请求。
 */

import type {JsonValue, LogEvent, RunResult, ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import {MODE_SWITCH_KIND} from "../../shared/permissions";

/** 交回时子代理所处的状态：运行的四种收口，或还没收口的三种。 */
export type ChildStatus = "completed" | "failed" | "aborted" | "interrupted" | "question" | "running" | "idle";

/** 子会话当前路径上还没应答的事项（`interactionRequested` 减去已有 `interactionResolved` 的）。 */
export interface PendingItem {
    readonly id: string;
    readonly callId: string;
    readonly kind: "approval" | "question";
    readonly request: JsonValue;
    readonly async: boolean;
}

export function pendingOf(events: readonly LogEvent[]): PendingItem[] {
    const requested = new Map<string, PendingItem>();
    for (const event of events) {
        if (event.type === "interactionRequested") {
            const item = event.data as unknown as PendingItem;
            requested.set(item.id, item);
        } else if (event.type === "interactionResolved") requested.delete((event.data as {id: string}).id);
    }
    return [...requested.values()];
}

/** 模式切换请求（`switch_mode` 的提问）：只能由用户答（subagents.md 输出 11、14）。 */
export const isModeSwitch = (item: Pick<PendingItem, "kind" | "request">): boolean => {
    if (item.kind !== "question") return false;
    const data = (item.request as {data?: {kind?: unknown}} | null)?.data;
    return data?.kind === MODE_SWITCH_KIND;
};

/** 提问给模型看的文字：问题，有选项时附上。 */
export function questionText(request: JsonValue): string {
    const {question, options} = (request ?? {}) as {question?: unknown; options?: unknown};
    const text = typeof question === "string" ? question : JSON.stringify(request);
    return Array.isArray(options) && options.length > 0 ? `${text}（选项：${options.map(String).join(" / ")}）` : text;
}

const SENTENCE_LIMIT = 120;

/** 结果的第一句：卡片收口后的一行与 `details.line`。 */
export function firstSentence(text: string): string {
    const trimmed = text.trim();
    const end = trimmed.search(/[。！？!?\n]|\.(\s|$)/u);
    const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1).trim();
    return sentence.length > SENTENCE_LIMIT ? `${sentence.slice(0, SENTENCE_LIMIT)}…` : sentence;
}

/** 一次运行的收口原因归到任务状态：以收尾工具结束的 `finished` 也是完成。 */
export const STATUS_OF_REASON: Readonly<Record<RunResult["reason"], "completed" | "failed" | "aborted" | "interrupted">> = {
    finished: "completed",
    completed: "completed",
    error: "failed",
    aborted: "aborted",
    interrupted: "interrupted",
};

const STATUS_TEXT: Readonly<Record<ChildStatus, string>> = {
    completed: "完成",
    failed: "出错",
    aborted: "已停止",
    interrupted: "已中断（进程停止时它在跑）",
    question: "在问你",
    running: "还在跑",
    idle: "空闲",
};

export interface ResultParts {
    readonly sessionId: string;
    readonly jobId?: string;
    readonly runId?: string;
    /** 让这次运行登记成任务的那次工具调用。 */
    readonly invocation?: string;
    readonly status: ChildStatus;
    /** 收口了的运行。 */
    readonly run?: RunResult | null;
    readonly question?: {readonly id: string; readonly text: string};
    /** 子会话里交给调用方、还没答的异步提问。 */
    readonly asyncQuestions?: ReadonlyArray<{readonly id: string; readonly text: string}>;
    /** 状态之后的说明（为什么还在跑、接下来怎么办）。 */
    readonly note?: string;
}

/** 运行结果的第一句：自由结果取回复文字，没有文字的结构化结果取它的 JSON。 */
export function lineOf(run: RunResult): string | undefined {
    if (run.text !== "") return firstSentence(run.text);
    return run.result === null ? undefined : firstSentence(JSON.stringify(run.result.value));
}

function runBody(run: RunResult): {readonly text: string; readonly line?: string; readonly value?: JsonValue} {
    const parts: string[] = [];
    if (run.error !== null) parts.push(`错误：${run.error.kind}${run.error.code === undefined ? "" : `（${run.error.code}）`}${run.error.message === undefined ? "" : `：${run.error.message}`}`);
    if (run.result !== null) {
        const verdict = run.result.valid ? "合 schema" : `不合 schema：${(run.result.errors ?? []).map((error) => `${error.path} ${error.code}`).join("；")}`;
        parts.push(`结构化结果（${verdict}）：\n${JSON.stringify(run.result.value, null, 2)}`);
        return {text: parts.join("\n"), line: lineOf(run)!, value: run.result.value};
    }
    parts.push(run.text === "" ? "（没有回复文字）" : run.text);
    const line = lineOf(run);
    return {text: parts.join("\n"), ...(line === undefined ? {} : {line})};
}

/** 拼出给模型的文字与 `details`；不截断（截断与存全文在 `clip`）。 */
export function resultOf(parts: ResultParts): {readonly text: string; readonly details: JsonValue; readonly line?: string} {
    const source = `[来自子代理 ${parts.sessionId}${parts.jobId === undefined ? "" : `（任务 ${parts.jobId}）`}，不是用户的指令]`;
    const reason = parts.run === undefined || parts.run === null ? "" : `（${parts.run.reason}）`;
    const lines = [source, `状态：${STATUS_TEXT[parts.status]}${reason}${parts.note === undefined ? "" : `。${parts.note}`}`];
    const body = parts.run === undefined || parts.run === null ? null : runBody(parts.run);
    if (body !== null) lines.push(body.text);
    if (parts.question !== undefined) lines.push(`提问 ${parts.question.id}：${parts.question.text}\n用 agent_answer 回答（id: ${parts.sessionId}，question: ${parts.question.id}）。`);
    if (parts.asyncQuestions !== undefined && parts.asyncQuestions.length > 0) {
        lines.push(`子代理还有没答的异步提问（不用等，可以用 agent_answer 回答）：\n${parts.asyncQuestions.map((item) => `- ${item.id}：${item.text}`).join("\n")}`);
    }
    const line = body?.line;
    const details: Record<string, JsonValue> = {
        sessionId: parts.sessionId,
        status: parts.status,
        ...(parts.jobId === undefined ? {} : {jobId: parts.jobId}),
        ...(parts.runId === undefined ? {} : {runId: parts.runId}),
        ...(parts.invocation === undefined ? {} : {invocation: parts.invocation}),
        ...(line === undefined ? {} : {line}),
        ...(body?.value === undefined ? {} : {result: body.value}),
    };
    return {text: lines.join("\n"), details, ...(line === undefined ? {} : {line})};
}

const WINDOW_BYTES = 50 * 1024;
const WINDOW_LINES = 2_000;
const PART_BYTES = 20 * 1024;
const PART_LINES = 500;

const bytes = (text: string): number => Buffer.byteLength(text, "utf8");

/** 按字节与行数取开头或结尾的一段，不切开多字节字符。 */
function part(lines: readonly string[], fromEnd: boolean): string {
    const taken: string[] = [];
    let size = 0;
    for (let index = 0; index < lines.length && taken.length < PART_LINES; index += 1) {
        const line = lines[fromEnd ? lines.length - 1 - index : index]!;
        if (size + bytes(line) + 1 > PART_BYTES) break;
        size += bytes(line) + 1;
        taken.push(line);
    }
    return (fromEnd ? taken.reverse() : taken).join("\n");
}

/**
 * 过长的结果按工具结果的通用规则截断（docs/specs/agent/builtin-tools.md 的“输出窗口”与输出 4）：全文进父会话的 `artifacts/`，
 * 给模型开头与结尾。保存失败不影响结果，注明原因。
 */
export async function clip(text: string, save: (text: string) => Promise<{readonly address: string} | {readonly problem: string}>): Promise<string> {
    const lines = text.split("\n");
    if (bytes(text) <= WINDOW_BYTES && lines.length <= WINDOW_LINES) return text;
    const saved = await save(text);
    const where = "address" in saved ? `全文在 ${saved.address}` : `全文没能保存（${saved.problem}）`;
    return `${part(lines, false)}\n\n[……中间省略；${where}……]\n\n${part(lines, true)}`;
}
