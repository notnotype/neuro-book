/**
 * 恢复：打开会话时结算上一次进程没有收口的运行，作为一个写入批写入（session.md 输出 15、runtime.md 输出 34）。
 * 结算的是当前叶子上的运行：运行中不能回退或切分支，所以没收口的运行只可能在叶子的路径上。
 *
 * 顺序：最后一条回复里没有结果的工具调用（开始执行了的 `unknown`，还没开始的是等审批时中断，`denied`）→
 * 发出没回复的模型请求 `modelFailed{interrupted}` → `turnEnded`、`runEnded{interrupted}`。缓冲区里的输入留着。
 */

import type {JsonValue, ToolCall} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";

function unansweredCalls(core: SessionCore): EventDraft[] {
    const step = core.leafState.kernel.history.current?.steps.at(-1);
    if (step === undefined) return [];
    const answered = new Set(step.results.map((result) => result.data.callId));
    const pending = (step.reply.data.toolCalls as readonly ToolCall[]).filter((call) => !answered.has(call.id));
    if (pending.length === 0) return [];
    // 这一步里写过 toolStarted 的调用：从叶子往回找到这条回复为止。
    const started = new Set<string>();
    for (const event of core.pathTo().reverse()) {
        if (event.id === step.reply.id) break;
        if (event.type === "toolStarted") started.add((event.data as {callId: string}).callId);
    }
    return pending.map((call): EventDraft => ({
        type: "toolResult",
        kind: "conv",
        scope: "path",
        data: (started.has(call.id)
            ? {callId: call.id, tool: call.tool, text: "The process stopped while this call was running; it may or may not have finished.", status: "unknown", code: "interrupted"}
            : {callId: call.id, tool: call.tool, text: "The process stopped before this call was approved; it was not run.", status: "denied", code: "interrupted-before-approval", by: "core"}) as JsonValue,
    }));
}

export function recoveryDrafts(core: SessionCore): EventDraft[] {
    const state = core.leafState.kernel;
    // 叶子是回退或切分支定的：运行是暂停的，不是崩溃留下的，留给 `start` 接着跑（runtime.md 输出 35）。
    if (state.run === null || core.leafSetBy === "leafChanged") return [];
    // 让运行停下的同步事项结算为中断（审批的码表明调用还没执行）；异步提问不属于运行，留着（runtime.md 输出 43）。
    const interrupted = state.pending.filter((item) => !item.async).map((item): EventDraft => ({
        type: "interactionResolved",
        kind: "ctrl",
        scope: "path",
        data: {id: item.id, decision: "interrupted", by: {kind: "kernel"}, code: item.kind === "approval" ? "interrupted-before-approval" : "interrupted"} as JsonValue,
    }));
    const drafts: EventDraft[] = [...interrupted, ...unansweredCalls(core)];
    // 发出没回复的模型请求（各种用途，含压缩方法与审批钩子发的）逐个结算。
    for (const request of state.openRequests) drafts.push({type: "modelFailed", kind: "ctrl", scope: "path", data: {request, kind: "interrupted"}});
    const turn = state.history.current;
    if (turn !== null) drafts.push({type: "turnEnded", kind: "ctrl", scope: "path", data: {turnId: turn.id, reason: "interrupted"}});
    drafts.push({type: "runEnded", kind: "ctrl", scope: "path", data: {runId: state.run.runId, reason: "interrupted"}});
    return drafts;
}
