/**
 * 恢复：打开会话时结算上一次进程没有收口的运行，作为一个写入批写入（session.md 输出 15、runtime.md 输出 34）。
 * 结算的是当前叶子上的运行：运行中不能回退或切分支，所以没收口的运行只可能在叶子的路径上。
 *
 * 顺序：等用户的同步事项结算为中断 → 没有结果的嵌套调用（同下，runtime.md 输出 101；排在父调用的结果前面）→
 * 最后一条回复里没有结果的工具调用（开始执行了的 `unknown`，还没开始的是等审批时中断，`denied`）→
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

/**
 * 最后一条回复之后开始了、或在等审批的嵌套调用，没有结果的逐个结算。只看这一步：嵌套调用活不过它的父调用，
 * 更早的步骤里父调用都已有结果，嵌套调用也已结算。
 */
function unsettledNested(core: SessionCore): EventDraft[] {
    const step = core.leafState.kernel.history.current?.steps.at(-1);
    if (step === undefined) return [];
    const path = core.pathTo();
    const after = path.slice(path.findIndex((event) => event.id === step.reply.id) + 1);
    type Nested = {readonly within: JsonValue; readonly tool: string; args: JsonValue; argsClipped?: true; started: boolean};
    // 按先后读：提了审批或开始了的登记进来，有了结果的去掉，剩下的就是没收口的。
    const open = new Map<string, Nested>();
    for (const event of after) {
        const data = event.data as Record<string, unknown>;
        if (event.type === "interactionRequested" && data.within !== undefined && data.kind === "approval" && !open.has(data.callId as string)) {
            const request = data.request as {tool?: string; args?: JsonValue};
            open.set(data.callId as string, {within: data.within as JsonValue, tool: request.tool ?? "", args: request.args ?? {}, started: false});
        } else if (event.type === "nestedToolStarted") {
            const known = open.get(data.id as string);
            // 开始事件里的参数是写日志用的那份（截过的带 argsClipped），补写的结果照抄它。
            const clipped = data.argsClipped === true ? {argsClipped: true as const} : {};
            if (known !== undefined) Object.assign(known, {started: true, args: data.args as JsonValue, ...clipped});
            else open.set(data.id as string, {within: data.within as JsonValue, tool: data.tool as string, args: data.args as JsonValue, ...clipped, started: true});
        } else if (event.type === "nestedToolResult") open.delete(data.id as string);
    }
    return [...open.entries()].map(([id, item]): EventDraft => ({
        type: "nestedToolResult",
        kind: "ctrl",
        scope: "path",
        data: (item.started
            ? {id, within: item.within, tool: item.tool, args: item.args, ...(item.argsClipped === true ? {argsClipped: true} : {}), status: "unknown", code: "interrupted", preview: "The process stopped while this call was running; it may or may not have finished.", size: 0}
            : {id, within: item.within, tool: item.tool, args: item.args, status: "denied", code: "interrupted-before-approval", by: "core", preview: "The process stopped before this call was approved; it was not run.", size: 0}) as JsonValue,
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
    const drafts: EventDraft[] = [...interrupted, ...unsettledNested(core), ...unansweredCalls(core)];
    // 发出没回复的模型请求（各种用途，含压缩方法与审批钩子发的）逐个结算。
    for (const request of state.openRequests) drafts.push({type: "modelFailed", kind: "ctrl", scope: "path", data: {request, kind: "interrupted"}});
    const turn = state.history.current;
    if (turn !== null) drafts.push({type: "turnEnded", kind: "ctrl", scope: "path", data: {turnId: turn.id, reason: "interrupted"}});
    drafts.push({type: "runEnded", kind: "ctrl", scope: "path", data: {runId: state.run.runId, reason: "interrupted"}});
    // 回到空闲：还就绪的话与收口同批转成留着，不自动发出（runtime.md 输出 34、104）。
    const ready = core.session.kernel.buffer.filter((item) => item.state === "ready").map((item) => item.id);
    if (ready.length > 0) drafts.push({type: "inputHeld", kind: "ctrl", scope: "session", data: {ids: ready, cause: {end: "interrupted"}}});
    return drafts;
}
