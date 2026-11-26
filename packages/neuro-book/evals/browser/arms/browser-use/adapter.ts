/**
 * browser-use 一边的适配：读执行脚本（`run.py`）的标准输出事件与 `executor.json`，拼成运行记录的步骤、结果与自报用量。
 *
 * 步骤的对齐：`executor.json` 里的代码段按出现先后，与步骤事件按到达先后一一对应（browser-use 每执行完一段 python
 * 打一条日志，见 1.0.6 `agent/loop.py`）。被兜底结束、没写出 `executor.json` 时，步骤只有事件里那一行代码，输出为空。
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

export function buildSteps(output: ExecutorOutput | null, observed: readonly ObservedStep[]): RunStep[] {
    const count = Math.max(output?.steps.length ?? 0, observed.length);
    const steps: RunStep[] = [];
    for (let i = 0; i < count; i++) {
        const fromOutput = output?.steps[i];
        const event = observed[i];
        steps.push({
            ordinal: i + 1,
            code: clipMiddle(fromOutput?.code ?? event?.line ?? ""),
            output: clipMiddle(fromOutput?.output ?? ""),
            error: fromOutput?.error ?? null,
            endedAt: event?.at ?? Number.NaN,
            targets: [...(event?.targets ?? [])],
        });
    }
    return steps.map((step) => (Number.isNaN(step.endedAt) ? {...step, endedAt: steps.findLast((other) => !Number.isNaN(other.endedAt))?.endedAt ?? 0} : step));
}
