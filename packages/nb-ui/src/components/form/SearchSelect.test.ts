/**
 * 可搜索的下拉（docs/specs/ui/forms.md 输出 30、28）：输入的文字只是搜索词，只有选中选项才改值，Escape 与失焦恢复显示
 * 已选项；高亮经 `aria-activedescendant` 指向列表里真实的那一项。布局与真实浏览器里的指针在 Lab 的 e2e。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {h} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import Field from "./Field.vue";
import SearchSelect from "./SearchSelect.vue";

const OPTIONS = [
    {value: "gpt", label: "GPT-5"},
    {value: "claude", label: "Claude Opus", description: "Anthropic"},
    {value: "old", label: "Claude Instant", disabled: true},
    {value: "deepseek", label: "DeepSeek"},
];

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function mountSelect(props: Record<string, unknown> = {}): Promise<VueWrapper> {
    const wrapper = mount(SearchSelect, {props: {modelValue: "gpt", options: OPTIONS, ...props}, attachTo: document.body});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const input = (wrapper: VueWrapper) => wrapper.get("input[role='combobox']");
const value = (wrapper: VueWrapper) => (input(wrapper).element as HTMLInputElement).value;
const optionTexts = () => [...document.querySelectorAll<HTMLElement>("[role='option']")].map((option) => option.textContent?.trim());
const highlighted = () => document.querySelector<HTMLElement>("[role='option'][data-highlighted]");

async function type(wrapper: VueWrapper, text: string): Promise<void> {
    (input(wrapper).element as HTMLInputElement).value = text;
    await input(wrapper).trigger("input");
    await flushPromises();
}

describe("SearchSelect", () => {
    it("打字只筛选、不改值；Enter 选中高亮项，输入框显示它的名字", async () => {
        const wrapper = await mountSelect();
        expect(value(wrapper)).toBe("GPT-5");
        await type(wrapper, "claude");
        expect(optionTexts()).toEqual(["Claude OpusAnthropic", "Claude Instant"]);
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        expect(input(wrapper).attributes("aria-expanded")).toBe("true");
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["claude"]]);
        await wrapper.setProps({modelValue: "claude"});
        expect(value(wrapper)).toBe("Claude Opus");
        expect(input(wrapper).attributes("aria-expanded")).toBe("false");
    });

    it("Escape 与失焦都丢掉搜索词、恢复显示已选项，不发出变化；Escape 不冒泡", async () => {
        const wrapper = await mountSelect();
        await type(wrapper, "deep");
        let bubbled = false;
        document.body.addEventListener("keydown", () => {
            bubbled = true;
        }, {once: true});
        await input(wrapper).trigger("keydown", {key: "Escape"});
        expect(value(wrapper)).toBe("GPT-5");
        expect(bubbled).toBe(false);
        await type(wrapper, "deep");
        await input(wrapper).trigger("blur");
        expect(value(wrapper)).toBe("GPT-5");
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("↓ 打开时高亮落在已选项；移动跳过停用项并循环；aria-activedescendant 指向高亮的那一项", async () => {
        const wrapper = await mountSelect({modelValue: "claude"});
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toContain("Claude Opus");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toBe("DeepSeek");
        expect(input(wrapper).attributes("aria-activedescendant")).toBe(highlighted()?.id);
        expect(document.getElementById(input(wrapper).attributes("aria-controls")!)?.getAttribute("role")).toBe("listbox");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        expect(highlighted()?.textContent).toBe("GPT-5");
    });

    it("列表开着时 Home、End 留给输入框移光标：不消费、不移动高亮", async () => {
        const wrapper = await mountSelect({modelValue: "claude"});
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await flushPromises();
        for (const key of ["Home", "End"]) {
            const event = new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true});
            input(wrapper).element.dispatchEvent(event);
            await flushPromises();
            expect(event.defaultPrevented).toBe(false);
            expect(highlighted()?.textContent).toContain("Claude Opus");
        }
    });

    it("点击选项选中它；停用项点了不算", async () => {
        const wrapper = await mountSelect();
        await input(wrapper).trigger("click");
        await flushPromises();
        const options = [...document.querySelectorAll<HTMLElement>("[role='option']")];
        options.find((option) => option.textContent?.includes("Instant"))!.click();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        options.find((option) => option.textContent === "DeepSeek")!.click();
        expect(wrapper.emitted("update:modelValue")).toEqual([["deepseek"]]);
    });

    it("没有匹配时列表里只有一行提示", async () => {
        const wrapper = await mountSelect({emptyText: "No match"});
        await type(wrapper, "zzz");
        expect(optionTexts()).toEqual([]);
        expect(document.querySelector("[data-suggestion-menu-empty]")?.textContent).toBe("No match");
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("只读：可聚焦、写 aria-readonly，点击、打字与方向键都不打开列表；停用时输入框停用", async () => {
        const wrapper = await mountSelect({readonly: true});
        expect(input(wrapper).attributes("aria-readonly")).toBe("true");
        expect(input(wrapper).attributes("disabled")).toBeUndefined();
        await input(wrapper).trigger("click");
        await input(wrapper).trigger("keydown", {key: "ArrowDown"});
        await type(wrapper, "deep");
        expect(document.querySelector("[role='listbox']")).toBeNull();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        const disabled = await mountSelect({disabled: true});
        expect(input(disabled).attributes("disabled")).toBeDefined();
    });

    it("点进去打开时全选已选项的名字：接着打的字替换它，不接在后面", async () => {
        const wrapper = await mountSelect();
        await input(wrapper).trigger("click");
        const element = input(wrapper).element as HTMLInputElement;
        expect([element.selectionStart, element.selectionEnd]).toEqual([0, "GPT-5".length]);
    });

    it("输入法组字中不筛选、Enter 不选中；组字结束后按上屏的字筛选", async () => {
        const wrapper = await mountSelect();
        await input(wrapper).trigger("click");
        await input(wrapper).trigger("compositionstart");
        (input(wrapper).element as HTMLInputElement).value = "qwe";
        await input(wrapper).trigger("input");
        await flushPromises();
        expect(optionTexts()).toHaveLength(4);
        await input(wrapper).trigger("keydown", {key: "Enter", isComposing: true, keyCode: 229});
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        (input(wrapper).element as HTMLInputElement).value = "deep";
        await input(wrapper).trigger("compositionend");
        await flushPromises();
        expect(optionTexts()).toEqual(["DeepSeek"]);
    });

    it("按外框上的放大镜或箭头：聚焦输入框、开合列表，不先失焦", async () => {
        const wrapper = await mountSelect();
        const frame = wrapper.get("[data-nb-search-select]");
        const arrow = frame.findAll("span[aria-hidden='true']").at(-1)!;
        const pressed = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        arrow.element.dispatchEvent(pressed);
        await flushPromises();
        expect(pressed.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(input(wrapper).element);
        expect(input(wrapper).attributes("aria-expanded")).toBe("true");
        arrow.element.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(input(wrapper).attributes("aria-expanded")).toBe("false");
    });

    it("名字：aria-label 落在输入框上；在字段里时列表的名字指向字段标签；当前值在列表里打勾", async () => {
        const named = await mountSelect({"aria-label": "模型"});
        expect(input(named).attributes("aria-label")).toBe("模型");
        expect(named.get("[data-nb-search-select]").attributes("aria-label")).toBeUndefined();
        named.unmount();
        const wrapper = mount(Field, {attachTo: document.body, props: {label: "默认模型"}, slots: {default: () => h(SearchSelect, {modelValue: "claude", options: OPTIONS})}});
        mounted.push(wrapper);
        await wrapper.get("input[role='combobox']").trigger("click");
        await flushPromises();
        const listbox = document.querySelector("[role='listbox']")!;
        expect(document.getElementById(listbox.getAttribute("aria-labelledby")!)?.textContent).toBe("默认模型");
        const checked = [...document.querySelectorAll("[role='option']")].filter((option) => option.querySelector("[data-suggestion-menu-checked]") !== null);
        expect(checked.map((option) => option.textContent?.trim())).toEqual(["Claude OpusAnthropic"]);
    });

    it("表单提交的是值：name 在隐藏输入框上，可见输入框没有 name；选的就是当前值时不发出变化", async () => {
        const wrapper = await mountSelect({name: "model"});
        expect(wrapper.get("input[type='hidden']").attributes()).toMatchObject({name: "model", value: "gpt"});
        expect(input(wrapper).attributes("name")).toBeUndefined();
        await input(wrapper).trigger("click");
        await flushPromises();
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("远程模式：打开与打字发出搜索词；宿主换来的选项不再按名字筛，名字里不含搜索词的也列出", async () => {
        const wrapper = await mountSelect({filter: false, options: [], modelValue: ""});
        await input(wrapper).trigger("click");
        await flushPromises();
        expect(wrapper.emitted("search")).toEqual([[""]]);
        await type(wrapper, "小瑕");
        expect(wrapper.emitted("search")).toEqual([[""], ["小瑕"]]);
        // 宿主按别名找到了“星瑕”：名字里没有“小瑕”，照样列出、可以选中。
        await wrapper.setProps({options: [{value: "e1", label: "星瑕", description: "人物"}]});
        expect(optionTexts()).toEqual(["星瑕人物"]);
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["e1"]]);
    });

    it("当前值不在选项里时显示 selectedLabel；在选项里时以选项的名字为准", async () => {
        const wrapper = await mountSelect({filter: false, options: [], modelValue: "e1", selectedLabel: "星瑕"});
        expect(value(wrapper)).toBe("星瑕");
        await wrapper.setProps({options: [{value: "e1", label: "星瑕（人物）"}]});
        expect(value(wrapper)).toBe("星瑕（人物）");
        await wrapper.setProps({modelValue: ""});
        expect(value(wrapper)).toBe("");
    });

    it("清空：已选时有清空按钮，点了发出空串、焦点留在输入框、不打开列表；未选、只读、停用时没有它", async () => {
        const wrapper = await mountSelect({clearable: true});
        const button = wrapper.get("button[aria-label='清除选择']");
        await button.trigger("mousedown");
        await button.trigger("click");
        await flushPromises();
        expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
        expect(document.activeElement).toBe(input(wrapper).element);
        expect(input(wrapper).attributes("aria-expanded")).toBe("false");
        await wrapper.setProps({modelValue: ""});
        expect(wrapper.find("button[aria-label='清除选择']").exists()).toBe(false);
        await wrapper.setProps({modelValue: "gpt", readonly: true});
        expect(wrapper.find("button[aria-label='清除选择']").exists()).toBe(false);
        await wrapper.setProps({readonly: false, disabled: true});
        expect(wrapper.find("button[aria-label='清除选择']").exists()).toBe(false);
    });
});
