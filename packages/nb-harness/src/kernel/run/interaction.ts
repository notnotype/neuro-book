/**
 * 等用户（docs/specs/harness/runtime.md 输出 39–45）：审批与提问是同一条通道。事项写成 `interactionRequested`，
 * 待处理的从 path 状态读（`kernel-state.ts` 的 `pending`），应答经指令 `resolve` 写 `interactionResolved`。
 *
 * 同步的事项（审批、同步提问）让这次调用停下等：等待登记在内存里（`Interactions`），`resolve` 写下之后叫醒它。
 * 中止时等待中的事项由发起它的这一方写 `aborted`；进程重启时由恢复写 `interrupted`（`recover.ts`）。
 * 异步提问只写事项、不等：它跨运行存在，回答作为一条输入进缓冲区。
 */

import type {Actor, CommandMap, CommandResult, InteractionDecision, InteractionSummary, Issuer, JsonValue} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import type {PendingInteraction} from "../state/kernel-state.js";
import {accept, isEmpty, startProblem, type CommandHost} from "./commands.js";
import {interceptInput, queuedData} from "./input.js";
import {takeInputDrafts} from "./loop.js";
import {ctrl, interrupting, RunStoppedError} from "./writes.js";

export interface Resolution {
    readonly decision: InteractionDecision;
    readonly by: Actor;
    readonly code?: string;
    readonly data?: JsonValue;
    readonly note?: string;
}

/** 一次运行里正在等的同步事项。属于 `RunControl`：运行状态的 `waiting` 由它报出。 */
export class Interactions {
    readonly #waiters = new Map<string, (resolution: Resolution) => void>();

    /** `report` 在待处理的同步事项变化时调用（null 表示没有了，回到运行）。 */
    constructor(private readonly report: (pending: readonly InteractionSummary[] | null) => void) {}

    /**
     * `resolve` 在它的队列项里认领等待者：从表里摘下并交回叫醒它的函数；没人等了（运行中途被中止）交回 undefined。
     * 认领之后中止就不再写 `aborted`，等 `resolve` 叫醒：同一事项只会有一条结算。
     */
    claim(id: string): ((resolution: Resolution) => void) | undefined {
        const wake = this.#waiters.get(id);
        this.#waiters.delete(id);
        return wake;
    }

    #reportFrom(core: SessionCore): void {
        const pending = core.leafState.kernel.pending.filter((item) => !item.async);
        this.report(pending.length === 0 ? null : pending.map(({id, callId, kind, request}) => ({id, callId, kind, request})));
    }

    /**
     * 提出一个事项。异步的写下就返回 null；同步的等应答，或等运行中止（这时写 `aborted` 并以它返回）。
     * `write` 是运行的写入口：运行收口之后它拒绝写（`RunStoppedError`）。
     */
    async request(core: SessionCore, write: (drafts: EventDraft[]) => Promise<unknown>, item: Omit<PendingInteraction, "id">, signal: AbortSignal): Promise<Resolution | null> {
        const id = core.newId();
        if (!item.async && signal.aborted) throw new RunStoppedError(`asking the user about ${item.callId}`);
        const answered = item.async ? null : new Promise<Resolution>((resolve) => this.#waiters.set(id, resolve));
        try {
            await write([ctrl("interactionRequested", {id, ...item})]);
        } catch (error) {
            this.#waiters.delete(id);
            throw error;
        }
        if (answered === null) return null;
        this.#reportFrom(core);
        let onAbort: () => void = () => undefined;
        const aborted = new Promise<"aborted">((resolve) => {
            // 中止触发时同步摘掉等待：之后才排进队列的 resolve 就知道没人等了，不会与这里的 aborted 各写一条结算。
            onAbort = () => {
                if (this.#waiters.delete(id)) resolve("aborted");
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, {once: true});
        });
        const result = await Promise.race([answered, aborted]);
        signal.removeEventListener("abort", onAbort);
        if (result !== "aborted") {
            this.#reportFrom(core);
            return result;
        }
        // 进程收尾的中止按 interrupted 结算，与重开时的恢复一致（runtime.md 输出 43）。
        const resolution: Resolution = interrupting(signal)
            ? {decision: "interrupted", by: {kind: "kernel"}, code: item.kind === "approval" ? "interrupted-before-approval" : "interrupted"}
            : {decision: "aborted", by: {kind: "kernel"}, code: "aborted"};
        try {
            await write([ctrl("interactionResolved", {id, ...resolution})]);
        } catch (error) {
            if (!(error instanceof RunStoppedError)) throw error;
        }
        return resolution;
    }

}

const actorLabel = (actor: Actor): string => (actor.kind === "session" ? `session:${actor.id}` : actor.kind);

/** 谁能应答：审批只收用户；提问用户都能答，会话头 `questions: "caller"` 时也收派这个会话的父会话。 */
function allowed(core: SessionCore, item: PendingInteraction, issuer: Issuer): boolean {
    if (issuer.kind === "user") return true;
    return item.kind === "question" && core.header.questions === "caller" && core.header.caller?.kind === "session" && core.header.caller.id === issuer.id;
}

export async function resolveCommand(host: CommandHost & {interactions: Interactions}, issuer: Issuer, args: CommandMap["resolve"]["args"] & {commandId: string}): Promise<CommandResult<"resolve">> {
    let claimed: ((resolution: Resolution) => void) | undefined;
    const result = await accept(host, "resolve", args.commandId, async () => {
        const {core, control} = host;
        const item = core.leafState.kernel.pending.find((pending) => pending.id === args.id);
        if (item === undefined) {
            const resolved = core.pathTo().find((event) => event.type === "interactionResolved" && (event.data as {id: string}).id === args.id);
            if (resolved === undefined) return {fail: "unknown-interaction"};
            const data = resolved.data as {by: Actor; decision: InteractionDecision};
            return {fail: "already-answered", detail: {by: actorLabel(data.by), decision: data.decision}};
        }
        if (!allowed(core, item, issuer)) return {fail: "not-allowed"};
        const decisions = item.kind === "approval" ? ["allow", "allow-session", "deny"] : ["answer", "deny"];
        if (!decisions.includes(args.decision)) return {fail: "invalid-answer"};
        if (args.decision === "answer" && (args.answer === undefined || isEmpty({text: args.answer.text}))) return {fail: "invalid-answer"};

        const resolution: Resolution = {
            decision: args.decision,
            by: issuer,
            ...(args.answer === undefined ? {} : {data: {text: args.answer.text, ...(args.answer.data === undefined ? {} : {data: args.answer.data})} as JsonValue}),
            ...(args.note === undefined ? {} : {note: args.note}),
        };
        const drafts: EventDraft[] = [ctrl("interactionResolved", {id: item.id, ...resolution})];
        if (args.decision === "allow-session") {
            drafts.push({type: "approvalRemembered", kind: "ctrl", scope: "session", data: {tool: (item.request as {tool: string}).tool, scope: "tool", by: issuer as unknown as JsonValue}});
        }
        let launch: string | undefined;
        if (item.async && args.decision === "answer") {
            // 异步提问的回答作为一条输入：过输入链；运行中当插话，空闲时开新一轮（或让暂停的运行接着跑）。
            const intercepted = await interceptInput(host, {text: args.answer!.text});
            if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
            const inputId = core.newId();
            const running = !control.idle;
            drafts.push(...intercepted.failed, {type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, running ? "steer" : "followup")});
            if (!running) {
                const problem = startProblem(host);
                if (problem === null) {
                    const paused = control.paused;
                    if (paused !== null) launch = paused;
                    else {
                        launch = core.newId();
                        drafts.push({type: "runStarted", kind: "ctrl", scope: "path", data: {runId: launch, kind: "chat"}}, ...takeInputDrafts(inputId, intercepted.input, core.newId()));
                    }
                }
            }
        }
        // 同步事项：认领等它的调用（最后一步再认领，前面任何一处失败都不占着它）。没人等了：运行在等它的时候被中止，
        // 结算已经交给中止那一方。
        if (!item.async) {
            claimed = host.interactions.claim(item.id);
            if (claimed === undefined) return {fail: "already-answered", detail: {by: "kernel", decision: "aborted"}};
        }
        const wake = claimed;
        return {value: {}, drafts, ...(launch === undefined ? {} : {launch}), written: async () => {
            claimed = undefined;
            wake?.(resolution);
        }};
    });
    // 认领了却没写下（写日志失败）：以 aborted 叫醒等它的调用，不让它一直挂着。
    claimed?.({decision: "aborted", by: {kind: "kernel"}, code: "aborted"});
    return result;
}
