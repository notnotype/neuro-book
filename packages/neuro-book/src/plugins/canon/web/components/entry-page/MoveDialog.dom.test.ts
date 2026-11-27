/**
 * MoveDialog（同名 .md）：改分组、种类、顺序与出场各发新的完整草稿；“移动”发 confirm；失败的原因写在对话框里。上级与马甲的
 * 选择器在 EntryPicker 的测试里，宿主里的整条路在 entry-page.dom.test.ts。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import type {MoveDraft} from "./move-dialog";
import MoveDialog from "./MoveDialog.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const DRAFT: MoveDraft = {parent: null, parentName: "", folder: "人物", kind: "人物", order: "keep", appears: null, sameAs: null, sameAsName: ""};

describe("MoveDialog", () => {
    it("改分组、种类各发新的完整草稿；“移动”发 confirm；失败的原因写在对话框里", async () => {
        const wrapper = mount(MoveDialog, {props: {open: true, entry: {id: "e1", name: "星瑕"}, draft: DRAFT, parentResults: {kind: "idle"}, sameAsResults: {kind: "idle"}, chapters: [{id: "1", index: 1}], error: "成环了"}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        await waitUntil("对话框", () => document.body.querySelector("[data-move-dialog]") !== null);
        expect(document.body.querySelector("[role='dialog']")?.textContent).toContain("移动“星瑕”");
        expect(document.body.querySelector("[data-move-dialog] [role='alert']")?.textContent).toBe("成环了");
        const inputs = [...document.body.querySelectorAll<HTMLInputElement>("[data-move-dialog] input:not([role='combobox'])")];
        inputs[0]!.value = "主角团";
        inputs[0]!.dispatchEvent(new Event("input", {bubbles: true}));
        inputs[1]!.value = "主角";
        inputs[1]!.dispatchEvent(new Event("input", {bubbles: true}));
        expect(wrapper.emitted("update:draft")).toEqual([[{...DRAFT, folder: "主角团"}], [{...DRAFT, kind: "主角"}]]);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "移动")!.click();
        expect(wrapper.emitted("confirm")).toHaveLength(1);
    });
});
