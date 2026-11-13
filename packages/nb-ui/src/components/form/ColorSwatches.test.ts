/**
 * ColorSwatches（同名 .md）：选中状态与发出的值、“自定义”打开取色面板、面板发出小写 `#rrggbb`、
 * 明度压到 0 再抬起来色相不丢、禁用时面板不改值。真实组件挂在 happy-dom 里，键盘操作代替拖动（没有布局）。
 */
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ColorSwatches from "./ColorSwatches.vue";

const COLORS = ["#2f5d8a", "#3b7a57", "#8f3f2e"];

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function mountSwatches(modelValue: string | null) {
    const wrapper = mount(ColorSwatches, {props: {modelValue, colors: COLORS, autoLabel: "自动", autoColor: "var(--accent-main)", customLabel: "自定义"}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

const swatch = (name: string): HTMLElement => document.body.querySelector<HTMLElement>(`[data-color-swatch='${name}']`)!;
const checked = (): string[] => [...document.body.querySelectorAll("[data-color-swatch][data-state='checked']")].map((node) => node.getAttribute("data-color-swatch") ?? "");

async function press(element: Element, key: string, times = 1): Promise<void> {
    for (let index = 0; index < times; index += 1) element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
    await flushPromises();
}

describe("ColorSwatches", () => {
    it("选中状态：null 是“自动”，大小写不同也认得出色板里的色，不在色板里的是“自定义”并显示该色", async () => {
        const wrapper = mountSwatches(null);
        expect(checked()).toEqual(["auto"]);
        await wrapper.setProps({modelValue: "#3B7A57"});
        expect(checked()).toEqual(["#3b7a57"]);
        await wrapper.setProps({modelValue: "#123456"});
        expect(checked()).toEqual(["custom"]);
        expect(swatch("custom").getAttribute("aria-label")).toBe("自定义 #123456");
    });

    it("点色块发出它，点“自动”发出 null，再点已选的不改值、但 pick 照发；点“自定义”不改值，打开取色面板", async () => {
        const wrapper = mountSwatches("#2f5d8a");
        swatch("#2f5d8a").click();
        swatch("#8f3f2e").click();
        swatch("auto").click();
        await flushPromises();
        expect(wrapper.emitted("update:modelValue")).toEqual([["#8f3f2e"], [null]]);
        expect(wrapper.emitted("pick")).toEqual([["#2f5d8a"], ["#8f3f2e"], [null]]);
        swatch("custom").click();
        await flushPromises();
        expect(wrapper.emitted("update:modelValue")).toHaveLength(2);
        expect(wrapper.emitted("pick")).toHaveLength(3);
        expect(document.body.querySelector("[data-color-swatches-panel] [data-color-panel]")).not.toBeNull();
    });

    it("面板里改了值（选中项从“自动”变成“自定义”）时焦点留在面板里、面板不关；Esc 关上后焦点回到“自定义”", async () => {
        const wrapper = mountSwatches(null);
        swatch("custom").click();
        await flushPromises();
        const input = document.body.querySelector<HTMLInputElement>("[data-color-swatches-panel] input[data-color-panel-input]")!;
        input.focus();
        // 面板发出的值由宿主写回：这正是“不是在色板里点出来的”那种改动。
        await wrapper.setProps({modelValue: "#123456"});
        await flushPromises();
        expect(checked()).toEqual(["custom"]);
        expect(document.activeElement).toBe(input);
        expect(document.body.querySelector("[data-color-swatches-panel]")).not.toBeNull();

        await press(input, "Escape");
        expect(document.body.querySelector("[data-color-swatches-panel]")).toBeNull();
        expect(document.activeElement).toBe(swatch("custom"));
    });

    it("面板开着时变成 disabled：面板里的输入也不再改值", async () => {
        const wrapper = mountSwatches(null);
        swatch("custom").click();
        await flushPromises();
        await wrapper.setProps({disabled: true});
        const input = document.body.querySelector<HTMLInputElement>("[data-color-swatches-panel] input[data-color-panel-input]")!;
        input.value = "#aabbcc";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await press(input, "Enter");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });
});

describe("ColorSwatches 的取色面板", () => {
    async function openPanel(modelValue: string) {
        const wrapper = mountSwatches(modelValue);
        swatch("custom").click();
        await flushPromises();
        return wrapper;
    }

    it("颜色值输入回车后发出去掉透明度的小写 #rrggbb；写错的值不发出，输入框恢复为当前颜色", async () => {
        const wrapper = await openPanel("#123456");
        const input = document.body.querySelector<HTMLInputElement>("[data-color-panel-input]")!;
        input.value = "#AABBCC80";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await press(input, "Enter");
        expect(wrapper.emitted("update:modelValue")).toEqual([["#aabbcc"]]);
        await wrapper.setProps({modelValue: "#aabbcc"});
        input.value = "不是颜色";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await press(input, "Enter");
        expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
        expect(input.value.toLowerCase()).toBe("#aabbcc");
    });

    it("明度压到 0 再抬起来，色相还是原来的蓝，不跳成红或灰", async () => {
        const wrapper = await openPanel("#2f5d8a");
        const area = document.body.querySelector<HTMLElement>("[data-color-panel] [role='slider']")!;
        area.focus();
        await press(area, "ArrowDown", 60);
        await wrapper.setProps({modelValue: (wrapper.emitted("update:modelValue")?.at(-1) as [string])[0]});
        await press(area, "ArrowUp", 40);
        const last = (wrapper.emitted("update:modelValue")?.at(-1) as [string])[0];
        expect(last).toMatch(/^#[0-9a-f]{6}$/u);
        const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(last.slice(start, start + 2), 16)) as [number, number, number];
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
    });
});
