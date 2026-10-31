/**
 * 运行控制：当前运行、运行状态、中止与等运行结束。运行状态大部分能从日志推出，`aborting` 与阶段这类中间态不进日志，
 * 在这里记着并经状态帧推出。
 *
 * 句柄损坏时日志写不进去：当前运行立即在内存里标为结束，等它的调用方以 `log-broken` 的结果完成，状态进 `broken`。
 * 这次运行的收口留给重开时的恢复（session.md 输出 12、15）。
 */

import type {RunResult, RunStatus} from "../api/index.js";
import type {SessionCore} from "../dispatch/core.js";
import {LogBrokenError} from "../dispatch/core.js";
import {runLoop, type ActiveRun, type RunHost} from "./loop.js";
import {runResultOf} from "./results.js";

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
    #host: Omit<RunHost, "phase"> | null = null;

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

    attach(host: Omit<RunHost, "phase">): void {
        this.#host = host;
    }

    get active(): ActiveRun | null {
        return this.#active;
    }

    get status(): RunStatus {
        return this.#status;
    }

    /** 没有在跑的运行，日志里也没有没收口的运行。 */
    get idle(): boolean {
        return this.#active === null && this.#core.leafState.kernel.run === null;
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
    launch(runId: string): void {
        const host = this.#host;
        if (host === null) throw new Error("run control is not attached");
        const controller = new AbortController();
        const run: ActiveRun = {runId, controller};
        const done = runLoop({...host, phase: (phase, request) => this.#setStatus({state: "running", runId, turnId: this.#core.leafState.kernel.run?.turnId ?? null, phase, request, pendingTools: []})}, run)
            .catch((error: unknown) => {
                // 只有写日志失败会到这里；onBroken 已经结算了等它的调用方。
                if (!(error instanceof LogBrokenError)) throw error;
            })
            .finally(() => {
                if (this.#active?.runId === runId) this.#active = null;
                if (this.#status.state !== "broken") this.#setStatus({state: "idle"});
                // 循环结束、当前运行清掉之后才结算等它的调用方：它们拿到结果时会话已经空闲，紧接着发下一条不会撞上 already-running。
                const result = runResultOf(this.#core.events, runId);
                if (result !== null) this.#settle(runId, result);
            });
        this.#active = {...run, done};
    }

    /** 中止当前运行并等它收口；没有运行时返回 false。 */
    async abort(): Promise<boolean> {
        const active = this.#active;
        if (active === null) return false;
        this.#setStatus({state: "aborting", runId: active.runId});
        active.controller.abort();
        await active.done;
        return true;
    }

    /** 等运行结束：正在跑的等循环结束；已经结束的从日志取；句柄坏了又查不到结果的以 `log-broken` 完成。 */
    waitRun(runId: string): Promise<RunResult> {
        if (this.#active?.runId !== runId) {
            const settled = runResultOf(this.#core.events, runId);
            if (settled !== null) return Promise.resolve(settled);
            if (this.#core.broken) return Promise.resolve(BROKEN_RESULT(runId, this.#core.head));
        }
        return new Promise((resolve) => {
            const list = this.#waiters.get(runId) ?? [];
            list.push(resolve);
            this.#waiters.set(runId, list);
        });
    }

    /** 关闭会话时：中止并等收口。 */
    async shutdown(): Promise<void> {
        await this.abort();
    }
}
