import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import FloatWindowHandles from "./FloatWindowHandles.vue";
import {LAYOUT_TEXT_KEY, layoutCatalogTranslate, type LayoutTranslate} from "./text";

/** 浮动窗的手柄（同名 .md）：指针与键盘算出的矩形。真实浏览器的拖动在 e2e/workbench-float.e2e.ts。 */

const RECT = {x: 100, y: 80, width: 400, height: 300};
const MIN = {width: 200, height: 100};
const MAX = {width: 600, height: 500};

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function handles(translate?: LayoutTranslate, props: Record<string, unknown> = {max: MAX}) {
    const wrapper = mount(FloatWindowHandles, {props: {rect: RECT, min: MIN, ...props}, attachTo: document.body, ...(translate === undefined ? {} : {global: {provide: {[LAYOUT_TEXT_KEY as symbol]: translate}}})});
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
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, width: 440, height: 320}, {width: 1, height: 1}]]);
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
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, x: 300, width: 200}, {width: -1, height: 0}]]);
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
        // 没有注入文字：两个控件的读屏名称用自带的源语言（英文）目录（nested-grid 输出 143）。
        expect(focusable.map((button) => button.attributes("aria-label")).sort()).toEqual(["Move the floating window with the arrow keys", "Resize the floating window with the arrow keys"]);
        await wrapper.get("[data-float-handle=\"bottom-right\"]").trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("commit")?.at(-1)).toEqual([{...RECT, width: 410}, {width: 1, height: 1}]);
        await wrapper.get("[data-float-move-handle]").trigger("keydown", {key: "ArrowDown", shiftKey: true});
        expect(wrapper.emitted("move")?.at(-1)).toEqual([{x: 100, y: 81}]);
    });

    it("松手的结算（nested-grid 输出 177）：同一个同步段里先 preview(null) 再 commit，commit 带这次动的边", () => {
        const order: string[] = [];
        const wrapper = handles(undefined, {max: MAX, onPreview: (rect: unknown) => order.push(rect === null ? "preview(null)" : "preview"), onCommit: (_rect: unknown, direction: unknown) => order.push(`commit ${JSON.stringify(direction)}`)});
        const bottom = wrapper.get("[data-float-handle=\"bottom\"]").element;
        bottom.dispatchEvent(pointer("pointerdown", 300, 380));
        bottom.dispatchEvent(pointer("pointermove", 300, 420));
        bottom.dispatchEvent(pointer("pointerup", 300, 420));
        expect(order).toEqual(["preview", "preview(null)", "commit {\"width\":0,\"height\":1}"]);
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, height: 340}, {width: 0, height: 1}]]);
    });

    it("缩放的边界（nested-grid 输出 176）：给了 area，指针拖动的预览与提交、键盘缩放都不越过它；不给 max 也行", async () => {
        // 窗右缘在 500、下缘在 380；区域到 520、400 为止。
        const wrapper = handles(undefined, {area: {x: 0, y: 0, width: 520, height: 400}});
        const corner = wrapper.get("[data-float-handle=\"bottom-right\"]").element;
        corner.dispatchEvent(pointer("pointerdown", 500, 380));
        corner.dispatchEvent(pointer("pointermove", 900, 900));
        expect(wrapper.emitted("preview")?.at(-1)).toEqual([{...RECT, width: 420, height: 320}]);
        corner.dispatchEvent(pointer("pointerup", 900, 900));
        expect(wrapper.emitted("commit")).toEqual([[{...RECT, width: 420, height: 320}, {width: 1, height: 1}]]);
        await wrapper.setProps({rect: {...RECT, width: 415}});
        await wrapper.get("[data-float-handle=\"bottom-right\"]").trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("commit")?.at(-1)).toEqual([{...RECT, width: 420}, {width: 1, height: 1}]);
        // 不给区域也不给 max：不限。
        await wrapper.setProps({area: undefined});
        await wrapper.get("[data-float-handle=\"bottom-right\"]").trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("commit")?.at(-1)).toEqual([{...RECT, width: 425}, {width: 1, height: 1}]);
    });

    it("文字（nested-grid 输出 143）：宿主经 LAYOUT_TEXT_KEY 注入时两个控件的读屏名称用宿主的", () => {
        const wrapper = handles(layoutCatalogTranslate("zh-CN"));
        expect(wrapper.findAll("button").map((button) => button.attributes("aria-label")).sort()).toEqual(["用方向键移动浮动窗", "用方向键调整浮动窗大小"]);
    });
});
