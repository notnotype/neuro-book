/**
 * 长截止的等待（docs/specs/runtime/desktop-shell.md 输出 19）：停止的截止是排空 20 秒加项目子进程的停止截止再加 50 秒，
 * 项目停止截止的上限是 2^31−1 毫秒，加起来会超出 `setTimeout` 能排的最长时间（超出时 Node 与 Bun 都按 1 毫秒处理）。
 * 这里按绝对时间分段排，每段不超过上限。
 */

/** 能注入的时钟：现在几点、排一个回调、取消它。测试换成手动时钟。 */
export interface DeadlineClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export const systemClock: DeadlineClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `setTimeout` 一次能排的最长毫秒数。 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** 到 `at`（绝对时间，毫秒）时调用 `callback`，交回取消函数。`at` 已过时尽快调用。 */
export function at(clock: DeadlineClock, atMs: number, callback: () => void): () => void {
    let handle: unknown = null;
    let cancelled = false;
    const arm = (): void => {
        if (cancelled) return;
        const remaining = atMs - clock.now();
        if (remaining <= 0) {
            handle = null;
            callback();
            return;
        }
        handle = clock.setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
    return () => {
        cancelled = true;
        if (handle !== null) clock.clearTimeout(handle);
    };
}

/** 停止服务端的截止（毫秒）：排空上限加项目子进程的停止截止再加余量。 */
export function stopDeadlineMs(projectStopMs: number): number {
    return 20_000 + projectStopMs + 50_000;
}
