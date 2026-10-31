/**
 * 运行循环（提案第 1 节的运行图）。循环在队列之外：每次写日志都把写入交给队列并等它完成；等模型、等工具的时候不占队列。
 *
 * 边界（每次模型请求之前）按这个顺序：外部事实 → 工具集比对（必需工具、`toolsAnnounced`）→ steer 全部取走 →
 * 交结果的提醒 → 视图、模型拦截链、`modelStarted`。估算与压缩随第 8 片插在 steer 之后，顺序不变。
 *
 * 收口：任何一步出错或被中止，都写 `turnEnded`、`runEnded`。决定收口之后，还在跑的模型链与工具链再写日志都得
 * `RunStoppedError`（`writes.ts`）；收口前先等队列里已经交出去的写入写完，再看有没有发出了没结果的模型请求。
 * 写日志本身失败（句柄损坏）时什么都写不了，由 `RunControl` 在内存里把运行标为结束。
 */

import {replyText} from "../api/index.js";
import type {ApproveHook, EventData, JsonValue, KernelEvents, ModelInfo, ModelPort, ReplyEvent, Resources, ToolInfo, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {LogBrokenError} from "../dispatch/core.js";
import {writeAndReact, type ReactHost} from "../dispatch/reactions.js";
import type {ViewEnvironment} from "../extension/ctx.js";
import {computeRequest} from "../view/request.js";
import {failureDrafts} from "./chain.js";
import {callModel, modelCaller, type ModelCallHost} from "./model-call.js";
import type {Interactions} from "./interaction.js";
import {runTools, toolInfo, type ToolBox} from "./tools.js";
import {ctrl, RunStoppedError} from "./writes.js";

export interface RunHost {
    readonly core: SessionCore;
    readonly react: ReactHost;
    readonly models: ModelPort;
    readonly box: ToolBox;
    readonly resources: Resources;
    readonly approve: ApproveHook;
    readonly interactions: Interactions;
    environment(model: ModelInfo, tools: readonly ToolInfo[]): ViewEnvironment;
    /** 必需工具缺失：会话进只读直到重开（runtime.md 输出 15）。 */
    markReadOnly(code: "tools-missing"): void;
    /** 运行阶段变了（推状态帧用）。 */
    phase(phase: "reacting" | "requesting" | "streaming" | "tools", request: number | null): void;
}

export interface ActiveRun {
    readonly runId: string;
    readonly controller: AbortController;
}

/** 取走一条输入开新的一轮：`inputConsumed`、`turnStarted`、`input` 同批（提案第 2 节“写入批”）。 */
export function takeInputDrafts(inputId: string, input: UserInput, turnId: string): EventDraft[] {
    const {text, payload, attachments} = input;
    return [
        {type: "inputConsumed", kind: "ctrl", scope: "session", data: {id: inputId}},
        ctrl("turnStarted", {turnId, inputId}),
        {type: "input", kind: "conv", scope: "path", data: {text, ...(payload === undefined ? {} : {payload: payload as JsonValue}), ...(attachments === undefined ? {} : {attachments: attachments as JsonValue}), queued: inputId} as JsonValue},
    ];
}

/** 取走缓冲区里全部 steer：按入队顺序，每条 `inputConsumed` 加一条 `steer`，同一个写入批（runtime.md 输出 28）。 */
function takeSteerDrafts(core: SessionCore): EventDraft[] {
    return core.session.kernel.buffer.filter((item) => item.mode === "steer").flatMap((item): EventDraft[] => {
        const {text, payload, attachments} = item.input;
        return [
            {type: "inputConsumed", kind: "ctrl", scope: "session", data: {id: item.id}},
            {type: "steer", kind: "conv", scope: "path", data: {text, ...(payload === undefined ? {} : {payload: payload as JsonValue}), ...(attachments === undefined ? {} : {attachments: attachments as JsonValue}), queued: item.id} as JsonValue},
        ];
    });
}

/** 这一轮里这个扩展已经写过几条 continued。 */
function continuedSoFar(core: SessionCore, extension: string): number {
    const turn = core.leafState.kernel.history.current;
    if (turn === null) return 0;
    return [...turn.attachments, ...turn.steps.flatMap((step) => step.after)].filter((event) => event.type === "continued" && (event.data as {by: string}).by === extension).length;
}

const conv = (type: keyof KernelEvents, data: object): EventDraft => ({type, kind: "conv", scope: "path", data: data as JsonValue});

/** 工具集变了给模型的提醒文字：新增、去掉、改了版本的。 */
function toolsChangedText(before: readonly {id: string; version: string}[], after: readonly {id: string; version: string}[]): string {
    const was = new Map(before.map((tool) => [tool.id, tool.version]));
    const now = new Map(after.map((tool) => [tool.id, tool.version]));
    const added = after.filter((tool) => !was.has(tool.id)).map((tool) => tool.id);
    const removed = before.filter((tool) => !now.has(tool.id)).map((tool) => tool.id);
    const changed = after.filter((tool) => was.has(tool.id) && was.get(tool.id) !== tool.version).map((tool) => tool.id);
    const parts = [
        added.length === 0 ? null : `added: ${added.join(", ")}`,
        removed.length === 0 ? null : `removed: ${removed.join(", ")}`,
        changed.length === 0 ? null : `updated: ${changed.join(", ")}`,
    ].filter((part) => part !== null);
    return `<system-reminder>\nThe available tools have changed (${parts.join("; ")}).\n</system-reminder>`;
}

const RESULT_REQUESTED = "<system-reminder>\nWhen the work is done, call the yield tool alone to hand back the result.\n</system-reminder>";
const RESULT_NUDGE = "You stopped without calling yield. Call yield now to hand back the result.";

/** 跑一次运行，直到写下 `runEnded`。只有写日志失败会以 `LogBrokenError` 拒绝。 */
export async function runLoop(host: RunHost, run: ActiveRun): Promise<void> {
    const {core} = host;
    const signal = run.controller.signal;
    let stopped = false;
    const write = (drafts: EventDraft[]) => core.queue.run(() => writeAndReact(core, drafts, host.react, signal));
    /** 给模型链、工具链用：收口之后再写就拒绝。 */
    const guardedWrite = (drafts: EventDraft[]) => (stopped ? Promise.reject(new RunStoppedError(`writing ${drafts.map((draft) => draft.type).join(", ")}`)) : write(drafts));
    const end = async (turnReason: "completed" | "error" | "aborted", runData: Omit<EventData<KernelEvents["runEnded"]>, "runId">, before: EventDraft[] = []) => {
        stopped = true;
        await core.queue.drain();
        const open = core.leafState.kernel.openRequest;
        const settleOpen = open !== null && turnReason === "aborted" && !before.some((draft) => draft.type === "modelFailed") ? [ctrl("modelFailed", {request: open, kind: "aborted"})] : [];
        const turn = core.leafState.kernel.history.current;
        await write([...settleOpen, ...before, ...(turn === null ? [] : [ctrl("turnEnded", {turnId: turn.id, reason: turnReason})]), ctrl("runEnded", {runId: run.runId, ...runData})]);
    };
    const abortedNow = new Promise<"aborted">((resolve) => {
        if (signal.aborted) resolve("aborted");
        else signal.addEventListener("abort", () => resolve("aborted"), {once: true});
    });
    let nudged = false;
    try {
        // 接着跑一个停在两轮之间的运行（回退到某一轮之前再发）：先取缓冲区里的第一条开一轮，没有就收口。
        if (core.leafState.kernel.history.current === null) {
            const next = core.session.kernel.buffer[0];
            if (next === undefined) return await end("completed", {reason: "completed"});
            await write(takeInputDrafts(next.id, next.input, core.newId()));
        }
        for (;;) {
            if (signal.aborted) return await end("aborted", {reason: "aborted"});
            // 边界第 1 步：运行中到达的外部事实，按到达顺序写入。
            while (core.inbox.length > 0) await write(core.inbox.shift()!);

            // 边界第 2 步：工具集。必需工具缺失时收口；与路径上告诉过模型的不同就重新告诉它。
            const tools = host.box.current();
            await host.box.retire(tools);
            const required = (core.assembly.profile as {tools?: {required?: readonly string[]}}).tools?.required ?? [];
            const missing = required.filter((id) => !tools.some((tool) => tool.id === id));
            if (missing.length > 0) {
                host.markReadOnly("tools-missing");
                core.diagnostics.add({code: "tool-declaration-invalid", entry: "host", subject: "required", params: {missing: missing.join(", ")}, message: `required tools are missing: ${missing.join(", ")}; the session is read-only until it is reopened`}, core.head);
                return await end("error", {reason: "error", error: {kind: "local", code: "tools-missing"}});
            }
            const announced = tools.map((tool) => ({id: tool.id, version: tool.version})).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            const last = core.leafState.kernel.announced;
            if (last === null) await write([ctrl("toolsAnnounced", {tools: announced})]);
            else if (JSON.stringify(last) !== JSON.stringify(announced)) await write([ctrl("toolsAnnounced", {tools: announced}), conv("notice", {code: "tools-changed", text: toolsChangedText(last, announced)})]);

            // 边界第 3 步：运行中到达的 steer 全部取走，进当前这一轮。
            const steers = takeSteerDrafts(core);
            if (steers.length > 0) await write(steers);

            // 边界第 4 步：会话要求交回结果时，第一轮开头告诉模型调用 yield。
            if (core.header.result !== undefined && !core.leafState.kernel.resultRequested) await write([conv("notice", {code: "result-requested", text: RESULT_REQUESTED})]);

            host.phase("requesting", null);
            const resolution = host.models.resolve(core.session.kernel.core, "turn");
            if (!resolution.ok) return await end("error", {reason: "error", error: {kind: "local", code: resolution.code}});
            const environment = host.environment(resolution.info, tools.map(toolInfo));
            const computed = computeRequest({
                assembly: core.assembly,
                state: core.stateAt(),
                environment,
                purpose: "turn",
                model: resolution.info.id,
                ...(core.session.kernel.core.effort === null ? {} : {effort: core.session.kernel.core.effort}),
                tools,
                cache: core.view,
                checks: core.dev,
            });
            for (const {error, ...problem} of computed.problems) core.diagnostics.add({...problem, ...(error === undefined ? {} : {cause: error})}, core.head);
            if (!computed.ok) {
                if (computed.reason === "request-invalid") return await end("error", {reason: "error", error: {kind: "local", code: "request-invalid"}});
                const profile = core.assembly.profile.id;
                return await end("error", {reason: "error", error: {kind: "local", code: "profile-failed"}}, [ctrl("extensionFailed", {extension: profile, entry: computed.entry, code: computed.code})]);
            }

            const modelHost: ModelCallHost & {resolve: Parameters<typeof modelCaller>[0]["resolve"]} = {
                core,
                resources: host.resources,
                environment: () => environment,
                write: guardedWrite,
                streaming: (request) => host.phase("streaming", request),
                resolve: (purpose) => host.models.resolve(core.session.kernel.core, purpose),
            };
            const called = await Promise.race([callModel(modelHost, resolution, computed.request, signal), abortedNow]);
            if (called === "aborted") return await end("aborted", {reason: "aborted"});
            const {response, request} = called;
            const modelFailures = failureDrafts(core, "intercept.model", called.failures);
            if (response.stopReason === "error" || response.stopReason === "aborted") {
                const aborted = response.stopReason === "aborted" || signal.aborted;
                const failure = ctrl("modelFailed", {
                    request,
                    kind: aborted ? "aborted" : (response.error?.kind ?? "provider"),
                    ...(response.error?.code === undefined ? {} : {code: response.error.code}),
                    ...(response.error?.status === undefined ? {} : {status: response.error.status}),
                    ...(response.error?.message === undefined ? {} : {message: response.error.message}),
                    ...(response.content.length === 0 ? {} : {partial: response.content}),
                    usage: response.usage,
                });
                if (aborted) return await end("aborted", {reason: "aborted"}, [...modelFailures, failure]);
                return await end("error", {reason: "error", error: {kind: response.error?.kind ?? "provider", ...(response.error?.code === undefined ? {} : {code: response.error.code})}}, [...modelFailures, failure]);
            }
            const replied = await write([...modelFailures, {type: "assistant", kind: "conv", scope: "path", data: {
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
                host.phase("tools", request);
                const reply = replied.events.find((event) => event.type === "assistant") as ReplyEvent;
                const outcome = await runTools({
                    core,
                    box: host.box,
                    resources: host.resources,
                    approve: host.approve,
                    interactions: host.interactions,
                    model: modelCaller(modelHost, signal),
                    environment: () => environment,
                    write: guardedWrite,
                }, reply, tools, signal);
                if (outcome.finished !== null) {
                    // 收尾：结果、turnEnded、runEnded 同一个写入批，写下即结束（runtime.md 输出 26）。
                    stopped = true;
                    const turn = core.leafState.kernel.history.current;
                    await write([...outcome.drafts, ...(turn === null ? [] : [ctrl("turnEnded", {turnId: turn.id, reason: "completed"})]), ctrl("runEnded", {runId: run.runId, reason: "finished", result: {via: "tool", tool: outcome.finished.tool, value: outcome.finished.value, valid: true}})]);
                    return;
                }
                if (signal.aborted) return await end("aborted", {reason: "aborted"}, outcome.drafts);
                await write(outcome.drafts);
                continue;
            }
            // 回复已经写下；反应期间被中止的，这一轮以 aborted 收口（不再请求，也不提交成 completed）。
            if (signal.aborted) return await end("aborted", {reason: "aborted"});
            if (replied.continues.length > 0) {
                // 扩展要求接着做（只在最终回复上）：每个请求写一条 continued，再请求一次。次数上限在 ctx.continue 里查过。
                // 同时有没取走的 steer 也先写 continued：下一个边界再取 steer，两者都进下一次请求。
                await write(replied.continues.map(({extension, text}) => conv("continued", {text, by: extension, count: continuedSoFar(core, extension) + 1})));
                continue;
            }
            // 最终回复时还有没取走的 steer：这一轮接着请求，下一个边界取走它们。
            if (core.session.kernel.buffer.some((item) => item.mode === "steer")) continue;
            const result = core.header.result;
            if (result !== undefined) {
                // 会话要交回结果而模型没调用 yield（runtime.md 输出 27）：必需的先催一次。
                if (result.mode === "required" && !nudged) {
                    nudged = true;
                    await write([conv("continued", {text: RESULT_NUDGE, by: "core", count: continuedSoFar(core, "core") + 1})]);
                    continue;
                }
                const fallback = {via: "text" as const, value: replyText(response.content), valid: false};
                if (result.mode === "required") return await end("completed", {reason: "error", error: {kind: "local", code: "result-missing"}, result: fallback});
                return await end("completed", {reason: "completed", result: fallback});
            }
            const turn = core.leafState.kernel.history.current;
            const turnEnded = turn === null ? [] : [ctrl("turnEnded", {turnId: turn.id, reason: "completed"})];
            const followup = core.session.kernel.buffer.find((item) => item.mode === "followup");
            if (followup === undefined) return await write([...turnEnded, ctrl("runEnded", {runId: run.runId, reason: "completed"})]).then(() => undefined);
            await write([...turnEnded, ...takeInputDrafts(followup.id, followup.input, core.newId())]);
        }
    } catch (error) {
        if (error instanceof LogBrokenError) throw error;
        // 内核自己的错：记诊断，按 internal 收口（写日志还能写的话）。
        core.diagnostics.add({code: "handler-threw", entry: "host", subject: "run-loop", message: "the run loop failed", cause: error}, core.head);
        stopped = true;
        await end("error", {reason: "error", error: {kind: "local", code: "internal"}});
    }
}
