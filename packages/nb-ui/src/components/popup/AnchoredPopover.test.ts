/** AnchoredPopover（同名 .md）：打开与关闭都不动焦点；在里面按下不夺焦；外框不是对话框。 */
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import AnchoredPopover from "./AnchoredPopover.vue";

const wrappers: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function open() {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const anchor = document.createElement("span");
    document.body.append(anchor);
    const wrapper = mount(AnchoredPopover, {props: {open: true, anchor}, slots: {default: "<button id=\"inside\">按钮</button><input id=\"field\" />"}, attachTo: document.body});
    wrappers.push(wrapper);
    return {wrapper, input, anchor};
}
const surface = (): Element | null => document.querySelector("[data-anchored-popover]");

describe("AnchoredPopover", () => {
    it("打开不抢焦点，关闭也不动焦点", async () => {
        const {wrapper, input} = open();
        await nextTick();
        await nextTick();
        expect(surface()).not.toBeNull();
        expect(document.activeElement).toBe(input);
        await wrapper.setProps({open: false});
        expect(document.activeElement).toBe(input);
    });

    it("没有锚点时不显示", async () => {
        const {wrapper} = open();
        await wrapper.setProps({anchor: null});
        await nextTick();
        expect(surface()).toBeNull();
    });

    it("外框不是对话框：角色由内容决定", async () => {
        open();
        await nextTick();
        await nextTick();
        expect(surface()?.getAttribute("role")).toBeNull();
        expect(surface()?.getAttribute("tabindex")).toBeNull();
    });

    it("在按钮上按下不夺焦，输入框照常接收", async () => {
        open();
        await nextTick();
        await nextTick();
        const press = (selector: string): boolean => {
            const event = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
            document.querySelector(selector)?.dispatchEvent(event);
            return event.defaultPrevented;
        };
        expect(press("#inside")).toBe(true);
        expect(press("#field")).toBe(false);
    });

    it("contains 认得传送出去的内容", async () => {
        const {wrapper} = open();
        await nextTick();
        await nextTick();
        const exposed = wrapper.vm as unknown as {contains(node: Node | null): boolean};
        expect(exposed.contains(document.querySelector("#inside"))).toBe(true);
        expect(exposed.contains(document.body)).toBe(false);
    });
});
