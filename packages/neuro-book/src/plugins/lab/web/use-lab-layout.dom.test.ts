/**
 * 侧栏拖边（docs/specs/ui/component-lab.md 的输出“侧栏宽度”与“状态与转换”里拖动松手才保存）：松手把宽度交给偏好；
 * 系统取消（触摸被打断、指针丢失）回到拖动前的宽度，不交。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, nextTick} from "vue";

import {useLabLayout} from "./use-lab-layout";

const mounted: Array<{unmount(): void}> = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function setup() {
    (window as unknown as {happyDOM: {setViewport(viewport: {width: number; height: number}): void}}).happyDOM.setViewport({width: 1600, height: 1000});
    const committed: string[] = [];
    let layout: ReturnType<typeof useLabLayout> | null = null;
    const wrapper = mount(defineComponent({
        setup() {
            layout = useLabLayout({onDragEnd: (side) => committed.push(side)});
            return () => h("div", {"data-handle": "", "onPointerdown": (event: PointerEvent) => layout!.startPanelDrag("left", event)});
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
    const handle = wrapper.element as HTMLElement;
    const press = (x: number) => handle.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: x, bubbles: true}));
    const move = (x: number) => window.dispatchEvent(new PointerEvent("pointermove", {clientX: x}));
    return {layout: layout!, committed, press, move};
}

describe("侧栏拖边", () => {
    it("松手：宽度定下来并交给偏好", async () => {
        const {layout, committed, press, move} = setup();
        press(100);
        move(140);
        expect(layout.leftWidth.value).toBe(340);
        expect(layout.dragging.value).toBe(true);
        window.dispatchEvent(new PointerEvent("pointerup"));
        expect(committed).toEqual(["left"]);
        expect(layout.dragging.value).toBe(false);
        expect(layout.leftWidth.value).toBe(340);
    });

    it("系统取消：回到拖动前的宽度，不交给偏好，之后的指针移动不再改宽度", async () => {
        const {layout, committed, press, move} = setup();
        press(100);
        move(160);
        expect(layout.leftWidth.value).toBe(360);
        window.dispatchEvent(new PointerEvent("pointercancel"));
        expect(layout.leftWidth.value).toBe(300);
        expect(committed).toEqual([]);
        await nextTick();
        expect(layout.dragging.value).toBe(false);
        move(200);
        expect(layout.leftWidth.value).toBe(300);
    });
});
