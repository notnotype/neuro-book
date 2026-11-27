/**
 * NewEntryDialog（同名 .md，docs/specs/canon/author-ui.md 输出 4）：名字为空时“新建”不可用；改字段发新的完整草稿；分组跟着
 * 种类，改过分组以后不跟；选定种类时勾上它默认的设定组，动过勾选以后不跟（点预设不算动过）；勾选列表的“适用于”与预设跟着选定的
 * 种类；选了本体以后上级跟着它；勾选动过又与默认不同时能恢复默认；名字框里回车新建；保存中不能关、按钮不可用。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {emptyDraft} from "../../new-entry";
import type {NewEntryDraft} from "../../new-entry";
import {canonCatalogs} from "../../text";
import NewEntryDialog from "./NewEntryDialog.vue";
import type {ChecklistItem} from "../entry-page/component-checklist";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function dialog(draft: NewEntryDraft, extra: Record<string, unknown> = {}) {
    const wrapper = mount(NewEntryDialog, {props: {open: true, draft, kinds: ["人物", "地点"], ...extra}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    const root = (): Element => document.body.querySelector("[role='dialog']")!;
    const button = (label: string): HTMLButtonElement => [...root().querySelectorAll("button")].find((item) => item.textContent?.trim() === label)!;
    const inputs = (): HTMLInputElement[] => [...root().querySelectorAll("input")] as HTMLInputElement[];
    await waitUntil("对话框挂出来", () => document.body.querySelector("[role='dialog'] [data-new-entry]") !== null);
    return {wrapper, root, button, inputs};
}

const item = (value: string, label: string, kinds: string[] = []): ChecklistItem => ({value, label, iconClass: "i-lucide-box", group: "canon", kinds, present: false, restore: false});

/** 开一个空草稿的对话框，像宿主那样把发出的草稿交回去；勾着的读勾选列表的行。 */
async function choosing(extra: Record<string, unknown>) {
    const opened = await dialog(emptyDraft(), extra);
    const follow = async () => opened.wrapper.setProps({draft: opened.wrapper.emitted<[NewEntryDraft]>("update:draft")!.at(-1)![0]});
    const checked = () => [...opened.root().querySelectorAll<HTMLElement>("[role='option'][aria-selected='true']")].map((option) => option.textContent?.trim());
    const row = (value: string) => opened.root().querySelector<HTMLElement>(`[data-checklist-item='${value}']`)!;
    return {...opened, follow, checked, row};
}

describe("NewEntryDialog", () => {
    it("名字为空时“新建”不可用；有名字以后可用，点了发 confirm", async () => {
        const empty = await dialog(emptyDraft());
        expect(empty.button("新建").disabled).toBe(true);
        empty.wrapper.unmount();
        const named = await dialog({...emptyDraft(), name: "魔杖"});
        expect(named.button("新建").disabled).toBe(false);
        named.button("新建").click();
        expect(named.wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("改种类发新的草稿，分组跟着种类；点已有的种类填进去；改过分组以后不再跟", async () => {
        const {wrapper, button, inputs} = await dialog(emptyDraft());
        const kind = inputs()[1]!;
        kind.value = "物品";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "物品", folder: "物品", folderTouched: false});
        button("地点").click();
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "地点", folder: "地点"});
        await wrapper.setProps({draft: {...emptyDraft(), kind: "地点", folder: "城市", folderTouched: true}});
        button("人物").click();
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "人物", folder: "城市", folderTouched: true});
    });

    it("选定种类（点候选、输入框失焦）时勾上它默认的设定组，打字时不勾；动过勾选以后不再跟着种类换", async () => {
        const items = [item("t.person", "人物", ["人物"]), item("t.look", "形象", ["人物"]), item("t.panel", "面板")];
        const kindDefaults = {人物: ["t.person", "t.look"]};
        const {wrapper, button, inputs, follow, checked, row} = await choosing({items, kindDefaults});

        button("人物").click();
        await follow();
        expect(checked()).toEqual(["人物", "形象"]);

        const kind = inputs()[1]!;
        kind.value = "地";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        await follow();
        expect(checked()).toEqual(["人物", "形象"]);
        kind.value = "地点";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        await follow();
        kind.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await follow();
        expect(checked()).toEqual([]);

        button("人物").click();
        await follow();
        row("t.panel").click();
        await follow();
        expect(wrapper.emitted<[NewEntryDraft]>("update:draft")!.at(-1)![0]).toMatchObject({types: ["t.person", "t.look", "t.panel"], typesTouched: true});
        button("地点").click();
        await follow();
        expect(checked()).toEqual(["人物", "形象", "面板"]);
    });

    it("勾选列表的“适用于”与预设跟着选定的种类换，打字时不换；点预设不算动过勾选，之后换种类照旧换成那个种类的默认；Ctrl 加回车不新建", async () => {
        const items = [item("t.person", "人物", ["人物"]), item("t.look", "形象", ["人物"]), item("t.panel", "面板")];
        const kindPresets = {人物: [{id: "main", label: "主要角色", components: ["t.person", "t.look", "t.panel"]}]};
        const {wrapper, button, inputs, follow, checked, root} = await choosing({items, kindDefaults: {人物: ["t.person"], 地点: []}, kindPresets});
        const groupNames = () => [...root().querySelectorAll("[role='listbox'] [role='group']")].map((group) => group.getAttribute("aria-label"));
        const presets = () => [...root().querySelectorAll("[data-checklist-presets] button")].map((preset) => preset.textContent?.trim());
        expect(groupNames()).toEqual(["设定"]);
        expect(presets()).toEqual([]);
        // 焦点在名字上（对话框的初始焦点），列表里不亮一块高亮。
        await waitUntil("焦点在名字上", () => document.activeElement === inputs()[0]);
        expect(root().querySelector("[data-highlighted]")).toBeNull();

        const kind = inputs()[1]!;
        kind.value = "人物";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        await follow();
        expect(groupNames()).toEqual(["设定"]);
        kind.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await follow();
        expect(groupNames()).toEqual(["适用于人物", "设定"]);
        expect(presets()).toEqual(["主要角色"]);
        expect(checked()).toEqual(["人物"]);

        root().querySelector<HTMLButtonElement>("[data-preset='main']")!.click();
        await follow();
        expect(checked()).toEqual(["人物", "形象", "面板"]);
        expect(wrapper.emitted<[NewEntryDraft]>("update:draft")!.at(-1)![0]).toMatchObject({typesTouched: false});
        // 再选定同一个种类（点它的按钮、种类的输入框失焦）：什么都不换，预设勾上的还在。
        const emitted = wrapper.emitted("update:draft")!.length;
        button("人物").click();
        kind.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await nextTick();
        expect(wrapper.emitted("update:draft")!.length).toBe(emitted);
        expect(checked()).toEqual(["人物", "形象", "面板"]);
        button("地点").click();
        await follow();
        expect(checked()).toEqual([]);
        expect(presets()).toEqual([]);

        // 宿主在对话框开着时换了一份草稿（又点了“新建人物”）：列表跟着新草稿选定的种类。
        await wrapper.setProps({draft: {...emptyDraft(), kind: "人物", kindChosen: "人物"}});
        expect(groupNames()).toEqual(["适用于人物", "设定"]);
        await wrapper.setProps({draft: {...wrapper.props("draft"), name: "魔杖"}});
        root().querySelector<HTMLInputElement>("[data-component-checklist] input")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true, cancelable: true}));
        expect(wrapper.emitted("confirm")).toBeUndefined();
    });

    it("种类写成 constructor、toString 这类词：没有默认、没有预设，照常选定", async () => {
        const items = [item("t.person", "人物", ["人物"])];
        const {wrapper, inputs, follow, checked, root} = await choosing({items, kindDefaults: {人物: ["t.person"]}, kindPresets: {人物: [{id: "main", label: "主要角色", components: ["t.person"]}]}});
        const kind = inputs()[1]!;
        for (const word of ["constructor", "toString", "__proto__"]) {
            kind.value = word;
            kind.dispatchEvent(new Event("input", {bubbles: true}));
            await follow();
            kind.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
            await follow();
            expect(wrapper.props("draft")).toMatchObject({kindChosen: word, types: []});
            expect(root().querySelector("[data-checklist-presets]")).toBeNull();
            expect(checked()).toEqual([]);
        }
    });

    it("保存中：按钮不可用；原因写在页脚的状态行", async () => {
        const {button, root} = await dialog({...emptyDraft(), name: "魔杖"}, {saving: true, error: "这次改动没有成功"});
        expect(button("新建").disabled).toBe(true);
        expect(button("取消").disabled).toBe(true);
        expect(root().querySelector("[aria-live='polite']")?.textContent?.trim()).toBe("这次改动没有成功");
    });

    it("名字框里回车新建；名字为空、输入法组字时的回车不新建；从“新建人物”打开时标题写“新建人物”", async () => {
        const empty = await dialog(emptyDraft());
        empty.inputs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        expect(empty.wrapper.emitted("confirm")).toBeUndefined();
        expect(empty.root().textContent).toContain("新建条目");
        empty.wrapper.unmount();

        const named = await dialog({...emptyDraft(), name: "星瑾", startKind: "人物", kind: "人物", kindChosen: "人物"});
        expect(named.root().textContent).toContain("新建人物");
        // 改选了别的种类：标题回到“新建条目”，不与下面的种类对不上。
        await named.wrapper.setProps({draft: {...named.wrapper.props("draft"), kind: "地点", kindChosen: "地点"}});
        expect(named.root().textContent).not.toContain("新建人物");
        named.inputs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true, cancelable: true}));
        // WebKit 在组字结束后才发选词的那次回车：isComposing 为假、keyCode 是 229。
        named.inputs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", keyCode: 229, bubbles: true, cancelable: true}));
        expect(named.wrapper.emitted("confirm")).toBeUndefined();
        named.inputs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        expect(named.wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("勾选动过、又与选定种类的默认不同时，设定组那一行有“恢复人物的默认”：点了换回默认、之后又跟着种类换；与默认相同时没有", async () => {
        const items = [item("t.person", "人物", ["人物"]), item("t.look", "形象", ["人物"]), item("t.panel", "面板")];
        const kindDefaults = {人物: ["t.person", "t.look"]};
        const person = {...emptyDraft(), kind: "人物", kindChosen: "人物", folder: "人物"};
        const restore = (root: () => Element) => root().querySelector<HTMLButtonElement>("[data-new-entry-restore]");

        const same = await dialog({...person, types: ["t.look", "t.person"], typesTouched: true}, {items, kindDefaults});
        expect(restore(same.root)).toBeNull();
        same.wrapper.unmount();

        // 还没选定种类：没有“某某的默认”可言，不出。
        const kindless = await dialog({...emptyDraft(), types: ["t.panel"], typesTouched: true}, {items, kindDefaults});
        expect(restore(kindless.root)).toBeNull();
        kindless.wrapper.unmount();

        const changed = await dialog({...person, types: ["t.person"], typesTouched: true}, {items, kindDefaults});
        expect(restore(changed.root)?.textContent?.trim()).toBe("恢复人物的默认");
        restore(changed.root)!.focus();
        restore(changed.root)!.click();
        expect(changed.wrapper.emitted<[NewEntryDraft]>("update:draft")!.at(-1)![0]).toMatchObject({types: ["t.person", "t.look"], typesTouched: false});
        // 按钮随即淡出：焦点交给勾选列表的搜索框，不落到 body。
        expect(document.activeElement).toBe(changed.root().querySelector("[data-component-checklist] input"));
    });

    it("位置与出场：收起时段头写现在的值；选了本体，上级跟着它、写“某某（跟着本体）”；清掉本体，上级也清掉", async () => {
        const found = {kind: "done", query: "", items: [{id: "e1", name: "星瑕", kind: "人物"}, {id: "e2", name: "学院", kind: "组织"}]};
        const opened = await choosing({sameAsResults: found, parentResults: found, chapters: [{id: "c2", index: 2}]});
        await opened.wrapper.setProps({draft: {...emptyDraft({parent: {id: "e2", name: "学院"}}), kind: "人物", appears: "c2"}});
        const summary = () => opened.root().querySelector("[data-new-entry-place-summary]")?.textContent?.trim();
        expect(summary()).toBe("人物 · 在学院下面 · 第 2 章出场");

        opened.root().querySelector<HTMLButtonElement>("[data-new-entry-place]")!.click();
        await waitUntil("展开位置与出场", () => opened.root().querySelector("[data-new-entry-same-as] input") !== null);
        const sameAs = opened.root().querySelector<HTMLInputElement>("[data-new-entry-same-as] input")!;
        sameAs.click();
        await waitUntil("列出候选", () => [...document.querySelectorAll("[role='option']")].some((option) => option.textContent?.includes("星瑕")));
        [...document.querySelectorAll<HTMLElement>("[role='option']")].find((option) => option.textContent?.includes("星瑕"))!.click();
        await opened.follow();
        expect(opened.wrapper.props("draft")).toMatchObject({sameAs: "e1", sameAsName: "星瑕", parent: "e1", parentName: "星瑕"});
        expect(summary()).toBe("人物 · 星瑕的马甲 · 第 2 章出场");
        await waitUntil("上级写成跟着本体", () => opened.root().querySelector("[data-new-entry-following]")?.textContent?.trim() === "星瑕（跟着本体）");
        expect(opened.root().querySelector("[data-new-entry-parent] input")).toBeNull();

        // 清掉本体：上级也清掉，上级的选择器回来。
        const clear = [...opened.root().querySelectorAll<HTMLButtonElement>("[data-new-entry-same-as] button")].find((button) => /清除|清空/u.test(button.getAttribute("aria-label") ?? ""));
        expect(clear).toBeDefined();
        clear!.click();
        await opened.follow();
        expect(opened.wrapper.props("draft")).toMatchObject({sameAs: null, sameAsName: "", parent: null, parentName: ""});
        await waitUntil("上级的选择器回来", () => opened.root().querySelector("[data-new-entry-parent] input") !== null);
        expect(opened.root().querySelector("[data-new-entry-following]")).toBeNull();
    });
});
