/**
 * 一次运行的结果（master `TurnResult` 的等价物）：全部从日志算，重开之后同样能取。
 * 用量是这次运行里 `assistant` 与 `modelEnded` 的和；有一条不完整，总和就不完整。
 */

import {replyText, type EventData, type KernelEvents, type LogEvent, type RunResult, type Usage} from "../api/index.js";

const ZERO: Usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, complete: true};

function addUsage(total: Usage, usage: Usage): Usage {
    return {
        input: total.input + usage.input,
        output: total.output + usage.output,
        cacheRead: total.cacheRead + usage.cacheRead,
        cacheWrite: total.cacheWrite + usage.cacheWrite,
        cost: total.cost === null || usage.cost === null ? null : total.cost + usage.cost,
        complete: total.complete && usage.complete,
    };
}

/** `runId` 的结果；运行还没结束（或不存在）时为 null。 */
export function runResultOf(events: readonly LogEvent[], runId: string): RunResult | null {
    const start = events.findIndex((event) => event.type === "runStarted" && (event.data as {runId: string}).runId === runId);
    if (start < 0) return null;
    let usage = ZERO;
    let lastReply: EventData<KernelEvents["assistant"]> | null = null;
    let lastFailure: EventData<KernelEvents["modelFailed"]> | null = null;
    for (let index = start; index < events.length; index += 1) {
        const event = events[index]!;
        if (event.type === "assistant") {
            const data = event.data as EventData<KernelEvents["assistant"]>;
            usage = addUsage(usage, data.usage);
            lastReply = data;
        } else if (event.type === "modelEnded") {
            usage = addUsage(usage, (event.data as EventData<KernelEvents["modelEnded"]>).usage);
        } else if (event.type === "modelFailed") {
            const data = event.data as EventData<KernelEvents["modelFailed"]>;
            if (data.usage !== undefined) usage = addUsage(usage, data.usage);
            lastFailure = data;
        } else if (event.type === "runEnded" && (event.data as {runId: string}).runId === runId) {
            const data = event.data as EventData<KernelEvents["runEnded"]>;
            const stopReason = data.reason === "finished" ? "finished" : data.reason === "aborted" || data.reason === "interrupted" ? "aborted" : data.reason === "error" ? "error" : lastReply?.stopReason === "length" ? "length" : "stop";
            let error: RunResult["error"] = null;
            if (data.reason === "error") {
                const failedKind = lastFailure === null || lastFailure.kind === "aborted" || lastFailure.kind === "interrupted" ? "local" : lastFailure.kind;
                error = {kind: data.error?.kind ?? failedKind, ...(data.error?.code === undefined ? {} : {code: data.error.code}), ...(lastFailure?.message === undefined ? {} : {message: lastFailure.message})};
            }
            return {
                runId,
                reason: data.reason,
                stopReason: stopReason as RunResult["stopReason"],
                text: lastReply === null ? "" : replyText(lastReply.content),
                result: data.result ?? null,
                error,
                usage,
                entries: {first: events[start]!.seq, last: event.seq},
            };
        }
    }
    return null;
}
