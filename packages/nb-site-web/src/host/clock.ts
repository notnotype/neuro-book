/**
 * 站点的时钟：当前时刻与按固定间隔重复的计时。页面上随时间变的东西（`rate_limited` 的倒数，计划 3.1“状态行与表单错误”）
 * 都经它取时间，由 `startSite` 注入；组件测试换成手动推进的时钟（`src/testing/manual-clock.ts`），不改写全局计时器
 * （docs/testing/README.md 的“不按固定时长等待”）。
 */

export interface SiteClock {
    /** 当前时刻（毫秒）。 */
    now(): number;
    /** 每隔 `intervalMs` 毫秒调一次 `tick`，第一次在一个间隔之后；回一个停掉它的函数，停掉之后不再调。 */
    every(intervalMs: number, tick: () => void): () => void;
}

/** 浏览器的时钟：`Date.now` 与窗口的 `setInterval`。 */
export function browserClock(win: Pick<Window, "setInterval" | "clearInterval">): SiteClock {
    return {
        now: () => Date.now(),
        every(intervalMs, tick) {
            const handle = win.setInterval(tick, intervalMs);
            return () => win.clearInterval(handle);
        },
    };
}
