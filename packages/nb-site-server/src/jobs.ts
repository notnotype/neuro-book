/**
 * 模块定时任务的调度（`ModuleContext.jobs`）。生命周期：`create()` 与 `start()` 里登记 → 全部 `start()` 之后 `start()`
 * 开始调度 → 停止时 `stop()` 停掉计时并等正在跑的那一次，然后才轮到模块的 `close()`。
 *
 * 每个任务的每一次运行（按间隔排的，与测试控制入口要的“立即跑一次”）都排进这个任务自己的队列，一次 settle 之后才开始
 * 下一次，所以同一个任务不会叠着跑；间隔从上一次按间隔排的运行结束算起。轮到某一次时调度已经停了，它就不跑。
 */

import type {JobDefinition, JobRegistry} from "./module";
import {errorType, type Logger} from "./log";

interface Entry {
    readonly module: string;
    readonly job: JobDefinition;
    readonly log: Logger;
    timer: ReturnType<typeof setTimeout> | undefined;
    /** 这个任务最后排上的那一次运行；下一次排在它后面。从不 reject。 */
    queue: Promise<unknown>;
}

/**
 * 测试控制入口跑一次任务的结果（`site.operations` 输出 11）：`done` 跑完了，`failed` 任务抛错或 reject（已记 `job.failed`），
 * `unavailable` 调度还没开始或已经停了，没有跑。
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
        if (this.#state !== "registering") return;
        this.#state = "running";
        for (const entry of this.#entries) this.#schedule(entry);
    }

    /** 停掉计时并等已经排上的运行 settle（排在后面、还没轮到的不再跑）。可以重复调用；没开始调度时直接完成。 */
    async stop(): Promise<void> {
        this.#state = "stopped";
        for (const entry of this.#entries) clearTimeout(entry.timer);
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
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            void this.#enqueue(entry).then(() => {
                if (this.#state === "running") this.#schedule(entry);
            });
        }, entry.job.intervalMs);
    }

    /** 排在这个任务的队列末尾；轮到时调度不在运行状态就不跑。 */
    #enqueue(entry: Entry): Promise<RunNowOutcome> {
        const run = entry.queue.then((): Promise<RunNowOutcome> | RunNowOutcome => (this.#state === "running" ? this.#runOnce(entry) : "unavailable"));
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
