/**
 * AddComponentDialog（同名 .md，docs/specs/canon/author-ui.md 输出 38）：主按钮写组数、Ctrl 加回车提交、已添加的那一行切过去并关上、
 * 每次打开清空、写入在途与失败、别处加上了勾着的那个模块。焦点还给入口在宿主的测试里（entry-page.dom.test.ts）。
 */

import {DOMWrapper, flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import AddComponentDialog from "./AddComponentDialog.vue";
import type {ChecklistItem} from "./component-checklist";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const item = (value: string, label: string, present = false): ChecklistItem => ({value, label, iconClass: "i-lucide-box", group: "canon", kinds: ["人物"], present, restore: false});
const ITEMS = [item("nbook.canon.person", "人物", true), item("nbook.canon.look", "形象"), item("nbook.canon.panel", "数值")];

function open() {
    const state = {open: shallowRef(true), items: shallowRef<readonly ChecklistItem[]>(ITEMS), busy: shallowRef(false), error: shallowRef("")};
    const events: Array<[string, unknown]> = [];
    const Host = defineComponent(() => () => h(AddComponentDialog, {
        open: state.open.value,
        items: state.items.value,
        kind: "人物",
        presets: [{id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.look"]}],
        busy: state.busy.value,
        error: state.error.value,
        "onUpdate:open": (value: boolean) => {
            events.push(["update:open", value]);
            state.open.value = value;
        },
        onAdd: (types: readonly string[]) => events.push(["add", types]),
        onShow: (type: string) => events.push(["show", type]),
    }));
    mounted.push(mount(Host, {global: {provide: provideText(port)}, attachTo: document.body}));
    return {state, events};
}

const body = () => new DOMWrapper(document.body);
const submit = () => document.querySelector<HTMLButtonElement>("[data-add-submit]")!;
const row = (value: string) => document.querySelector<HTMLElement>(`[data-checklist-item='${value}']`)!;
const search = () => document.querySelector<HTMLInputElement>("[data-component-checklist] input")!;
const keydown = (init: KeyboardEventInit) => search().dispatchEvent(new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init}));
/** 点一行：勾选在对话框里受控，等它重画（真实点击之间总有这一轮）。 */
const click = async (value: string): Promise<void> => {
    row(value).click();
    await flushPromises();
};

describe("AddComponentDialog", () => {
    it("标题“添加模块”、焦点进搜索框；没勾时主按钮写“添加”且不可用，勾了 N 组写“添加 N 组”；点它或 Ctrl 加回车发 add(勾着的)", async () => {
        const {events} = open();
        await waitUntil("对话框", () => search() !== null);
        expect(body().get("[role='dialog']").text()).toContain("添加模块");
        await waitUntil("焦点进搜索框", () => document.activeElement === search());
        expect(submit().textContent?.trim()).toBe("添加");
        expect(submit().disabled).toBe(true);
        keydown({key: "Enter", ctrlKey: true});
        await flushPromises();
        expect(events).toEqual([]);
        await click("nbook.canon.look");
        await click("nbook.canon.panel");
        expect(submit().textContent?.trim()).toBe("添加 2 个");
        expect(submit().getAttribute("aria-label")).toBe("添加 2 个");
        expect(submit().dataset.shortcut).toMatch(/^(Ctrl|⌘) ↵$/u);
        submit().click();
        keydown({key: "Enter", ctrlKey: true});
        await flushPromises();
        expect(events).toEqual([["add", ["nbook.canon.look", "nbook.canon.panel"]], ["add", ["nbook.canon.look", "nbook.canon.panel"]]]);
    });

    it("点已添加的那一行：发 show 并关上；再打开时勾选清空", async () => {
        const {state, events} = open();
        await waitUntil("对话框", () => search() !== null);
        await click("nbook.canon.look");
        await click("nbook.canon.person");
        expect(events).toEqual([["show", "nbook.canon.person"], ["update:open", false]]);
        await waitUntil("关上", () => search() === null);
        state.open.value = true;
        await waitUntil("再打开", () => search() !== null);
        expect(submit().textContent?.trim()).toBe("添加");
    });

    it("写入在途：主按钮不可用、Escape 不关、点已添加的也不切；失败的原因写在状态行，勾选留着", async () => {
        const {state, events} = open();
        await waitUntil("对话框", () => search() !== null);
        await click("nbook.canon.look");
        state.busy.value = true;
        await flushPromises();
        expect(submit().disabled).toBe(true);
        keydown({key: "Escape"});
        row("nbook.canon.person").click();
        submit().click();
        await flushPromises();
        expect(events).toEqual([]);
        expect(search()).not.toBeNull();
        state.busy.value = false;
        state.error.value = "“形象”模块已经加上了";
        await flushPromises();
        expect(body().get("[role='dialog']").text()).toContain("“形象”模块已经加上了");
        expect(submit().textContent?.trim()).toBe("添加 1 个");
    });

    it("开着的时候勾着的一个模块在别处加上了（重读回来成了已添加）：从勾选里去掉", async () => {
        const {state} = open();
        await waitUntil("对话框", () => search() !== null);
        await click("nbook.canon.look");
        await click("nbook.canon.panel");
        state.items.value = [item("nbook.canon.person", "人物", true), item("nbook.canon.look", "形象", true), item("nbook.canon.panel", "数值")];
        await flushPromises();
        expect(submit().textContent?.trim()).toBe("添加 1 个");
    });
});
