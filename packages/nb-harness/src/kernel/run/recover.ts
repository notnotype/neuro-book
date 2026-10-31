/**
 * 恢复：打开会话时结算上一次进程没有收口的运行，作为一个写入批写入（session.md 输出 15）。
 * 结算的是当前叶子上的运行：运行中不能回退或切分支，所以没收口的运行只可能在叶子的路径上。
 *
 * 这一版结算发出没回复的模型请求与轮、运行；没有结果的工具调用与等用户的事项随工具与等用户的切片加进来。
 */

import type {EventDraft, SessionCore} from "../dispatch/core.js";

export function recoveryDrafts(core: SessionCore): EventDraft[] {
    const state = core.leafState.kernel;
    if (state.run === null) return [];
    const drafts: EventDraft[] = [];
    if (state.openRequest !== null) drafts.push({type: "modelFailed", kind: "ctrl", scope: "path", data: {request: state.openRequest, kind: "interrupted"}});
    const turn = state.history.current;
    if (turn !== null) drafts.push({type: "turnEnded", kind: "ctrl", scope: "path", data: {turnId: turn.id, reason: "interrupted"}});
    drafts.push({type: "runEnded", kind: "ctrl", scope: "path", data: {runId: state.run.runId, reason: "interrupted"}});
    return drafts;
}
