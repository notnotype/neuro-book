/**
 * 关窗协调（docs/specs/runtime/desktop-shell.md 输出 9、14 到 17、23）。端口替身按 Electrobun 的顺序派发：`closeRequested`
 * 之前 `will-close` 已否决；`commitClose` 之后窗口要等测试送 `closed` 才没。时钟是手动的。
 */

import {describe, expect, it} from "bun:test";

import type {DeadlineClock} from "./deadline";
import {ACK_MS, WindowCoordinator} from "./windows";
import type {CloseReason, OpenTarget, WindowId, WindowPort} from "./windows";

type Call =
    | ["open", WindowId, OpenTarget]
    | ["load", WindowId, string]
    | ["commitClose", WindowId]
    | ["askPage", WindowId, number, CloseReason]
    | ["endAsk", WindowId, number]
    | ["showNotResponding", WindowId]
    | ["closeNotResponding", WindowId];

function harness(options: {owned?: boolean; ready?: boolean} = {}) {
    let now = 0;
    const timers = new Set<{due: number; callback: () => void}>();
    const clock: DeadlineClock = {
        now: () => now,
        setTimeout(callback, ms) {
            const timer = {due: now + ms, callback};
            timers.add(timer);
            return timer;
        },
        clearTimeout: (handle) => void timers.delete(handle as {due: number; callback: () => void}),
    };
    const advance = (ms: number) => {
        now += ms;
        for (const timer of [...timers].sort((a, b) => a.due - b.due)) {
            if (timer.due <= now && timers.delete(timer)) timer.callback();
        }
    };
    const calls: Call[] = [];
    let nextId = 0;
    const port: WindowPort = {
        open(target) {
            nextId += 1;
            calls.push(["open", nextId, target]);
            return nextId;
        },
        load: (id, url) => void calls.push(["load", id, url]),
        commitClose: (id) => void calls.push(["commitClose", id]),
        askPage: (id, generation, reason) => void calls.push(["askPage", id, generation, reason]),
        endAsk: (id, generation) => void calls.push(["endAsk", id, generation]),
        showNotResponding: (id) => void calls.push(["showNotResponding", id]),
        closeNotResponding: (id) => void calls.push(["closeNotResponding", id]),
    };
    const events: string[] = [];
    const coordinator = new WindowCoordinator({port, clock, onQuit: () => events.push("quit"), onAllClosed: () => events.push("all-closed")});
    if (options.ready ?? true) coordinator.serverReady("http://127.0.0.1:4217/", options.owned ?? true);
    /** 最近一次对这个窗口的询问。 */
    const lastAsk = (id: WindowId) => calls.filter((call): call is ["askPage", WindowId, number, CloseReason] => call[0] === "askPage" && call[1] === id).at(-1);
    const did = (name: Call[0], id: WindowId) => calls.some((call) => call[0] === name && call[1] === id);
    return {coordinator, calls, events, advance, lastAsk, did};
}

describe("关窗协调", () => {
    it("两个窗口：关第一个以 window 询问，同意就关、不停服务；关最后一个以 quit 询问，同意时进入停止中", () => {
        const {coordinator, events, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.closeRequested(a);
        const askA = lastAsk(a);
        expect(askA?.[3]).toBe("window");
        coordinator.pageAcked(a, askA?.[2] ?? 0);
        coordinator.pageAnswered(a, askA?.[2] ?? 0, "allow");
        expect(did("commitClose", a)).toBe(true);
        expect(events).toEqual([]);
        coordinator.closed(a);

        coordinator.closeRequested(b);
        const askB = lastAsk(b);
        expect(askB?.[3]).toBe("quit");
        coordinator.pageAnswered(b, askB?.[2] ?? 0, "allow");
        expect(events).toEqual(["quit"]);
        expect(did("commitClose", b)).toBe(true);
        coordinator.closed(b);
        expect(events).toEqual(["quit", "all-closed"]);
    });

    it("页面回 deny：窗口照旧；迟到、过期代次的回答被丢弃", () => {
        const {coordinator, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        coordinator.openWindow();
        coordinator.closeRequested(a);
        const first = lastAsk(a)?.[2] ?? 0;
        coordinator.pageAnswered(a, first, "deny");
        expect(did("commitClose", a)).toBe(false);
        coordinator.closeRequested(a);
        const second = lastAsk(a)?.[2] ?? 0;
        expect(second).toBeGreaterThan(first);
        coordinator.pageAnswered(a, first, "allow");
        expect(did("commitClose", a)).toBe(false);
        coordinator.pageAnswered(a, second, "allow");
        expect(did("commitClose", a)).toBe(true);
    });

    it("3 秒内没有接下：弹没有响应的对话框；继续等待再等 3 秒；取消关闭结束代次、通知页面；强制关闭就关", () => {
        const {coordinator, calls, events, advance, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        coordinator.closeRequested(a);
        const generation = lastAsk(a)?.[2] ?? 0;
        advance(ACK_MS - 1);
        expect(did("showNotResponding", a)).toBe(false);
        advance(1);
        expect(did("showNotResponding", a)).toBe(true);
        coordinator.dialogChose(a, "wait");
        advance(ACK_MS);
        expect(calls.filter((call) => call[0] === "showNotResponding")).toHaveLength(2);
        coordinator.dialogChose(a, "cancel");
        expect(calls).toContainEqual(["endAsk", a, generation]);
        coordinator.pageAnswered(a, generation, "allow");
        expect(did("commitClose", a)).toBe(false);

        coordinator.closeRequested(a);
        advance(ACK_MS);
        coordinator.dialogChose(a, "force");
        expect(did("commitClose", a)).toBe(true);
        expect(events).toEqual(["quit"]);
    });

    it("接下之后不限时；再次关这个窗口才弹对话框，继续等待不重置已接下的询问", () => {
        const {coordinator, calls, advance, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        coordinator.closeRequested(a);
        const generation = lastAsk(a)?.[2] ?? 0;
        coordinator.pageAcked(a, generation);
        advance(60_000);
        expect(did("showNotResponding", a)).toBe(false);
        coordinator.closeRequested(a);
        expect(did("showNotResponding", a)).toBe(true);
        coordinator.dialogChose(a, "wait");
        advance(60_000);
        expect(calls.filter((call) => call[0] === "showNotResponding")).toHaveLength(1);
        coordinator.pageAnswered(a, generation, "allow");
        expect(did("commitClose", a)).toBe(true);
    });

    it("两个询问重叠：先关掉的那个让另一个成了最后一个，它以 window 回答后改以 quit 重问一次", () => {
        const {coordinator, events, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.closeRequested(a);
        coordinator.closeRequested(b);
        const askA = lastAsk(a);
        const askB = lastAsk(b);
        expect([askA?.[3], askB?.[3]]).toEqual(["window", "window"]);
        coordinator.pageAnswered(a, askA?.[2] ?? 0, "allow");
        coordinator.pageAnswered(b, askB?.[2] ?? 0, "allow");
        expect(did("commitClose", b)).toBe(false);
        const requeried = lastAsk(b);
        expect(requeried?.[3]).toBe("quit");
        coordinator.pageAnswered(b, requeried?.[2] ?? 0, "allow");
        expect(did("commitClose", b)).toBe(true);
        expect(events).toEqual(["quit"]);
    });

    it("最后一次关闭进行中：开窗转交回 closing、页面的新窗口被拒；取消后再开；同意之后回 stopping", () => {
        const {coordinator, lastAsk} = harness();
        const a = coordinator.openWindow();
        coordinator.closeRequested(a);
        expect(coordinator.openWindowRequested()).toEqual({ok: false, code: "closing"});
        expect(coordinator.pageWindowRequested("http://127.0.0.1:4217/?project=a")).toBe(false);
        coordinator.pageAnswered(a, lastAsk(a)?.[2] ?? 0, "deny");
        expect(coordinator.openWindowRequested()).toEqual({ok: true});
        expect(coordinator.windowCount).toBe(2);

        const {coordinator: second, lastAsk: secondAsk} = harness();
        const only = second.openWindow();
        second.closeRequested(only);
        second.pageAnswered(only, secondAsk(only)?.[2] ?? 0, "allow");
        expect(second.openWindowRequested()).toEqual({ok: false, code: "stopping"});
    });

    it("服务端不归壳：关最后一个以 window 询问，不停服务；只有启动页的窗口直接关", () => {
        const {coordinator, events, lastAsk} = harness({owned: false});
        const a = coordinator.openWindow();
        coordinator.closeRequested(a);
        expect(lastAsk(a)?.[3]).toBe("window");
        coordinator.pageAnswered(a, lastAsk(a)?.[2] ?? 0, "allow");
        coordinator.closed(a);
        expect(events).toEqual(["all-closed"]);

        const {coordinator: starting, did, events: startingEvents} = harness({ready: false});
        const s = starting.openWindow();
        starting.closeRequested(s);
        expect(did("askPage", s)).toBe(false);
        expect(did("commitClose", s)).toBe(true);
        starting.closed(s);
        expect(startingEvents).toEqual(["all-closed"]);
    });

    it("启动中开的窗口在服务端就绪后加载页面；询问中窗口被关掉，询问作废、页面得到结束通知", () => {
        const {coordinator, calls, lastAsk} = harness({ready: false});
        const a = coordinator.openWindow();
        coordinator.serverReady("http://127.0.0.1:4217/", true);
        expect(calls).toContainEqual(["load", a, "http://127.0.0.1:4217/"]);
        coordinator.openWindow();
        coordinator.closeRequested(a);
        const generation = lastAsk(a)?.[2] ?? 0;
        coordinator.closed(a);
        expect(calls).toContainEqual(["endAsk", a, generation]);
    });
});
