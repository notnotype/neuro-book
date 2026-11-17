/**
 * 一组短文字的输入（同名 .md 的“交互”）：经末尾输入的按键与输入事件加项，经 × 与退格删项；值去空白、去重，空的不加。
 * 换行与小块的样子在 Lab 的场景里看。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import TagInput from "./TagInput.vue";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 受控挂载：像真实的父组件一样把发出的值写回 `modelValue`。 */
async function mountTags(props: Record<string, unknown> = {}): Promise<VueWrapper> {
    const wrapper: VueWrapper = mount(TagInput, {
        props: {modelValue: ["青石镇"], ...props, "onUpdate:modelValue": (value: string[]) => wrapper.setProps({modelValue: value})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const field = (wrapper: VueWrapper) => wrapper.get("input");
const items = (wrapper: VueWrapper) => wrapper.findAll("[data-reka-collection-item]").map((item) => item.text());
const emitted = (wrapper: VueWrapper) => (wrapper.emitted("update:modelValue") ?? []).map(([value]) => value);

async function typeAndEnter(wrapper: VueWrapper, text: string): Promise<void> {
    (field(wrapper).element as HTMLInputElement).value = text;
    await field(wrapper).trigger("input");
    await field(wrapper).trigger("keydown", {key: "Enter"});
    await flushPromises();
}

/** 像键盘那样一个字一个字打：分隔符在 `input` 事件的 `data` 里。 */
async function typeChars(wrapper: VueWrapper, text: string): Promise<void> {
    const element = field(wrapper).element as HTMLInputElement;
    for (const char of text) {
        element.value += char;
        await field(wrapper).trigger("input", {data: char});
    }
    await flushPromises();
}

describe("TagInput", () => {
    it("回车加一项，值去掉首尾空白", async () => {
        const wrapper = await mountTags();
        await typeAndEnter(wrapper, "  北山 ");
        expect(emitted(wrapper)).toEqual([["青石镇", "北山"]]);
        expect(items(wrapper)).toEqual(["青石镇", "北山"]);
        expect((field(wrapper).element as HTMLInputElement).value).toBe("");
    });

    it("打出半角逗号、全角逗号或顿号就加一项", async () => {
        const wrapper = await mountTags({modelValue: []});
        await typeChars(wrapper, "渡口，");
        await typeChars(wrapper, "客栈、");
        await typeChars(wrapper, "inn,");
        expect(items(wrapper)).toEqual(["渡口", "客栈", "inn"]);
    });

    it("空白的与已有的不加，列表不变", async () => {
        const wrapper = await mountTags();
        await typeAndEnter(wrapper, "   ");
        await typeAndEnter(wrapper, "青石镇");
        expect(emitted(wrapper)).toEqual([]);
        expect(items(wrapper)).toEqual(["青石镇"]);
    });

    it("粘贴含分隔符的文字拆成几项，空段丢掉", async () => {
        const wrapper = await mountTags({modelValue: []});
        const paste = new Event("paste", {bubbles: true, cancelable: true});
        Object.defineProperty(paste, "clipboardData", {value: {getData: () => "北山,,渡口、 客栈 "}});
        field(wrapper).element.dispatchEvent(paste);
        await flushPromises();
        expect(items(wrapper)).toEqual(["北山", "渡口", "客栈"]);
    });

    it("点 × 删掉这一项；输入为空时退格先选中最后一项、再按一次删掉", async () => {
        const wrapper = await mountTags({modelValue: ["青石镇", "北山", "渡口"]});
        await wrapper.get("button[aria-label='移除 北山']").trigger("click");
        await flushPromises();
        expect(items(wrapper)).toEqual(["青石镇", "渡口"]);
        await field(wrapper).trigger("keydown", {key: "Backspace"});
        expect(items(wrapper)).toEqual(["青石镇", "渡口"]);
        await field(wrapper).trigger("keydown", {key: "Backspace"});
        await flushPromises();
        expect(items(wrapper)).toEqual(["青石镇"]);
    });

    it("只读：没有末尾的输入与 ×，各项照样显示", async () => {
        const wrapper = await mountTags({modelValue: ["青石镇", "北山"], readonly: true});
        expect(wrapper.find("input").exists()).toBe(false);
        expect(wrapper.find("button").exists()).toBe(false);
        expect(items(wrapper)).toEqual(["青石镇", "北山"]);
    });

    it("读屏属性落在末尾的输入上", async () => {
        const wrapper = await mountTags({"aria-label": "地点"});
        expect(field(wrapper).attributes("aria-label")).toBe("地点");
    });
});
