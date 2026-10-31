/** 产品用的时钟：真实时间与真实计时器。测试换成 `kernel/testing` 的手动时钟。 */

import type {Clock} from "../api/index.js";

export const systemClock: Clock = {
    now: () => Date.now(),
    wait: (ms, signal) =>
        new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason);
            const timer = setTimeout(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            const onAbort = () => {
                clearTimeout(timer);
                reject(signal?.reason);
            };
            signal?.addEventListener("abort", onAbort, {once: true});
        }),
};
