/**
 * SidePanel 的合同（同名 .md）：点外面与焦点移出不关、触发器切换、Esc 只在焦点在面板里或触发器上时关、组字时不关、
 * 关闭后焦点回到触发器、`closed` 在卸载之后发、读屏名、面板里的下拉取页面浮层档；内容上按下拖动不开始任何手势。
 * 入退场动画与传送后的几何只在浏览器里看（happy-dom 没有动画与布局）。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, inject, ref} from "vue";

import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import SidePanel from "./SidePanel.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 受控宿主：页面上一个触发器与一个页面里的按钮，面板里一个输入框与一个读取浮层层级的探针。 */
function mountHost(initial = false) {
    const open = ref(initial);
    const events: string[] = [];
    const Probe = defineComponent({
        setup() {
            const layer = inject(NB_POPOVER_Z_INDEX, -1);
            return () => h("span", {"data-probe": String(layer)});
        },
    });
    const Host = defineComponent({
        setup() {
            return () => h("div", [
                h("button", {type: "button", "data-outside": ""}, "书架"),
                h(SidePanel, {
                    "open": open.value,
                    "label": "星璃",
                    "onUpdate:open": (value: boolean) => {
                        events.push(`update:open:${String(value)}`);
                        open.value = value;
                    },
                    "onClosed": () => events.push("closed"),
                }, {
                    trigger: () => h("button", {type: "button", "data-trigger": ""}, "看板娘"),
                    default: () => [h("p", {"data-text": ""}, "雪线以北的驿站里，一个守灯人等一封永远不会来的信。"), h("input", {"data-input": ""}), h(Probe)],
                }),
            ]);
        },
    });
    const wrapper = mount(Host, {attachTo: document.body});
    mounted.push(wrapper);
    return {open, events};
}

const query = <T extends Element = HTMLElement>(selector: string): T | null => document.body.querySelector<T>(selector);
const panel = (): HTMLElement | null => query("[data-side-panel]");
const pressEscape = (target: Element, init: KeyboardEventInit = {}): void => {
    target.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true, ...init}));
};

describe("SidePanel", () => {
    it("触发器切换开关；打开后是名为 label 的对话框，焦点进入面板，面板里的下拉取页面浮层档", async () => {
        const {open} = mountHost();
        query("[data-trigger]")!.click();
        await flushPromises();
        expect(open.value).toBe(true);
        const dialog = panel()!;
        expect(dialog.getAttribute("role")).toBe("dialog");
        expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("星璃");
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(query("[data-trigger]")!.getAttribute("aria-expanded")).toBe("true");
        expect(query("[data-probe]")!.getAttribute("data-probe")).toBe(String(NB_Z_INDEX.popover));
        expect(dialog.style.zIndex).toBe(String(NB_Z_INDEX.sidePanel));
        query("[data-trigger]")!.click();
        await flushPromises();
        expect(open.value).toBe(false);
    });

    it("点外面、焦点移到外面都不关", async () => {
        const {open} = mountHost(true);
        await flushPromises();
        const outside = query("[data-outside]")!;
        outside.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0}));
        outside.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, button: 0}));
        outside.click();
        outside.focus();
        await flushPromises();
        expect(open.value).toBe(true);
        expect(panel()).not.toBeNull();
    });

    it("Esc：焦点在面板里时关，关闭后焦点回到触发器、closed 在内容卸载之后发；组字时与焦点在页面别处时不关", async () => {
        const {open, events} = mountHost();
        query("[data-trigger]")!.click();
        await flushPromises();
        const input = query<HTMLInputElement>("[data-input]")!;
        input.focus();
        pressEscape(input, {isComposing: true});
        await flushPromises();
        expect(open.value).toBe(true);

        const outside = query("[data-outside]")!;
        outside.focus();
        pressEscape(outside);
        await flushPromises();
        expect(open.value).toBe(true);

        input.focus();
        pressEscape(input);
        await flushPromises();
        expect(open.value).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(panel()).toBeNull();
        expect(events.at(-1)).toBe("closed");
        expect(document.activeElement).toBe(query("[data-trigger]"));
    });

    it("焦点在触发器上时 Esc 也关", async () => {
        const {open} = mountHost(true);
        await flushPromises();
        const trigger = query("[data-trigger]")!;
        trigger.focus();
        pressEscape(trigger);
        await flushPromises();
        expect(open.value).toBe(false);
    });

    it("内容上按下拖动不开始任何手势：面板仍开着、不带拖动状态", async () => {
        const {open} = mountHost(true);
        await flushPromises();
        const text = query("[data-text]")!;
        text.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0, pointerType: "mouse", clientX: 200, clientY: 100}));
        text.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, buttons: 1, pointerType: "mouse", clientX: 300, clientY: 100}));
        text.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, button: 0, pointerType: "mouse", clientX: 300, clientY: 100}));
        await flushPromises();
        expect(open.value).toBe(true);
        expect(panel()!.hasAttribute("data-swiping")).toBe(false);
    });
});
