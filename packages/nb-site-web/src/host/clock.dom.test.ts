/**
 * 时钟的约定（`host/clock.ts` 的 `SiteClock`）：浏览器的时钟与组件测试用的手动时钟都守同一份，组件测试换上手动时钟时才不改变页面的行为。
 * 浏览器的时钟在 happy-dom 的窗口里跑真实的计时器，等的是可观察的调用次数，不按固定时长等。
 */

import {describe, expect, it, vi} from "vitest";

import {manualClock} from "../testing/manual-clock";
import {browserClock} from "./clock";

describe("浏览器的时钟", () => {
    it("当前时刻取系统时间", () => {
        const before = Date.now();
        const now = browserClock(window).now();
        expect(now).toBeGreaterThanOrEqual(before);
        expect(now).toBeLessThanOrEqual(Date.now());
    });

    it("登记之后不立刻调用，按间隔反复调用；停掉之后不再调用", async () => {
        const clock = browserClock(window);
        let stoppedTicks = 0;
        const stop = clock.every(5, () => {
            stoppedTicks += 1;
        });
        expect(stoppedTicks).toBe(0);
        await vi.waitFor(() => expect(stoppedTicks).toBeGreaterThanOrEqual(2));
        stop();
        const atStop = stoppedTicks;

        // 停掉之后要证明“不再调”：等另一个同样间隔的计时走过两次，那段时间里停掉的那个要是还在，早该再调了。
        let witnessTicks = 0;
        const stopWitness = clock.every(5, () => {
            witnessTicks += 1;
        });
        await vi.waitFor(() => expect(witnessTicks).toBeGreaterThanOrEqual(2));
        stopWitness();
        expect(stoppedTicks).toBe(atStop);
    });
});

describe("手动时钟", () => {
    it("时间只在推进时走；到点的计时按到点的先后调用，一次推进跨过几个间隔就调几次", () => {
        const clock = manualClock(1_000);
        const calls: string[] = [];
        clock.every(300, () => calls.push(`a@${clock.now()}`));
        clock.every(200, () => calls.push(`b@${clock.now()}`));
        expect(clock.now()).toBe(1_000);
        expect(calls).toEqual([]);

        clock.advance(650);
        // 1600 两个都到点，按登记的先后。
        expect(calls).toEqual(["b@1200", "a@1300", "b@1400", "a@1600", "b@1600"]);
        expect(clock.now()).toBe(1_650);
    });

    it("停掉之后不再调用，在别的计时的回调里停掉也一样", () => {
        const clock = manualClock(0);
        const calls: string[] = [];
        // 两个都在 100 到点，先登记的先调：它在 100 那次停掉后一个，后一个在 100 就不再调。
        let stopOther = (): void => undefined;
        clock.every(50, () => {
            calls.push(`stopper@${clock.now()}`);
            if (clock.now() === 100) stopOther();
        });
        stopOther = clock.every(100, () => calls.push(`other@${clock.now()}`));
        clock.advance(200);
        expect(calls).toEqual(["stopper@50", "stopper@100", "stopper@150", "stopper@200"]);
    });
});
