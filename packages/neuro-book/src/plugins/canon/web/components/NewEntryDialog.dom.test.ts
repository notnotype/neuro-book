/**
 * NewEntryDialog（同名 .md，docs/specs/canon/author-ui.md 输出 4）：名字为空时“新建”不可用；改字段发新的完整草稿；分组跟着
 * 种类，改过分组以后不跟；选定种类时勾上它默认的设定组，动过勾选以后不跟（点预设不算动过）；勾选列表的“适用于”与预设跟着选定的
 * 种类；选了另一个身份以后放在它下面；保存中不能关、按钮不可用。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {emptyDraft} from "../new-entry";
import type {NewEntryDraft} from "../new-entry";
import {canonCatalogs} from "../text";
import NewEntryDialog from "./NewEntryDialog.vue";
import type {ChecklistItem} from "./component-checklist";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

async function dialog(draft: NewEntryDraft, extra: Record<string, unknown> = {}) {
    const wrapper = mount(NewEntryDialog, {props: {open: true, draft, kinds: ["人物", "地点"], entries: [{id: "e1", name: "星瑕"}], ...extra}, global: {provide: provideText(port)}, attachTo: document.body});
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
    const opened = await dialog(emptyDraft(null), extra);
    const follow = async () => opened.wrapper.setProps({draft: opened.wrapper.emitted<[NewEntryDraft]>("update:draft")!.at(-1)![0]});
    const checked = () => [...opened.root().querySelectorAll<HTMLElement>("[role='option'][aria-selected='true']")].map((option) => option.textContent?.trim());
    const row = (value: string) => opened.root().querySelector<HTMLElement>(`[data-checklist-item='${value}']`)!;
    return {...opened, follow, checked, row};
}

describe("NewEntryDialog", () => {
    it("名字为空时“新建”不可用；有名字以后可用，点了发 confirm", async () => {
        const empty = await dialog(emptyDraft(null));
        expect(empty.button("新建").disabled).toBe(true);
        empty.wrapper.unmount();
        const named = await dialog({...emptyDraft(null), name: "魔杖"});
        expect(named.button("新建").disabled).toBe(false);
        named.button("新建").click();
        expect(named.wrapper.emitted("confirm")).toHaveLength(1);
    });

    it("改种类发新的草稿，分组跟着种类；点已有的种类填进去；改过分组以后不再跟", async () => {
        const {wrapper, button, inputs} = await dialog(emptyDraft(null));
        const kind = inputs()[1]!;
        kind.value = "物品";
        kind.dispatchEvent(new Event("input", {bubbles: true}));
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "物品", folder: "物品", folderTouched: false});
        button("地点").click();
        expect(wrapper.emitted("update:draft")?.at(-1)?.[0]).toMatchObject({kind: "地点", folder: "地点"});
        await wrapper.setProps({draft: {...emptyDraft(null), kind: "地点", folder: "城市", folderTouched: true}});
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
        const groupNames = () => [...root().querySelectorAll("[role='listbox'] > [role='group']")].map((group) => group.getAttribute("aria-label"));
        const presets = () => [...root().querySelectorAll("[data-checklist-presets] button")].map((preset) => preset.textContent?.trim());
        expect(groupNames()).toEqual(["设定"]);
        expect(presets()).toEqual([]);

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
        button("地点").click();
        await follow();
        expect(checked()).toEqual([]);
        expect(presets()).toEqual([]);

        await wrapper.setProps({draft: {...wrapper.props("draft"), name: "魔杖"}});
        root().querySelector<HTMLInputElement>("[data-component-checklist] input")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true, cancelable: true}));
        expect(wrapper.emitted("confirm")).toBeUndefined();
    });

    it("保存中：按钮不可用；原因写在对话框里", async () => {
        const {button, root} = await dialog({...emptyDraft(null), name: "魔杖"}, {saving: true, error: "这次改动没有成功"});
        expect(button("新建").disabled).toBe(true);
        expect(button("取消").disabled).toBe(true);
        expect(root().querySelector("[role='alert']")?.textContent).toBe("这次改动没有成功");
    });
});
