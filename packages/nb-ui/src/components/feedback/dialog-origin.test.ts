/**
 * 触发点的取法与入场位移的算法（dialog-origin.ts）。位移表驱动；取点用真的 document 与 PointerEvent。
 */
import {afterEach, describe, expect, it} from "vitest";

import {
    ORIGIN_POINTER_WINDOW_MS,
    captureDialogOrigin,
    dialogOriginOffset,
    trackDialogOrigin,
} from "./dialog-origin";

afterEach(() => {
    // 取一次就用掉了记下的按下，用例之间不串。
    captureDialogOrigin();
    document.body.innerHTML = "";
});

describe("dialogOriginOffset", () => {
    // 面 400x200，左上角 (300, 200)，中心 (500, 300)
    const panel = {left: 300, top: 200, width: 400, height: 200};

    it.each([
        {name: "没有触发点时不偏", origin: null, expected: {x: 0, y: 0}},
        {name: "触发点就在中心时不偏", origin: {x: 500, y: 300}, expected: {x: 0, y: 0}},
        {name: "朝触发点（左上）", origin: {x: 400, y: 250}, expected: {x: -85, y: -42.5}},
        {name: "朝触发点（右下）", origin: {x: 600, y: 350}, expected: {x: 85, y: 42.5}},
        {name: "触发点很远也不设上限：面看得出从那里长出来", origin: {x: -500, y: 300}, expected: {x: -850, y: 0}},
    ])("$name", ({origin, expected}) => {
        expect(dialogOriginOffset(panel, origin)).toEqual(expected);
    });
});

describe("captureDialogOrigin", () => {
    function press(x: number, y: number): void {
        document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: x, clientY: y}));
    }

    it("没有按下也没有焦点按钮时没有来处", () => {
        trackDialogOrigin();
        expect(captureDialogOrigin()).toBeNull();
    });

    it("时限内的按下用按下的坐标，过了时限就不算", () => {
        trackDialogOrigin();
        press(120, 340);
        expect(captureDialogOrigin(performance.now() + ORIGIN_POINTER_WINDOW_MS / 2)).toEqual({x: 120, y: 340});
        press(120, 340);
        expect(captureDialogOrigin(performance.now() + ORIGIN_POINTER_WINDOW_MS + 1000)).toBeNull();
    });

    it("一次按下只算一次打开：紧接着打开的第二个对话框没有来处", () => {
        trackDialogOrigin();
        press(120, 340);
        expect(captureDialogOrigin()).toEqual({x: 120, y: 340});
        expect(captureDialogOrigin()).toBeNull();
    });

    it("内容里 stopPropagation 也挡不住按下的记录", () => {
        trackDialogOrigin();
        const inner = document.body.appendChild(document.createElement("div"));
        inner.addEventListener("pointerdown", (event) => event.stopPropagation());
        inner.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 7, clientY: 8}));
        expect(captureDialogOrigin()).toEqual({x: 7, y: 8});
    });

    it("没有按下时用焦点所在按钮的中心；焦点在输入框里不算来处", () => {
        const button = document.body.appendChild(document.createElement("button"));
        button.getBoundingClientRect = () => ({left: 10, top: 20, width: 40, height: 30}) as DOMRect;
        button.focus();
        expect(captureDialogOrigin()).toEqual({x: 30, y: 35});

        const input = document.body.appendChild(document.createElement("input"));
        input.focus();
        expect(captureDialogOrigin()).toBeNull();
    });
});
