/** 手动时钟：时间只在 `advance` 时前进，到期的等待按到期先后完成。测试不用真等，也不用假计时器。 */

import type {Clock} from "../api/index.js";

export interface TestClock extends Clock {
    /** 推进时间，并让到期的等待完成；等它们引出的微任务跑完再返回。 */
    advance(ms: number): Promise<void>;
}

export function createTestClock(startAt = Date.UTC(2026, 0, 1)): TestClock {
    let now = startAt;
    const timers: {due: number; resolve: () => void}[] = [];
    return {
        now: () => now,
        wait(ms, signal) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) return reject(signal.reason);
                const timer = {due: now + ms, resolve: () => resolve()};
                timers.push(timer);
                signal?.addEventListener("abort", () => {
                    timers.splice(timers.indexOf(timer), 1);
                    reject(signal.reason);
                }, {once: true});
            });
        },
        async advance(ms) {
            const target = now + ms;
            for (;;) {
                timers.sort((a, b) => a.due - b.due);
                const next = timers[0];
                if (next === undefined || next.due > target) break;
                timers.shift();
                now = next.due;
                next.resolve();
                await new Promise<void>((resolve) => setImmediate(resolve));
            }
            now = target;
            await new Promise<void>((resolve) => setImmediate(resolve));
        },
    };
}
