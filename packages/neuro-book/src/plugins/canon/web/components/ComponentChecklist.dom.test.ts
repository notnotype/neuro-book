/**
 * ComponentChecklist（同名 .md，docs/specs/canon/author-ui.md 输出 4、38）：按组列出、打字筛、勾与取消、预设、已添加的那一行、键盘。
 * 列表的滚动与高亮的底色在 e2e 与 Lab。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import ComponentChecklist from "./ComponentChecklist.vue";
import type {ChecklistGroup, ChecklistItem, ChecklistPreset} from "./component-checklist";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const PERSON = ["人物"];
const item = (value: string, label: string, group: ChecklistGroup, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({value, label, iconClass: "i-lucide-box", group, kinds: [], present: false, restore: false, ...extra});
const ITEMS: ChecklistItem[] = [
    item("nbook.canon.person", "人物", "canon", {kinds: PERSON, present: true}),
    item("nbook.canon.inventory", "物品栏", "canon"),
    item("nbook.canon.panel", "数值", "canon", {restore: true}),
    item("a.test.badge", "徽章", "other"),
    item("nbook.plot.knowing", "知道什么", "plot", {kinds: PERSON}),
    item("nbook.canon.skills", "技能", "canon", {kinds: PERSON}),
];
const PRESETS: ChecklistPreset[] = [
    {id: "basic", label: "基本", components: ["nbook.canon.person", "nbook.canon.skills"]},
    {id: "main", label: "主要角色", components: ["nbook.canon.person", "nbook.canon.skills", "nbook.canon.panel", "nbook.plot.knowing"]},
];

/** 像宿主那样接 v-model：勾选记在外面，组件只发事件。 */
function open(props: Partial<{items: ChecklistItem[]; kind: string; presets: ChecklistPreset[]; initial: string[]}> = {}) {
    const checked = shallowRef<readonly string[]>(props.initial ?? []);
    const events: Array<[string, unknown]> = [];
    const handle = shallowRef<{focus(): void} | null>(null);
    const Host = defineComponent(() => () => h(ComponentChecklist, {
        ref: (instance: unknown) => (handle.value = instance as {focus(): void} | null),
        items: props.items ?? ITEMS,
        kind: props.kind ?? "人物",
        presets: props.presets ?? PRESETS,
        modelValue: checked.value,
        "onUpdate:modelValue": (value: readonly string[], via: string) => {
            checked.value = value;
            events.push(["update", via]);
        },
        onPresent: (type: string) => events.push(["present", type]),
        onSubmit: () => events.push(["submit", null]),
    }));
    const wrapper = mount(Host, {global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, checked, events, handle};
}

const clean = (value: string | null | undefined): string => value?.replace(/\s+/gu, "") ?? "";
/** 各组：组名与组里各行的名字（行尾的“已添加”另算）。 */
const groups = (): Array<[string, string[]]> => [...document.querySelectorAll<HTMLElement>("[role='listbox'] [role='group']")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll<HTMLElement>("[role='option']")].map((option) => clean(option.textContent)),
]);
const options = (): string[] => [...document.querySelectorAll<HTMLElement>("[role='option']")].map((option) => clean(option.textContent));
const selected = (): string[] => [...document.querySelectorAll<HTMLElement>("[role='option'][aria-selected='true']")].map((option) => clean(option.textContent));
const highlighted = (): string => clean(document.querySelector<HTMLElement>("[role='option'][data-highlighted]")?.textContent);
const search = (): HTMLInputElement => document.querySelector<HTMLInputElement>("[data-component-checklist] input")!;
const row = (value: string): HTMLElement => document.querySelector<HTMLElement>(`[data-checklist-item='${value}']`)!;
const preset = (id: string): HTMLButtonElement => document.querySelector<HTMLButtonElement>(`[data-preset='${id}']`)!;
/** 点一行：勾选是受控的，等宿主把新的勾选传回来（真实点击之间总有这一轮）。 */
const click = async (value: string): Promise<void> => {
    row(value).click();
    await flushPromises();
};
const type = async (value: string): Promise<void> => {
    search().value = value;
    search().dispatchEvent(new Event("input"));
    await flushPromises();
};
/** 在搜索框里按一个键（焦点先放进去，像作者在打字）。 */
const key = async (name: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    if (document.activeElement !== search()) search().focus();
    const event = new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true, ...init});
    search().dispatchEvent(event);
    await flushPromises();
    return event;
};

describe("ComponentChecklist", () => {
    it("不打字时：适用于这个种类的在最前，其余按设定、剧情、插件分组，组内照给的顺序；已经有的勾着、写“已添加”，去掉过的写“恢复”；没有种类时没有“适用于”", async () => {
        open();
        await flushPromises();
        expect(groups()).toEqual([
            ["适用于人物", ["人物已添加", "知道什么", "技能"]],
            ["设定", ["物品栏", "恢复“数值”"]],
            ["插件", ["徽章"]],
        ]);
        expect(selected()).toEqual(["人物已添加"]);
        mounted.pop()!.unmount();
        open({kind: ""});
        await flushPromises();
        expect(groups().map(([label]) => label)).toEqual(["设定", "剧情", "插件"]);
    });

    it("高亮第一项还没添加的，focus() 把焦点放进搜索框；打字只按名字筛（不分大小写、不管空格）、不分组；对不上时写出搜的词", async () => {
        const {handle} = open();
        await flushPromises();
        // 焦点还不在列表上：高亮记着第一项还没添加的，但不画。
        expect(search().getAttribute("aria-activedescendant")).toBe(row("nbook.plot.knowing").id);
        expect(highlighted()).toBe("");
        handle.value!.focus();
        await flushPromises();
        expect(document.activeElement).toBe(search());
        expect(highlighted()).toBe("知道什么");
        await type("物品 栏");
        expect(options()).toEqual(["物品栏"]);
        expect(groups().map(([label]) => label)).toEqual([""]);
        await type("龙");
        expect(options()).toEqual([]);
        expect(document.querySelector("[data-component-checklist]")?.textContent).toContain("没有叫“龙”的设定组");
    });

    it("点一行勾上、再点取消，次序同勾的先后；被筛掉的勾选照旧算；已添加的那一行点了不取消、发 present", async () => {
        const {checked, events} = open();
        await flushPromises();
        await click("nbook.canon.skills");
        await click("a.test.badge");
        expect(checked.value).toEqual(["nbook.canon.skills", "a.test.badge"]);
        expect(row("a.test.badge").getAttribute("aria-selected")).toBe("true");
        await type("徽章");
        await click("a.test.badge");
        expect(checked.value).toEqual(["nbook.canon.skills"]);
        await type("技能");
        await type("");
        expect(checked.value).toEqual(["nbook.canon.skills"]);
        await click("nbook.canon.person");
        expect(checked.value).toEqual(["nbook.canon.skills"]);
        expect(row("nbook.canon.person").getAttribute("aria-selected")).toBe("true");
        expect(events.filter(([name]) => name === "present")).toEqual([["present", "nbook.canon.person"]]);
        expect(events.filter(([name]) => name === "update").map(([, via]) => via)).toEqual(["row", "row", "row"]);
    });

    it("预设：把里面还没添加、还没勾的勾上，不取消别的，标明是预设勾的；里面都已添加或已勾时不可用", async () => {
        const {checked, events} = open({initial: ["a.test.badge"]});
        await flushPromises();
        expect([...document.querySelectorAll("[data-checklist-presets] button")].map((button) => button.textContent?.trim())).toEqual(["基本", "主要角色"]);
        expect(document.querySelector("[data-checklist-presets]")?.getAttribute("role")).toBe("group");
        preset("basic").click();
        await flushPromises();
        expect(checked.value).toEqual(["a.test.badge", "nbook.canon.skills"]);
        expect(events).toEqual([["update", "preset"]]);
        expect(preset("basic").disabled).toBe(true);
        preset("main").click();
        await flushPromises();
        expect(checked.value).toEqual(["a.test.badge", "nbook.canon.skills", "nbook.canon.panel", "nbook.plot.knowing"]);
        expect(preset("main").disabled).toBe(true);
        // 取消一组手选的：预设又能点了。
        await click("nbook.plot.knowing");
        expect(preset("main").disabled).toBe(false);
        // 按下预设不抢搜索框的焦点；用键盘按的（焦点在按钮上），按完焦点回到搜索框，接着能用上下键与回车。
        search().focus();
        const down = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        preset("main").dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
        preset("main").focus();
        preset("main").click();
        await flushPromises();
        expect(document.activeElement).toBe(search());
        expect(highlighted()).not.toBe("");
    });

    it("指针在列表上移动时高亮跟着它、读屏的当前项也跟着；移出列表高亮不画，记着的那一行不变", async () => {
        open();
        await flushPromises();
        row("nbook.canon.inventory").dispatchEvent(new PointerEvent("pointermove", {bubbles: true}));
        await flushPromises();
        expect(highlighted()).toBe("物品栏");
        expect(search().getAttribute("aria-activedescendant")).toBe(row("nbook.canon.inventory").id);
        document.querySelector("[role='listbox']")!.dispatchEvent(new PointerEvent("pointerleave"));
        await flushPromises();
        expect(highlighted()).toBe("");
        expect(search().getAttribute("aria-activedescendant")).toBe(row("nbook.canon.inventory").id);
    });

    it("键盘：上下键移高亮、到头绕回；Enter 勾或取消高亮的那行，高亮的是已添加的发 present；Ctrl 或 ⌘ 加 Enter 发 submit；组字中的 Enter 不处理", async () => {
        const {checked, events} = open();
        await flushPromises();
        search().focus();
        await flushPromises();
        expect(highlighted()).toBe("知道什么");
        await key("ArrowUp");
        expect(highlighted()).toBe("人物已添加");
        await key("ArrowUp");
        expect(highlighted()).toBe("徽章");
        await key("ArrowDown");
        expect(highlighted()).toBe("人物已添加");
        expect((await key("Enter")).defaultPrevented).toBe(true);
        expect(events).toEqual([["present", "nbook.canon.person"]]);
        events.length = 0;
        await key("ArrowDown");
        await key("Enter");
        expect(checked.value).toEqual(["nbook.plot.knowing"]);
        await key("Enter", {isComposing: true});
        await key("Enter", {keyCode: 229});
        expect(checked.value).toEqual(["nbook.plot.knowing"]);
        await key("Enter");
        expect(checked.value).toEqual([]);
        await key("Enter", {ctrlKey: true});
        await key("Enter", {metaKey: true});
        expect(events.filter(([name]) => name === "submit")).toHaveLength(2);
        expect(checked.value).toEqual([]);
    });

    it("读屏：搜索框是 combobox、指着列表，列表可多选，每组以组名作读屏名", async () => {
        open();
        await flushPromises();
        const list = document.querySelector<HTMLElement>("[role='listbox']")!;
        expect(search().getAttribute("role")).toBe("combobox");
        expect(search().getAttribute("aria-controls")).toBe(list.id);
        expect(list.getAttribute("aria-multiselectable")).toBe("true");
    });
});
