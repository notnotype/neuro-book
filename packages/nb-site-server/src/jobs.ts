/**
 * 模块定时任务的调度（`ModuleContext.jobs`）。生命周期：`create()` 与 `start()` 里登记 → 全部 `start()` 之后 `start()`
 * 开始调度 → 第一次停止信号到达时 `stopAccepting()`，不再开始新的运行 → HTTP 排空之后 `stop()` 停掉计时并等正在跑的那一次，
 * 然后才轮到模块的 `close()`。
 *
 * 不再开始与停计时分成两步：排空期间还连着的请求（测试控制入口的“立即跑一次”）不能再起新的后台工作，它会用到随后就被
 * `close()`、关库的资源（`site.operations` 输出 11：服务正在停止时回 503）；而停计时、等正在跑的那一次要放在排空之后，
 * 那一次的收尾时限（`serve.ts` 的 `MODULE_CLEANUP_MS`）才不被排空占掉。
 *
 * 每个任务的每一次运行（按间隔排的，与测试控制入口要的“立即跑一次”）都排进这个任务自己的队列，一次 settle 之后才开始
 * 下一次，所以同一个任务不会叠着跑；间隔从上一次按间隔排的运行结束算起。轮到某一次时调度已经停了，它就不跑。
 */

import type {JobDefinition, JobRegistry} from "./module";
import {errorType, type Logger} from "./log";

/**
 * 排间隔用的计时器。缺省是全局的 `setTimeout`；包内测试传一个手动推进的，按间隔到点的那一次什么时候跑由测试决定
 * （仓库的测试规则不许改写全局时间的假计时器）。
 */
export interface JobTimers {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
}

const GLOBAL_TIMERS: JobTimers = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface Entry {
    readonly module: string;
    readonly job: JobDefinition;
    readonly log: Logger;
    timer: unknown;
    /** 这个任务最后排上的那一次运行；下一次排在它后面。从不 reject。 */
    queue: Promise<unknown>;
}

/**
 * 测试控制入口跑一次任务的结果（`site.operations` 输出 11）：`done` 跑完了，`failed` 任务抛错或 reject（已记 `job.failed`），
 * `unavailable` 调度还没开始、服务正在停止或已经停了，没有跑。
 */
export type RunNowOutcome = "done" | "failed" | "unavailable";

export interface JobHandle {
    /** 立即排一次；这个任务正在跑时等那一次 settle 再跑。 */
    runNow(): Promise<RunNowOutcome>;
}

export class JobScheduler {
    readonly #entries: Entry[] = [];
    readonly #running = new Set<Promise<unknown>>();
    #state: "registering" | "running" | "stopped" = "registering";
    /**
     * `stopAccepting()` 之后为 false：不再开始新的运行，计时还在、正在跑的那一次照常跑完（见文件头）。与 `#state` 分开记：
     * 建实例期间就收到停止信号时，后面的模块照样能登记任务（登记不是开始运行），只是 `start()` 不再开始调度。
     */
    #accepting = true;
    readonly #timers: JobTimers;

    constructor(timers: JobTimers = GLOBAL_TIMERS) {
        this.#timers = timers;
    }

    /** 给一个模块的登记入口；登记的任务的日志带上这个模块（`log` 已带 `module`）。 */
    registry(module: string, log: Logger): JobRegistry {
        return {
            register: (job) => {
                if (this.#state !== "registering") throw new Error(`job ${JSON.stringify(job.name)} registered after scheduling started`);
                if (!Number.isInteger(job.intervalMs) || job.intervalMs <= 0) throw new Error(`job ${JSON.stringify(job.name)} needs a positive integer interval`);
                // 测试控制入口按模块名与任务名找任务，同名的分不出来。
                if (this.#find(module, job.name) !== undefined) throw new Error(`job ${JSON.stringify(job.name)} of module ${module} is registered twice`);
                this.#entries.push({module, job, log, timer: undefined, queue: Promise.resolve()});
            },
        };
    }

    start(): void {
        if (this.#state !== "registering" || !this.#accepting) return;
        this.#state = "running";
        for (const entry of this.#entries) this.#schedule(entry);
    }

    /**
     * 从此不再开始新的运行：排着还没轮到的与之后再要的都得 `unavailable`，按间隔到点的也不跑；已经开始的那一次照常跑完。
     * 可以重复调用，在 `start()` 之前调用时 `start()` 不再开始调度。
     */
    stopAccepting(): void {
        this.#accepting = false;
    }

    /** 不再开始新的运行，停掉计时并等已经排上的运行 settle。可以重复调用；没开始调度时直接完成。 */
    async stop(): Promise<void> {
        this.#state = "stopped";
        this.#accepting = false;
        for (const entry of this.#entries) if (entry.timer !== undefined) this.#timers.clear(entry.timer);
        await Promise.all(this.#running);
    }

    /** 按模块名与任务名找任务；没有时为 undefined。 */
    find(module: string, name: string): JobHandle | undefined {
        const entry = this.#find(module, name);
        return entry === undefined ? undefined : {runNow: () => this.#enqueue(entry)};
    }

    #find(module: string, name: string): Entry | undefined {
        return this.#entries.find((entry) => entry.module === module && entry.job.name === name);
    }

    #schedule(entry: Entry): void {
        entry.timer = this.#timers.set(() => {
            entry.timer = undefined;
            void this.#enqueue(entry).then(() => {
                if (this.#runnable()) this.#schedule(entry);
            });
        }, entry.job.intervalMs);
    }

    #runnable(): boolean {
        return this.#state === "running" && this.#accepting;
    }

    /** 排在这个任务的队列末尾；轮到时已经不再开始新的运行（停止开始了，或调度还没开始）就不跑。 */
    #enqueue(entry: Entry): Promise<RunNowOutcome> {
        const run = entry.queue.then((): Promise<RunNowOutcome> | RunNowOutcome => (this.#runnable() ? this.#runOnce(entry) : "unavailable"));
        entry.queue = run;
        this.#running.add(run);
        void run.finally(() => this.#running.delete(run));
        return run;
    }

    async #runOnce(entry: Entry): Promise<RunNowOutcome> {
        try {
            await entry.job.run();
            return "done";
        } catch (error) {
            entry.log.error("job.failed", "scheduled job failed", {job: entry.job.name, errorType: errorType(error)});
            return "failed";
        }
    }
}
