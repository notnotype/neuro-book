/**
 * 运行控制：当前运行、运行状态、中止与等运行结束。运行状态大部分能从日志推出，`aborting` 与阶段这类中间态不进日志，
 * 在这里记着并经状态帧推出。
 *
 * 句柄损坏时日志写不进去：当前运行立即在内存里标为结束，等它的调用方以 `log-broken` 的结果完成，状态进 `broken`。
 * 这次运行的收口留给重开时的恢复（session.md 输出 12、15）。
 */

import type {Issuer, RetryWait, RunResult, RunStatus} from "../api/index.js";
import type {SessionCore} from "../dispatch/core.js";
import {LogBrokenError} from "../dispatch/core.js";
import {writeAndReact} from "../dispatch/reactions.js";
import {Interactions} from "./interaction.js";
import {runLoop, type ActiveRun, type RunHost} from "./loop.js";
import {runResultOf} from "./results.js";
import {settleBatch, type Deferred, type SettleInput, type StopRecord} from "./settle.js";

/** 会话交给运行控制的部分；阶段、等待、事项与收口由控制自己补上。 */
type AttachedHost = Omit<RunHost, "phase" | "retrying" | "interactions" | "takeCompactRequests" | "settle">;

const BROKEN_RESULT = (runId: string, head: number): RunResult => ({
    runId,
    reason: "error",
    stopReason: "error",
    text: "",
    result: null,
    error: {kind: "local", code: "log-broken"},
    usage: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null, complete: false},
    entries: {first: head, last: head},
});

export class RunControl {
    #active: (ActiveRun & {done: Promise<void>}) | null = null;
    #status: RunStatus = {state: "idle"};
    readonly #waiters = new Map<string, ((result: RunResult) => void)[]>();
    readonly #core: SessionCore;
    #host: AttachedHost | null = null;
    /** 这次运行的停止记录（输出 30）：第一个被受理的 `abort` 定范围与停的人，后到的只追加受理记录。 */
    #stop: StopRecord | null = null;
    /** 等收口批写下的 `abort`：交回它的受理记录的 seq。 */
    #stopWaiters: ((seq: number) => void)[] = [];
    /** 运行不再取输入时受理的、要开运行的指令，按受理先后（输出 104）。 */
    #deferred: Deferred[] = [];
    /** 正在组收口批的运行：之后到的 `abort` 交回 `{aborted: false}`。 */
    #settling: string | null = null;
    /** 已经由收口批结束的运行：`launch` 的收尾不再重复清理与结算。 */
    readonly #settled = new Set<string>();
    /** 不带原因关闭会话时置上：留着的原因带这个码（输出 53）。 */
    #closingCode: string | null = null;
    /** 运行结束、会话回到空闲之后调用（撤回插件后的重新装配在这里接上，runtime.md 输出 57）。 */
    onIdle: (() => void) | null = null;
    /**
     * 运行中（或叶子上有暂停的运行时）受理的 `compact` 的要求，归属那次运行，到它的下一个边界做（runtime.md 输出 52）。
     * 不进日志：进程中断就丢。那次运行结束时没做的丢掉，别的运行不会拿到。
     */
    #compactRequests: {readonly runId: string; readonly require: readonly string[]}[] = [];
    /** 当前运行里在等的同步事项；有待处理的时运行状态是 `waiting`，都应答了回到 `running`。 */
    readonly interactions = new Interactions((pending) => {
        const active = this.#active;
        if (active === null || this.#status.state === "aborting") return;
        if (pending === null) this.#setStatus({state: "running", runId: active.runId, turnId: this.#core.leafState.kernel.run?.turnId ?? null, phase: "tools", request: null});
        else this.#setStatus({state: "waiting", runId: active.runId, pending: [...pending]});
    });

    constructor(core: SessionCore) {
        this.#core = core;
        core.onBroken(() => {
            const active = this.#active;
            this.#setStatus({state: "broken", code: "log-broken"});
            if (active !== null) {
                active.controller.abort();
                this.#settle(active.runId, BROKEN_RESULT(active.runId, core.head));
            }
        });
    }

    attach(host: AttachedHost): void {
        this.#host = host;
    }

    get active(): ActiveRun | null {
        return this.#active;
    }

    get status(): RunStatus {
        return this.#status;
    }

    /** 没有在跑的运行（叶子上可能有暂停的运行：回退到运行中途，见 `paused`）。 */
    get idle(): boolean {
        return this.#active === null;
    }

    /**
     * 有运行、且它还在取输入：不是只压缩的运行、停止没被受理、还没开始组收口批（输出 104 的“运行不再取输入”之外）。
     */
    get takesInput(): boolean {
        const active = this.#active;
        return active !== null && active.compact === undefined && this.#stop === null && this.#settling !== active.runId;
    }

    /** 运行不再取输入时受理的要开运行的指令：收口批里按受理先后放行、开下一次运行。 */
    defer(item: Deferred): void {
        this.#deferred.push(item);
    }

    /**
     * 停止的受理（输出 30）：在调用方的同步步骤里记下，交回等收口批写下的 Promise（得到受理记录的 seq）。
     * 没有当前运行或已开始组收口批时交回 null：这次 `abort` 没停下任何运行。
     */
    recordStop(stop: Omit<StopRecord, "runId" | "commands">, command: {commandId: string; argsHash: string}): Promise<number> | null {
        const active = this.#active;
        if (active === null || this.#settling === active.runId) return null;
        if (this.#stop === null) this.#stop = {...stop, runId: active.runId, commands: [command]};
        else this.#stop.commands.push(command);
        return new Promise((resolve) => this.#stopWaiters.push(resolve));
    }

    /** 叶子上有没收口、也没有循环在跑的运行（回退或切分支到运行中途）；`start` 与 `send` 让它接着跑。 */
    get paused(): string | null {
        return this.#active === null ? (this.#core.leafState.kernel.run?.runId ?? null) : null;
    }

    #setStatus(status: RunStatus): void {
        this.#status = status;
        this.#core.emit({type: "status", status, afterSeq: this.#core.head});
    }

    #settle(runId: string, result: RunResult): void {
        const waiters = this.#waiters.get(runId) ?? [];
        this.#waiters.delete(runId);
        for (const resolve of waiters) resolve(result);
    }

    /** 受理批（含 `runStarted`）写下之后调用：开始跑循环。 */
    /** 运行中（或叶子上有暂停的运行）受理的 `compact`：交给这次运行的下一个边界。 */
    requestCompaction(runId: string, require: readonly string[]): void {
        this.#compactRequests.push({runId, require: [...require]});
    }

    #takeCompactRequests(runId: string): string[][] {
        const mine = this.#compactRequests.filter((item) => item.runId === runId).map((item) => [...item.require]);
        this.#compactRequests = this.#compactRequests.filter((item) => item.runId !== runId);
        return mine;
    }

    /** 只改运行中的状态：等审批的 `waiting`、中止中的 `aborting` 不被盖掉。 */
    #setRetrying(wait: RetryWait | null): void {
        const status = this.#status;
        if (status.state !== "running") return;
        const {retry: _previous, ...rest} = status;
        this.#setStatus(wait === null ? rest : {...rest, retry: wait});
    }

    launch(runId: string, options: {compact?: {require: readonly string[]}} = {}): void {
        const host = this.#host;
        if (host === null) throw new Error("run control is not attached");
        const controller = new AbortController();
        const run: ActiveRun = {runId, controller, ...(options.compact === undefined ? {} : {compact: options.compact})};
        const done = runLoop({...host, interactions: this.interactions, settle: (input) => this.settleIn(runId, input), takeCompactRequests: () => this.#takeCompactRequests(runId), retrying: (wait) => this.#setRetrying(wait), phase: (phase, request) => this.#setStatus({state: "running", runId, turnId: this.#core.leafState.kernel.run?.turnId ?? null, phase, request})}, run)
            .catch((error: unknown) => {
                // 只有写日志失败会到这里；onBroken 已经结算了等它的调用方。
                if (!(error instanceof LogBrokenError)) throw error;
            })
            .finally(() => {
                if (this.#settled.delete(runId)) return;
                if (this.#active?.runId === runId) this.#active = null;
                // 这次运行没来得及做的 compact 要求丢掉：它们只属于这次运行。
                this.#compactRequests = this.#compactRequests.filter((item) => item.runId !== runId);
                if (this.#status.state !== "broken") this.#setStatus({state: "idle"});
                this.onIdle?.();
                // 循环结束、当前运行清掉之后才结算等它的调用方：它们拿到结果时会话已经空闲，紧接着发下一条不会撞上 already-running。
                const result = runResultOf(this.#core.events, runId, this.#core.byId);
                if (result !== null) this.#settle(runId, result);
            });
        this.#active = {...run, done};
    }

    /**
     * 收口那一项（输出 104）：只在单写者队列的一项里调用。组批、写下，然后在同一项里把会话翻成空闲（或换成收口批开的下一次运行）、
     * 推状态帧、结算 `waitRun`。写批或反应失败时照样翻转（句柄损坏时状态保持 `broken`），错误再交给调用方。
     */
    async settleIn(runId: string, input: Omit<SettleInput, "runId" | "stop" | "deferred" | "skip" | "closingCode">): Promise<void> {
        const host = this.#host;
        if (host === null) throw new Error("run control is not attached");
        this.#settling = runId;
        const stop = this.#stop?.runId === runId ? this.#stop : null;
        const deferred = this.#deferred;
        let next: string | null = null;
        try {
            const skip = deferred.length === 0 ? null : this.#deferredSkip(host);
            const batch = settleBatch(this.#core, {...input, runId, stop, deferred, skip, closingCode: input.reason === "aborted" ? this.#closingCode : null});
            await writeAndReact(this.#core, batch.drafts, host.react);
            next = batch.next;
        } finally {
            this.#finish(runId, next);
        }
    }

    /** 推迟的指令为什么不能开运行：正在关闭、待做的重新装配、开不起运行（查的时候抛错按 `internal`）。 */
    #deferredSkip(host: AttachedHost): string | null {
        if (host.checks.closed()) return "session-closing";
        if (host.checks.reassemblyPending()) return "reassembly-pending";
        try {
            return host.checks.startProblem();
        } catch {
            return "internal";
        }
    }

    #finish(runId: string, next: string | null): void {
        this.#settled.add(runId);
        if (this.#active?.runId === runId) this.#active = null;
        this.#settling = null;
        this.#compactRequests = this.#compactRequests.filter((item) => item.runId !== runId);
        this.#stop = null;
        this.#deferred = [];
        const stopWaiters = this.#stopWaiters.splice(0);
        if (this.#status.state !== "broken") this.#setStatus({state: "idle"});
        const launched = next !== null && this.#status.state !== "broken" && this.#host?.checks.closed() !== true;
        if (launched) this.launch(next);
        else this.onIdle?.();
        for (const resolve of stopWaiters) resolve(this.#core.head);
        const result = runResultOf(this.#core.events, runId, this.#core.byId);
        if (result !== null) this.#settle(runId, result);
    }

    /** 中止当前运行并等它收口；没有运行时返回 false。 */
    /** `reason` 是 `ProcessInterrupt` 时这次运行按 `interrupted` 收口（进程收尾），否则按 `aborted`。 */
    async abort(reason?: unknown): Promise<boolean> {
        const active = this.#active;
        if (active === null) return false;
        this.#setStatus({state: "aborting", runId: active.runId});
        active.controller.abort(reason);
        await active.done;
        return true;
    }

    /** 等运行结束：正在跑的等循环结束；已经结束的从日志取；句柄坏了又查不到结果的以 `log-broken` 完成。 */
    waitRun(runId: string): Promise<RunResult> {
        if (this.#active?.runId !== runId) {
            const settled = runResultOf(this.#core.events, runId, this.#core.byId);
            if (settled !== null) return Promise.resolve(settled);
            if (this.#core.broken) return Promise.resolve(BROKEN_RESULT(runId, this.#core.head));
        }
        return new Promise((resolve) => {
            const list = this.#waiters.get(runId) ?? [];
            list.push(resolve);
            this.#waiters.set(runId, list);
        });
    }

    /** 关闭会话时：中止并等收口。不带原因的关闭，留着的话记 `session-closed`（输出 53）。 */
    async shutdown(reason?: unknown): Promise<void> {
        if (reason === undefined) this.#closingCode = "session-closed";
        await this.abort(reason);
    }

    /** 这次运行由谁停：没有停止记录时为 null。 */
    stoppedBy(runId: string): Issuer | null {
        return this.#stop?.runId === runId ? this.#stop.by : null;
    }
}
