/**
 * 关窗协调（docs/specs/runtime/desktop-shell.md 输出 9、14 到 17、23）。端口替身按 Electrobun 的顺序派发：`closeRequested`
 * 之前 `will-close` 已否决；`commitClose` 之后窗口要等测试送 `closed` 才没。时钟是手动的。
 */

import {describe, expect, it} from "bun:test";

import type {UpdateHint} from "../shared/desktop-bridge";
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
    | ["closeNotResponding", WindowId]
    | ["sendHint", WindowId, number, UpdateHint]
    | ["endHint", WindowId, number];

function harness(options: {owned?: boolean; ready?: boolean} = {}) {
    let now = 0;
    const timers = new Set<{due: number; callback: () => void}>();
    const clock: DeadlineClock = {
        now: () => now,
        schedule(callback, ms) {
            const timer = {due: now + ms, callback};
            timers.add(timer);
            return () => void timers.delete(timer);
        },
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
        sendHint: (id, hintId, hint) => void calls.push(["sendHint", id, hintId, hint]),
        endHint: (id, hintId) => void calls.push(["endHint", id, hintId]),
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

    it("应用级退出请求：两个窗口各自以 window 询问，都同意后最后一个改以 quit 重问一次，同意时进入停止中", () => {
        const {coordinator, events, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.quitRequested();
        const askA = lastAsk(a);
        const askB = lastAsk(b);
        expect([askA?.[3], askB?.[3]]).toEqual(["window", "window"]);
        coordinator.pageAnswered(a, askA?.[2] ?? 0, "allow");
        expect(did("commitClose", a)).toBe(true);
        coordinator.closed(a);
        coordinator.pageAnswered(b, askB?.[2] ?? 0, "allow");
        const requeried = lastAsk(b);
        expect(requeried?.[3]).toBe("quit");
        coordinator.pageAnswered(b, requeried?.[2] ?? 0, "allow");
        expect(did("commitClose", b)).toBe(true);
        expect(events).toEqual(["quit"]);
    });

    it("应用级退出请求：一个页面回 deny 时它照旧开着、应用继续运行；只有启动页的窗口直接关；已在问的窗口不弹没有响应", () => {
        const {coordinator, calls, events, lastAsk, did} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.quitRequested();
        coordinator.quitRequested();
        expect(did("showNotResponding", a)).toBe(false);
        expect(calls.filter((call) => call[0] === "askPage")).toHaveLength(2);
        coordinator.pageAnswered(a, lastAsk(a)?.[2] ?? 0, "deny");
        coordinator.pageAnswered(b, lastAsk(b)?.[2] ?? 0, "allow");
        coordinator.closed(b);
        expect(did("commitClose", a)).toBe(false);
        expect(coordinator.windowCount).toBe(1);
        expect(events).toEqual([]);
        expect(coordinator.openWindowRequested()).toEqual({ok: true});

        const {coordinator: starting, did: startingDid} = harness({ready: false});
        const s = starting.openWindow();
        starting.quitRequested();
        expect(startingDid("askPage", s)).toBe(false);
        expect(startingDid("commitClose", s)).toBe(true);
    });

    it("应用级退出请求：停止中再来的退出请求不再询问、不再提交关闭", () => {
        const {coordinator, calls, events, lastAsk} = harness();
        const a = coordinator.openWindow();
        coordinator.quitRequested();
        coordinator.pageAnswered(a, lastAsk(a)?.[2] ?? 0, "allow");
        expect(events).toEqual(["quit"]);
        const before = calls.length;
        coordinator.quitRequested();
        expect(calls).toHaveLength(before);
        expect(events).toEqual(["quit"]);
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

describe("更新提示的交付（desktop-update 输出 3、4）", () => {
    const HINT = {id: 1, hint: {kind: "available", version: "0.90.2"}} as const;
    const hintCalls = (calls: Call[]) => calls.filter((call) => call[0] === "sendHint" || call[0] === "endHint");

    it("交给最近获得焦点的就绪窗口；没有就绪窗口时等，第一个就绪的接手", () => {
        const {coordinator, calls} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.setUpdateHint(HINT, false);
        expect(hintCalls(calls)).toEqual([]);
        coordinator.focused(a);
        coordinator.pageReady(a);
        expect(hintCalls(calls)).toEqual([["sendHint", a, 1, HINT.hint]]);
        // b 后来就绪、也获得了焦点，但 a 已经持有：新开窗口不夺走提示。
        coordinator.focused(b);
        coordinator.pageReady(b);
        expect(hintCalls(calls)).toHaveLength(1);
        // 下一条提示（新阶段）交给此时最近焦点的 b，并让 a 收起旧的。
        coordinator.setUpdateHint({id: 2, hint: {kind: "downloading", version: "0.90.2"}}, true);
        expect(hintCalls(calls).slice(1)).toEqual([
            ["endHint", a, 1],
            ["sendHint", b, 2, {kind: "downloading", version: "0.90.2"}],
        ]);
    });

    it("持有窗口关掉时转给最近焦点的就绪窗口（正在关的不选、已关的不发收起）", () => {
        const {coordinator, calls, lastAsk} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        const c = coordinator.openWindow();
        for (const id of [c, b, a]) {
            coordinator.focused(id);
            coordinator.pageReady(id);
        }
        coordinator.setUpdateHint(HINT, false);
        expect(hintCalls(calls)).toEqual([["sendHint", a, 1, HINT.hint]]);
        // b 正在关（已同意、还没 closed），a 关掉：转给 c。
        coordinator.closeRequested(b);
        coordinator.pageAnswered(b, lastAsk(b)?.[2] ?? 0, "allow");
        coordinator.closeRequested(a);
        coordinator.pageAnswered(a, lastAsk(a)?.[2] ?? 0, "allow");
        expect(hintCalls(calls).slice(1)).toEqual([["sendHint", c, 1, HINT.hint]]);
    });

    it("持有窗口刷新（又报一次就绪）：转给当时最近焦点的就绪窗口，可能还是它自己", () => {
        const {coordinator, calls} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.focused(b);
        coordinator.pageReady(b);
        coordinator.focused(a);
        coordinator.pageReady(a);
        coordinator.setUpdateHint(HINT, false);
        coordinator.pageReady(a);
        expect(hintCalls(calls)).toEqual([
            ["sendHint", a, 1, HINT.hint],
            ["sendHint", a, 1, HINT.hint],
        ]);
        coordinator.focused(b);
        coordinator.pageReady(a);
        // 刷新后的页面里没有旧的那条，不发收起。
        expect(hintCalls(calls).slice(2)).toEqual([["sendHint", b, 1, HINT.hint]]);
    });

    it("持有窗口离开就绪：让它收起，转给别的就绪窗口；都不就绪时等，回来就绪再交", () => {
        const {coordinator, calls} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.focused(a);
        coordinator.pageReady(a);
        coordinator.pageReady(b);
        coordinator.setUpdateHint(HINT, false);
        coordinator.pageGone(a);
        expect(hintCalls(calls)).toEqual([
            ["sendHint", a, 1, HINT.hint],
            ["endHint", a, 1],
            ["sendHint", b, 1, HINT.hint],
        ]);
        coordinator.pageGone(b);
        expect(hintCalls(calls).slice(3)).toEqual([["endHint", b, 1]]);
        coordinator.pageReady(a);
        expect(hintCalls(calls).slice(4)).toEqual([["sendHint", a, 1, HINT.hint]]);
    });

    it("提示被用户结束（清掉、不收起）后，窗口的就绪变化不再交", () => {
        const {coordinator, calls} = harness();
        const a = coordinator.openWindow();
        coordinator.pageReady(a);
        coordinator.setUpdateHint(HINT, false);
        coordinator.setUpdateHint(null, false);
        coordinator.pageReady(a);
        coordinator.pageGone(a);
        expect(hintCalls(calls)).toEqual([["sendHint", a, 1, HINT.hint]]);
    });

    it("启动页窗口不算就绪；停止中不再交", () => {
        const {coordinator, calls, lastAsk} = harness({ready: false});
        const s = coordinator.openWindow();
        coordinator.pageReady(s);
        coordinator.setUpdateHint(HINT, false);
        expect(hintCalls(calls)).toEqual([]);
        coordinator.serverReady("http://127.0.0.1:4217/", true);
        coordinator.closeRequested(s);
        coordinator.pageAnswered(s, lastAsk(s)?.[2] ?? 0, "allow");
        coordinator.pageReady(s);
        expect(hintCalls(calls)).toEqual([]);
    });
});
