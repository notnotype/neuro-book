/**
 * 关窗协调（docs/specs/runtime/desktop-shell.md 输出 9、14 到 17、23、29 到 31）。端口替身按 Electrobun 的顺序派发：`closeRequested`
 * 之前 `will-close` 已否决；`commitClose` 之后窗口要等测试送 `closed` 才没。时钟是手动的。
 */

import {describe, expect, it} from "bun:test";

import type {CloseLastWindow, UpdateHint} from "../shared/desktop-bridge";
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

function harness(options: {owned?: boolean; ready?: boolean; mode?: CloseLastWindow; trayShown?: boolean} = {}) {
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
    /** 设置与托盘图标的此刻状态：用例里直接改，协调器判断原因时现读。 */
    const shell = {mode: options.mode ?? "quit", trayShown: options.trayShown ?? true};
    const counts: number[] = [];
    const coordinator = new WindowCoordinator({
        port,
        clock,
        onQuit: () => events.push("quit"),
        onAllClosed: () => events.push("all-closed"),
        closeLastWindow: () => shell.mode,
        trayShown: () => shell.trayShown,
        onWindowsChanged: (count) => counts.push(count),
    });
    if (options.ready ?? true) coordinator.serverReady("http://127.0.0.1:4217/", options.owned ?? true);
    /** 最近一次对这个窗口的询问。 */
    const lastAsk = (id: WindowId) => calls.filter((call): call is ["askPage", WindowId, number, CloseReason] => call[0] === "askPage" && call[1] === id).at(-1);
    const did = (name: Call[0], id: WindowId) => calls.some((call) => call[0] === name && call[1] === id);
    return {coordinator, calls, events, advance, lastAsk, did, shell, counts};
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

        // 启动中（服务端还不归壳）：启动页直接关，关完照旧走 onAllClosed（壳据此结束启动流程），不进停止。
        const {coordinator: starting, did: startingDid, events: startingEvents} = harness({ready: false});
        const s = starting.openWindow();
        starting.quitRequested();
        expect(startingDid("askPage", s)).toBe(false);
        expect(startingDid("commitClose", s)).toBe(true);
        starting.closed(s);
        expect(startingEvents).toEqual(["all-closed"]);
        expect(starting.stopping).toBe(false);
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
        // 开它时没有别的窗口：加载启动时打开的路由（desktop-shell.md 输出 9）。
        expect(calls).toContainEqual(["load", a, "http://127.0.0.1:4217/api/nbook.projects/resume"]);
        coordinator.openWindow();
        coordinator.closeRequested(a);
        const generation = lastAsk(a)?.[2] ?? 0;
        coordinator.closed(a);
        expect(calls).toContainEqual(["endAsk", a, generation]);
    });
});

describe("启动时打开（desktop-shell.md 输出 9）", () => {
    const RESUME = "http://127.0.0.1:4217/api/nbook.projects/resume";
    const ROOT = "http://127.0.0.1:4217/";
    const opened = (calls: Call[]) => calls.filter((call) => call[0] === "open").map((call) => call[2]);

    it("没有窗口时开的第一个经路由进上次的作品；已有窗口时开窗转交开的是书架；有窗口时托盘置前、不开新的", () => {
        const {coordinator, calls} = harness();
        const first = coordinator.openWindow();
        expect(coordinator.openWindowRequested()).toEqual({ok: true});
        expect(opened(calls)).toEqual([{kind: "page", url: RESUME}, {kind: "page", url: ROOT}]);
        coordinator.closeRequested(first);
        expect(coordinator.openFromTray()).toMatchObject({focus: expect.any(Number)});
    });

    it("全部关掉（留在托盘）后，从托盘或 Dock 再开的也经路由", () => {
        const h = harness({mode: "tray"});
        const only = h.coordinator.openWindow();
        h.coordinator.closeRequested(only);
        h.coordinator.pageAnswered(only, h.lastAsk(only)?.[2] ?? 0, "allow");
        h.coordinator.closed(only);
        expect(h.coordinator.openFromTray()).toMatchObject({opened: expect.any(Number)});
        expect(opened(h.calls).at(-1)).toEqual({kind: "page", url: RESUME});
    });

    it("启动期间：第一个启动页就绪后经路由，启动期间转交来的再开的启动页加载根地址", () => {
        const {coordinator, calls} = harness({ready: false});
        const first = coordinator.openWindow();
        const second = coordinator.openWindow();
        coordinator.serverReady(ROOT, true);
        expect(calls).toContainEqual(["load", first, RESUME]);
        expect(calls).toContainEqual(["load", second, ROOT]);
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

    it("用户结束（“以后”）的带动作提示还留在中心里：下一个阶段到来时让那个窗口收起它；一次性通知显示后不收", () => {
        const {coordinator, calls} = harness();
        const a = coordinator.openWindow();
        const b = coordinator.openWindow();
        coordinator.focused(a);
        coordinator.pageReady(a);
        coordinator.pageReady(b);
        coordinator.setUpdateHint(HINT, false);
        coordinator.setUpdateHint(null, false);
        coordinator.focused(b);
        coordinator.setUpdateHint({id: 2, hint: {kind: "available", version: "0.90.3"}}, true);
        expect(hintCalls(calls)).toEqual([
            ["sendHint", a, 1, HINT.hint],
            ["endHint", a, 1],
            ["sendHint", b, 2, {kind: "available", version: "0.90.3"}],
        ]);

        const notice = harness();
        const c = notice.coordinator.openWindow();
        notice.coordinator.pageReady(c);
        notice.coordinator.setUpdateHint({id: 5, hint: {kind: "downloaded", version: "0.90.2"}}, true);
        notice.coordinator.setUpdateHint(null, false);
        notice.coordinator.setUpdateHint({id: 6, hint: {kind: "available", version: "0.90.3"}}, true);
        expect(hintCalls(notice.calls)).toEqual([
            ["sendHint", c, 5, {kind: "downloaded", version: "0.90.2"}],
            ["sendHint", c, 6, {kind: "available", version: "0.90.3"}],
        ]);
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

describe("托盘与后台（输出 29 到 31）", () => {
    /** 回答这个窗口最近一次的询问。 */
    const answer = (h: ReturnType<typeof harness>, id: WindowId, value: "allow" | "deny") => h.coordinator.pageAnswered(id, h.lastAsk(id)?.[2] ?? 0, value);

    it("设置是 tray：关最后一个窗口以 window 询问，同意后关掉、不停止；关完留在后台，不调 onAllClosed", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        expect(h.lastAsk(a)?.[3]).toBe("window");
        answer(h, a, "allow");
        expect(h.did("commitClose", a)).toBe(true);
        h.coordinator.closed(a);
        expect(h.events).toEqual([]);
        expect(h.counts).toEqual([1, 0]);
        expect(h.coordinator.stopping).toBe(false);
    });

    it("设置是 tray 而托盘图标没显示出来：按没有托盘，以 quit 询问、停止", () => {
        const h = harness({mode: "tray", trayShown: false});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        expect(h.lastAsk(a)?.[3]).toBe("quit");
        answer(h, a, "allow");
        expect(h.events).toEqual(["quit"]);
    });

    it("设置是 tray：没有响应时强制关闭最后一个窗口，照样进后台", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        h.advance(ACK_MS);
        expect(h.did("showNotResponding", a)).toBe(true);
        h.coordinator.dialogChose(a, "force");
        expect(h.did("commitClose", a)).toBe(true);
        h.coordinator.closed(a);
        expect(h.events).toEqual([]);
    });

    it("以 window 询问期间设置改成 quit：同意时改以 quit 重问一次，再同意才停止", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        h.shell.mode = "quit";
        answer(h, a, "allow");
        expect(h.lastAsk(a)?.[3]).toBe("quit");
        expect(h.did("commitClose", a)).toBe(false);
        answer(h, a, "allow");
        expect(h.events).toEqual(["quit"]);
    });

    it("以 quit 询问期间设置改成 tray：同意时照样停止；强制关闭也以 quit 提交", () => {
        const allowed = harness();
        const a = allowed.coordinator.openWindow();
        allowed.coordinator.closeRequested(a);
        allowed.shell.mode = "tray";
        answer(allowed, a, "allow");
        expect(allowed.events).toEqual(["quit"]);

        const forced = harness();
        const b = forced.coordinator.openWindow();
        forced.coordinator.closeRequested(b);
        forced.shell.mode = "tray";
        forced.advance(ACK_MS);
        forced.coordinator.dialogChose(b, "force");
        expect(forced.events).toEqual(["quit"]);
    });

    it("连别人的实例时设置是 tray：最后一个窗口以 window 关掉，关完照旧调 onAllClosed（壳退出，不留后台）", () => {
        const h = harness({mode: "tray", owned: false});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        answer(h, a, "allow");
        h.coordinator.closed(a);
        expect(h.events).toEqual(["all-closed"]);
    });

    it("应用级退出、设置是 tray、两个窗口：各自以 window 询问，最后一个改以 quit 重问，同意时停止", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        const b = h.coordinator.openWindow();
        h.coordinator.quitRequested();
        expect(h.lastAsk(a)?.[3]).toBe("window");
        expect(h.lastAsk(b)?.[3]).toBe("window");
        answer(h, a, "allow");
        h.coordinator.closed(a);
        answer(h, b, "allow");
        expect(h.lastAsk(b)?.[3]).toBe("quit");
        answer(h, b, "allow");
        expect(h.events).toEqual(["quit"]);
        h.coordinator.closed(b);
        expect(h.events).toEqual(["quit", "all-closed"]);
    });

    it("应用级退出进行中：开窗转交回 closing、页面的新窗口被拒、托盘打开不开窗；一个页面拒绝后退出结束，又能开窗", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.openWindow();
        h.coordinator.quitRequested();
        expect(h.coordinator.openWindowRequested()).toEqual({ok: false, code: "closing"});
        expect(h.coordinator.pageWindowRequested("http://127.0.0.1:4217/?project=a")).toBe(false);
        answer(h, a, "deny");
        expect(h.coordinator.openWindowRequested()).toEqual({ok: true});
        expect(h.events).toEqual([]);
    });

    it("应用级退出：“取消关闭”也结束这次退出；剩下的窗口之后照常以 window 关掉、进后台", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        const b = h.coordinator.openWindow();
        h.coordinator.quitRequested();
        h.coordinator.closeRequested(a);
        h.coordinator.dialogChose(a, "cancel");
        expect(h.coordinator.openWindowRequested()).toEqual({ok: true});
        answer(h, b, "allow");
        h.coordinator.closed(b);
        expect(h.events).toEqual([]);
    });

    it("应用级退出时剩下的窗口都已在关闭中（以 window 提交过）：最后一个关掉时停止", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        answer(h, a, "allow");
        expect(h.did("commitClose", a)).toBe(true);
        h.coordinator.quitRequested();
        expect(h.events).toEqual([]);
        h.coordinator.closed(a);
        expect(h.events).toEqual(["quit"]);
    });

    it("后台时：应用级退出直接停止；之后的开窗转交回 stopping、托盘打开无效；onQuit 只调一次", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        answer(h, a, "allow");
        h.coordinator.closed(a);
        expect(h.coordinator.quitFromTray()).toBe("check-work");
        h.coordinator.quitRequested();
        h.coordinator.quitRequested();
        expect(h.events).toEqual(["quit"]);
        expect(h.coordinator.openWindowRequested()).toEqual({ok: false, code: "stopping"});
        expect(h.coordinator.openFromTray()).toBeNull();
        expect(h.coordinator.quitFromTray()).toBe("stopping");
    });

    it("后台时开窗转交开一个窗口；托盘打开置前最近获得焦点的产品窗口，唯一的窗口在关闭中时开新的", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        h.coordinator.closeRequested(a);
        answer(h, a, "allow");
        h.coordinator.closed(a);
        expect(h.coordinator.openWindowRequested()).toEqual({ok: true});
        const b = h.calls.filter((call) => call[0] === "open").at(-1)?.[1] ?? 0;
        const c = h.coordinator.openWindow();
        h.coordinator.focused(c);
        h.coordinator.focused(b);
        expect(h.coordinator.openFromTray()).toEqual({focus: b});
        h.coordinator.closeRequested(b);
        answer(h, b, "allow");
        expect(h.coordinator.openFromTray()).toEqual({focus: c});
        h.coordinator.closeRequested(c);
        answer(h, c, "allow");
        const opened = h.coordinator.openFromTray();
        expect(opened).not.toBeNull();
        expect(opened !== null && "opened" in opened).toBe(true);
    });

    it("托盘退出：有窗口时就是应用级退出（每个窗口询问）", () => {
        const h = harness({mode: "tray"});
        const a = h.coordinator.openWindow();
        expect(h.coordinator.quitFromTray()).toBe("quitting");
        expect(h.lastAsk(a)?.[3]).toBe("quit");
        answer(h, a, "allow");
        expect(h.events).toEqual(["quit"]);
    });

    it("后台时服务端意外退出：选“稍后”时壳退出；对话框期间开了窗口再选“稍后”，不退出；之后关窗也不再停服务", () => {
        const background = harness({mode: "tray"});
        const a = background.coordinator.openWindow();
        background.coordinator.closeRequested(a);
        answer(background, a, "allow");
        background.coordinator.closed(a);
        background.coordinator.serverAbandoned();
        expect(background.events).toEqual(["all-closed"]);

        const reopened = harness({mode: "tray"});
        const b = reopened.coordinator.openWindow();
        reopened.coordinator.closeRequested(b);
        answer(reopened, b, "allow");
        reopened.coordinator.closed(b);
        expect(reopened.coordinator.openWindowRequested()).toEqual({ok: true});
        reopened.coordinator.serverAbandoned();
        expect(reopened.events).toEqual([]);
        const c = reopened.calls.filter((call) => call[0] === "open").at(-1)?.[1] ?? 0;
        reopened.coordinator.closeRequested(c);
        expect(reopened.lastAsk(c)?.[3]).toBe("window");
        answer(reopened, c, "allow");
        reopened.coordinator.closed(c);
        expect(reopened.events).toEqual(["all-closed"]);
    });
});
