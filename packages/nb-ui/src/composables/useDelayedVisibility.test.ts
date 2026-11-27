/**
 * 加载指示的延时出现与最短停留（`useDelayedVisibility`）。时间用手动推进的计时器，不用假计时器、不按真实时长等。
 */

import {describe, expect, it} from "vitest";
import {effectScope, nextTick, ref} from "vue";

import {useDelayedVisibility} from "./useDelayedVisibility";
import type {VisibilityTimers} from "./useDelayedVisibility";

function manualTimers(): VisibilityTimers & {advance(ms: number): void} {
    let now = 0;
    let seq = 0;
    const queue = new Map<number, {at: number; callback: () => void}>();
    return {
        now: () => now,
        setTimeout: (callback, ms) => {
            seq += 1;
            queue.set(seq, {at: now + ms, callback});
            return seq;
        },
        clearTimeout: (handle) => void queue.delete(handle as number),
        advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...queue.entries()].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (due === undefined) break;
                queue.delete(due[0]);
                now = due[1].at;
                due[1].callback();
            }
            now = end;
        },
    };
}

function setup() {
    const timers = manualTimers();
    const busy = ref(false);
    const scope = effectScope();
    const visible = scope.run(() => useDelayedVisibility(busy, {delay: 200, minVisible: 400, timers}))!;
    const set = async (value: boolean) => {
        busy.value = value;
        await nextTick();
    };
    return {timers, visible, set, scope};
}

describe("useDelayedVisibility", () => {
    it("延时之内就结束的请求什么都不出现", async () => {
        const {timers, visible, set} = setup();
        await set(true);
        timers.advance(150);
        await set(false);
        timers.advance(1000);
        expect(visible.value).toBe(false);
    });

    it("刚出现就结束，仍停够最短时长再隐藏", async () => {
        const {timers, visible, set} = setup();
        await set(true);
        timers.advance(200);
        expect(visible.value).toBe(true);
        timers.advance(50);
        await set(false);
        expect(visible.value).toBe(true);
        timers.advance(349);
        expect(visible.value).toBe(true);
        timers.advance(1);
        expect(visible.value).toBe(false);
    });

    it("长请求停够之后结束，立即隐藏", async () => {
        const {timers, visible, set} = setup();
        await set(true);
        timers.advance(2000);
        expect(visible.value).toBe(true);
        await set(false);
        expect(visible.value).toBe(false);
    });

    it("停留期里又忙起来：接着显示，不闪也不重新计延时", async () => {
        const {timers, visible, set} = setup();
        await set(true);
        timers.advance(250);
        await set(false);
        timers.advance(100);
        await set(true);
        expect(visible.value).toBe(true);
        timers.advance(1000);
        expect(visible.value).toBe(true);
        await set(false);
        expect(visible.value).toBe(false);
    });

    it("作用域销毁后待办的计时器不再改值", async () => {
        const {timers, visible, set, scope} = setup();
        await set(true);
        scope.stop();
        timers.advance(1000);
        expect(visible.value).toBe(false);
    });
});
