/**
 * 长截止的等待（docs/specs/runtime/desktop-shell.md 输出 19）：停止的截止是排空 20 秒加项目子进程的停止截止再加 50 秒，
 * 项目停止截止的上限是 2^31−1 毫秒，加起来会超出 `setTimeout` 能排的最长时间（超出时 Node 与 Bun 都按 1 毫秒处理）。
 * 这里按绝对时间分段排，每段不超过上限。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

/** 能注入的时钟：与内核的 `RuntimeClock` 同形（现在几点、排一个回调并交回取消函数）。测试换成手动时钟。 */
export type DeadlineClock = RuntimeClock;

export const systemClock: DeadlineClock = {
    now: () => Date.now(),
    schedule(callback, ms) {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    },
};

/** `setTimeout` 一次能排的最长毫秒数。 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** 到 `at`（绝对时间，毫秒）时调用 `callback`，交回取消函数。`at` 已过时尽快调用。 */
export function at(clock: DeadlineClock, atMs: number, callback: () => void): () => void {
    let cancelArmed: (() => void) | null = null;
    let cancelled = false;
    const arm = (): void => {
        if (cancelled) return;
        const remaining = atMs - clock.now();
        if (remaining <= 0) {
            cancelArmed = null;
            callback();
            return;
        }
        cancelArmed = clock.schedule(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
    return () => {
        cancelled = true;
        cancelArmed?.();
    };
}

/** 停止服务端的截止（毫秒）：排空上限加项目子进程的停止截止再加余量。 */
export function stopDeadlineMs(projectStopMs: number): number {
    return 20_000 + projectStopMs + 50_000;
}
