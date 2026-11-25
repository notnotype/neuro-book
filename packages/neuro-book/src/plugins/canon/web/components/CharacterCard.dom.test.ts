/**
 * CharacterCard 与 LookCard（同名 .md，docs/specs/canon/author-ui.md 输出 49、50、52）：立绘那一格的几种样子与点了发的事件；值是
 * 按钮，点了带着按钮发 edit，未知时写“填写”，写不了时不可用；“第 N 章改过”发 origins；添加一项资料发 add-preset、restore、
 * add-own；衣柜的“换上”带着套名与按钮发 put-on，穿着的那一套写“穿着”。
 */

import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import CharacterCard from "./CharacterCard.vue";
import type {CardPortrait} from "./character-card";
import LookCard from "./LookCard.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const FACTS = [{id: "性别", label: "性别", text: "女"}, {id: "现在在哪", label: "现在在哪", text: "老宅", link: true, mark: "第 2 章改过"}, {id: "年龄", label: "年龄", text: null}, {id: "种族", label: "种族", text: "人类", own: true}];
function card(props: Record<string, unknown> = {}): VueWrapper {
    const wrapper = mount(CharacterCard, {props: {facts: FACTS, portrait: {status: "no-image"}, namespace: "character", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("CharacterCard", () => {
    it("立绘那一格：有图、添加立绘、添加形象、恢复形象、第 N 章起有形象（不可点）；类型不可用时不画；点了发 portrait", async () => {
        const cases: Array<[CardPortrait, string]> = [[{status: "no-image"}, "添加立绘"], [{status: "absent"}, "添加形象"], [{status: "removed"}, "恢复形象"], [{status: "later", from: "第 3 章"}, "第 3 章起有形象"]];
        for (const [portrait, label] of cases) {
            const wrapper = card({portrait});
            expect(wrapper.get("[data-portrait]").text()).toContain(label);
            await wrapper.get("[data-portrait]").trigger("click");
            expect(wrapper.emitted("portrait")?.length ?? 0).toBe(portrait.status === "later" ? 0 : 1);
            wrapper.unmount();
        }
        expect(card({portrait: {status: "unavailable"}}).find("[data-portrait]").exists()).toBe(false);
        expect(card({portrait: {status: "image", path: "插图/星瑕.png", alt: "星瑕"}}).find("[data-canon-image='插图/星瑕.png']").exists()).toBe(true);
    });

    it("值是按钮：带着按钮发 edit，data-edit 写完整路径，未知写“填写”；“第 N 章改过”发 origins；写不了时不可用、悬停写原因", async () => {
        const wrapper = card();
        expect(wrapper.get("[data-fact='年龄']").text()).toContain("填写");
        const value = wrapper.get("[data-edit='character.性别']");
        await value.trigger("click");
        expect(wrapper.emitted("edit")).toEqual([["性别", value.element]]);
        await wrapper.get("[data-origins='现在在哪']").trigger("click");
        expect(wrapper.emitted("origins")?.[0]?.[0]).toBe("现在在哪");
        expect(wrapper.find("[data-origins='年龄']").exists()).toBe(false);
        await wrapper.setProps({editReason: "先关掉按计划"});
        expect(wrapper.get("[data-edit='character.性别']").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-edit='character.性别']").attributes("title")).toBe("先关掉按计划");
    });

    it("添加一项资料：点预设发 add-preset，点去掉过的发 restore，自己写名字发 add-own；被拒的原因写在下面", async () => {
        const wrapper = card({canAdd: true, addOpen: true, presets: [{id: "生日", label: "生日"}], removed: [{id: "身高", label: "身高"}], addError: "名字重了"});
        await waitUntil("浮层", () => document.body.querySelector("[data-add-field-panel]") !== null);
        (document.body.querySelector("[data-preset='生日']") as HTMLElement).click();
        (document.body.querySelector("[data-restore='身高']") as HTMLElement).click();
        expect(document.body.querySelector("[data-restore='身高']")?.textContent).toContain("恢复“身高”");
        const input = document.body.querySelector<HTMLInputElement>("[data-add-field-panel] input")!;
        input.value = " 弱点 ";
        input.dispatchEvent(new Event("input", {bubbles: true}));
        await waitUntil("能添加", () => !(document.body.querySelector("[data-add-field-panel] button[type='submit']") as HTMLButtonElement).disabled);
        document.body.querySelector("[data-add-field-panel] form")!.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}));
        expect(wrapper.emitted("add-preset")).toEqual([["生日"]]);
        expect(wrapper.emitted("restore")).toEqual([["身高"]]);
        expect(wrapper.emitted("add-own")).toEqual([["弱点"]]);
        expect(document.body.querySelector("[data-add-field-panel] [role='alert']")?.textContent).toBe("名字重了");
    });
});

describe("LookCard", () => {
    it("衣柜：穿着的那一套写“穿着”，别的“换上”带着套名与按钮发 put-on；空着时只有“添加一套”；立绘空着写“添加立绘”", async () => {
        const outfits = [{id: "i1", name: "便装", look: "连帽衫", image: null, wearing: true}, {id: "i2", name: "制服", look: "藏青外套", image: null, wearing: false}];
        const wrapper = mount(LookCard, {props: {portrait: null, outfits, wearing: {id: "现在穿的", label: "现在穿的", text: "便装"}}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        expect(wrapper.get("[data-outfit='i1']").text()).toContain("穿着");
        expect(wrapper.find("[data-put-on='i1']").exists()).toBe(false);
        const putOn = wrapper.get("[data-put-on='i2']");
        await putOn.trigger("click");
        expect(wrapper.emitted("put-on")).toEqual([["制服", putOn.element]]);
        expect(wrapper.get("[data-edit='立绘']").text()).toContain("添加立绘");
        await wrapper.get("[data-outfit-add]").trigger("click");
        expect(wrapper.emitted("outfit-add")).toHaveLength(1);
        await wrapper.setProps({outfits: []});
        await waitUntil("衣柜空了", () => wrapper.findAll("[data-outfit]").length === 0);
        expect(wrapper.find("[data-outfit-add]").exists()).toBe(true);
    });
});
