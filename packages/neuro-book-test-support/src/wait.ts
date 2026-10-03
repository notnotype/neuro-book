/**
 * 测试里等一个可观察的状态成立，代替固定时长的等待：条件一成立就继续，慢机器上只是多查几次，
 * 不会因为等得不够而误报。超时抛错，消息带上等待的内容。
 */

export interface WaitUntilOptions {
    /** 缺省 5000 毫秒。 */
    readonly timeoutMs?: number;
    /** 两次检查之间的间隔，缺省 10 毫秒。 */
    readonly intervalMs?: number;
}

type Present<T> = Exclude<T, false | null | undefined>;

/** 反复调用 `check`，直到它返回 `false`、`null`、`undefined` 以外的值，并返回该值。 */
export async function waitUntil<T>(description: string, check: () => T | Promise<T>, options: WaitUntilOptions = {}): Promise<Present<T>> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const intervalMs = options.intervalMs ?? 10;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value !== false && value !== null && value !== undefined) return value as Present<T>;
        if (Date.now() >= deadline) throw new Error(`等待超时（${String(timeoutMs)}ms）：${description}`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}
