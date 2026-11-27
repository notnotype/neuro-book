import {describe, expect, it} from "bun:test";

import {DRAG_GESTURE_DEFAULTS, createDragGesture, defineDropKind, edgeScrollStep, scrollOriginReversed} from "./drag-gesture";
import type {DragCancelReason, DragClock, DragEnd, DragGesture, DragGestureHost, DragScrollTarget, DragState, DragStops} from "./drag-gesture";
import type {GridDropPoint} from "./grid-drop";

/**
 * 手势状态机的判断（docs/specs/ui/layout-drag.md）：门槛、帧合并、放下比较、取消、收场顺序、边缘滚动与键盘。时钟由测试
 * 推进，不等真实时间。真实浏览器里的捕获与焦点时序在 `e2e/lab-drag-session.e2e.ts`。
 */

/** 手动时钟：`advance` 走定时器，`frame` 跑一帧。 */
function manualClock(): DragClock & {advance(ms: number): void; frame(): void; readonly pendingFrames: number} {
    let now = 0;
    let nextHandle = 1;
    const timers = new Map<number, {readonly at: number; readonly run: () => void}>();
    const frames = new Map<number, () => void>();
    return {
        delay(run, ms) {
            const handle = nextHandle++;
            timers.set(handle, {at: now + ms, run});
            return handle;
        },
        cancelDelay(handle) {
            timers.delete(handle as number);
        },
        requestFrame(run) {
            const handle = nextHandle++;
            frames.set(handle, run);
            return handle;
        },
        cancelFrame(handle) {
            frames.delete(handle as number);
        },
        advance(ms) {
            now += ms;
            for (const [handle, timer] of [...timers]) {
                if (timer.at > now) continue;
                timers.delete(handle);
                timer.run();
            }
        },
        frame() {
            const due = [...frames];
            frames.clear();
            for (const [, run] of due) run();
        },
        get pendingFrames() {
            return frames.size;
        },
    };
}

interface Drop {
    readonly name: string;
    /** 只显示、不提交的落点为 null。 */
    readonly key: string | null;
}

/** 指针按横坐标分区：x 小于 100 是 a，小于 200 是 b，小于 300 只显示不提交，其余没有落点。 */
function zoneAt(point: GridDropPoint): Drop | null {
    if (point.x < 100) return {name: "a", key: "a"};
    if (point.x < 200) return {name: "b", key: "b"};
    if (point.x < 300) return {name: "keep", key: null};
    return null;
}

type Region = "first" | "second";

function setup(overrides: Partial<DragGestureHost<string, Drop, Region>> = {}) {
    const clock = manualClock();
    const log: string[] = [];
    const published: Array<DragState<string, Drop> | null> = [];
    const commits: Array<{readonly drop: Drop; readonly source: string}> = [];
    const commitKeyboard: boolean[] = [];
    const ends: Array<{readonly end: DragEnd; readonly last: DragState<string, Drop>}> = [];
    let resolveCount = 0;
    const gesture: DragGesture<string> = createDragGesture<string, Drop, Region>({
        clock,
        resolve: ({point}) => {
            resolveCount++;
            return zoneAt(point);
        },
        actionKey: (drop) => drop.key,
        commit: (drop, source, keyboard) => {
            log.push("commit");
            commits.push({drop, source});
            commitKeyboard.push(keyboard);
        },
        publish: (state) => {
            if (state === null) log.push("publish-null");
            published.push(state);
        },
        ended: (end, last) => {
            log.push("ended");
            ends.push({end, last});
        },
        activeChanged: (active) => {
            log.push(active ? "active" : "inactive");
        },
        armed: () => log.push("armed"),
        disarmed: () => log.push("disarmed"),
        grabbed: () => {
            log.push("grabbed");
            return true;
        },
        released: () => log.push("released"),
        restoreFocus: () => log.push("focus"),
        ...overrides,
    });
    return {
        clock,
        gesture,
        log,
        published,
        commits,
        commitKeyboard,
        ends,
        resolveCount: () => resolveCount,
        last: () => published.at(-1) ?? null,
        /** 鼠标按下并移动过门槛，一场开始。 */
        grab(at: GridDropPoint = {x: 50, y: 50}) {
            gesture.press({pointerId: 1, pointerType: "mouse", point: {x: at.x - 10, y: at.y}, source: "row"});
            gesture.move(1, at, 1);
        },
    };
}

describe("输出 1：起拖门槛", () => {
    it("鼠标移动不到 6 px 不起拖，到 6 px 起拖", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.move(1, {x: 5, y: 0}, 1);
        expect(t.published).toEqual([]);
        t.gesture.move(1, {x: 6, y: 0}, 1);
        expect(t.last()?.source).toBe("row");
    });

    it("笔与鼠标同一个门槛，不走触摸的按住", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "pen", point: {x: 0, y: 0}, source: "row"});
        t.clock.advance(DRAG_GESTURE_DEFAULTS.touchDelayMs);
        expect(t.published).toEqual([]);
        t.gesture.move(1, {x: 6, y: 0}, 1);
        expect(t.last()).not.toBeNull();
    });

    it("没过门槛就松手：回到空闲，没有结束回调，之后的移动不起拖", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.release(1, {x: 1, y: 0});
        expect(t.gesture.idle).toBe(true);
        expect(t.log).toEqual(["armed", "disarmed"]);
        t.gesture.move(1, {x: 50, y: 0}, 1);
        expect(t.published).toEqual([]);
    });

    it("状态表：待起拖时收到 pointercancel，回到空闲，没有结束回调，之后的移动不起拖", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.pointerCancel(1);
        expect(t.gesture.idle).toBe(true);
        expect(t.ends).toEqual([]);
        expect(t.log).toEqual(["armed", "disarmed"]);
        t.gesture.move(1, {x: 50, y: 0}, 1);
        expect(t.published).toEqual([]);
    });

    it("触摸按住 200 毫秒起拖，坐标是抖动后的最后位置", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "touch", point: {x: 50, y: 50}, source: "row"});
        t.gesture.move(1, {x: 51, y: 50}, 1);
        t.clock.advance(199);
        expect(t.published).toEqual([]);
        t.clock.advance(1);
        expect(t.last()?.point).toEqual({x: 51, y: 50});
    });

    it("触摸先动了超过 6 px：放弃，让给滚动", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "touch", point: {x: 0, y: 0}, source: "row"});
        t.gesture.move(1, {x: 7, y: 0}, 1);
        t.clock.advance(1000);
        expect(t.published).toEqual([]);
        expect(t.gesture.idle).toBe(true);
    });

    it("待起拖时收到没有按键的移动（松手事件丢了）：放弃这次按下，不起一场没有按键的拖动", () => {
        const t = setup();
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.move(1, {x: 50, y: 0}, 0);
        expect(t.published).toEqual([]);
        expect(t.gesture.idle).toBe(true);
    });

    it("门槛可以由配置改", () => {
        const t = setup({config: {distancePx: 20}});
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.move(1, {x: 19, y: 0}, 1);
        expect(t.published).toEqual([]);
        t.gesture.move(1, {x: 20, y: 0}, 1);
        expect(t.last()).not.toBeNull();
    });

    it("别的指针的移动与松手不影响这一场", () => {
        const t = setup();
        t.grab();
        t.gesture.move(2, {x: 150, y: 0}, 1);
        t.gesture.release(2, {x: 150, y: 0});
        t.clock.frame();
        expect(t.last()?.drop?.name).toBe("a");
        expect(t.ends).toEqual([]);
    });
});

describe("输出 3：拿起", () => {
    it("立即按当前坐标发布第一次判定", () => {
        const t = setup();
        t.grab({x: 150, y: 10});
        expect(t.last()).toEqual({source: "row", point: {x: 150, y: 10}, drop: {name: "b", key: "b"}, keyboard: false});
    });

    it("activate 拿到按下处与过门槛时的位置", () => {
        const seen: unknown[] = [];
        const t = setup({activate: (_source, keyboard, at) => {
            seen.push({keyboard, at});
            return true;
        }});
        t.grab({x: 150, y: 10});
        expect(seen).toEqual([{keyboard: false, at: {pressed: {x: 140, y: 10}, point: {x: 150, y: 10}}}]);
    });

    it("activate 拒绝：不起拖，也不取捕获", () => {
        const t = setup({activate: () => false});
        t.grab();
        expect(t.log).toEqual(["armed", "disarmed"]);
        expect(t.gesture.idle).toBe(true);
    });

    it("取不到捕获：按失去捕获取消，反馈不留", () => {
        const t = setup({grabbed: () => false});
        t.grab();
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "capture-lost"}]);
        expect(t.last()).toBeNull();
        expect(t.gesture.idle).toBe(true);
    });
});

describe("输出 4：逐帧", () => {
    it("过门槛的那一下拿起时已经判定过，下一帧不再判定一次", () => {
        const t = setup();
        t.grab();
        const count = t.resolveCount();
        t.clock.frame();
        expect(t.resolveCount()).toBe(count);
    });

    it("一帧里的多次移动只判定并发布一次，用最后的坐标", () => {
        const t = setup();
        t.grab();
        const before = t.resolveCount();
        t.gesture.move(1, {x: 60, y: 0}, 1);
        t.gesture.move(1, {x: 70, y: 0}, 1);
        t.gesture.move(1, {x: 150, y: 0}, 1);
        expect(t.resolveCount()).toBe(before);
        t.clock.frame();
        expect(t.resolveCount()).toBe(before + 1);
        expect(t.last()?.point).toEqual({x: 150, y: 0});
    });
});

describe("flush：宿主这一帧要写 DOM，先做完判定", () => {
    it("有排着的发布时马上发布，这一帧不再发布第二次", () => {
        const t = setup();
        t.grab({x: 50, y: 10});
        t.gesture.move(1, {x: 150, y: 10}, 1);
        t.gesture.flush();
        expect(t.last()?.drop?.name).toBe("b");
        const count = t.published.length;
        t.clock.frame();
        expect(t.published.length).toBe(count);
    });

    it("没有排着的发布时什么都不做", () => {
        const t = setup();
        t.grab();
        const count = t.published.length;
        t.gesture.flush();
        expect(t.published.length).toBe(count);
    });
});

describe("输出 6：放下", () => {
    it("`commitsUnderPointer`：放下这一刻的动作和最后显示的不同，也提交这一刻的；键盘照旧要相同", () => {
        const t = setup({commitsUnderPointer: (keyboard) => !keyboard});
        t.grab({x: 50, y: 0});
        t.gesture.release(1, {x: 150, y: 0});
        expect(t.commits).toEqual([{drop: {name: "b", key: "b"}, source: "row"}]);
    });

    it("与最后显示过的动作相同：提交一次，结束为 committed", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        t.gesture.release(1, {x: 51, y: 0});
        expect(t.commits).toEqual([{drop: {name: "a", key: "a"}, source: "row"}]);
        expect(t.commitKeyboard).toEqual([false]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "committed"}]);
        expect(t.gesture.idle).toBe(true);
    });

    it("松手处的动作用户没看到过（移动后那一帧还没发布）：不提交", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        t.gesture.move(1, {x: 150, y: 0}, 1);
        t.gesture.release(1, {x: 150, y: 0});
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
    });

    it("只显示、不提交的落点与没有落点：不提交", () => {
        for (const x of [250, 350]) {
            const t = setup();
            t.grab({x, y: 0});
            t.gesture.release(1, {x, y: 0});
            expect(t.commits).toEqual([]);
            expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
        }
    });

    it("放下那次判定不发布，也不改掉最后显示过的动作", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        const shown = t.published.length;
        t.gesture.release(1, {x: 51, y: 0});
        expect(t.published.slice(shown)).toEqual([null]);
    });

    it("`commitsUnderPointer` 为真：落点撤下期间（输出 12）原地松手也不提交，结束为 no-action", () => {
        const t = setup({scroll: "withdraw", commitsUnderPointer: () => true});
        t.grab({x: 50, y: 0});
        t.gesture.scrolled();
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
    });

    it("`commitsUnderPointer` 为真：松手处的落点 `actionKey` 为 null（只显示）时不提交，结束为 no-action", () => {
        const t = setup({commitsUnderPointer: () => true});
        t.grab({x: 50, y: 0});
        t.gesture.release(1, {x: 250, y: 0});
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
    });

    it("一场只提交一次：放下之后再松手没有效果", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        t.gesture.release(1, {x: 50, y: 0});
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toHaveLength(1);
    });
});

describe("时序与寿命：收场顺序", () => {
    it("拆监听、状态置空、标记撤下、结束回调、提交", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        t.log.length = 0;
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.log).toEqual(["released", "publish-null", "inactive", "ended", "commit"]);
    });

    it("结束回调拿到最后发布的状态", () => {
        const t = setup();
        t.grab({x: 150, y: 3});
        t.gesture.cancel("escape");
        expect(t.ends[0]?.last).toEqual({source: "row", point: {x: 150, y: 3}, drop: {name: "b", key: "b"}, keyboard: false});
    });
});

describe("失败与恢复：`commit` 抛出", () => {
    it("异常从 release 抛出；抛出时一场已经收场（拆了监听、反馈撤下、回到空闲），下一场照常开始", () => {
        const t = setup({commit: () => {
            throw new Error("commit failed");
        }});
        t.grab({x: 50, y: 0});
        t.log.length = 0;
        expect(() => t.gesture.release(1, {x: 50, y: 0})).toThrow("commit failed");
        expect(t.gesture.idle).toBe(true);
        expect(t.log).toEqual(["released", "publish-null", "inactive", "ended"]);
        t.grab({x: 150, y: 0});
        expect(t.last()).toMatchObject({source: "row", drop: {name: "b"}});
    });
});

describe("输出 7：取消", () => {
    const reasons: DragCancelReason[] = ["escape", "pointer-cancel", "capture-lost", "blur", "hidden", "focus-left", "pressed-elsewhere", "disposed"];
    for (const reason of reasons) {
        it(`${reason}：不提交、撤下反馈、回到空闲`, () => {
            const t = setup();
            t.grab({x: 50, y: 0});
            t.gesture.cancel(reason);
            expect(t.commits).toEqual([]);
            expect(t.last()).toBeNull();
            expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason}]);
            expect(t.gesture.idle).toBe(true);
        });
    }

    it("pointercancel 经 pointerCancel 进来，只认这一场的指针", () => {
        const t = setup();
        t.grab();
        t.gesture.pointerCancel(2);
        expect(t.ends).toEqual([]);
        t.gesture.pointerCancel(1);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "pointer-cancel"}]);
    });

    it("取消是幂等的，只结束一次", () => {
        const t = setup();
        t.grab();
        t.gesture.cancel("escape");
        t.gesture.cancel("blur");
        expect(t.ends).toHaveLength(1);
    });

    it("取消后排着的那一帧不再发布", () => {
        const t = setup();
        t.grab();
        t.gesture.move(1, {x: 150, y: 0}, 1);
        t.gesture.cancel("blur");
        const count = t.published.length;
        t.clock.frame();
        expect(t.published).toHaveLength(count);
    });

    it("abort：收场但不回调结束", () => {
        const t = setup();
        t.grab();
        t.gesture.abort();
        expect(t.ends).toEqual([]);
        expect(t.last()).toBeNull();
        expect(t.gesture.idle).toBe(true);
    });

    it("dispose：取消进行中的一场；待起拖时的定时器作废", () => {
        const active = setup();
        active.grab();
        active.gesture.dispose();
        expect(active.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "disposed"}]);

        const armed = setup();
        armed.gesture.press({pointerId: 1, pointerType: "touch", point: {x: 0, y: 0}, source: "row"});
        armed.gesture.dispose();
        armed.clock.advance(1000);
        expect(armed.published).toEqual([]);
    });
});

describe("输出 8：结构键", () => {
    it("结构变了：下一次判定时取消，不提交", () => {
        let structure = "s1";
        const t = setup({structure: () => structure});
        t.grab();
        structure = "s2";
        t.gesture.move(1, {x: 60, y: 0}, 1);
        t.clock.frame();
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "structure-changed"}]);
    });

    it("结构在最后一帧之后才变：放下时比较，不提交", () => {
        let structure = "s1";
        const t = setup({structure: () => structure});
        t.grab({x: 50, y: 0});
        structure = "s2";
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "structure-changed"}]);
    });

    it("结构不变：照常放下", () => {
        const t = setup({structure: () => "same"});
        t.grab({x: 50, y: 0});
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toHaveLength(1);
    });
});

describe("输出 9：吞掉 click", () => {
    it("指针拖动结束后吞一次指针 click，再来的不吞", () => {
        const t = setup();
        t.grab();
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.gesture.takeClick(1)).toBe(true);
        expect(t.gesture.takeClick(1)).toBe(false);
    });

    it("键盘触发的 click（detail 为 0）不吞，标记留着", () => {
        const t = setup();
        t.grab();
        t.gesture.cancel("escape");
        expect(t.gesture.takeClick(0)).toBe(false);
        expect(t.gesture.takeClick(1)).toBe(true);
    });

    it("下一次按下清掉标记", () => {
        const t = setup();
        t.grab();
        t.gesture.cancel("escape");
        t.gesture.pressed();
        expect(t.gesture.takeClick(1)).toBe(false);
    });

    it("没过门槛的按下不吞 click", () => {
        const t = setup();
        t.gesture.pressed();
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "row"});
        t.gesture.release(1, {x: 0, y: 0});
        expect(t.gesture.takeClick(1)).toBe(false);
    });
});

describe("输出 10：按键归属", () => {
    it("指针拖动里方向键等归会话但没有动作，Escape 取消", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        const count = t.published.length;
        for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", "Enter", " ", "Home", "End"]) {
            expect(t.gesture.key({key, shift: false})).toBe(true);
        }
        expect(t.published).toHaveLength(count);
        expect(t.ends).toEqual([]);
        expect(t.gesture.key({key: "Escape", shift: false})).toBe(true);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "escape"}]);
    });

    it("别的键不归会话；空闲时什么键都不归", () => {
        const t = setup();
        expect(t.gesture.key({key: "ArrowLeft", shift: false})).toBe(false);
        t.grab();
        expect(t.gesture.key({key: "a", shift: false})).toBe(false);
    });
});

describe("输出 12：滚动与窗口尺寸", () => {
    it("reevaluate：按当前坐标重判，内容变了落点跟着变", () => {
        let zone: Drop = {name: "a", key: "a"};
        const t = setup({resolve: () => zone});
        t.grab();
        zone = {name: "b", key: "b"};
        t.gesture.scrolled();
        t.clock.frame();
        expect(t.last()?.drop?.name).toBe("b");
    });

    it("withdraw：撤下落点，这期间放下不提交", () => {
        const t = setup({scroll: "withdraw"});
        t.grab({x: 50, y: 0});
        t.gesture.scrolled();
        expect(t.last()?.drop).toBeNull();
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
    });

    it("withdraw：指针再动就恢复，之后放下照常提交", () => {
        const t = setup({scroll: "withdraw"});
        t.grab({x: 50, y: 0});
        t.gesture.scrolled();
        t.gesture.move(1, {x: 51, y: 0}, 1);
        t.clock.frame();
        expect(t.last()?.drop?.name).toBe("a");
        t.gesture.release(1, {x: 51, y: 0});
        expect(t.commits).toHaveLength(1);
    });

    it("withdraw：撤下时排着的那一帧作废，不把落点又显示出来", () => {
        const t = setup({scroll: "withdraw"});
        t.grab({x: 50, y: 0});
        t.gesture.move(1, {x: 60, y: 0}, 1);
        t.gesture.scrolled();
        t.clock.frame();
        expect(t.last()?.drop).toBeNull();
    });

    it("窗口尺寸变化一律重判，withdraw 也不撤下", () => {
        const t = setup({scroll: "withdraw"});
        t.grab({x: 50, y: 0});
        const before = t.resolveCount();
        t.gesture.resized();
        t.clock.frame();
        expect(t.resolveCount()).toBe(before + 1);
        expect(t.last()?.drop?.name).toBe("a");
    });
});

describe("输出 13：撤下", () => {
    it("invalidate 与 withdraw 的撤下相同", () => {
        const t = setup();
        t.grab({x: 50, y: 0});
        t.gesture.invalidate();
        expect(t.last()?.drop).toBeNull();
        t.gesture.release(1, {x: 50, y: 0});
        expect(t.commits).toEqual([]);
    });
});

describe("输出 14：边缘滚动", () => {
    const rect = {left: 0, right: 100, top: 0, bottom: 200};

    it("步进：离边缘越近越快，越过边缘是最快；范围外与中段不滚", () => {
        expect(edgeScrollStep(rect, {x: 50, y: 100}, "y")).toBe(0);
        expect(edgeScrollStep(rect, {x: 150, y: 195}, "y")).toBe(0);
        expect(edgeScrollStep(rect, {x: 50, y: 188}, "y")).toBe(8);
        expect(edgeScrollStep(rect, {x: 50, y: 500}, "y")).toBe(16);
        expect(edgeScrollStep(rect, {x: 50, y: 12}, "y")).toBe(-8);
        expect(edgeScrollStep(rect, {x: 50, y: -50}, "y")).toBe(-16);
    });

    it("元素矮到两条边缘带相接时不滚", () => {
        expect(edgeScrollStep({left: 0, right: 100, top: 0, bottom: 48}, {x: 50, y: 1}, "y")).toBe(0);
    });

    it("横向同样：两端按离边的距离、越过一端最快；纵向范围外与中段不滚，窄到两条带相接不滚", () => {
        const strip = {left: 0, right: 200, top: 0, bottom: 32};
        expect(edgeScrollStep(strip, {x: 100, y: 16}, "x")).toBe(0);
        expect(edgeScrollStep(strip, {x: 188, y: 16}, "x")).toBe(8);
        expect(edgeScrollStep(strip, {x: 12, y: 16}, "x")).toBe(-8);
        expect(edgeScrollStep(strip, {x: 500, y: 16}, "x")).toBe(16);
        expect(edgeScrollStep(strip, {x: -50, y: 16}, "x")).toBe(-16);
        expect(edgeScrollStep(strip, {x: 195, y: 40}, "x")).toBe(0);
        // 32px 高的条竖向两条带相接：横向条不会竖着滚。
        expect(edgeScrollStep(strip, {x: 100, y: 2}, "y")).toBe(0);
        expect(edgeScrollStep({left: 0, right: 48, top: 0, bottom: 32}, {x: 1, y: 16}, "x")).toBe(0);
    });

    it("滚动位置是负值范围的轴：书写模式、方向与 flex 的反向组合，期望值是 Chrome 里实测的（往负方向能滚动）", () => {
        // [display, direction, writing-mode, flex-direction, flex-wrap] → 横、竖哪个轴的 scrollLeft、scrollTop 从 0 往负数走。
        const measured: ReadonlyArray<readonly [string, string, string, string, string, boolean, boolean]> = [
            ["block", "ltr", "horizontal-tb", "row", "nowrap", false, false],
            ["block", "rtl", "horizontal-tb", "row", "nowrap", true, false],
            ["flex", "ltr", "horizontal-tb", "row-reverse", "nowrap", true, false],
            ["flex", "ltr", "horizontal-tb", "column-reverse", "nowrap", false, true],
            ["flex", "rtl", "horizontal-tb", "row-reverse", "nowrap", false, false],
            ["flex", "rtl", "horizontal-tb", "column-reverse", "nowrap", true, true],
            ["flex", "ltr", "horizontal-tb", "row", "wrap-reverse", false, true],
            ["flex", "ltr", "horizontal-tb", "column", "wrap-reverse", true, false],
            ["block", "ltr", "vertical-rl", "row", "nowrap", true, false],
            ["block", "ltr", "vertical-lr", "row", "nowrap", false, false],
            ["block", "rtl", "vertical-rl", "row", "nowrap", true, true],
            ["block", "rtl", "vertical-lr", "row", "nowrap", false, true],
            ["block", "ltr", "sideways-rl", "row", "nowrap", true, false],
            ["block", "ltr", "sideways-lr", "row", "nowrap", false, true],
            ["flex", "ltr", "vertical-rl", "column-reverse", "nowrap", false, false],
            ["flex", "ltr", "vertical-lr", "row-reverse", "nowrap", false, true],
            ["grid", "rtl", "horizontal-tb", "row", "nowrap", true, false],
            ["inline-flex", "ltr", "horizontal-tb", "column-reverse", "nowrap", false, true],
        ];
        for (const [display, direction, writingMode, flexDirection, flexWrap, x, y] of measured) {
            expect({style: [display, direction, writingMode, flexDirection, flexWrap].join(" "), ...scrollOriginReversed({display, direction, writingMode, flexDirection, flexWrap})}).toEqual({style: [display, direction, writingMode, flexDirection, flexWrap].join(" "), x, y});
        }
    });

    const ROOM = {left: 1000, right: 1000, up: 1000, down: 1000};
    const NO_ROOM = {left: 0, right: 0, up: 0, down: 0};

    /** 一个容器替身：记下收到的每一步，有 `limit` 步可滚。 */
    function target(rectOf: {left: number; right: number; top: number; bottom: number}, room: DragScrollTarget["room"] = ROOM, limit = Infinity) {
        const steps: Array<{readonly x: number; readonly y: number}> = [];
        const value: DragScrollTarget = {
            rect: rectOf,
            room,
            scrollBy(x, y) {
                if (steps.length >= limit) return false;
                steps.push({x, y});
                return true;
            },
        };
        return {steps, target: value};
    }

    /** 一个有 `limit` 步可滚的竖向列表。 */
    function scroller(limit: number) {
        const list = target(rect, ROOM, limit);
        return {steps: list.steps, host: {targets: () => [list.target]}};
    }

    it("每一帧先判定发布，再滚；滚到头停下，指针再动：有余量就接着滚，没余量不滚", () => {
        let room: DragScrollTarget["room"] = ROOM;
        const steps: number[] = [];
        const order: string[] = [];
        const t = setup({
            autoScroll: {targets: () => [{
                rect,
                room,
                scrollBy: (_x, y) => {
                    order.push("scroll");
                    if (steps.length >= 2) return false;
                    steps.push(y);
                    return true;
                },
            }]},
            resolve: () => {
                order.push("resolve");
                return null;
            },
        });
        t.grab({x: 50, y: 195});
        order.length = 0;
        t.clock.frame();
        t.clock.frame();
        expect(order.slice(-4)).toEqual(["resolve", "scroll", "resolve", "scroll"]);
        t.clock.frame();
        expect(steps).toHaveLength(2);
        expect(t.clock.pendingFrames).toBe(0);
        t.gesture.move(1, {x: 50, y: 196}, 1);
        expect(t.clock.pendingFrames).toBeGreaterThan(0);
        t.clock.frame();
        room = {...ROOM, down: 0};
        order.length = 0;
        t.gesture.move(1, {x: 50, y: 197}, 1);
        t.clock.frame();
        t.clock.frame();
        expect(order).not.toContain("scroll");
    });

    it("最后一步滚到头、下一帧已挑不到容器：先按滚完的位置发布一次再停，指针不动松手照样提交", () => {
        // 列表还有一步可滚；这一步滚完余量为 0，指针下的行也换了。
        let room: DragScrollTarget["room"] = ROOM;
        let zone: Drop = {name: "before", key: "before"};
        const t = setup({
            autoScroll: {targets: () => [{
                rect,
                room,
                scrollBy: () => {
                    room = {...ROOM, down: 0};
                    zone = {name: "after", key: "after"};
                    return true;
                },
            }]},
            resolve: () => zone,
        });
        t.grab({x: 50, y: 195});
        t.clock.frame();
        expect(t.last()?.drop?.name).toBe("before");
        t.clock.frame();
        expect(t.last()?.drop?.name).toBe("after");
        expect(t.clock.pendingFrames).toBe(0);
        t.gesture.release(1, {x: 50, y: 195});
        expect(t.commits).toEqual([{drop: {name: "after", key: "after"}, source: "row"}]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "committed"}]);
    });

    it("两个轴各挑各的：里层只横向滚、外层只竖向滚时，角上两个都滚；里层这个方向没余量时交给外层；外层这个轴不让滚时不滚", () => {
        const corner = {x: 390, y: 5};
        const rowRect = {left: 0, right: 400, top: 0, bottom: 34};
        const listRect = {left: 0, right: 400, top: 0, bottom: 102};
        const row = target(rowRect, {...NO_ROOM, left: 100, right: 100});
        const list = target(listRect, {...NO_ROOM, up: 100, down: 100});
        const t = setup({autoScroll: {targets: () => [row.target, list.target]}});
        t.grab(corner);
        t.clock.frame();
        expect(row.steps).toEqual([{x: 10, y: 0}]);
        expect(list.steps).toEqual([{x: 0, y: -13}]);
        t.gesture.dispose();

        // 里层往右没余量了：横向交给外层（外层两个轴都让滚）。外层够高，指针在里层右端、离外层上下边都远。
        const tallRect = {left: 0, right: 400, top: 0, bottom: 300};
        const inRowRightEnd = {x: 390, y: 30};
        const endRow = target(rowRect, {...NO_ROOM, left: 100});
        const both = target(tallRect, ROOM);
        const chained = setup({autoScroll: {targets: () => [endRow.target, both.target]}});
        chained.grab(inRowRightEnd);
        chained.clock.frame();
        expect(endRow.steps).toEqual([]);
        expect(both.steps).toEqual([{x: 10, y: 0}]);
        chained.gesture.dispose();

        // 外层横向不让滚：不滚。
        const vertical = target(tallRect, {...NO_ROOM, up: 100, down: 100});
        const stopped = setup({autoScroll: {targets: () => [endRow.target, vertical.target]}});
        stopped.grab(inRowRightEnd);
        stopped.clock.frame();
        stopped.clock.frame();
        expect(endRow.steps).toEqual([]);
        expect(vertical.steps).toEqual([]);
    });

    it("两个轴都挑中、是同一个容器：一帧滚一次，两个方向都动", () => {
        const box = target({left: 0, right: 200, top: 0, bottom: 200});
        const t = setup({autoScroll: {targets: () => [box.target]}});
        t.grab({x: 190, y: 190});
        t.clock.frame();
        expect(box.steps).toEqual([{x: 10, y: 10}]);
    });

    it("候选每帧现取：指针不动，下一帧交回别的容器，就滚那一个", () => {
        const first = target(rect);
        const second = target(rect);
        let current = first.target;
        const t = setup({autoScroll: {targets: () => [current]}});
        t.grab({x: 50, y: 195});
        t.clock.frame();
        expect(first.steps).toHaveLength(1);
        current = second.target;
        t.clock.frame();
        expect(first.steps).toHaveLength(1);
        expect(second.steps).toHaveLength(1);
    });

    it("这个方向余量为 0 时，指针进边缘带也不滚", () => {
        const full = target(rect, {...ROOM, down: 0});
        const t = setup({autoScroll: {targets: () => [full.target]}});
        t.grab({x: 50, y: 195});
        t.gesture.move(1, {x: 50, y: 196}, 1);
        t.clock.frame();
        t.clock.frame();
        expect(full.steps).toEqual([]);
        expect(t.clock.pendingFrames).toBe(0);
    });

    it("自己滚出来的滚动不撤下落点", () => {
        const scroll = scroller(10);
        const t = setup({scroll: "withdraw", autoScroll: scroll.host});
        t.grab({x: 50, y: 195});
        t.clock.frame();
        t.gesture.scrolled();
        expect(t.last()?.drop?.name).toBe("a");
    });

    /** 滚动中松手：滚了几帧，落点因滚动变成 `after`。 */
    function scrollingDrag() {
        const scroll = scroller(100);
        let zone: Drop = {name: "before", key: "before"};
        const t = setup({scroll: "withdraw", autoScroll: scroll.host, resolve: () => zone});
        t.grab({x: 50, y: 195});
        t.clock.frame();
        zone = {name: "after", key: "after"};
        return {t, scroll};
    }

    it("滚动中松手：停滚，等下一帧，判定并发布一次，按这一次的落点放下", () => {
        const {t, scroll} = scrollingDrag();
        const steps = scroll.steps.length;
        t.gesture.release(1, {x: 50, y: 195});
        expect(t.commits).toEqual([]);
        expect(t.gesture.idle).toBe(false);
        t.clock.frame();
        expect(scroll.steps).toHaveLength(steps);
        expect(t.commits).toEqual([{drop: {name: "after", key: "after"}, source: "row"}]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "committed"}]);
        expect(t.published.at(-2)?.drop?.name).toBe("after");
    });

    it("滚动中松手：紧接着的失去捕获不算取消", () => {
        const {t} = scrollingDrag();
        t.gesture.release(1, {x: 50, y: 195});
        t.gesture.cancel("capture-lost");
        expect(t.ends).toEqual([]);
        t.clock.frame();
        expect(t.commits).toHaveLength(1);
    });

    it("滚动中松手：等下一帧时 Escape 仍然取消，不提交", () => {
        const {t} = scrollingDrag();
        t.gesture.release(1, {x: 50, y: 195});
        t.gesture.key({key: "Escape", shift: false});
        t.clock.frame();
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "cancelled", reason: "escape"}]);
    });

    it("滚动中松手：之后的移动不改放下的坐标（输出 6）", () => {
        const scroll = scroller(100);
        const t = setup({autoScroll: scroll.host});
        t.grab({x: 50, y: 195});
        t.clock.frame();
        t.gesture.release(1, {x: 50, y: 195});
        t.gesture.move(1, {x: 150, y: 195}, 0);
        t.clock.frame();
        expect(t.commits).toEqual([{drop: {name: "a", key: "a"}, source: "row"}]);
    });

    it("滚动中松手：最后一步滚动的滚动事件在放下之前到，不撤下落点", () => {
        const {t} = scrollingDrag();
        t.gesture.release(1, {x: 50, y: 195});
        t.gesture.scrolled();
        t.clock.frame();
        expect(t.commits).toEqual([{drop: {name: "after", key: "after"}, source: "row"}]);
    });

    it("滚动中松手：末尾的 click 在那一帧之前到，照样被吞", () => {
        const {t} = scrollingDrag();
        t.gesture.release(1, {x: 50, y: 195});
        expect(t.gesture.takeClick(1)).toBe(true);
    });
});

describe("输出 15：键盘拖动", () => {
    const STOPS: Readonly<Record<Region, DragStops>> = {
        first: {axis: "horizontal", points: [{x: 10, y: 0}, {x: 20, y: 0}, {x: 30, y: 0}]},
        second: {axis: "vertical", points: [{x: 110, y: 0}, {x: 110, y: 10}]},
    };

    function keyboardSetup(overrides: Partial<DragGestureHost<string, Drop, Region>> = {}, start: {readonly region: number; readonly at: number | GridDropPoint} = {region: 0, at: 0}) {
        const regions: Region[] = [];
        let regionsCalls = 0;
        const t = setup({
            keyboard: {
                regions: () => {
                    regionsCalls++;
                    return ["first", "second"];
                },
                stops: (region) => STOPS[region],
                start: () => start,
            },
            resolve: ({point, region}) => {
                if (region !== null) regions.push(region);
                return zoneAt(point);
            },
            ...overrides,
        });
        const press = (key: string, shift = false) => t.gesture.key({key, shift});
        return {...t, press, regions, regionsCalls: () => regionsCalls};
    }

    it("拿起停在起点，状态标明是键盘拖动；不取指针捕获", () => {
        const pointers: Array<number | null> = [];
        const t = keyboardSetup({grabbed: (pointerId) => {
            pointers.push(pointerId);
            return true;
        }});
        expect(t.gesture.startKeyboard("row")).toBe(true);
        expect(t.gesture.keyboard).toBe(true);
        expect(pointers).toEqual([null]);
        expect(t.last()).toMatchObject({point: {x: 10, y: 0}, keyboard: true});
    });

    it("输入 activate：键盘拿起时收到 keyboard 为真、at 为 null", () => {
        const seen: unknown[] = [];
        const t = keyboardSetup({activate: (_source, keyboard, at) => {
            seen.push({keyboard, at});
            return true;
        }});
        expect(t.gesture.startKeyboard("row")).toBe(true);
        expect(seen).toEqual([{keyboard: true, at: null}]);
    });

    it("状态表：区域列表只在拿起时取一次，Tab、方向键与放下都不再取", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.press("ArrowRight");
        t.press("Tab");
        t.press("ArrowDown");
        t.press("Tab", true);
        t.press("Enter");
        expect(t.ends).toHaveLength(1);
        expect(t.regionsCalls()).toBe(1);
    });

    it("Tab 与 Shift+Tab 循环区域，停在区域的第一个位置；判定拿到停在的区域", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.press("ArrowRight");
        t.press("Tab");
        expect(t.last()?.point).toEqual({x: 110, y: 0});
        expect(t.regions.at(-1)).toBe("second");
        t.press("Tab");
        expect(t.last()?.point).toEqual({x: 10, y: 0});
        expect(t.regions.at(-1)).toBe("first");
        t.press("Tab", true);
        expect(t.regions.at(-1)).toBe("second");
    });

    it("方向键只沿区域的轴移动，到头夹住", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.press("ArrowDown");
        expect(t.last()?.point).toEqual({x: 10, y: 0});
        t.press("ArrowRight");
        t.press("ArrowRight");
        t.press("ArrowRight");
        expect(t.last()?.point).toEqual({x: 30, y: 0});
        t.press("ArrowLeft");
        expect(t.last()?.point).toEqual({x: 20, y: 0});
    });

    it("轴为 both：ArrowDown 与 ArrowRight 都前进一格，ArrowUp 与 ArrowLeft 都后退一格", () => {
        const points = [{x: 10, y: 0}, {x: 20, y: 10}, {x: 30, y: 20}];
        const t = keyboardSetup({keyboard: {regions: () => ["first"], stops: () => ({axis: "both", points}), start: () => ({region: 0, at: 0})}});
        t.gesture.startKeyboard("row");
        t.press("ArrowDown");
        expect(t.last()?.point).toEqual(points[1]);
        t.press("ArrowRight");
        expect(t.last()?.point).toEqual(points[2]);
        t.press("ArrowUp");
        expect(t.last()?.point).toEqual(points[1]);
        t.press("ArrowLeft");
        expect(t.last()?.point).toEqual(points[0]);
    });

    it("起点可以是来源自己的坐标：直接 Enter 不移动；没提交也在下一帧还焦点", () => {
        const t = keyboardSetup({}, {region: 0, at: {x: 250, y: 0}});
        t.gesture.startKeyboard("row");
        expect(t.last()?.drop?.name).toBe("keep");
        t.log.length = 0;
        t.press("Enter");
        expect(t.commits).toEqual([]);
        expect(t.ends.map(({end}) => end)).toEqual([{kind: "no-action"}]);
        expect(t.log).not.toContain("focus");
        t.clock.frame();
        expect(t.log.at(-1)).toBe("focus");
    });

    it("Enter 按放下规则提交；焦点在下一帧还，不吞 click", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.log.length = 0;
        t.press("Enter");
        expect(t.commitKeyboard).toEqual([true]);
        expect(t.commits).toHaveLength(1);
        expect(t.log).not.toContain("focus");
        t.clock.frame();
        expect(t.log.at(-1)).toBe("focus");
        expect(t.gesture.takeClick(1)).toBe(false);
    });

    it("Escape 取消：不提交，焦点立即还", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.press("Escape");
        expect(t.commits).toEqual([]);
        expect(t.log.at(-1)).toBe("focus");
    });

    it("焦点移到根之外造成的取消与会话销毁不还焦点", () => {
        for (const reason of ["focus-left", "disposed"] as const) {
            const t = keyboardSetup();
            t.gesture.startKeyboard("row");
            t.gesture.cancel(reason);
            t.clock.frame();
            expect(t.log).not.toContain("focus");
        }
    });

    it("放下后、还焦点之前会话销毁：那一帧作废", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        t.press("Enter");
        t.gesture.dispose();
        t.clock.frame();
        expect(t.log).not.toContain("focus");
    });

    it("拿起后再按空格归会话，不做事", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        const count = t.published.length;
        expect(t.press(" ")).toBe(true);
        expect(t.published).toHaveLength(count);
    });

    it("没有区域、activate 拒绝或没配键盘：不拿起", () => {
        expect(keyboardSetup({keyboard: {regions: () => [], stops: (region) => STOPS[region], start: () => ({region: 0, at: 0})}}).gesture.startKeyboard("row")).toBe(false);
        expect(keyboardSetup({activate: () => false}).gesture.startKeyboard("row")).toBe(false);
        expect(setup().gesture.startKeyboard("row")).toBe(false);
    });

    it("键盘拖动进行中或待起拖时再按下、再拿起都被忽略", () => {
        const t = keyboardSetup();
        t.gesture.startKeyboard("row");
        expect(t.gesture.startKeyboard("row")).toBe(false);
        t.gesture.press({pointerId: 1, pointerType: "mouse", point: {x: 0, y: 0}, source: "other"});
        t.gesture.move(1, {x: 50, y: 0}, 1);
        expect(t.last()?.source).toBe("row");
    });
});

describe("落点种类", () => {
    it("defineDropKind 给出按 id 比较用的标识", () => {
        expect(defineDropKind<{readonly group: string}>("file").id).toBe("file");
    });
});
