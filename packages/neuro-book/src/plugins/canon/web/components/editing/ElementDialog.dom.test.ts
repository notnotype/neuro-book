/**
 * ElementDialog（同名 .md）：别的列表填名字、以条目为键的列表选条目；子字段改了按字段发新值；改一项时键不能换、语义档只读；
 * “保存”发 confirm，失败的原因写在对话框里。宿主里的整条路（发一次改几处、写进世界）在 entry-page.dom.test.ts。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import type {ElementField} from "./element-dialog";
import ElementDialog from "./ElementDialog.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const FIELDS: ElementField[] = [{id: "程度", label: "程度", kind: "enum", options: ["知道", "怀疑"]}, {id: "数量", label: "数量", kind: "number"}, {id: "想法", label: "想法", kind: "text", semantic: true}];
const BASE = {open: true, title: "给“知情”加一项", label: "", fields: FIELDS, values: {程度: "知道", 数量: "1", 想法: "觉得校长在隐瞒"}, keyValue: null, keyResults: {kind: "idle"} as const, refResults: {kind: "idle"} as const, intents: ["creative", "story"] as const, intent: "creative" as const};

const show = (props: Partial<InstanceType<typeof ElementDialog>["$props"]> & {keyed: boolean; editing: boolean}) => {
    const wrapper = mount(ElementDialog, {props: {...BASE, ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};
const dialog = () => document.body.querySelector("[data-element-dialog]")!;

describe("ElementDialog", () => {
    it("加一项：别的列表填名字、子字段改了按字段发新值、语义档可以填起点；“保存”发 confirm；失败的原因写在对话框里", async () => {
        const wrapper = show({keyed: false, editing: false, error: "“数量”填得不对"});
        await waitUntil("对话框", () => document.body.querySelector("[data-element-dialog]") !== null);
        expect(dialog().querySelector("input[role='combobox']")).toBeNull();
        expect(dialog().querySelector("[role='alert']")?.textContent).toBe("“数量”填得不对");
        const [name, count] = [...dialog().querySelectorAll<HTMLInputElement>("input")];
        name!.value = "盾";
        name!.dispatchEvent(new Event("input", {bubbles: true}));
        count!.value = "3";
        count!.dispatchEvent(new Event("input", {bubbles: true}));
        const thought = dialog().querySelector<HTMLTextAreaElement>("textarea")!;
        thought.value = "怀疑";
        thought.dispatchEvent(new Event("input", {bubbles: true}));
        expect(wrapper.emitted("update:label")).toEqual([["盾"]]);
        expect(wrapper.emitted("update:value")).toEqual([["数量", "3"], ["想法", "怀疑"]]);
        [...document.body.querySelectorAll<HTMLButtonElement>("[role='dialog'] button")].find((button) => button.textContent?.trim() === "保存")!.click();
        expect(wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("改一项：以条目为键时选择器不能换，语义档只读、写着在剧情里记一句来改", async () => {
        show({keyed: true, editing: true, keyValue: "k1", keyName: "学院的秘密"});
        await waitUntil("对话框", () => document.body.querySelector("[data-element-dialog]") !== null);
        const picker = dialog().querySelector<HTMLInputElement>("input[role='combobox']")!;
        expect(picker.disabled).toBe(true);
        expect(picker.value).toBe("学院的秘密");
        expect(dialog().querySelector("textarea")).toBeNull();
        expect(dialog().textContent).toContain("觉得校长在隐瞒");
        expect(dialog().textContent).toContain("在剧情里记一句来改");
    });
});
