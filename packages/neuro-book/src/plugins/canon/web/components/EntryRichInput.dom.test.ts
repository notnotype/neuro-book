/**
 * 富文本输入框与源文字输入框同一个合同（同名 .md 的“合同逐项对照”；canon/author-ui.md 输出 44 到 46、48）：受控的整篇、外面换了整篇
 * 只换不同的一段、回声不动、只读、插入过写入前的检查、写不出时不交出。用真实的编辑器、编解码器与内核文法。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import type {EntryTextValue} from "./entry-text";
import EntryRichInput from "./EntryRichInput.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

const mounted: Array<ReturnType<typeof mount>> = [];
const show = (props: Record<string, unknown>) => {
    const wrapper = mount(EntryRichInput, {props: {label: "主文字", modelValue: "", ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Exposed = {focus(caret?: "start" | "end"): void; cursorOffset(): number | null; insert(text: string): boolean};
const exposed = (wrapper: ReturnType<typeof mount>) => wrapper.vm as unknown as Exposed;
const prose = (wrapper: ReturnType<typeof mount>) => wrapper.get(".entry-rich__prose").element as HTMLElement;
/** 顶层的小块（条件里各支的小块不算）。 */
const chips = (wrapper: ReturnType<typeof mount>, kind?: string) => [...(wrapper.element as HTMLElement).querySelectorAll<HTMLElement>("[data-entry-chip]")].filter((chip) => chip.parentElement?.closest("[data-entry-chip]") === null && (kind === undefined || chip.dataset.entryChip === kind));
const emitted = (wrapper: ReturnType<typeof mount>) => (wrapper.emitted("update:modelValue") ?? []).map((event) => event[0] as string);

const SOURCE = '## 现在\n\n魔力 <V of="panel.魔力" />，<If test="panel.魔力 >= 1000">还能变身。<Else />不够。</If>\n\n- 一项\n- 两项\n';

describe("富文本输入框的合同", () => {
    it("读入整篇：标签是小块、条件是一个小块；什么都不改就不交出", async () => {
        const wrapper = show({modelValue: SOURCE});
        await flushPromises();
        expect(chips(wrapper).map((chip) => chip.dataset.entryChip)).toEqual(["value", "if"]);
        expect(prose(wrapper).textContent).toContain("魔力");
        expect(emitted(wrapper)).toEqual([]);
    });

    it("插入一段写法：读成小块插在光标处，整篇照打字一样交出；没改的块原样", async () => {
        const wrapper = show({modelValue: SOURCE});
        await flushPromises();
        exposed(wrapper).focus("end");
        expect(exposed(wrapper).insert('<V of="panel.上限" />')).toBe(true);
        await flushPromises();
        const last = emitted(wrapper).at(-1)!;
        expect(last.startsWith('## 现在\n\n魔力 <V of="panel.魔力" />，<If test="panel.魔力 >= 1000">还能变身。<Else />不够。</If>\n\n')).toBe(true);
        expect(last).toContain('<V of="panel.上限" />');
        expect(chips(wrapper, "value").length).toBe(2);
    });

    it("插入写坏的写法：不插、返回假；只读时也返回假", async () => {
        const wrapper = show({modelValue: "甲"});
        await flushPromises();
        exposed(wrapper).focus("end");
        expect(exposed(wrapper).insert('<V of="" />')).toBe(false);
        expect(emitted(wrapper)).toEqual([]);
        await wrapper.setProps({readonly: true});
        expect(exposed(wrapper).insert('<V of="panel.a" />')).toBe(false);
    });

    it("外面换了整篇：显示换成新的、不交出；与最近交出的相同是回声，不动", async () => {
        const wrapper = show({modelValue: "第一段。"});
        await flushPromises();
        await wrapper.setProps({modelValue: '第一段。\n\n别处加的 <Ref id="e2" />。'});
        await flushPromises();
        expect(prose(wrapper).textContent).toContain("别处加的");
        expect(chips(wrapper, "ref").length).toBe(1);
        expect(emitted(wrapper)).toEqual([]);
        // 作者插入以后，父组件把交出的整篇原样传回：不重读（编辑器里的文档对象不换）。
        exposed(wrapper).focus("end");
        exposed(wrapper).insert("尾巴");
        await flushPromises();
        const before = wrapper.get(".entry-rich__prose").element.innerHTML;
        await wrapper.setProps({modelValue: emitted(wrapper).at(-1)!});
        await flushPromises();
        expect(wrapper.get(".entry-rich__prose").element.innerHTML).toBe(before);
    });

    it("只读：编辑区不可编辑，标记在根上", async () => {
        const wrapper = show({modelValue: "甲", readonly: true});
        await flushPromises();
        expect(prose(wrapper).getAttribute("contenteditable")).toBe("false");
        expect(wrapper.get("[data-rich-input]").attributes("data-readonly")).toBe("");
        await wrapper.setProps({readonly: false});
        expect(prose(wrapper).getAttribute("contenteditable")).toBe("true");
    });

    it("光标偏移：在第二块里时是前面写出的长度加块内偏移", async () => {
        const wrapper = show({modelValue: "第一段。\n\n第二段。"});
        await flushPromises();
        exposed(wrapper).focus("end");
        expect(exposed(wrapper).cursorOffset()).toBe("第一段。\n\n第二段。".length);
        exposed(wrapper).focus("start");
        expect(exposed(wrapper).cursorOffset()).toBe(0);
    });

    it("没登记的标签：基线里有的插得进，没有的不插", async () => {
        const wrapper = show({modelValue: "状态 <StatusBar />", baseline: new Set(["<StatusBar />"])});
        await flushPromises();
        exposed(wrapper).focus("end");
        expect(exposed(wrapper).insert("<StatusBar />")).toBe(true);
        expect(exposed(wrapper).insert("<Gauge />")).toBe(false);
    });

    it("写不出（粘进来的小块原文读不回来）：不交出，输入框下面写原因；撤销以后原因收起、照常交出", async () => {
        const wrapper = show({modelValue: "甲"});
        await flushPromises();
        exposed(wrapper).focus("end");
        const data = new DataTransfer();
        data.setData("text/html", '<span data-canon-entry-tag data-source="不是标签">不是标签</span>');
        prose(wrapper).dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true}));
        await flushPromises();
        expect(emitted(wrapper)).toEqual([]);
        expect(wrapper.get("[data-rich-unwritable]").text()).toBe("这一处写不出，撤销上一步再改");
        prose(wrapper).dispatchEvent(new KeyboardEvent("keydown", {key: "z", ctrlKey: true, bubbles: true, cancelable: true}));
        exposed(wrapper).insert("乙");
        await flushPromises();
        expect(wrapper.find("[data-rich-unwritable]").exists()).toBe(false);
        expect(emitted(wrapper).at(-1)).toBe("甲乙");
    });
});

const VALUE_SOURCE = '魔力 <V of="panel.魔力" />，好感 <V entry="e2" of="panel.好感度" />，翻倍 <V expr="panel.魔力 * 2" />。<If test="panel.魔力 >= 1000">还能变身，<V of="panel.魔力" /> 够了。<Else />不够。</If>';
const fields = [{path: "panel.魔力", label: "魔力", group: "数值", display: "1,200"}];
/** 照内核的形状给 VALUE_SOURCE 的值表。 */
function valuesFor(source: string, taken: number | null): EntryTextValue[] {
    const at = (needle: string, from = 0) => source.indexOf(needle, from);
    const ifAt = at("<If");
    return [
        {tag: "V", start: at('<V of="panel.魔力" />'), path: "panel.魔力", raw: 1500, display: "1,500"},
        {tag: "V", start: at("<V entry"), path: "panel.好感度", entry: "e2", raw: 40, display: "40"},
        {tag: "V", start: at("<V expr"), expr: "panel.魔力 * 2", raw: 3000, display: "3,000"},
        {tag: "If", start: ifAt, result: taken === 0, taken},
        {tag: "V", start: at('<V of="panel.魔力" />', ifAt), path: "panel.魔力", raw: 1500, display: "1,500"},
    ] as unknown as EntryTextValue[];
}

describe("小块的值（canon/author-ui.md 输出 48）", () => {
    it("还没有值表：本条目的字段马上显示这一页的值，别的条目与计算是“计算中”，条件是“计算中”", async () => {
        const wrapper = show({modelValue: VALUE_SOURCE, self: "e1", fields});
        await flushPromises();
        expect(chips(wrapper).map((chip) => [chip.dataset.entryChip, chip.dataset.chipState, chip.textContent?.trim()])).toEqual([
            ["value", "value", "1,200"],
            ["value", "pending", "panel.好感度"],
            ["calc", "pending", "panel.魔力 * 2"],
            ["if", "pending", expect.any(String) as unknown as string],
        ]);
        await wrapper.setProps({computing: false});
        expect(chips(wrapper).map((chip) => chip.dataset.chipState)).toEqual(["value", "uncomputed", "uncomputed", "uncomputed"]);
    });

    it("值表到了：按原文挂到小块上，条件只画生效的那一支、支里的取值也有值", async () => {
        const wrapper = show({modelValue: VALUE_SOURCE, self: "e1", fields});
        await flushPromises();
        await wrapper.setProps({values: {source: VALUE_SOURCE, values: valuesFor(VALUE_SOURCE, 0)}});
        await flushPromises();
        expect(chips(wrapper).map((chip) => [chip.dataset.chipState, chip.dataset.chipBranch ?? null])).toEqual([["value", null], ["value", null], ["value", null], ["value", "0"]]);
        expect(chips(wrapper).slice(0, 3).map((chip) => chip.textContent?.trim())).toEqual(["1,500", "40", "3,000"]);
        const condition: HTMLElement = chips(wrapper, "if")[0]!;
        const shown = [...condition.querySelectorAll<HTMLElement>(".entry-if__branch")].filter((branch) => !branch.hidden);
        expect(shown.map((branch) => branch.textContent?.replace(/\s+/gu, ""))).toEqual(["还能变身，1,500够了。"]);
        // 没有一支成立：淡的占位。
        await wrapper.setProps({values: {source: VALUE_SOURCE, values: valuesFor(VALUE_SOURCE, null)}});
        await flushPromises();
        expect(chips(wrapper, "if")[0]!.dataset.chipState).toBe("no-branch");
        // 显示全部分支：每支都画。
        await wrapper.setProps({showBranches: true});
        expect([...(chips(wrapper, "if")[0] as HTMLElement).querySelectorAll<HTMLElement>(".entry-if__branch")].filter((branch) => !branch.hidden).length).toBe(2);
    });

    it("值表对不上它说的那一版源文：这一批不用，小块留着原来的样子", async () => {
        const wrapper = show({modelValue: VALUE_SOURCE, self: "e1", fields});
        await flushPromises();
        await wrapper.setProps({values: {source: VALUE_SOURCE, values: valuesFor(VALUE_SOURCE, 0).slice(1)}});
        await flushPromises();
        expect(chips(wrapper, "calc")[0]!.dataset.chipState).toBe("pending");
    });

    it("输入法正在组字时不换值，组完再换", async () => {
        const wrapper = show({modelValue: VALUE_SOURCE, self: "e1", fields});
        await flushPromises();
        prose(wrapper).dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
        await wrapper.setProps({values: {source: VALUE_SOURCE, values: valuesFor(VALUE_SOURCE, 0)}});
        await flushPromises();
        expect(chips(wrapper, "calc")[0]!.dataset.chipState).toBe("pending");
        prose(wrapper).dispatchEvent(new CompositionEvent("compositionend", {bubbles: true}));
        await flushPromises();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(chips(wrapper, "calc")[0]!.dataset.chipState).toBe("value");
    });
});
