/**
 * CharacterCard 与 LookCard（同名 .md，docs/specs/canon/author-ui.md 输出 49、50、52）：立绘那一格的几种样子与点了发的事件；值是
 * 按钮，点了带着按钮发 edit，未知时写“填写”，读屏名带上是哪一项，写不了时不可用；短资料、成段的文字与外貌、立绘的“第 N 章改过”
 * 是按钮、发 origins，现在的状态的那个展开细节；添加一项资料发 add-preset、restore、add-own；衣柜的“换上”带着套名与按钮发
 * put-on，穿着的那一套写“穿着”。
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
    it("立绘那一格：有图、添加立绘（有形象没图与没有形象两种都是）、恢复形象、第 N 章起有形象（不可点）；类型不可用时不画；点了发 portrait", async () => {
        const cases: Array<[CardPortrait, string]> = [[{status: "no-image"}, "添加立绘"], [{status: "absent"}, "添加立绘"], [{status: "removed"}, "恢复形象"], [{status: "later", from: "第 3 章"}, "第 3 章起有形象"]];
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
        // 读屏名带上是哪一项；悬停看得到截断前的整个值。
        expect(value.attributes("aria-label")).toBe("性别：女");
        expect(wrapper.get("[data-edit='character.年龄']").attributes("aria-label")).toBe("年龄：填写");
        expect(value.attributes("title")).toBe("女");
        await wrapper.setProps({editReason: "先不算计划"});
        expect(wrapper.get("[data-edit='character.性别']").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-edit='character.性别']").attributes("title")).toBe("先不算计划");
    });

    it("成段的文字与现在的状态的“第 N 章改过”是按钮：段落的发 origins，现在的状态的展开它的细节；未知时没有", async () => {
        const wrapper = card({
            condition: {id: "现在的状态", label: "现在的状态", text: "左臂带伤", hint: "此刻的处境", mark: "第 3 章改过"},
            passages: [{id: "性格", label: "性格", text: "嘴硬心软", hint: "", mark: "第 2 章改过"}, {id: "背景", label: "背景", text: null, hint: "从哪里来", mark: "第 2 章改过"}],
        });
        const temper = wrapper.get("[data-origins='性格']");
        await temper.trigger("click");
        expect(wrapper.emitted("origins")).toEqual([["性格", temper.element]]);
        expect(wrapper.find("[data-origins='背景']").exists()).toBe(false);
        await wrapper.get("[data-origins='现在的状态']").trigger("click");
        expect(wrapper.emitted("toggle-condition")).toHaveLength(1);
        expect(wrapper.get("[data-edit='character.性格']").attributes("aria-label")).toBe("性格：嘴硬心软");
    });

    it("加上形象被拒：原因写在立绘下面；在途时那一格不可用", async () => {
        const wrapper = card({portrait: {status: "absent"}, portraitBusy: true});
        expect(wrapper.get("[data-portrait]").attributes("disabled")).toBeDefined();
        await wrapper.setProps({portraitBusy: false, portraitError: "这部作品此刻只读"});
        expect(wrapper.get("[data-portrait]").attributes("disabled")).toBeUndefined();
        expect(wrapper.get("[role='alert']").text()).toBe("这部作品此刻只读");
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

    it("立绘与外貌的“第 N 章改过”是按钮、发 origins；没有立绘时立绘的不出", async () => {
        const appearance = {id: "外貌", label: "外貌", text: "银发", hint: "", mark: "第 2 章改过"};
        const wrapper = mount(LookCard, {props: {portrait: {path: "插图/星瑕.png", alt: ""}, portraitMark: "第 4 章改过", appearance}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        await wrapper.get("[data-origins='立绘']").trigger("click");
        await wrapper.get("[data-origins='外貌']").trigger("click");
        expect(wrapper.emitted("origins")?.map(([id]) => id)).toEqual(["立绘", "外貌"]);
        expect(wrapper.get("[data-edit='外貌']").attributes("aria-label")).toBe("外貌：银发");
        await wrapper.setProps({portrait: null});
        expect(wrapper.find("[data-origins='立绘']").exists()).toBe(false);
    });
});
