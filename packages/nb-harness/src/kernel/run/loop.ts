/**
 * 运行循环（提案第 1 节的运行图）。循环在队列之外：每次写日志都把写入交给队列并等它完成；等模型的时候不占队列。
 *
 * 边界（每次模型请求之前）按这个顺序：外部事实与设置 → 工具集比对 → steer 全部取走 → 估算与压缩 → 视图、模型拦截链、
 * `modelStarted`。这一版只有最后一步；其余随后续切片加进来，顺序不变。
 *
 * 收口：任何一步出错或被中止，都写 `turnEnded`、`runEnded`。写日志本身失败（句柄损坏）时什么都写不了，
 * 由 `RunControl` 在内存里把运行标为结束。
 */

import {createHash} from "node:crypto";
import type {EventData, JsonValue, KernelEvents, ModelInfo, ModelResponse, ToolDeclaration, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {LogBrokenError} from "../dispatch/core.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import type {ViewEnvironment} from "../extension/ctx.js";
import {computeRequest} from "../view/request.js";
import type {ModelPort} from "../api/index.js";

export interface RunHost {
    readonly core: SessionCore;
    readonly react: ReactHost;
    readonly models: ModelPort;
    environment(model: ModelInfo): ViewEnvironment;
    tools(): readonly ToolDeclaration[];
    /** 运行阶段变了（推状态帧用）。 */
    phase(phase: "reacting" | "requesting" | "streaming" | "tools", request: number | null): void;
}

export interface ActiveRun {
    readonly runId: string;
    readonly controller: AbortController;
}

const ctrl = (type: keyof KernelEvents, data: object): EventDraft => ({type, kind: "ctrl", scope: "path", data: data as JsonValue});

/** 取走一条输入开新的一轮：`inputConsumed`、`turnStarted`、`input` 同批（提案第 2 节“写入批”）。 */
export function takeInputDrafts(inputId: string, input: UserInput, turnId: string): EventDraft[] {
    const {text, payload, attachments} = input;
    return [
        {type: "inputConsumed", kind: "ctrl", scope: "session", data: {id: inputId}},
        ctrl("turnStarted", {turnId, inputId}),
        {type: "input", kind: "conv", scope: "path", data: {text, ...(payload === undefined ? {} : {payload: payload as JsonValue}), ...(attachments === undefined ? {} : {attachments: attachments as JsonValue}), queued: inputId} as JsonValue},
    ];
}

/** 这一轮里这个扩展已经写过几条 continued。 */
function continuedSoFar(core: SessionCore, extension: string): number {
    const turn = core.leafState.kernel.history.current;
    if (turn === null) return 0;
    return [...turn.attachments, ...turn.steps.flatMap((step) => step.after)].filter((event) => event.type === "continued" && (event.data as {by: string}).by === extension).length;
}

function requestHash(request: unknown): string {
    return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

/** 跑一次运行，直到写下 `runEnded`。只有写日志失败会以 `LogBrokenError` 拒绝。 */
export async function runLoop(host: RunHost, run: ActiveRun): Promise<void> {
    const {core} = host;
    const write = (drafts: EventDraft[]) => core.queue.run(() => writeAndReact(core, drafts, host.react, run.controller.signal));
    const end = async (turnReason: "completed" | "error" | "aborted", runData: Omit<EventData<KernelEvents["runEnded"]>, "runId">, before: EventDraft[] = []) => {
        const turn = core.leafState.kernel.history.current;
        await write([...before, ...(turn === null ? [] : [ctrl("turnEnded", {turnId: turn.id, reason: turnReason})]), ctrl("runEnded", {runId: run.runId, ...runData})]);
    };
    try {
        for (;;) {
            if (run.controller.signal.aborted) return await end("aborted", {reason: "aborted"});
            // 边界第 1 步：运行中到达的外部事实，按到达顺序写入。
            while (core.inbox.length > 0) await write(core.inbox.shift()!);
            host.phase("requesting", null);
            const resolution = host.models.resolve(core.session.kernel.core, "turn");
            if (!resolution.ok) return await end("error", {reason: "error", error: {kind: "local", code: resolution.code}});
            const computed = computeRequest({
                assembly: core.assembly,
                state: core.stateAt(),
                environment: host.environment(resolution.info),
                purpose: "turn",
                model: resolution.info.id,
                ...(core.session.kernel.core.effort === null ? {} : {effort: core.session.kernel.core.effort}),
                tools: host.tools(),
                cache: core.view,
                checks: core.dev,
            });
            for (const {error, ...problem} of computed.problems) core.diagnostics.add({...problem, ...(error === undefined ? {} : {cause: error})}, core.head);
            if (!computed.ok) {
                if (computed.reason === "request-invalid") return await end("error", {reason: "error", error: {kind: "local", code: "request-invalid"}});
                const profile = core.assembly.profile.id;
                return await end("error", {reason: "error", error: {kind: "local", code: "profile-failed"}}, [ctrl("extensionFailed", {extension: profile, entry: computed.entry, code: computed.code})]);
            }
            const request = core.requestCounter + 1;
            await write([ctrl("modelStarted", {request, purpose: "turn", model: computed.request.model, hash: requestHash(computed.request), now: core.clock.now(), invocation: core.newId(), modifiedBy: []})]);
            host.phase("streaming", request);
            let deltaNumber = 0;
            const response: ModelResponse = await resolution.call(computed.request, run.controller.signal, (delta) => {
                deltaNumber += 1;
                core.emit({type: "delta", request, n: deltaNumber, part: delta.part, text: delta.text, ...(delta.callId === undefined ? {} : {callId: delta.callId})});
            });
            if (response.stopReason === "error" || response.stopReason === "aborted") {
                const aborted = response.stopReason === "aborted" || run.controller.signal.aborted;
                const failure = ctrl("modelFailed", {
                    request,
                    kind: aborted ? "aborted" : (response.error?.kind ?? "provider"),
                    ...(response.error?.code === undefined ? {} : {code: response.error.code}),
                    ...(response.error?.status === undefined ? {} : {status: response.error.status}),
                    ...(response.error?.message === undefined ? {} : {message: response.error.message}),
                    ...(response.content.length === 0 ? {} : {partial: response.content}),
                    usage: response.usage,
                });
                if (aborted) return await end("aborted", {reason: "aborted"}, [failure]);
                return await end("error", {reason: "error", error: {kind: response.error?.kind ?? "provider", ...(response.error?.code === undefined ? {} : {code: response.error.code})}}, [failure]);
            }
            const replied = await write([{type: "assistant", kind: "conv", scope: "path", data: {
                request,
                content: response.content,
                toolCalls: response.toolCalls,
                stopReason: response.stopReason,
                usage: response.usage,
                model: response.model,
                ...(computed.request.effort === undefined ? {} : {effort: computed.request.effort}),
                ...(response.responseId === undefined ? {} : {responseId: response.responseId}),
            } as unknown as JsonValue}]);
            if (response.toolCalls.length > 0) {
                // 工具执行在后续切片；这一版没有声明任何工具，模型调用了就按未知工具回结果，让它接着答。
                host.phase("tools", request);
                await write(response.toolCalls.map((call) => ({type: "toolResult", kind: "conv", scope: "path", data: {callId: call.id, tool: call.tool, text: `unknown tool ${call.tool}`, status: "error", code: "unknown-tool"}})));
                continue;
            }
            // 回复已经写下；反应期间被中止的，这一轮以 aborted 收口（不再请求，也不提交成 completed）。
            if (run.controller.signal.aborted) return await end("aborted", {reason: "aborted"});
            if (replied.continues.length > 0) {
                // 扩展要求接着做（只在最终回复上）：每个请求写一条 continued，再请求一次。次数上限在 ctx.continue 里查过。
                await write(replied.continues.map(({extension, text}) => ({type: "continued", kind: "conv", scope: "path", data: {text, by: extension, count: continuedSoFar(core, extension) + 1}})));
                continue;
            }
            const turn = core.leafState.kernel.history.current;
            const turnEnded = turn === null ? [] : [ctrl("turnEnded", {turnId: turn.id, reason: "completed"})];
            const followup = core.session.kernel.buffer.find((item) => item.mode === "followup");
            if (followup === undefined) return await write([...turnEnded, ctrl("runEnded", {runId: run.runId, reason: "completed"})]).then(() => undefined);
            await write([...turnEnded, ...takeInputDrafts(followup.id, followup.input, core.newId())]);
        }
    } catch (error) {
        if (error instanceof LogBrokenError) throw error;
        // 内核自己的错：照样收口，原因写进诊断。
        core.diagnostics.add({code: "handler-threw", entry: "host", message: "the run loop threw unexpectedly; the run is ended with an error", cause: error}, core.head);
        await end("error", {reason: "error", error: {kind: "local", code: "internal"}});
    }
}
