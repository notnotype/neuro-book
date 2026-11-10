/**
 * 合并推送：触发多少次都只算一次，两次推送之间至少隔 `intervalMs`；算的时候又触发了，算完再推一次。远程的 `treeChanged`、`jobsChanged`
 * 推整份，用它限频（subagents.md 输出 22、jobs.md 输出 9）。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

export class PushThrottle<T> {
    #timer: (() => void) | null = null;
    #running = false;
    #dirty = false;
    #closed = false;
    #last = Number.NEGATIVE_INFINITY;

    /** `failed`：计算抛错时调用（写诊断）；下一次触发照常重算。 */
    constructor(private readonly options: {readonly clock: RuntimeClock; readonly intervalMs: number; readonly compute: () => T | Promise<T>; readonly push: (value: T) => void; readonly failed: (error: unknown) => void}) {}

    trigger(): void {
        if (this.#closed) return;
        if (this.#running) {
            this.#dirty = true;
            return;
        }
        if (this.#timer !== null) return;
        const {clock, intervalMs} = this.options;
        this.#timer = clock.schedule(() => void this.#flush(), Math.max(0, this.#last + intervalMs - clock.now()));
    }

    close(): void {
        this.#closed = true;
        this.#timer?.();
        this.#timer = null;
    }

    async #flush(): Promise<void> {
        this.#timer = null;
        if (this.#closed) return;
        this.#running = true;
        this.#dirty = false;
        try {
            const value = await this.options.compute();
            this.#last = this.options.clock.now();
            if (!this.#closed) this.options.push(value);
        } catch (error) {
            this.options.failed(error);
        } finally {
            this.#running = false;
        }
        if (this.#dirty) this.trigger();
    }
}
