import {describe, expect, it} from "vitest";

import {moveGridFocus, moveTab, nextFocusStop} from "./grid-focus";
import type {GridFocusItems} from "./grid-focus";

/**
 * Tab 接管什么时候不介入（docs/specs/ui/nested-grid.md 的“Tab 顺序”）。`tabbable` 判可见性要真实布局，happy-dom 里没有，所以走到头
 * 之后的跳转由 e2e/lab-grid-structure.e2e.ts 验；这里只测不介入的分支，它们在查 `tabbable` 之前就返回。
 */

function setup(): {scope: GridFocusItems; button: HTMLElement} {
    document.body.innerHTML = `<div id="a"><button id="button">甲</button></div><div id="b"><button>乙</button></div>`;
    const a = document.getElementById("a") as HTMLElement;
    const b = document.getElementById("b") as HTMLElement;
    return {scope: {items: () => [{element: a, leaf: true}, {element: b, leaf: true}]}, button: document.getElementById("button") as HTMLElement};
}

function tab(target: HTMLElement, init: KeyboardEventInit & {keyCode?: number} = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true, ...init});
    if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", {value: init.keyCode});
    target.dispatchEvent(event);
    return event;
}

describe("moveTab 不介入", () => {
    it("内容自己处理了 Tab（preventDefault）", () => {
        const {scope, button} = setup();
        button.addEventListener("keydown", (event) => event.preventDefault());
        expect(moveTab(tab(button), scope)).toBe("browser");
    });

    it("带修饰键", () => {
        const {scope, button} = setup();
        for (const init of [{ctrlKey: true}, {altKey: true}, {metaKey: true}]) expect(moveTab(tab(button, init), scope)).toBe("browser");
    });

    it("输入法正在组字（Tab 用来翻候选）", () => {
        const {scope, button} = setup();
        expect(moveTab(tab(button, {isComposing: true}), scope)).toBe("browser");
        expect(moveTab(tab(button, {keyCode: 229}), scope)).toBe("browser");
    });

    it("焦点不在任何一项里", () => {
        const {scope} = setup();
        const outside = document.createElement("button");
        document.body.append(outside);
        expect(moveTab(tab(outside), scope)).toBe("browser");
    });
});

describe("moveGridFocus", () => {
    it("不在任何 grid 里：什么都不做", () => {
        document.body.innerHTML = `<button id="x">x</button>`;
        expect(moveGridFocus(document.getElementById("x"), "next")).toBe(false);
    });
});

describe("nextFocusStop", () => {
    const focusable = (...indexes: number[]) => (index: number): boolean => indexes.includes(index);

    it("跳过没有可聚焦元素的项", () => {
        expect(nextFocusStop({count: 5, from: 0, direction: 1, wrap: false, focusable: focusable(0, 3)})).toBe(3);
        expect(nextFocusStop({count: 5, from: 4, direction: -1, wrap: false, focusable: focusable(1, 4)})).toBe(1);
    });

    it("不绕回：走到头返回 null", () => {
        expect(nextFocusStop({count: 3, from: 2, direction: 1, wrap: false, focusable: focusable(0, 1, 2)})).toBeNull();
        expect(nextFocusStop({count: 3, from: 0, direction: -1, wrap: false, focusable: focusable(0, 1, 2)})).toBeNull();
    });

    it("绕回：回到另一头；只有自己能停时停在自己；都不能停返回 null", () => {
        expect(nextFocusStop({count: 3, from: 2, direction: 1, wrap: true, focusable: focusable(0, 1, 2)})).toBe(0);
        expect(nextFocusStop({count: 3, from: 1, direction: 1, wrap: true, focusable: focusable(1)})).toBe(1);
        expect(nextFocusStop({count: 3, from: 1, direction: 1, wrap: true, focusable: focusable()})).toBeNull();
    });
});
