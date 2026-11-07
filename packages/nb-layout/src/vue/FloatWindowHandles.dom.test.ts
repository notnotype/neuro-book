import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import FloatWindowHandles from "./FloatWindowHandles.vue";

/** 浮动窗的手柄（同名 .md）：指针与键盘算出的矩形。真实浏览器的拖动在 e2e/workbench-float.e2e.ts。 */

const RECT = {x: 100, y: 80, width: 400, height: 300};
const MIN = {width: 200, height: 100};
const MAX = {width: 600, height: 500};

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function handles() {
    const wrapper = mount(FloatWindowHandles, {props: {rect: RECT, min: MIN, max: MAX}, attachTo: document.body});
    mounted.push(wrapper);
    // happy-dom 没有指针捕获。
    for (const handle of wrapper.findAll("[data-float-handle]")) (handle.element as HTMLElement).setPointerCapture = () => undefined;
    return wrapper;
}

const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y});

describe("FloatWindowHandles", () => {
    it("拖右下角：预览跟着走，松手提交一次，预览撤掉", () => {
        const wrapper = handles();
        const corner = wrapper.get("[data-float-handle=\"bottom-right\"]").element;
        corner.dispatchEvent(pointer("pointerdown", 500, 380));
        corner.dispatchEvent(pointer("pointermove", 540, 400));
        expect(wrapper.emitted("preview")?.at(-1)).toEqual([{...RECT, width: 440, height: 320}]);
        expect(wrapper.emitted("commit")).toBeUndefined();
        corner.dispatchEvent(pointer("pointerup", 540, 400));
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, width: 440, height: 320}]]);
        expect(wrapper.emitted("preview")?.at(-1)).toEqual([null]);
    });

    it("按下没动就抬起：不提交（窗被夹着时 rect 是夹过的，不能写回）", () => {
        const wrapper = handles();
        const corner = wrapper.get("[data-float-handle=\"bottom-right\"]").element;
        corner.dispatchEvent(pointer("pointerdown", 500, 380));
        corner.dispatchEvent(pointer("pointerup", 500, 380));
        expect(wrapper.emitted("commit")).toBeUndefined();
    });

    it("拖左边：位置跟着改，到了最小尺寸右边不动", () => {
        const wrapper = handles();
        const left = wrapper.get("[data-float-handle=\"left\"]").element;
        left.dispatchEvent(pointer("pointerdown", 100, 200));
        left.dispatchEvent(pointer("pointermove", 1000, 200));
        left.dispatchEvent(pointer("pointerup", 1000, 200));
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, x: 300, width: 200}]]);
    });

    it("Esc 取消：只撤预览，不提交；失去捕获同样", () => {
        const wrapper = handles();
        const corner = wrapper.get("[data-float-handle=\"bottom-right\"]").element;
        corner.dispatchEvent(pointer("pointerdown", 500, 380));
        corner.dispatchEvent(pointer("pointermove", 540, 400));
        corner.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        expect(wrapper.emitted("preview")?.at(-1)).toEqual([null]);
        expect(wrapper.emitted("commit")).toBeUndefined();
        corner.dispatchEvent(pointer("pointerdown", 500, 380));
        corner.dispatchEvent(new Event("lostpointercapture"));
        expect(wrapper.emitted("commit")).toBeUndefined();
    });

    it("键盘：只有两个控件能聚焦；右下角缩放、把手移动，Shift 是 1px", async () => {
        const wrapper = handles();
        const focusable = wrapper.findAll("button");
        expect(focusable).toHaveLength(2);
        expect(wrapper.findAll("[tabindex=\"-1\"]")).toHaveLength(7);
        await wrapper.get("[data-float-handle=\"bottom-right\"]").trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("commit")?.at(-1)).toEqual([{...RECT, width: 410}]);
        await wrapper.get("[data-float-move-handle]").trigger("keydown", {key: "ArrowDown", shiftKey: true});
        expect(wrapper.emitted("move")?.at(-1)).toEqual([{x: 100, y: 81}]);
    });
});
