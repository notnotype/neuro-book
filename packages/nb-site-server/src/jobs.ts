/**
 * 模块定时任务的调度（`ModuleContext.jobs`）。生命周期：`create()` 与 `start()` 里登记 → 全部 `start()` 之后 `start()`
 * 开始调度 → 停止时 `stop()` 停掉计时并等正在跑的那一次，然后才轮到模块的 `close()`。
 *
 * 每个任务跑完一次之后才排下一次，不会叠着跑；间隔从上一次结束算起。
 */

import type {JobDefinition, JobRegistry} from "./module";
import {errorType, type Logger} from "./log";

interface Entry {
    readonly job: JobDefinition;
    readonly log: Logger;
    timer: ReturnType<typeof setTimeout> | undefined;
}

export class JobScheduler {
    readonly #entries: Entry[] = [];
    readonly #running = new Set<Promise<void>>();
    #state: "registering" | "running" | "stopped" = "registering";

    /** 给一个模块的登记入口；登记的任务的日志带上这个模块。 */
    registry(log: Logger): JobRegistry {
        return {
            register: (job) => {
                if (this.#state !== "registering") throw new Error(`job ${JSON.stringify(job.name)} registered after scheduling started`);
                if (!Number.isInteger(job.intervalMs) || job.intervalMs <= 0) throw new Error(`job ${JSON.stringify(job.name)} needs a positive integer interval`);
                this.#entries.push({job, log, timer: undefined});
            },
        };
    }

    start(): void {
        if (this.#state !== "registering") return;
        this.#state = "running";
        for (const entry of this.#entries) this.#schedule(entry);
    }

    /** 停掉计时并等正在跑的那一次 settle。可以重复调用；没开始调度时直接完成。 */
    async stop(): Promise<void> {
        this.#state = "stopped";
        for (const entry of this.#entries) clearTimeout(entry.timer);
        await Promise.all(this.#running);
    }

    #schedule(entry: Entry): void {
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            const run = this.#runOnce(entry).finally(() => {
                this.#running.delete(run);
                if (this.#state === "running") this.#schedule(entry);
            });
            this.#running.add(run);
        }, entry.job.intervalMs);
    }

    async #runOnce(entry: Entry): Promise<void> {
        try {
            await entry.job.run();
        } catch (error) {
            entry.log.error("job.failed", "scheduled job failed", {job: entry.job.name, errorType: errorType(error)});
        }
    }
}
