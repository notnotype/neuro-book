/**
 * 测试用的手动时钟：实现 `RuntimeClock`，时间只在 `advance()` 时前进。供注入时钟的机制（远程调用
 * 超时、子实例宽限期与停止截止）的测试使用，代替真实计时与固定等待。
 */

import type {RuntimeClock} from "../clock";

export class ManualClock implements RuntimeClock {
    #now = 0;
    readonly #timers = new Set<{readonly at: number; readonly callback: () => void}>();

    now(): number {
        return this.#now;
    }

    schedule(callback: () => void, ms: number): () => void {
        const timer = {at: this.#now + ms, callback};
        this.#timers.add(timer);
        return () => this.#timers.delete(timer);
    }

    /** 前进 `ms` 毫秒，按到期先后同步执行到点的回调；回调里新登记的计时留到下一次 `advance`。 */
    advance(ms: number): void {
        this.#now += ms;
        const due = [...this.#timers].filter((timer) => timer.at <= this.#now).sort((left, right) => left.at - right.at);
        for (const timer of due) {
            // 前一个回调可能已取消它。
            if (this.#timers.delete(timer)) {
                timer.callback();
            }
        }
    }
}
