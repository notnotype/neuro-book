/**
 * 等用户（docs/specs/harness/runtime.md 输出 39–45）：审批与提问是同一条通道。事项写成 `interactionRequested`，
 * 待处理的从 path 状态读（`kernel-state.ts` 的 `pending`），应答经指令 `resolve` 写 `interactionResolved`。
 *
 * 同步的事项（审批、同步提问）让这次调用停下等：等待登记在内存里（`Interactions`），`resolve` 写下之后叫醒它。
 * 中止时等待中的事项由发起它的这一方写 `aborted`；进程重启时由恢复写 `interrupted`（`recover.ts`）。
 * 异步提问只写事项、不等：它跨运行存在，回答作为一条输入进缓冲区。
 */

import type {Actor, CommandMap, CommandResult, HeldCause, InteractionDecision, InteractionSummary, Issuer, JsonValue} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import type {PendingInteraction} from "../state/kernel-state.js";
import {accept, isEmpty, startProblem, type CommandHost} from "./commands.js";
import {byField, interceptInput, queuedData} from "./input.js";
import {canContinue} from "./permissions.js";
import {openRunDrafts, projectSession, releaseDrafts} from "./settle.js";
import {ctrl, interrupting, RunStoppedError} from "./writes.js";

export interface Resolution {
    readonly decision: InteractionDecision;
    readonly by: Actor;
    readonly code?: string;
    readonly data?: JsonValue;
    readonly note?: string;
}

/** 认领到的一个同步事项：`wake` 以应答叫醒等它的调用；`giveBack` 在应答没写下时把这次等待交还（只调一次）。 */
export interface Claim {
    wake(resolution: Resolution): void;
    giveBack(): void;
}

interface Waiter {
    readonly signal: AbortSignal;
    answer(resolution: Resolution): void;
    /** 走中止的那一支：由发起它的调用写 `aborted` 或 `interrupted`。 */
    abort(): void;
}

/** 一次运行里正在等的同步事项。属于 `RunControl`：运行状态的 `waiting` 由它报出。 */
export class Interactions {
    readonly #waiters = new Map<string, Waiter>();

    /** `report` 在待处理的同步事项变化时调用（null 表示没有了，回到运行）。 */
    constructor(private readonly report: (pending: readonly InteractionSummary[] | null) => void) {}

    /**
     * 应答（`resolve`、`send` 的 `settlePending`）在它的队列项里认领等待者：从表里摘下；没人等了（运行中途被中止）交回
     * undefined。认领之后中止就不再写 `aborted`，等认领方叫醒或交还：同一事项只会有一条结算。
     */
    take(id: string): Claim | undefined {
        const waiter = this.#waiters.get(id);
        if (waiter === undefined) return undefined;
        this.#waiters.delete(id);
        let done = false;
        return {
            wake: (resolution) => {
                if (done) return;
                done = true;
                waiter.answer(resolution);
            },
            // 应答没写下：认领期间运行可能已被中止（中止那一方摘不到它，没写结算），这时直接走中止那一支；否则放回去接着等。
            giveBack: () => {
                if (done) return;
                done = true;
                if (waiter.signal.aborted) waiter.abort();
                else this.#waiters.set(id, waiter);
            },
        };
    }

    #reportFrom(core: SessionCore): void {
        const pending = core.leafState.kernel.pending.filter((item) => !item.async);
        this.report(pending.length === 0 ? null : pending.map(({id, callId, kind}) => ({id, callId, kind})));
    }

    /**
     * 提出一个事项。异步的写下就返回 null；同步的等应答，或等运行中止（这时写 `aborted` 并以它返回）。
     * `write` 是运行的写入口：运行收口之后它拒绝写（`RunStoppedError`）。
     */
    async request(core: SessionCore, write: (drafts: EventDraft[]) => Promise<unknown>, item: Omit<PendingInteraction, "id">, signal: AbortSignal): Promise<Resolution | null> {
        const id = core.newId();
        if (!item.async && signal.aborted) throw new RunStoppedError(`asking the user about ${item.callId}`);
        let answer: (resolution: Resolution) => void = () => undefined;
        let abort: () => void = () => undefined;
        const answered = new Promise<Resolution | "aborted">((resolve) => {
            answer = resolve;
            abort = () => resolve("aborted");
        });
        if (!item.async) this.#waiters.set(id, {signal, answer, abort});
        try {
            await write([ctrl("interactionRequested", {id, ...item})]);
        } catch (error) {
            this.#waiters.delete(id);
            throw error;
        }
        if (item.async) return null;
        this.#reportFrom(core);
        // 中止触发时同步摘掉等待：之后才排进队列的应答就知道没人等了，不会与这里的 aborted 各写一条结算。
        const onAbort = () => {
            if (this.#waiters.delete(id)) abort();
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, {once: true});
        const result = await answered;
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

/**
 * 受理没走完（会话关闭、写失败）时收尾认领到的事项。句柄好好的、事项还在待处理里，说明应答确定没写下，交还给等它的调用。
 * 别的情况以 `aborted` 叫醒，不让它挂住（与日志可能不一致，runtime.md 的已知限制）：事项已经不在了，是受理批写下了、之后的反应批
 * 才失败；句柄坏了，是写入结果不确定（写进文件、同步失败时内存里的待处理不变），交还的话等它的调用会再往坏了的句柄上写。
 */
export function releaseClaims(core: SessionCore, claims: ReadonlyMap<string, Claim>): void {
    const pending = new Set(core.leafState.kernel.pending.map((item) => item.id));
    for (const [id, claim] of claims) {
        if (pending.has(id) && !core.broken) claim.giveBack();
        else claim.wake({decision: "aborted", by: {kind: "kernel"}, code: "aborted"});
    }
}

const actorLabel = (actor: Actor): string => (actor.kind === "session" ? `session:${actor.id}` : actor.kind === "host" ? `host:${actor.source.plugin}` : actor.kind);

/** 谁能应答：审批只收用户；提问用户都能答，会话头 `questions: "caller"` 时也收派这个会话的父会话。 */
function allowed(core: SessionCore, item: PendingInteraction, issuer: Issuer): boolean {
    if (issuer.kind === "user") return true;
    return issuer.kind === "session" && item.kind === "question" && core.header.questions === "caller" && core.header.caller?.kind === "session" && core.header.caller.id === issuer.id;
}

export async function resolveCommand(host: CommandHost & {interactions: Interactions}, issuer: Issuer, args: CommandMap["resolve"]["args"] & {commandId: string}): Promise<CommandResult<"resolve">> {
    let claimed: Claim | undefined;
    let claimedId = "";
    const result = await accept(host, "resolve", args, async () => {
        const {core, control} = host;
        // 应答会改变对话（结算事项、回答进缓冲区）：只读会话不受理新的（session.md 失败表的 unknown-profile）。在判定里查，已提交的键
        // 先按记录重放：受理之后会话才变只读（重开时 Profile 不在了）的应答，重发得到原来的结果。
        if (host.readOnly() !== null) return {fail: "read-only"};
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
        const remember = item.kind === "approval" ? (item.request as {remember?: JsonValue}).remember : undefined;
        if (args.decision === "allow-session" && remember === false) return {fail: "invalid-answer"};
        if (args.decision === "answer" && (args.answer === undefined || isEmpty({text: args.answer.text}))) return {fail: "invalid-answer"};

        const resolution: Resolution = {
            decision: args.decision,
            by: issuer,
            ...(args.answer === undefined ? {} : {data: {text: args.answer.text, ...(args.answer.data === undefined ? {} : {data: args.answer.data})} as JsonValue}),
            ...(args.note === undefined ? {} : {note: args.note}),
        };
        const drafts: EventDraft[] = [ctrl("interactionResolved", {id: item.id, ...resolution})];
        if (args.decision === "allow-session") {
            drafts.push({type: "approvalRemembered", kind: "ctrl", scope: "session", data: {tool: (item.request as {tool: string}).tool, ...(remember === undefined ? {scope: "tool"} : {scope: "rule", rules: remember}), by: issuer as unknown as JsonValue}});
        }
        let launch: string | undefined;
        let deferred = false;
        if (item.async && args.decision === "answer") {
            // 异步提问的回答作为一条输入（runtime.md 输出 42）：过输入链；先放行应答者能放行的，运行中当插话，空闲时开新一轮
            // （或让应答者能接着跑的暂停的运行接着跑）。开不起运行时回答留着带码，应答照常成功。
            const intercepted = await interceptInput(host, {text: args.answer!.text});
            if (!intercepted.ok) return {fail: "input-rejected", detail: intercepted.rejection};
            const inputId = core.newId();
            const active = control.active;
            const window = active !== null && !control.takesInput;
            const mode = active !== null ? "steer" : "followup";
            const queue = (held?: HeldCause): EventDraft => ({type: "inputQueued", kind: "ctrl", scope: "session", data: queuedData(inputId, intercepted, mode, issuer, {commandId: args.commandId, ...(held === undefined ? {} : {held})})});
            drafts.push(...intercepted.failed);
            const paused = control.paused;
            const pausedBy = core.leafState.kernel.runBy ?? {kind: "user"};
            const problem = active === null ? startProblem(host) : null;
            if (window) {
                drafts.push(queue());
                deferred = true;
            } else if (active === null && paused !== null && !canContinue(pausedBy, null, issuer)) {
                drafts.push(queue({queued: "idle", code: "not-allowed"}));
            } else if (problem !== null) {
                drafts.push(queue({queued: "idle", code: problem}));
            } else {
                drafts.push(...releaseDrafts(core.session.kernel.buffer, issuer, "keep").drafts, queue());
                if (active === null && paused !== null) {
                    launch = paused;
                    drafts.push({type: "runResumed", kind: "ctrl", scope: "session", data: {runId: paused, ...byField(issuer)} as JsonValue});
                } else if (active === null) {
                    const opened = openRunDrafts(core, projectSession(core.session.kernel, drafts, core.head).buffer, issuer)!;
                    launch = opened.runId;
                    drafts.push(...opened.drafts);
                }
            }
        }
        // 同步事项：认领等它的调用（最后一步再认领，前面任何一处失败都不占着它）。没人等了：运行在等它的时候被中止，
        // 结算已经交给中止那一方。
        if (!item.async) {
            claimed = host.interactions.take(item.id);
            claimedId = item.id;
            if (claimed === undefined) return {fail: "already-answered", detail: {by: "kernel", decision: "aborted"}};
        }
        const wake = claimed;
        // 接着跑的运行：同步事项叫醒的是在跑的那次；异步回答插进在跑的那次，或开、续一次（runtime.md 输出 88）。
        // 推迟到收口的回答不进正在收口的那次运行：不交 runId（同 send 的 later）。
        const runId = launch ?? (deferred ? undefined : control.active?.runId);
        const answerId = deferred ? (drafts.at(-1)!.data as {id: string}).id : null;
        // 叫醒放在 `committed`：结算写下了就按它叫醒，之后的反应批写失败也一样（等它的调用拿到的与日志一致）。
        return {value: runId === undefined ? {} : {runId}, drafts, ...(launch === undefined ? {} : {launch}), committed: () => {
            claimed = undefined;
            wake?.wake(resolution);
        }, written: async () => {
            if (answerId !== null) control.defer({issuer, mode: "keep", inputIds: [answerId]});
        }};
    });
    // 认领了却没走完受理（会话关闭、写日志失败）：按事项的去向交还或叫醒（`releaseClaims`）。
    if (claimed !== undefined) releaseClaims(host.core, new Map([[claimedId, claimed]]));
    return result;
}
