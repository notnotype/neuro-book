/**
 * 画布拖手柄调尺寸：松手提交草稿；系统取消丢掉草稿，尺寸保持拖动前（ViewportCanvas.md“交互”）。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import ViewportCanvas from "./ViewportCanvas.vue";

const mounted: Array<{unmount(): void}> = [];

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

async function drag(end: "pointerup" | "pointercancel") {
    const wrapper = mount(ViewportCanvas, {props: {width: 400, height: 300}, attachTo: document.body});
    mounted.push(wrapper);
    const handle = wrapper.get('[aria-label="调整宽度"]').element as HTMLElement;
    handle.dispatchEvent(new PointerEvent("pointerdown", {pointerId: 1, clientX: 100, clientY: 100, bubbles: true}));
    handle.dispatchEvent(new PointerEvent("pointermove", {pointerId: 1, clientX: 130, clientY: 100}));
    await nextTick();
    handle.dispatchEvent(new PointerEvent(end, {pointerId: 1}));
    await nextTick();
    return wrapper.emitted("update:width") ?? [];
}

describe("画布拖手柄", () => {
    it("松手提交草稿宽度", async () => {
        expect(await drag("pointerup")).toEqual([[460]]);
    });

    it("系统取消不提交", async () => {
        expect(await drag("pointercancel")).toEqual([]);
    });
});
