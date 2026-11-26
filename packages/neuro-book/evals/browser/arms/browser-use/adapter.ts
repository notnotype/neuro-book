/**
 * browser-use 一边的适配：读执行脚本（`run.py`）的标准输出事件与 `executor.json`，拼成运行记录的步骤、结果与自报用量。
 *
 * 步骤的对齐：`executor.json` 里是模型发出的每一段 python 调用，步骤事件只为真正执行了的那几段才有（browser-use 执行完
 * 一段才打 “step N: <代码第一行>” 的日志；参数校验没过、时间用完回 NO_TIME 的调用不打）。所以按内容配：事件行就是代码
 * 第一个非空行的前 120 个字符（出错时后面接 “ -> 错误”），按先后逐段找；配不上的代码段记为没执行。
 * 被兜底结束、没写出 `executor.json` 时，步骤只有事件里那一行代码，输出为空。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {RunStep} from "../../record/schema";
import type {PageTarget} from "../../runner/observer";

export const EVENT_SCHEMA = "nbook.browser-eval.event/v1";
export const EXECUTOR_FORMAT = "nbook.browser-eval.executor/v1";

const EventSchema = Type.Object({
    schema: Type.Literal(EVENT_SCHEMA),
    event: Type.Union([Type.Literal("ready"), Type.Literal("step"), Type.Literal("done")]),
    line: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    at: Type.Optional(Type.Number()),
});

export type ExecutorEvent = Static<typeof EventSchema>;

/** 标准输出的一行：带 schema 的事件 JSON 交回事件，别的（browser-use 或依赖打到标准输出的行）交回 null。 */
export function parseEventLine(line: string): ExecutorEvent | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return null;
    let value: unknown;
    try {
        value = JSON.parse(trimmed);
    } catch {
        return null;
    }
    return Value.Check(EventSchema, value) ? value : null;
}

export const ExecutorOutputSchema = Type.Object({
    format: Type.Literal(EXECUTOR_FORMAT),
    status: Type.Union([Type.Literal("completed"), Type.Literal("timeout"), Type.Literal("max_steps"), Type.Literal("error")]),
    success: Type.Union([Type.Boolean(), Type.Null()]),
    finalAnswer: Type.Union([Type.String(), Type.Null()]),
    error: Type.Union([Type.String(), Type.Null()]),
    partial: Type.Union([Type.String(), Type.Null()]),
    usage: Type.Union([Type.Record(Type.String(), Type.Number()), Type.Null()]),
    steps: Type.Array(Type.Object({code: Type.String(), output: Type.String(), error: Type.Union([Type.String(), Type.Null()])})),
    thinking: Type.Array(Type.String()),
    deliverables: Type.Array(Type.String()),
    versions: Type.Record(Type.String(), Type.String()),
});

export type ExecutorOutput = Static<typeof ExecutorOutputSchema>;

/** 调度器在收到一个步骤事件时记下的：到达时刻与观察者这时看到的页面目标。 */
export interface ObservedStep {
    readonly line: string;
    readonly at: number;
    readonly targets: readonly PageTarget[];
}

/** BU Bench 的掐中间的办法：留开头与结尾各一半，中间标出去掉了多少字。 */
export function clipMiddle(text: string, limit = 20_000): string {
    if (text.length <= limit) return text;
    const half = Math.floor(limit / 2);
    return `${text.slice(0, half)}\n... [${text.length - limit} characters omitted] ...\n${text.slice(-half)}`;
}

/** browser-use 的步骤日志里那一行：代码第一个非空行的前 120 个字符（1.0.6 `agent/loop.py`）。 */
function logLine(code: string): string {
    return (code.split(/\r?\n/u).find((line) => line.trim() !== "") ?? "").slice(0, 120).trim();
}

function sameStep(event: ObservedStep, code: string): boolean {
    const head = logLine(code);
    return head === "" ? event.line === "" : event.line.startsWith(head);
}

export function buildSteps(output: ExecutorOutput | null, observed: readonly ObservedStep[]): RunStep[] {
    const steps: RunStep[] = [];
    let next = 0;
    let previous: ObservedStep | undefined;
    for (const segment of output?.steps ?? []) {
        const event = observed[next];
        const executed = event !== undefined && sameStep(event, segment.code);
        if (executed) {
            next += 1;
            previous = event;
        }
        steps.push({
            ordinal: steps.length + 1,
            code: clipMiddle(segment.code),
            output: clipMiddle(segment.output),
            error: segment.error === null ? null : clipMiddle(segment.error),
            event: executed ? next : null,
            endedAt: previous?.at ?? 0,
            targets: [...(previous?.targets ?? [])],
            executed,
        });
    }
    // 没写出 executor.json，或事件多出来（配不上任何代码段）：照事件补上，代码只有那一行。
    observed.slice(next).forEach((event, i) => steps.push({ordinal: steps.length + 1, code: event.line, output: "", error: null, event: next + i + 1, endedAt: event.at, targets: [...event.targets], executed: true}));
    return steps;
}
