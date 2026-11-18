/**
 * 收口那一批（docs/specs/harness/runtime.md 输出 104）：一次运行回到空闲只在这里组批。缓冲区里还就绪的话与收口写在同一个
 * 写入批里转成留着；停止的范围、推迟到收口的放行与下一次运行也在这一批。
 *
 * 只在单写者队列的一项里调用：组批读到的缓冲区与写下之间不会插进别的指令，在这一项之前受理的话由这次运行处理，之后的按空闲。
 */

import type {BufferedInput, EventData, HeldCause, Issuer, JsonValue, KernelEvents, LogEvent, ReleaseMode, RunEndReason, UserInput} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {reduceSessionKernel, type SessionKernelState} from "../state/kernel-state.js";
import {byField} from "./input.js";
import {canRemove, releasable} from "./permissions.js";
import {ctrl} from "./writes.js";

/** 一次停止的受理（输出 30）：同步记下，收口批按它处理。 */
export interface StopRecord {
    readonly runId: string;
    readonly by: Issuer;
    readonly keep: boolean;
    /** 受理那一刻缓冲区里的条目（就绪与留着）。 */
    readonly scope: readonly string[];
    /** 收口前受理的每个 `abort`：都在收口批里写自己的受理记录，交回同样的 `{aborted: true}`。 */
    readonly commands: {readonly commandId: string; readonly argsHash: string}[];
}

/** 运行不再取输入时受理的、要开运行的指令（输出 104）：收口时按受理先后放行并开下一次运行。 */
export interface Deferred {
    readonly issuer: Issuer;
    readonly mode: ReleaseMode;
    /** 这条指令送进来的话（`resume` 没有）。 */
    readonly inputIds: readonly string[];
    /** `release` 按条放行：只放行这几条。 */
    readonly only?: readonly string[];
}

export interface SettleInput {
    readonly runId: string;
    readonly reason: RunEndReason;
    /** `runEnded` 的其余字段（结果、错误）。 */
    readonly data: Omit<EventData<KernelEvents["runEnded"]>, "runId" | "reason" | "stoppedBy">;
    /** 收口前要写的：没结果的模型请求、`turnEnded`、工具结果等。 */
    readonly before: readonly EventDraft[];
    readonly stop: StopRecord | null;
    /** 不带原因关闭会话时的码（`session-closed`），写进留着的原因。 */
    readonly closingCode: string | null;
    readonly deferred: readonly Deferred[];
    /** 推迟的指令为什么不能开运行（待做的重新装配、正在关闭、开不起运行）；能开时为 null。 */
    readonly skip: string | null;
}

export interface SettleBatch {
    readonly drafts: EventDraft[];
    /** 收口批里开了下一次运行：写下之后接着跑它。 */
    readonly next: string | null;
}

/** 把草稿里的 session 事件叠到当前状态上，算出写下之后的缓冲区（放行、开运行要看留着之后的样子）。 */
export function projectSession(state: SessionKernelState, drafts: readonly EventDraft[], fromSeq: number): SessionKernelState {
    let projected = state;
    let seq = fromSeq;
    for (const draft of drafts) {
        if (draft.scope !== "session") continue;
        seq += 1;
        projected = reduceSessionKernel(projected, {id: "", seq, at: 0, parent: null, scope: "session", kind: draft.kind, type: draft.type, version: 1, source: "kernel", data: draft.data} as unknown as LogEvent);
    }
    return projected;
}

/** 缓冲区里就绪的话（运行只取它们，输出 103）。 */
export const readyEntries = (buffer: readonly BufferedInput[]): BufferedInput[] => buffer.filter((item) => item.state === "ready");

/**
 * 取走一条开新的一轮：`inputConsumed`（带取走它的运行）、`turnStarted`、`input` 同批；`input` 带条目的发出者与受理它的指令。
 */
export function takeInputDrafts(entry: {readonly id: string; readonly input: UserInput; readonly by?: Issuer; readonly commandId?: string}, turnId: string, runId: string): EventDraft[] {
    const {text, payload, attachments} = entry.input;
    return [
        {type: "inputConsumed", kind: "ctrl", scope: "session", data: {id: entry.id, runId}},
        ctrl("turnStarted", {turnId, inputId: entry.id}),
        {type: "input", kind: "conv", scope: "path", data: {text, ...(payload === undefined ? {} : {payload: payload as JsonValue}), ...(attachments === undefined ? {} : {attachments: attachments as unknown as JsonValue}), queued: entry.id, ...byField(entry.by), ...(entry.commandId === undefined ? {} : {commandId: entry.commandId})} as JsonValue},
    ];
}

/** 放行：按发出者能放行的写 `inputReleased`；没有能放行的不写。交回放行的 id。 */
export function releaseDrafts(buffer: readonly BufferedInput[], issuer: Issuer, mode: ReleaseMode, only?: readonly string[]): {drafts: EventDraft[]; ids: string[]} {
    const ids = releasable(buffer, issuer).map((item) => item.id).filter((id) => only === undefined || only.includes(id));
    if (ids.length === 0) return {drafts: [], ids};
    return {drafts: [{type: "inputReleased", kind: "ctrl", scope: "session", data: {ids, ...byField(issuer), mode}}], ids};
}

/** 开一次新运行：`runStarted{by}` 与取走投影后缓冲区里就绪的第一条；没有就绪的话时不开。 */
export function openRunDrafts(core: SessionCore, buffer: readonly BufferedInput[], by: Issuer): {drafts: EventDraft[]; runId: string} | null {
    const first = readyEntries(buffer)[0];
    if (first === undefined) return null;
    const runId = core.newId();
    return {runId, drafts: [ctrl("runStarted", {runId, kind: "chat", ...byField(by)}), ...takeInputDrafts(first, core.newId(), runId)]};
}

const held = (ids: readonly string[], cause: HeldCause, heldBy?: Issuer): EventDraft[] =>
    ids.length === 0 ? [] : [{type: "inputHeld", kind: "ctrl", scope: "session", data: {ids: [...ids], cause, ...(heldBy === undefined ? {} : {heldBy: heldBy as unknown as JsonValue})} as JsonValue}];

/** 组收口批。 */
export function settleBatch(core: SessionCore, input: SettleInput): SettleBatch {
    const buffer = core.session.kernel.buffer;
    const {stop, reason} = input;
    const drafts: EventDraft[] = [...input.before];
    drafts.push(ctrl("runEnded", {runId: input.runId, reason, ...input.data, ...(stop !== null && reason === "aborted" ? {stoppedBy: stop.by} : {})}));

    const arrived = new Set(input.deferred.flatMap((item) => item.inputIds));
    const handled = new Set<string>();
    const cause: HeldCause = input.closingCode === null ? {end: reason} : {end: reason, code: input.closingCode};
    if (stop !== null) {
        const inScope = new Set(stop.scope);
        const items = buffer.filter((item) => inScope.has(item.id) && !arrived.has(item.id));
        const removed = stop.keep ? [] : items.filter((item) => canRemove(item, stop.by));
        for (const item of removed) {
            drafts.push({type: "inputRemoved", kind: "ctrl", scope: "session", data: {id: item.id, reason: "aborted", ...byField(stop.by)} as JsonValue});
            handled.add(item.id);
        }
        const kept = items.filter((item) => item.state === "ready" && !handled.has(item.id)).map((item) => item.id);
        drafts.push(...held(kept, {end: "aborted"}, stop.by));
        for (const id of kept) handled.add(id);
    }
    const rest = buffer.filter((item) => item.state === "ready" && !handled.has(item.id) && (input.skip === null || !arrived.has(item.id))).map((item) => item.id);
    drafts.push(...held(rest, cause));
    for (const command of stop?.commands ?? []) {
        drafts.push({type: "commandAccepted", kind: "ctrl", scope: "session", data: {commandId: command.commandId, name: "abort", value: {aborted: true}, argsHash: command.argsHash}});
    }

    if (input.deferred.length === 0) return {drafts, next: null};
    if (input.skip !== null) {
        const late = buffer.filter((item) => item.state === "ready" && arrived.has(item.id)).map((item) => item.id);
        drafts.push(...held(late, {end: reason, code: input.skip}));
        core.diagnostics.add({code: "deferred-start-skipped", entry: "host", subject: input.skip, params: {code: input.skip}, message: `inputs that arrived while the run was no longer taking input stay held (${input.skip})`}, core.head);
        return {drafts, next: null};
    }
    // 放行要看留着之后的缓冲区：把这一批叠上去再算。
    let projected = projectSession(core.session.kernel, drafts, core.head);
    for (const item of input.deferred) {
        const released = releaseDrafts(projected.buffer, item.issuer, item.mode, item.only);
        drafts.push(...released.drafts);
        projected = projectSession(projected, released.drafts, core.head + drafts.length);
    }
    // 下一次运行记谁开的：有用户就是用户，否则最先受理的那条（输出 104）。
    const by = input.deferred.find((item) => item.issuer.kind === "user")?.issuer ?? input.deferred[0]!.issuer;
    const opened = openRunDrafts(core, projected.buffer, by);
    if (opened === null) return {drafts, next: null};
    drafts.push(...opened.drafts);
    return {drafts, next: opened.runId};
}
