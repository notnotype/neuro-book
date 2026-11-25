/**
 * SuggestInput（同名 .md）：获得焦点时列出建议值、打字只列包含它的；点一条或上下键加回车填进输入框，值就是输入框里的字；
 * 列表开着时 Escape 只收起列表、不往外传。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import SuggestInput from "./SuggestInput.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

function input(value = "") {
    const wrapper = mount(SuggestInput, {props: {modelValue: value, label: "性别", suggestions: ["男", "女", "不明"], "onUpdate:modelValue": (next: string) => void wrapper.setProps({modelValue: next})}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}
const options = (): string[] => [...document.body.querySelectorAll("[role='option']")].map((option) => option.textContent?.trim() ?? "");

describe("SuggestInput", () => {
    it("获得焦点时列出建议值；打字只列包含它的；点一条填进输入框并收起", async () => {
        const wrapper = input();
        const field = wrapper.get("input");
        await field.trigger("focusin");
        await waitUntil("列出建议值", () => options().join("|") === "男|女|不明");
        await field.setValue("不");
        await waitUntil("只列包含的", () => options().join("|") === "不明");
        (document.body.querySelector("[role='option']") as HTMLElement).click();
        await waitUntil("填进去、收起", () => (field.element as HTMLInputElement).value === "不明" && options().length === 0);
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["不明"]);
    });

    it("写建议值之外的字照样是值；上下键加回车填进高亮的；列表开着时 Escape 只收起列表", async () => {
        const wrapper = input();
        const field = wrapper.get("input");
        await field.trigger("focusin");
        await field.setValue("双性");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["双性"]);
        await field.setValue("");
        await waitUntil("列出建议值", () => options().length === 3);
        await field.trigger("keydown", {key: "ArrowDown"});
        await field.trigger("keydown", {key: "ArrowDown"});
        await field.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["女"]);
        await field.setValue("");
        await waitUntil("又列出来", () => options().length === 3);
        let outside = 0;
        wrapper.element.parentElement!.addEventListener("keydown", () => (outside += 1));
        await field.trigger("keydown", {key: "Escape"});
        await waitUntil("收起", () => options().length === 0);
        expect(outside).toBe(0);
        await field.trigger("keydown", {key: "Escape"});
        expect(outside).toBe(1);
    });
});
