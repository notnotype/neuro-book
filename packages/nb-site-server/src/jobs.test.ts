/**
 * 调度器的停止分两步（`jobs.ts` 的文件头）。按间隔到点的那一次用手动推进的计时器触发：真实时间下要证明“到点了却没跑”
 * 只能留一个固定时长的窗口。“立即跑一次”在停止期间回 503 的那条走真实进程，见 `serve.test.ts` 的测试控制入口一组。
 */

import {describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {JobScheduler, type JobTimers} from "./jobs";
import {createLogger} from "./log";

/** 记下排上的计时器，`fire()` 触发到点的那些；不碰全局时间。 */
function manualTimers(): JobTimers & {pending(): number; fire(): void} {
    const pending = new Map<number, () => void>();
    let next = 0;
    return {
        set: (callback) => {
            next += 1;
            pending.set(next, callback);
            return next;
        },
        clear: (handle) => void pending.delete(handle as number),
        pending: () => pending.size,
        fire: () => {
            const due = [...pending.values()];
            pending.clear();
            for (const callback of due) callback();
        },
    };
}

describe("JobScheduler 的停止", () => {
    it("stopAccepting() 之后按间隔到点的那一次不再开始，也不再排下一次", async () => {
        const timers = manualTimers();
        const scheduler = new JobScheduler(timers);
        let runs = 0;
        scheduler.registry("alpha", createLogger(() => undefined)).register({name: "tick", intervalMs: 10, run: () => void (runs += 1)});
        scheduler.start();
        timers.fire();
        // 一次跑完之后才排下一次。
        await waitUntil("next run scheduled", () => timers.pending() === 1);
        expect(runs).toBe(1);

        scheduler.stopAccepting();
        timers.fire();
        // 到点的那一次排在这个任务的队列里；排在它后面的“立即跑一次”settle 时它已经轮过了。
        expect(await scheduler.find("alpha", "tick")!.runNow()).toBe("unavailable");
        expect({runs, pending: timers.pending()}).toEqual({runs: 1, pending: 0});
        await scheduler.stop();
    });
});
