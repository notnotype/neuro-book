/**
 * 组件测试用的时钟：时间只在测试调 `advance` 时走，到点的计时按到点的先后依次调用。与浏览器时钟（`host/clock.ts`）的约定相同：
 * 第一次在一个间隔之后、停掉之后不再调；两者同一份约定由 `host/clock.dom.test.ts` 守着。
 *
 * 只给测试导入；产品代码不导入它，所以不进构建产物。
 */

import type {SiteClock} from "../host/clock";

interface Timer {
    readonly intervalMs: number;
    readonly tick: () => void;
    due: number;
    stopped: boolean;
}

export interface ManualClock extends SiteClock {
    /** 把时间往前推 `ms` 毫秒，途中到点的计时逐个调用（同一时刻到点的按登记先后）。 */
    advance(ms: number): void;
}

export function manualClock(start: number): ManualClock {
    let current = start;
    const timers: Timer[] = [];

    return {
        now: () => current,
        every(intervalMs, tick) {
            if (!(intervalMs > 0)) throw new Error(`间隔要是正数，收到 ${intervalMs}`);
            const timer: Timer = {intervalMs, tick, due: current + intervalMs, stopped: false};
            timers.push(timer);
            return () => {
                timer.stopped = true;
            };
        },
        advance(ms) {
            const target = current + ms;
            for (;;) {
                const next = timers.filter((timer) => !timer.stopped && timer.due <= target).sort((a, b) => a.due - b.due)[0];
                if (next === undefined) break;
                current = next.due;
                next.due += next.intervalMs;
                next.tick();
            }
            current = target;
        },
    };
}
