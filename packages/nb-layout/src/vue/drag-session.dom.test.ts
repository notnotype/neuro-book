import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {DragEnd} from "../drag-gesture";
import {createDragSession} from "./drag-session";
import type {DragKeyboardOptions, DragQuery, DragSession} from "./drag-session";

/**
 * 会话的 DOM 适配里 happy-dom 看得到的部分（docs/specs/ui/layout-drag.md）：按下的归属、遮挡、取消的来源、按键拦截。
 * happy-dom 不派发 `lostpointercapture`，也没有 `elementsFromPoint`，所以这里手动派发、替换；浏览器真实的捕获与焦点时序
 * 只有 `e2e/lab-drag-session.e2e.ts` 能证明。
 */

type Drop = {readonly key: string};

let root: HTMLElement;
let source: HTMLElement;
let inner: HTMLElement;
let session: DragSession<string, Drop>;
let ends: DragEnd[];
let commits: Drop[];
let queries: Array<DragQuery<string, string>>;
let hit: Element[];

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
    return new PointerEvent(type, {bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: 1, ...init});
}

function start(options: {readonly keyboard?: DragKeyboardOptions<string, string>} = {}): void {
    session = createDragSession<string, Drop, string>({
        root,
        sourceAt: (target) => (target.closest("[data-source]") === null ? null : "row"),
        resolve: (query) => {
            queries.push(query);
            return {key: "a"};
        },
        actionKey: (drop) => drop.key,
        commit: (drop) => commits.push(drop),
        onEnd: (end) => ends.push(end),
        ...options,
    });
}

function grab(target: Element = source): void {
    target.dispatchEvent(pointer("pointerdown", {clientX: 0, clientY: 0}));
    target.dispatchEvent(pointer("pointermove", {clientX: 10, clientY: 0}));
}

beforeEach(() => {
    document.body.innerHTML = `<div id="root"><button data-source><span id="inner">标签</span></button><input id="field" /></div><input id="outside" />`;
    root = document.querySelector<HTMLElement>("#root") as HTMLElement;
    source = root.querySelector<HTMLElement>("[data-source]") as HTMLElement;
    inner = root.querySelector<HTMLElement>("#inner") as HTMLElement;
    ends = [];
    commits = [];
    queries = [];
    hit = [source];
    // happy-dom 没有这个方法；真实行为由 e2e 覆盖。
    Object.assign(document, {elementsFromPoint: () => hit});
});

afterEach(() => {
    session.dispose();
    document.body.innerHTML = "";
});

describe("输出 2、3：按下与拿起", () => {
    it("主键按下加移动过门槛：根取得捕获，发布第一次判定", () => {
        start();
        grab();
        expect(session.state.value).toMatchObject({source: "row", point: {x: 10, y: 0}, drop: {key: "a"}, keyboard: false});
        expect(root.hasPointerCapture(1)).toBe(true);
    });

    it("内层停止传播的按下不起拖（分隔线的命中带）", () => {
        start();
        source.addEventListener("pointerdown", (event) => event.stopPropagation());
        grab();
        expect(session.state.value).toBeNull();
    });

    it("非主键、非主指针、来源之外的按下不起拖", () => {
        start();
        source.dispatchEvent(pointer("pointerdown", {button: 2}));
        source.dispatchEvent(pointer("pointermove", {clientX: 10}));
        expect(session.state.value).toBeNull();
        source.dispatchEvent(pointer("pointerdown", {isPrimary: false}));
        source.dispatchEvent(pointer("pointermove", {clientX: 10}));
        expect(session.state.value).toBeNull();
        grab(root);
        expect(session.state.value).toBeNull();
    });
});

describe("输出 5：遮挡", () => {
    it("top 跳过反馈元素，取第一个业务元素", () => {
        start();
        const feedback = document.createElement("div");
        feedback.setAttribute("data-drag-feedback", "");
        const part = document.createElement("span");
        feedback.append(part);
        document.body.append(feedback);
        hit = [part, feedback, inner];
        grab();
        expect(queries.at(-1)?.top).toBe(inner);
    });

    it("指针处什么都没有（视口外）时 top 为 null", () => {
        start();
        hit = [];
        grab();
        expect(queries.at(-1)?.top).toBeNull();
    });
});

describe("输出 7：取消的来源", () => {
    it("根自己失去捕获才取消；旧元素上冒泡上来的那一次不算", () => {
        start();
        grab();
        inner.dispatchEvent(pointer("lostpointercapture"));
        expect(ends).toEqual([]);
        root.dispatchEvent(pointer("lostpointercapture"));
        expect(ends).toEqual([{kind: "cancelled", reason: "capture-lost"}]);
    });

    it("窗口失焦取消；页面里的元素失焦不算", () => {
        start();
        grab();
        root.querySelector("#field")?.dispatchEvent(new FocusEvent("blur"));
        expect(ends).toEqual([]);
        window.dispatchEvent(new FocusEvent("blur"));
        expect(ends).toEqual([{kind: "cancelled", reason: "blur"}]);
    });

    it("焦点进了根之外取消；根里面的不算", () => {
        start();
        grab();
        root.querySelector("#field")?.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        expect(ends).toEqual([]);
        document.querySelector("#outside")?.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        expect(ends).toEqual([{kind: "cancelled", reason: "focus-left"}]);
    });

    it("pointercancel 取消", () => {
        start();
        grab();
        source.dispatchEvent(pointer("pointercancel"));
        expect(ends).toEqual([{kind: "cancelled", reason: "pointer-cancel"}]);
    });

    it("销毁之后不再响应，进行中的一场按 disposed 取消", () => {
        start();
        grab();
        session.dispose();
        expect(ends).toEqual([{kind: "cancelled", reason: "disposed"}]);
        grab();
        expect(session.state.value).toBeNull();
        expect(ends).toHaveLength(1);
    });
});

describe("放下与 click", () => {
    it("松手提交，并吞掉末尾的指针 click；键盘触发的 click 不吞", () => {
        start();
        const clicks: number[] = [];
        source.addEventListener("click", (event) => clicks.push(event.detail));
        grab();
        source.dispatchEvent(pointer("pointerup", {clientX: 10, clientY: 0, buttons: 0}));
        expect(commits).toEqual([{key: "a"}]);
        expect(root.hasPointerCapture(1)).toBe(false);
        source.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 0}));
        source.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
        source.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1}));
        expect(clicks).toEqual([0, 1]);
    });
});

describe("输出 10、11：按键与触摸", () => {
    it("拖动中方向键内层收不到，别的键照常；结束后方向键恢复", () => {
        start();
        const keys: string[] = [];
        source.addEventListener("keydown", (event) => keys.push(event.key));
        grab();
        source.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        source.dispatchEvent(new KeyboardEvent("keydown", {key: "a", bubbles: true, cancelable: true}));
        expect(keys).toEqual(["a"]);
        source.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        expect(ends).toEqual([{kind: "cancelled", reason: "escape"}]);
        source.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        expect(keys).toEqual(["a", "ArrowRight"]);
    });

    it("拖动中阻止 touchmove 的默认动作，结束后不再阻止", () => {
        start();
        const touch = (): boolean => !root.dispatchEvent(new Event("touchmove", {bubbles: true, cancelable: true}));
        expect(touch()).toBe(false);
        grab();
        expect(touch()).toBe(true);
        session.abort();
        expect(touch()).toBe(false);
    });
});

describe("输出 12：滚动", () => {
    it("根里面（含后代）的滚动重新判定", async () => {
        start();
        grab();
        const count = queries.length;
        inner.dispatchEvent(new Event("scroll"));
        await vi.waitFor(() => expect(queries.length).toBe(count + 1));
    });
});

describe("输出 15：键盘拖动", () => {
    function keyboard(overrides: Partial<DragKeyboardOptions<string, string>> = {}): DragKeyboardOptions<string, string> {
        return {
            sourceAt: (target) => (target.hasAttribute("data-source") ? "row" : null),
            regions: () => ["only"],
            stops: () => ({axis: "horizontal", points: [{x: 1, y: 1}, {x: 2, y: 1}]}),
            start: () => ({region: 0, at: 0}),
            refocus: () => null,
            ...overrides,
        };
    }

    const press = (key: string, target: Element = source): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
        target.dispatchEvent(event);
        return event;
    };

    it("焦点在来源上按空格拿起，拦下这次按键与它的 keyup；不取捕获", () => {
        start({keyboard: keyboard()});
        const event = press(" ");
        expect(event.defaultPrevented).toBe(true);
        expect(session.state.value).toMatchObject({keyboard: true, point: {x: 1, y: 1}});
        expect(root.hasPointerCapture(1)).toBe(false);
        const up = new KeyboardEvent("keyup", {key: " ", bubbles: true, cancelable: true});
        source.dispatchEvent(up);
        expect(up.defaultPrevented).toBe(true);
    });

    it("来源里别的控件保留自己的空格", () => {
        start({keyboard: keyboard()});
        expect(press(" ", inner).defaultPrevented).toBe(false);
        expect(session.state.value).toBeNull();
    });

    it("没配键盘时空格不拿起", () => {
        start();
        expect(press(" ").defaultPrevented).toBe(false);
        expect(session.state.value).toBeNull();
    });

    it("Escape 把焦点还给拿起时的元素；它已被换掉时用 refocus 找", () => {
        const next = document.createElement("button");
        document.body.append(next);
        start({keyboard: keyboard({refocus: () => next})});
        source.focus();
        press(" ");
        (document.querySelector("#field") as HTMLElement).focus();
        press("Escape");
        expect(document.activeElement).toBe(source);

        press(" ");
        source.remove();
        press("Escape", root);
        expect(document.activeElement).toBe(next);
    });

    it("键盘拖动中有指针按下：取消", () => {
        start({keyboard: keyboard()});
        press(" ");
        root.dispatchEvent(pointer("pointerdown"));
        expect(ends).toEqual([{kind: "cancelled", reason: "pressed-elsewhere"}]);
    });
});

describe("输出 17：不画东西", () => {
    it("一场进行中不增删元素、不写标记", () => {
        start();
        const before = document.documentElement.outerHTML;
        grab();
        expect(session.state.value).not.toBeNull();
        expect(document.documentElement.outerHTML).toBe(before);
    });
});
