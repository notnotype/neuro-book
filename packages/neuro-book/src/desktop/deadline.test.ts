/** 长截止分段（docs/specs/runtime/desktop-shell.md 输出 19）：用手动时钟看每段排了多长、什么时候真的到点。 */

import {describe, expect, it} from "bun:test";

import {at, MAX_TIMER_MS, stopDeadlineMs} from "./deadline";
import type {DeadlineClock} from "./deadline";

function manualClock(): DeadlineClock & {advance(ms: number): void; armed: number[]} {
    let now = 0;
    let next: {due: number; callback: () => void} | null = null;
    const armed: number[] = [];
    return {
        armed,
        now: () => now,
        schedule(callback, ms) {
            armed.push(ms);
            const timer = {due: now + ms, callback};
            next = timer;
            return () => {
                if (next === timer) next = null;
            };
        },
        advance(ms) {
            const target = now + ms;
            while (next !== null && next.due <= target) {
                const fired = next;
                next = null;
                now = fired.due;
                fired.callback();
            }
            now = target;
        },
    };
}

describe("长截止", () => {
    it("项目停止截止取最大值时，截止超过一次能排的上限：分段排，到绝对时间才调用，不提前", () => {
        const total = stopDeadlineMs(MAX_TIMER_MS);
        expect(total).toBeGreaterThan(MAX_TIMER_MS);
        const clock = manualClock();
        let fired = 0;
        at(clock, total, () => (fired += 1));
        expect(clock.armed[0]).toBe(MAX_TIMER_MS);
        clock.advance(MAX_TIMER_MS);
        expect(fired).toBe(0);
        clock.advance(total - MAX_TIMER_MS - 1);
        expect(fired).toBe(0);
        clock.advance(1);
        expect(fired).toBe(1);
        expect(clock.armed.every((ms) => ms > 0 && ms <= MAX_TIMER_MS)).toBe(true);
    });

    it("取消之后不再调用；缺省项目停止截止时共 90 秒", () => {
        const clock = manualClock();
        let fired = 0;
        const cancel = at(clock, 1_000, () => (fired += 1));
        cancel();
        clock.advance(2_000);
        expect(fired).toBe(0);
        expect(stopDeadlineMs(20_000)).toBe(90_000);
    });
});
