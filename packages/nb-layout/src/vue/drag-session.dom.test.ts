import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import type {DragEnd} from "../drag-gesture";
import {createDragSession} from "./drag-session";
import type {DragKeyboardOptions, DragQuery, DragSession, DragSessionOptions} from "./drag-session";

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

function start(options: Partial<Omit<DragSessionOptions<string, Drop, string>, "root">> = {}): void {
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
    it("主键按下加移动过门槛：根取得捕获，发布第一次判定；指针拖动的判定 region 为 null", () => {
        start();
        grab();
        expect(session.state.value).toMatchObject({source: "row", point: {x: 10, y: 0}, drop: {key: "a"}, keyboard: false});
        expect(root.hasPointerCapture(1)).toBe(true);
        expect(queries.at(-1)?.region).toBeNull();
    });

    it("拿起时清掉已选中的文字", () => {
        start();
        const range = document.createRange();
        range.selectNodeContents(inner);
        document.getSelection()?.addRange(range);
        expect(document.getSelection()?.rangeCount).toBe(1);
        grab();
        expect(session.state.value).not.toBeNull();
        expect(document.getSelection()?.rangeCount).toBe(0);
    });

    it("来源元素在拖动中被卸载不算取消：之后的移动照常跟手，松手照常提交", async () => {
        start();
        grab();
        source.remove();
        root.dispatchEvent(pointer("pointermove", {clientX: 20, clientY: 0}));
        await vi.waitFor(() => expect(session.state.value?.point).toEqual({x: 20, y: 0}));
        expect(ends).toEqual([]);
        root.dispatchEvent(pointer("pointerup", {clientX: 20, clientY: 0, buttons: 0}));
        expect(commits).toEqual([{key: "a"}]);
        expect(ends).toEqual([{kind: "committed"}]);
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

    it("捕获取不到：setPointerCapture 报 NotFoundError 时按失去捕获取消，不把异常抛出", () => {
        Object.assign(root, {setPointerCapture: () => {
            throw new DOMException("指针已经不在", "NotFoundError");
        }});
        start();
        grab();
        expect(ends).toEqual([{kind: "cancelled", reason: "capture-lost"}]);
        expect(session.state.value).toBeNull();
    });

    it("捕获取不到：调用后 hasPointerCapture 为假时按失去捕获取消", () => {
        Object.assign(root, {hasPointerCapture: () => false});
        start();
        grab();
        expect(ends).toEqual([{kind: "cancelled", reason: "capture-lost"}]);
        expect(session.state.value).toBeNull();
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

describe("状态与转换：一场进行中的第二次按下", () => {
    it("指针拖动中第二根指针按下并移动被忽略：这一场不变、不结束，也不另起一场", async () => {
        start();
        grab();
        source.dispatchEvent(pointer("pointerdown", {pointerId: 2, clientX: 0, clientY: 0}));
        source.dispatchEvent(pointer("pointermove", {pointerId: 2, clientX: 50, clientY: 0}));
        // 第二根指针若起了一场会立即发布它的坐标；排在可能的重判后面的一帧跑完再看。
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(session.state.value).toMatchObject({source: "row", point: {x: 10, y: 0}, keyboard: false});
        expect(ends).toEqual([]);
        expect(root.hasPointerCapture(2)).toBe(false);
    });
});

describe("失败与恢复：`commit` 抛出", () => {
    it("异常冒出会话；抛出时一场已经收场：不留捕获与监听，下一场照常开始", () => {
        start({commit: () => {
            throw new Error("commit failed");
        }});
        const touch = (): boolean => !root.dispatchEvent(new Event("touchmove", {bubbles: true, cancelable: true}));
        grab();
        // happy-dom 把监听里的异常从 dispatchEvent 抛回；浏览器里它交给全局的错误报告，同样没有被会话吞掉。
        expect(() => source.dispatchEvent(pointer("pointerup", {clientX: 10, clientY: 0, buttons: 0}))).toThrow("commit failed");
        expect(ends).toEqual([{kind: "committed"}]);
        expect(session.state.value).toBeNull();
        expect(root.hasPointerCapture(1)).toBe(false);
        expect(touch()).toBe(false);
        grab();
        expect(session.state.value).toMatchObject({source: "row", keyboard: false});
        expect(root.hasPointerCapture(1)).toBe(true);
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

    it("根外面的滚动不算：排在它后面的一帧跑完时没有重新判定", async () => {
        start();
        grab();
        const count = queries.length;
        document.querySelector("#outside")?.dispatchEvent(new Event("scroll"));
        // 会话的重判排在 requestAnimationFrame 上；排在它后面的一帧跑完，排过的重判一定已经跑了。
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(queries.length).toBe(count);
    });

    it("窗口尺寸变化重新判定", async () => {
        start();
        grab();
        const count = queries.length;
        window.dispatchEvent(new Event("resize"));
        await vi.waitFor(() => expect(queries.length).toBe(count + 1));
    });
});

describe("输出 14：边缘滚动的容器与轴", () => {
    /**
     * 根里一个比内容窄的容器，指针（`grab` 停在 (10, 0)）在它右端的边缘带里、离上下边都远。happy-dom 不排版，矩形与滚动
     * 尺寸按实例定；计算样式读得到 `overflow-x`，`scrollBy` 会改 `scrollLeft`（不夹在最大值内，所以余量给足）。happy-dom 的计算样式
     * 不把简写 `overflow` 展开成两个轴，所以两个轴分开写；竖向一律 hidden，只看横向。
     */
    function container(overflowX: string): HTMLElement {
        const element = document.createElement("div");
        element.style.overflowX = overflowX;
        element.style.overflowY = "hidden";
        Object.defineProperty(element, "getBoundingClientRect", {configurable: true, value: () => ({left: -200, top: -50, right: 20, bottom: 50, width: 220, height: 100})});
        Object.defineProperty(element, "scrollWidth", {configurable: true, value: 1000});
        Object.defineProperty(element, "clientWidth", {configurable: true, value: 220});
        root.append(element);
        return element;
    }

    /** 让指针再动一下，等这一下的发布出来，再等一帧：排在它前面的边缘滚动帧一定已经跑过。 */
    async function settled(): Promise<void> {
        root.dispatchEvent(pointer("pointermove", {clientX: 11, clientY: 0}));
        await vi.waitFor(() => expect(session.state.value?.point).toEqual({x: 11, y: 0}));
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    it("`containers` 收到指针坐标与 `top`（跳过反馈元素）", () => {
        const strip = container("auto");
        const feedback = document.createElement("div");
        feedback.setAttribute("data-drag-feedback", "");
        document.body.append(feedback);
        hit = [feedback, strip];
        const asked: Array<{readonly point: {readonly x: number; readonly y: number}; readonly top: Element | null}> = [];
        start({autoScroll: {containers: (query) => {
            asked.push(query);
            return [];
        }}});
        grab();
        expect(asked.at(-1)).toEqual({point: {x: 10, y: 0}, top: strip});
    });

    it("`overflow-x: auto` 的容器，指针在右端带里：`scrollLeft` 逐帧变大", async () => {
        const strip = container("auto");
        start({autoScroll: {containers: () => [strip]}});
        grab();
        await vi.waitFor(() => expect(strip.scrollLeft).toBeGreaterThanOrEqual(20));
        expect(strip.scrollTop).toBe(0);
    });

    it("`overflow-x: hidden` 的容器，内容比它宽、指针在右端带里：`scrollLeft` 不变", async () => {
        const strip = container("hidden");
        start({autoScroll: {containers: () => [strip]}});
        grab();
        await settled();
        expect(strip.scrollLeft).toBe(0);
    });

    it("`containers` 交回空数组不滚", async () => {
        const strip = container("auto");
        start({autoScroll: {containers: () => []}});
        grab();
        await settled();
        expect(strip.scrollLeft).toBe(0);
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

    it("状态与转换：键盘拖动中在来源上按下再移过门槛，键盘拖动按 pressed-elsewhere 取消，同一次按下接着起一场指针拖动", () => {
        start({keyboard: keyboard()});
        press(" ");
        expect(session.state.value).toMatchObject({keyboard: true});
        grab();
        expect(ends).toEqual([{kind: "cancelled", reason: "pressed-elsewhere"}]);
        expect(session.state.value).toMatchObject({source: "row", point: {x: 10, y: 0}, keyboard: false});
        expect(root.hasPointerCapture(1)).toBe(true);
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
