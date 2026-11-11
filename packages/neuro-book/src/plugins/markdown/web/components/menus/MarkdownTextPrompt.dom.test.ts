/**
 * MarkdownTextPrompt（同名 .md，docs/specs/workbench/markdown-editing.md 输出 9）：回车、Esc 与输入法，按钮上的回车，重开时的
 * 预填。真实组件挂在 happy-dom 里；浮层位置不看（没有布局）。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import MarkdownTextPrompt from "./MarkdownTextPrompt.vue";

const anchor = {getBoundingClientRect: () => new DOMRect(10, 10, 20, 20)};

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 与宿主（`MarkdownMenus`）一样：先关着挂上，再打开。 */
async function open(props: {initial?: string; removeLabel?: string} = {}) {
    const wrapper = mount(MarkdownTextPrompt, {props: {open: false, session: 0, anchor, label: "注音", confirmLabel: "确定", ...props}, attachTo: document.body});
    mounted.push(wrapper);
    await wrapper.setProps({open: true, session: 1});
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>("[data-markdown-text-prompt] input");
    if (input === null) throw new Error("卡片没有输入框");
    return {wrapper, input};
}

/** 派发一次按键，返回它有没有被拦下（拦下了，浏览器就不做这个键原本的事，例如按钮上的回车不再触发点击）。 */
function press(target: Element, key: string, {composing = false}: {composing?: boolean} = {}): boolean {
    const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
    // happy-dom 不认构造参数里的 isComposing，组字中的按键在事件上直接定义。
    if (composing) Object.defineProperty(event, "isComposing", {value: true});
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

function type(input: HTMLInputElement, text: string): void {
    input.value = text;
    input.dispatchEvent(new Event("input", {bubbles: true}));
}

describe("MarkdownTextPrompt", () => {
    it("打开时预填、聚焦；输入框里回车确定（去掉首尾空白），清空了再回车是取消，不是移除", async () => {
        const {wrapper, input} = await open({initial: "lín xī", removeLabel: "移除注音"});
        expect(input.value).toBe("lín xī");
        expect(document.activeElement).toBe(input);
        type(input, "  lín  ");
        expect(press(input, "Enter")).toBe(true);
        type(input, " ");
        press(input, "Enter");
        expect(wrapper.emitted("submit")).toEqual([["lín"]]);
        expect(wrapper.emitted("cancel")).toHaveLength(1);
        expect(wrapper.emitted("remove")).toBeUndefined();
    });

    it("焦点在“移除注音”按钮上按回车：卡片不当成确定，按钮照常被按下", async () => {
        const {wrapper} = await open({initial: "lín xī", removeLabel: "移除注音"});
        const remove = document.body.querySelector<HTMLButtonElement>("[data-markdown-text-prompt] button[aria-label='移除注音']");
        if (remove === null) throw new Error("没有移除按钮");
        remove.focus();
        expect(press(remove, "Enter")).toBe(false);
        remove.click();
        expect(wrapper.emitted("submit")).toBeUndefined();
        expect(wrapper.emitted("cancel")).toBeUndefined();
        expect(wrapper.emitted("remove")).toHaveLength(1);
    });

    it("输入法组字时的回车与 Esc 归输入法：不确定、不取消；组字结束后 Esc 取消", async () => {
        const {wrapper, input} = await open();
        type(input, "lin");
        press(input, "Enter", {composing: true});
        press(input, "Escape", {composing: true});
        expect(wrapper.emitted("submit")).toBeUndefined();
        expect(wrapper.emitted("cancel")).toBeUndefined();
        press(input, "Escape");
        expect(wrapper.emitted("cancel")).toHaveLength(1);
    });

    it("开着时宿主换到另一段（session 变了）：预填与上一次相同也重来，写了一半的字不留", async () => {
        const {wrapper, input} = await open({initial: "lín"});
        type(input, "改了一半");
        // 与宿主一样：同一个读音的另一段，`initial` 不变，只有 `session` 变。
        await wrapper.setProps({session: 2});
        await flushPromises();
        expect(input.value).toBe("lín");
        expect(document.activeElement).toBe(input);
    });
});
