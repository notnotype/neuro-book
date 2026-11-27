/**
 * 富文本输入框与源文字输入框同一个合同（同名 .md 的“合同逐项对照”；canon/author-ui.md 输出 44 到 46、48）：受控的整篇、外面换了整篇
 * 只换不同的一段、回声不动、只读、插入过写入前的检查、写不出时不交出。用真实的编辑器、编解码器与内核文法。
 */

import type {Editor} from "@tiptap/core";
import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

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

    it("按整篇源文的偏移放光标、再读回偏移：小块按它的原文算，在小块后、第二块里都对得上", async () => {
        const source = '魔力 <V of="panel.魔力" />。\n\n第二段 **强调** 后。';
        const wrapper = show({modelValue: source});
        await flushPromises();
        type Offsets = Exposed & {focus(caret: number): void};
        for (const offset of [0, source.indexOf("。"), source.indexOf("第二段"), source.indexOf("后")]) {
            (wrapper.vm as unknown as Offsets).focus(offset);
            expect(exposed(wrapper).cursorOffset()).toBe(offset);
        }
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
        // 条件里没显示的支也在 DOM 里（隐藏着）：条件只看它的占位。
        const shown = (chip: HTMLElement) => (chip.dataset.entryChip === "if" ? chip.querySelector(".entry-chip--if")?.textContent : chip.textContent)?.trim();
        expect(chips(wrapper).map((chip) => [chip.dataset.entryChip, chip.dataset.chipState, shown(chip)])).toEqual([
            ["value", "value", "1,200"],
            ["value", "pending", "panel.好感度"],
            ["calc", "pending", "panel.魔力 * 2"],
            ["if", "pending", "条件"],
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

    it("挂载时就带着值表（刚点“编辑”时用阅读视图的那份当初值）：一开始就是值，不先画计算中", async () => {
        const wrapper = show({modelValue: VALUE_SOURCE, self: "e1", fields, values: {source: VALUE_SOURCE, values: valuesFor(VALUE_SOURCE, 0)}});
        await flushPromises();
        expect(chips(wrapper).map((chip) => chip.dataset.chipState)).toEqual(["value", "value", "value", "value"]);
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

const key = (target: Element, name: string, init: KeyboardEventInit = {}) => target.dispatchEvent(new KeyboardEvent("keydown", {key: name, bubbles: true, cancelable: true, ...init}));
/** 浮层与列表传送到 body：在整页里找。 */
const popover = () => document.body.querySelector<HTMLElement>("[data-chip-popover]");
const field = (name: string) => document.body.querySelector<HTMLInputElement>(`[data-chip-field="${name}"]`)!;
const action = (name: string) => document.body.querySelector<HTMLButtonElement>(`[data-chip-action="${name}"]`)!;
const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", {bubbles: true}));
};
/** Tiptap 把编辑器挂在编辑区的 DOM 上：测试用它的命令放选区（左右键越过小块先选中它要量布局，happy-dom 里不成，留给 e2e）。 */
const editorOf = (wrapper: ReturnType<typeof mount>) => (prose(wrapper) as HTMLElement & {editor: Editor}).editor;
/** 选中第 `index` 个小块（节点选区），再按 Enter 打开浮层（键盘的开法，输出 48）。 */
async function openChip(wrapper: ReturnType<typeof mount>, index = 0): Promise<void> {
    const editor = editorOf(wrapper);
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "canonEntryTag" || node.type.name === "canonEntryIf") positions.push(pos);
        return true;
    });
    // 不用 `commands.focus()`：它在下一帧才聚焦，那时浮层已经开着，焦点回到编辑区会让浮层当作移到外面而关上。
    editor.view.focus();
    editor.commands.setNodeSelection(positions[index]!);
    key(prose(wrapper), "Enter");
    await flushPromises();
}
const openFirstChip = (wrapper: ReturnType<typeof mount>) => openChip(wrapper, 0);
const options = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].map((item) => item.textContent?.trim() ?? "");

describe("改小块（canon/author-ui.md 输出 48）", () => {
    it("计算：改式子按“应用”，过了检查才落、一次是一个撤销步；焦点回编辑器、小块仍选中", async () => {
        const wrapper = show({modelValue: '<V expr="panel.魔力 * 2" /> 之后'});
        await flushPromises();
        await openFirstChip(wrapper);
        expect(popover()?.dataset.chipPopover).toBe("calc");
        expect(field("expr").value).toBe("panel.魔力 * 2");
        type(field("expr"), "panel.魔力 * 3");
        await flushPromises();
        // 还没应用：不交出。
        expect(emitted(wrapper)).toEqual([]);
        action("apply").click();
        await vi.waitFor(() => expect(emitted(wrapper).at(-1)).toBe('<V expr="panel.魔力 * 3" /> 之后'));
        expect(popover()).toBeNull();
        // 应用自己换掉了小块：不算“没应用的改动被丢弃”。
        expect(wrapper.emitted("discarded")).toBeUndefined();
        await vi.waitFor(() => expect(document.activeElement).toBe(prose(wrapper)));
        expect(prose(wrapper).querySelector(".ProseMirror-selectednode")?.getAttribute("data-entry-chip")).toBe("calc");
        key(prose(wrapper), "z", {ctrlKey: true});
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBe('<V expr="panel.魔力 * 2" /> 之后');
    });

    it("写得不对：不落，浮层里写原因，作者打的字留着；改对了再应用就落", async () => {
        const wrapper = show({modelValue: '<V expr="panel.魔力 * 2" />'});
        await flushPromises();
        await openFirstChip(wrapper);
        type(field("expr"), "panel.魔力 *");
        action("apply").click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-chip-problem]")).not.toBeNull());
        expect(document.body.querySelector("[data-chip-problem]")!.textContent).toContain("写得不对");
        expect(field("expr").value).toBe("panel.魔力 *");
        expect(emitted(wrapper)).toEqual([]);
        type(field("expr"), 'panel.名字 == "甲"');
        action("apply").click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-chip-problem]")!.textContent).toBe("判断与式子里不能有双引号，字符串用单引号"));
        type(field("expr"), "panel.魔力 * 4");
        action("apply").click();
        await vi.waitFor(() => expect(emitted(wrapper).at(-1)).toBe('<V expr="panel.魔力 * 4" />'));
    });

    it("条件：改一支的文字、加“否则如果”，应用后是一个条件；现在生效的那支标出来", async () => {
        const source = '<If test="panel.魔力 >= 1000">强<Else />弱</If>';
        const wrapper = show({modelValue: source, values: {source, values: [{tag: "If", start: 0, result: false, taken: 1}] as unknown as EntryTextValue[]}});
        await flushPromises();
        await openFirstChip(wrapper);
        expect(popover()?.dataset.chipPopover).toBe("if");
        expect(document.body.querySelector('[data-taken] [data-chip-field^="test"]')).toBeNull();
        expect(document.body.querySelector('[data-taken] [data-chip-field="branch-1"]')).not.toBeNull();
        type(field("branch-1"), "弱，还剩 <V of=\"panel.魔力\" />");
        action("add-branch").click();
        await flushPromises();
        type(field("test-1"), "panel.魔力 > 0");
        type(field("branch-1"), "一般");
        action("apply").click();
        await vi.waitFor(() => expect(emitted(wrapper).at(-1)).toBe('<If test="panel.魔力 >= 1000">强<ElseIf test="panel.魔力 > 0" />一般<Else />弱，还剩 <V of="panel.魔力" /></If>'));
        expect(chips(wrapper).map((chip) => chip.dataset.entryChip)).toEqual(["if"]);
    });

    it("条件的一支里写了闭标签（会把条件切开）：读不成一个小块，不落", async () => {
        const wrapper = show({modelValue: '<If test="panel.魔力 > 0">有<Else />没有</If>'});
        await flushPromises();
        await openFirstChip(wrapper);
        type(field("branch-0"), "有</If>多");
        action("apply").click();
        await vi.waitFor(() => expect(document.body.querySelector("[data-chip-problem]")?.textContent).toBe("这样写读不成一个小块，到源文字里改"));
        expect(emitted(wrapper)).toEqual([]);
    });

    it("删掉一个小块；Esc 关上浮层、焦点回编辑器且小块仍选中", async () => {
        const wrapper = show({modelValue: '甲<V of="panel.魔力" />乙', fields});
        await flushPromises();
        await openChip(wrapper, 0);
        expect(popover()?.dataset.chipPopover).toBe("value");
        expect(document.body.querySelector("[data-chip-value]")?.textContent).toBe("1,200");
        expect(chips(wrapper, "value")[0]!.getAttribute("aria-expanded")).toBe("true");
        key(popover()!, "Escape");
        await vi.waitFor(() => expect(document.activeElement).toBe(prose(wrapper)));
        expect(popover()).toBeNull();
        expect(chips(wrapper, "value")[0]!.getAttribute("aria-expanded")).toBe("false");
        expect(prose(wrapper).querySelector(".ProseMirror-selectednode")?.getAttribute("data-entry-chip")).toBe("value");
        key(prose(wrapper), "Enter");
        await flushPromises();
        action("remove").click();
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBe("甲乙");
    });

    it("撤销、外面换了整篇让小块不在了：浮层关上；有没应用的字时发 discarded", async () => {
        const wrapper = show({modelValue: '<V expr="panel.魔力 * 2" />'});
        await flushPromises();
        await openFirstChip(wrapper);
        await wrapper.setProps({modelValue: "别处改成了这样"});
        await flushPromises();
        expect(popover()).toBeNull();
        expect(wrapper.emitted("discarded")).toBeUndefined();
        await wrapper.setProps({modelValue: '<V expr="panel.魔力 * 2" />'});
        await flushPromises();
        await openFirstChip(wrapper);
        type(field("expr"), "panel.魔力 * 5");
        await wrapper.setProps({readonly: true});
        await flushPromises();
        expect(popover()).toBeNull();
        expect(wrapper.emitted("discarded")).toHaveLength(1);
    });

    it("外面换了整篇、只改了别的段落：小块还在，浮层照样关上、没应用的字丢弃", async () => {
        const wrapper = show({modelValue: '<V expr="panel.魔力 * 2" />\n\n第二段。'});
        await flushPromises();
        await openFirstChip(wrapper);
        type(field("expr"), "panel.魔力 * 7");
        await wrapper.setProps({modelValue: '<V expr="panel.魔力 * 2" />\n\n别处改的第二段。'});
        await flushPromises();
        expect(chips(wrapper, "calc")).toHaveLength(1);
        expect(popover()).toBeNull();
        expect(wrapper.emitted("discarded")).toHaveLength(1);
    });

    it("撤销让锚着的小块不在了：浮层关上，没应用的字丢弃", async () => {
        const wrapper = show({modelValue: "甲"});
        await flushPromises();
        exposed(wrapper).focus("end");
        exposed(wrapper).insert('<V expr="panel.魔力 * 2" />');
        await flushPromises();
        await openFirstChip(wrapper);
        type(field("expr"), "panel.魔力 * 9");
        key(prose(wrapper), "z", {ctrlKey: true});
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBe("甲");
        expect(popover()).toBeNull();
        expect(wrapper.emitted("discarded")).toHaveLength(1);
    });

});

describe("插入小块：{ 与 @（canon/author-ui.md 输出 48）", () => {
    const fieldsTwo = [...fields, {path: "character.年龄", label: "年龄", group: "人物", display: null}];

    it("{ 打开字段列表：最前面是条件与计算，后面是本条目的字段；选字段插入取值，马上显示这一页的值", async () => {
        const wrapper = show({modelValue: "甲", self: "e1", fields: fieldsTwo});
        await flushPromises();
        exposed(wrapper).focus("end");
        key(prose(wrapper), "{");
        await flushPromises();
        expect(options()).toEqual([
            expect.stringContaining("条件"),
            expect.stringContaining("计算"),
            expect.stringContaining("数值 · 魔力"),
            expect.stringContaining("人物 · 年龄"),
        ]);
        const search = document.body.querySelector<HTMLInputElement>("[data-chip-menu] input")!;
        type(search, "魔力");
        await flushPromises();
        expect(options()).toEqual([expect.stringContaining("数值 · 魔力")]);
        key(search, "Enter");
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBe('甲<V of="panel.魔力" />');
        expect(chips(wrapper, "value")[0]!.textContent?.trim()).toBe("1,200");
        expect(options()).toEqual([]);
    });

    it("{ 后按 Esc：列表关上，补回一个 {", async () => {
        const wrapper = show({modelValue: "甲", fields});
        await flushPromises();
        exposed(wrapper).focus("end");
        key(prose(wrapper), "{");
        await flushPromises();
        key(document.body.querySelector("[data-chip-menu] input")!, "Escape");
        await flushPromises();
        expect(options()).toEqual([]);
        expect(emitted(wrapper).at(-1)).toBe("甲{");
    });

    it("{ 里选“计算”：先在浮层里写式子，应用了才插进去", async () => {
        const wrapper = show({modelValue: "甲", fields});
        await flushPromises();
        exposed(wrapper).focus("end");
        key(prose(wrapper), "{");
        await flushPromises();
        const search = document.body.querySelector<HTMLInputElement>("[data-chip-menu] input")!;
        type(search, "计算");
        await flushPromises();
        key(search, "Enter");
        await flushPromises();
        expect(popover()?.dataset.chipPopover).toBe("calc");
        expect(emitted(wrapper)).toEqual([]);
        type(field("expr"), "panel.魔力 + 1");
        action("apply").click();
        await vi.waitFor(() => expect(emitted(wrapper).at(-1)).toBe('甲<V expr="panel.魔力 + 1" />'));
    });

    it("@ 打开条目列表：按搜索词找，选了插入条目引用；没有找条目的入口时 @ 照字打", async () => {
        const queries: string[] = [];
        const find = async (query: string) => {
            queries.push(query);
            return {ok: true as const, items: [{id: "e2", name: "星瑾"}, {id: "e3", name: "星瑕"}].filter((item) => item.name.includes(query))};
        };
        const wrapper = show({modelValue: "见到", find});
        await flushPromises();
        exposed(wrapper).focus("end");
        key(prose(wrapper), "@");
        await vi.waitFor(() => expect(options()).toEqual(["星瑾", "星瑕"]));
        const search = document.body.querySelector<HTMLInputElement>("[data-chip-menu] input")!;
        type(search, "瑕");
        await vi.waitFor(() => expect(options()).toEqual(["星瑕"]));
        key(search, "Enter");
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBe('见到<Ref id="e3" />');
        expect(queries[0]).toBe("");

        const plain = show({modelValue: "见到"});
        await flushPromises();
        exposed(plain).focus("end");
        expect(key(prose(plain), "@")).toBe(true);
        expect(options()).toEqual([]);
    });

    it("行内代码里打 { 不弹列表", async () => {
        const wrapper = show({modelValue: "`代码`", fields});
        await flushPromises();
        editorOf(wrapper).commands.setTextSelection(2);
        key(prose(wrapper), "{");
        await flushPromises();
        expect(options()).toEqual([]);
    });
});
