/**
 * EntryPicker（同名 .md）与它的查找 `useEntryFind`（`entry-picker.ts`）：打开就查、打字后按词查；晚到的旧结果丢掉；查找失败与
 * 没有结果的提示；停用的条目；就地新建；清空。宿主是一个照文档用法接线的小组件，查找是内存里的、能控制何时回来的一份。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, ref, type PropType} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import {useEntryFind, type EntryCandidate, type EntryFind} from "./entry-picker";
import EntryPicker from "./EntryPicker.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const ENTRIES: readonly (EntryCandidate & {readonly aliases?: readonly string[]})[] = [
    {id: "e1", name: "星瑕", kind: "人物", aliases: ["小瑕"]},
    {id: "e2", name: "星瑾", kind: "人物"},
    {id: "e3", name: "星辰议会", kind: "组织"},
];

/** 按名字或别名包含搜索词找；`calls` 记下每次查的词。 */
function memoryFind(calls: string[]): EntryFind {
    return async (query) => {
        calls.push(query);
        return {ok: true, items: ENTRIES.filter((entry) => entry.name.includes(query) || entry.aliases?.some((alias) => alias.includes(query)) === true).map(({aliases: _aliases, ...item}) => item)};
    };
}

/** 每次查找都挂着，由测试决定什么时候、以什么结果回来。 */
function heldFind(): {find: EntryFind; pending: Array<{query: string; resolve(items: readonly EntryCandidate[]): void}>} {
    const pending: Array<{query: string; resolve(items: readonly EntryCandidate[]): void}> = [];
    return {
        pending,
        find: (query) => new Promise((resolve) => pending.push({query, resolve: (items) => resolve({ok: true, items})})),
    };
}

/** 照文档的用法接线：`useEntryFind` 查，结果传给 `EntryPicker`。 */
const Host = defineComponent({
    props: {find: {type: Function as PropType<EntryFind>, required: true}, picker: {type: Object, default: () => ({})}},
    setup(props) {
        const finder = useEntryFind(() => props.find);
        return () => h(EntryPicker, {modelValue: null, ...props.picker, results: finder.results.value, onSearch: finder.search});
    },
});

function picker(props: Record<string, unknown>): VueWrapper {
    const {find, ...rest} = props;
    const wrapper = mount(Host, {props: {find: find as EntryFind, picker: rest}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper.findComponent(EntryPicker) as unknown as VueWrapper;
}

const input = (wrapper: VueWrapper) => wrapper.get("input[role='combobox']");
const options = () => [...document.querySelectorAll<HTMLElement>("[role='option']")];
const optionTexts = () => options().map((option) => option.textContent?.trim());
const listText = () => document.querySelector("[role='listbox']")?.textContent?.trim() ?? "";

async function type(wrapper: VueWrapper, text: string): Promise<void> {
    (input(wrapper).element as HTMLInputElement).value = text;
    await input(wrapper).trigger("input");
}

describe("EntryPicker", () => {
    it("打开立刻查空词；打字后按词查，别名命中的也列出；Enter 选中发出 id", async () => {
        const calls: string[] = [];
        const wrapper = picker({find: memoryFind(calls)});
        await input(wrapper).trigger("click");
        await waitUntil("列出全部条目", () => options().length === 3);
        expect(calls).toEqual([""]);
        await type(wrapper, "小瑕");
        await waitUntil("按“小瑕”查过", () => calls.includes("小瑕") && options().length === 1);
        expect(optionTexts()).toEqual(["星瑕人物"]);
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["e1"]]);
    });

    it("先发的查找后回来时丢掉：列表是最新那个词的结果", async () => {
        const held = heldFind();
        const wrapper = picker({find: held.find});
        await input(wrapper).trigger("click");
        await type(wrapper, "星");
        await waitUntil("按“星”发出了查找", () => held.pending.some((call) => call.query === "星"));
        await type(wrapper, "星辰");
        await waitUntil("按“星辰”发出了查找", () => held.pending.some((call) => call.query === "星辰"));
        held.pending.find((call) => call.query === "星辰")!.resolve([ENTRIES[2]!]);
        await waitUntil("列出“星辰”的结果", () => options().length === 1);
        held.pending.find((call) => call.query === "星")!.resolve([ENTRIES[0]!, ENTRIES[1]!]);
        held.pending.find((call) => call.query === "")!.resolve(ENTRIES);
        await flushPromises();
        expect(optionTexts()).toEqual(["星辰议会组织"]);
    });

    it("查找中、没有结果与查找失败各有一行提示", async () => {
        const held = heldFind();
        const wrapper = picker({find: held.find});
        await input(wrapper).trigger("click");
        await waitUntil("查找中", () => listText().includes("正在查找"));
        held.pending[0]!.resolve([]);
        await waitUntil("没有结果", () => listText() === "没有匹配的条目");
        await input(wrapper).trigger("blur");
        const failing = picker({find: async () => ({ok: false, reason: "作品打不开"})});
        await input(failing).trigger("click");
        await waitUntil("查找失败", () => listText() === "查找失败：作品打不开");
    });

    it("exclude 里的条目列出但停用，右侧写原因，点了不选", async () => {
        const wrapper = picker({find: memoryFind([]), exclude: ["e2"], excludeReason: "已在列表里"});
        await input(wrapper).trigger("click");
        await waitUntil("列出全部条目", () => options().length === 3);
        const excluded = options().find((option) => option.textContent?.includes("星瑾"))!;
        expect(excluded.textContent).toContain("已在列表里");
        expect(excluded.getAttribute("aria-disabled")).toBe("true");
        excluded.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        await flushPromises();
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    });

    it("给了 createKind 且没有同名条目时末尾有“新建”，选它发出 create、不改值；有同名条目时不出", async () => {
        const wrapper = picker({find: memoryFind([]), createKind: "知识点"});
        await input(wrapper).trigger("click");
        await type(wrapper, " 哥哥能回溯 ");
        await waitUntil("出现新建", () => optionTexts().includes("新建“哥哥能回溯”知识点"));
        await input(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("create")).toEqual([["哥哥能回溯"]]);
        expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        await input(wrapper).trigger("click");
        await type(wrapper, "星瑕");
        await waitUntil("按“星瑕”查过", () => optionTexts().length === 1 && optionTexts()[0] === "星瑕人物");
    });

    it("选中以后再打开、搜不到词后离开：宿主没给名字，输入框仍写选中的那一项", async () => {
        const calls: string[] = [];
        const Controlled = defineComponent({
            setup() {
                const finder = useEntryFind(() => memoryFind(calls));
                const value = ref<string | null>(null);
                return () => h(EntryPicker, {modelValue: value.value, selectedName: "", results: finder.results.value, onSearch: finder.search, "onUpdate:modelValue": (next: string | null) => (value.value = next)});
            },
        });
        const host = mount(Controlled, {global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(host);
        const wrapper = host.findComponent(EntryPicker) as unknown as VueWrapper;
        const shown = () => (input(wrapper).element as HTMLInputElement).value;
        await input(wrapper).trigger("click");
        await type(wrapper, "星辰");
        await waitUntil("只列“星辰议会”", () => calls.includes("星辰") && options().length === 1);
        await input(wrapper).trigger("keydown", {key: "Enter"});
        await flushPromises();
        expect(shown()).toBe("星辰议会");
        await input(wrapper).trigger("blur");
        await input(wrapper).trigger("click");
        await type(wrapper, "不存在的词");
        await waitUntil("按这个词查过", () => calls.includes("不存在的词") && listText().includes("没有"));
        await input(wrapper).trigger("blur");
        await flushPromises();
        expect(shown()).toBe("星辰议会");
    });

    it("显示 selectedName；清空发出 null", async () => {
        const wrapper = picker({find: memoryFind([]), modelValue: "e9", selectedName: "雾崎"});
        expect((input(wrapper).element as HTMLInputElement).value).toBe("雾崎");
        await wrapper.get("button[aria-label='清除选择']").trigger("click");
        expect(wrapper.emitted("update:modelValue")).toEqual([[null]]);
    });
});
