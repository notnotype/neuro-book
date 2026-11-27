/**
 * 整篇编辑的编辑视图（EntryTextEditor.vue；docs/specs/canon/author-ui.md 输出 39、45、46）自己管的几件事：离开的按钮什么时候先问、
 * Esc、另一个窗口也在改与等结局时的按钮、打字与“插入”发出什么、富文本与源文字的切换（输出 48）。源文字用组件自带的退路（普通文本框），
 * 富文本是真的 `EntryRichInput`。写入与提交在宿主那边，
 * 见 `entry-page.dom.test.ts`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import EntryTextEditor from "./EntryTextEditor.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const base = {text: "第一段。", problem: "", dirty: false, saved: "none" as const, phase: "idle" as const, submitBlocked: "", message: ""};

const mounted: Array<ReturnType<typeof mount>> = [];
const show = (props: Record<string, unknown>) => {
    const wrapper = mount(EntryTextEditor, {props: {...base, ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
};
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const escape = (wrapper: ReturnType<typeof mount>, composing = false) => wrapper.get("[data-text-editor]").element.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, isComposing: composing}));

describe("author-ui 输出 39、45：离开编辑", () => {
    it("没有东西可丢时是“取消”，点它或按 Esc 直接走；输入法正在组字时的 Esc 不算", async () => {
        const wrapper = show({});
        expect([wrapper.find("[data-text-cancel]").exists(), wrapper.find("[data-text-discard]").exists(), wrapper.get("[data-text-cancel]").text()]).toEqual([true, false, "取消"]);
        escape(wrapper, true);
        expect(wrapper.emitted("cancel")).toBeUndefined();
        escape(wrapper);
        await wrapper.get("[data-text-cancel]").trigger("click");
        expect(wrapper.emitted("cancel")?.length).toBe(2);
    });

    it("有改动、读不出块、等上一次提交的结局时是“放弃”：先问一句，确认才发；这时 Esc 不接", async () => {
        for (const props of [{dirty: true, text: "改过。"}, {frozen: true}, {phase: "confirming" as const}]) {
            const wrapper = show(props);
            expect([wrapper.find("[data-text-discard]").exists(), wrapper.find("[data-text-cancel]").exists(), wrapper.get("[data-text-discard]").text()]).toEqual([true, false, "放弃"]);
            escape(wrapper);
            await wrapper.get("[data-text-discard]").trigger("click");
            await flushPromises();
            expect([wrapper.emitted("cancel"), wrapper.emitted("discard"), document.body.textContent?.includes("放弃没提交的修改？")]).toEqual([undefined, undefined, true]);
            [...document.body.querySelectorAll<HTMLButtonElement>("[role='alertdialog'] button")].find((button) => button.textContent?.trim() === "放弃")!.click();
            await flushPromises();
            expect(wrapper.emitted("discard")?.length).toBe(1);
            wrapper.unmount();
            document.body.innerHTML = "";
        }
    });
});

describe("author-ui 输出 45、46：状态行", () => {
    it("另一个窗口也在改：两个按钮各发各的；等上一次提交的结局：写“正在确认”，有“再试”，提交点不了", async () => {
        const diverged = show({dirty: true, saved: "diverged", text: "改过。"});
        await diverged.get("[data-text-take-over]").trigger("click");
        await diverged.get("[data-text-adopt]").trigger("click");
        expect([diverged.emitted("take-over")?.length, diverged.emitted("adopt")?.length, diverged.get("[data-text-submit]").attributes("disabled") !== undefined]).toEqual([1, 1, true]);

        const confirming = show({dirty: true, saved: "saved", phase: "confirming", text: "改过。"});
        expect([confirming.get("[data-text-confirming]").text(), confirming.find("[data-text-saved]").exists(), confirming.get("[data-text-submit]").attributes("disabled") !== undefined]).toEqual(["正在确认上一次提交", false, true]);
        await confirming.get("[data-text-retry]").trigger("click");
        expect(confirming.emitted("retry")?.length).toBe(1);
        // 等结局时输入框只读。
        expect(confirming.get("textarea").attributes("readonly")).toBeDefined();
    });

    it("“提交”点不了的原因写在状态行；整批的说明里正写着同一句时不写两遍", async () => {
        const reason = "世界是只读的";
        const wrapper = show({dirty: true, saved: "saved", submitBlocked: reason, text: "改过。"});
        expect([wrapper.get("[data-text-submit-blocked]").text(), wrapper.find("[data-text-message]").exists()]).toEqual([reason, false]);
        await wrapper.setProps({message: reason});
        expect([wrapper.find("[data-text-submit-blocked]").exists(), wrapper.get("[data-text-message]").text()]).toEqual([false, reason]);
    });
});

describe("author-ui 输出 39：输入与“插入”", () => {
    it("打字发 update；内核说写得不对时原因在输入框下面；提交在途时输入框只读、“插入”点不了", async () => {
        const wrapper = show({inserts: [{label: "面板 · 魔力", snippet: '<V of="panel.魔力" />'}]});
        await wrapper.get("textarea").setValue("第一段。改了");
        expect(wrapper.emitted("update")).toEqual([["第一段。改了"]]);
        expect(wrapper.find("[data-text-problem]").exists()).toBe(false);
        await wrapper.setProps({problem: "写得不对：少了一个花括号"});
        expect(wrapper.get("[data-text-problem]").text()).toBe("写得不对：少了一个花括号");
        await wrapper.setProps({phase: "submitting"});
        expect([wrapper.get("textarea").attributes("readonly") !== undefined, wrapper.get("[data-text-insert]").attributes("disabled") !== undefined]).toEqual([true, true]);
    });

    it("从“插入”里选一个字段：写法落在光标处、光标到了它后面，照打字一样发 update，焦点回到输入框；条目没有字段时不出“插入”", async () => {
        const wrapper = show({text: "魔力：点", inserts: [{label: "面板 · 魔力", snippet: '<V of="panel.魔力" />'}, {label: "面板 · 存款", snippet: '<V of="panel.存款" />'}]});
        // 同真实的宿主：收到 update 就把新的整篇给回来（不给回来的话，受控的输入框会被旧的文字盖回去）。
        await wrapper.setProps({onUpdate: (value: string) => void wrapper.setProps({text: value})});
        const area = wrapper.get("textarea").element as HTMLTextAreaElement;
        area.focus();
        area.setSelectionRange(3, 3);
        const trigger = wrapper.get("[data-text-insert]").element as HTMLElement;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        await flushPromises();
        const items = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];
        expect(items.map((item) => item.textContent?.trim())).toEqual(["面板 · 魔力", "面板 · 存款"]);
        items[0]!.click();
        await flushPromises();
        expect([wrapper.emitted("update"), area.value, area.selectionStart, document.activeElement === area]).toEqual([[['魔力：<V of="panel.魔力" />点']], '魔力：<V of="panel.魔力" />点', '魔力：<V of="panel.魔力" />'.length, true]);

        expect(show({}).find("[data-text-insert]").exists()).toBe(false);
    });
});

const rich = {self: "e1", fields: [{path: "panel.魔力", label: "魔力", group: "数值", display: "1,200"}], marks: {}, values: null, computing: true, find: null, baseline: new Set<string>()};
/** 同真实的宿主：收到 update 与 update:mode 就把新的给回来。 */
const controlled = async (props: Record<string, unknown>) => {
    const wrapper = show({rich, ...props});
    await wrapper.setProps({
        "onUpdate": (value: string) => void wrapper.setProps({text: value}),
        "onUpdate:mode": (value: "rich" | "source") => void wrapper.setProps({mode: value}),
    });
    await flushPromises();
    return wrapper;
};
const modeOf = (wrapper: ReturnType<typeof mount>) => wrapper.get("[data-text-mode]").attributes("data-text-mode");
const pick = async (wrapper: ReturnType<typeof mount>, label: string) => {
    const option = [...wrapper.get("[data-text-mode]").element.querySelectorAll<HTMLElement>("button, [role='radio']")].find((item) => item.textContent?.trim() === label)!;
    option.click();
    await flushPromises();
};

describe("author-ui 输出 39、48：富文本与源文字", () => {
    it("给了富文本要的东西：缺省富文本；切到源文字、再切回，内容不变，记下的模式跟着发出", async () => {
        const wrapper = await controlled({text: '魔力 <V of="panel.魔力" />。'});
        expect([modeOf(wrapper), wrapper.find("[data-rich-input]").exists(), wrapper.find("textarea").exists()]).toEqual(["rich", true, false]);
        // 光标放在富文本的文末再切：源文字里光标也落在文末（两边按整篇源文的偏移交接）。
        (wrapper.vm as unknown as {focus(caret: "end"): void}).focus("end");
        await pick(wrapper, "源文字");
        expect([modeOf(wrapper), wrapper.get("textarea").element.value, wrapper.emitted("update:mode")]).toEqual(["source", '魔力 <V of="panel.魔力" />。', [["source"]]]);
        await vi.waitFor(() => expect(document.activeElement).toBe(wrapper.get("textarea").element));
        expect((wrapper.get("textarea").element as HTMLTextAreaElement).selectionStart).toBe('魔力 <V of="panel.魔力" />。'.length);
        await pick(wrapper, "富文本");
        expect([modeOf(wrapper), wrapper.find("[data-rich-input] [data-entry-chip]").exists(), wrapper.emitted("update:mode")]).toEqual(["rich", true, [["source"], ["rich"]]]);
        expect(wrapper.emitted("update")).toBeUndefined();
        // 没给富文本要的东西：只有源文字，没有切换。
        expect([show({}).find("[data-text-mode]").exists(), show({}).find("textarea").exists()]).toEqual([false, true]);
    });

    it("源文字写坏一个标签：停顿后下面写第几行；切回富文本被拦下、写原因，模式不变；改好以后切得回去", async () => {
        const wrapper = await controlled({text: "第一段。", mode: "source"});
        await wrapper.get("textarea").setValue('第一段。\n\n<V of="panel.魔力"');
        await vi.waitFor(() => expect(wrapper.find("[data-source-problem]").exists()).toBe(true));
        expect(wrapper.get("[data-source-problem]").attributes("data-line")).toBe("3");
        await pick(wrapper, "富文本");
        expect([modeOf(wrapper), wrapper.get("[data-mode-problem]").text(), wrapper.emitted("update:mode")]).toEqual(["source", "第 3 行写得不对，改好才能切回富文本", undefined]);
        await wrapper.get("textarea").setValue("改好了。");
        expect(wrapper.find("[data-mode-problem]").exists()).toBe(false);
        await vi.waitFor(() => expect(wrapper.find("[data-source-problem]").exists()).toBe(false));
        await pick(wrapper, "富文本");
        expect([modeOf(wrapper), wrapper.get("[data-rich-input]").text()]).toEqual(["rich", "改好了。"]);
    });

    it("记下的是富文本、稿读不进去：这一次落在源文字，切换旁写原因，不改记下的模式", async () => {
        const wrapper = await controlled({text: '坏的 <V of="panel.魔力"'});
        expect([modeOf(wrapper), wrapper.find("textarea").exists(), wrapper.get("[data-mode-problem]").text(), wrapper.emitted("update:mode")]).toEqual(["source", true, "这一版里有写法要先在源文字里改好", undefined]);
    });

    it("在富文本里提交被拒收：切到源文字，光标落在原因指的那一行", async () => {
        const text = '第一段。\n\n第二段 <V of="panel.魔力" />。';
        const wrapper = await controlled({text});
        expect(modeOf(wrapper)).toBe("rich");
        // 内核拒收的原因浏览器这边查不出来（例如字段没了）：光标在文首。
        await wrapper.setProps({problem: "写得不对：panel.魔力 不在了"});
        await flushPromises();
        const area = wrapper.get("textarea").element as HTMLTextAreaElement;
        expect([modeOf(wrapper), wrapper.get("[data-text-problem]").text(), document.activeElement === area, area.selectionStart]).toEqual(["source", "写得不对：panel.魔力 不在了", true, 0]);
        // 拒收后落在源文字不改记下的模式。
        expect(wrapper.emitted("update:mode")).toBeUndefined();
    });

    it("状态行分两区：第一区是状态与放弃、提交，第二区是插入与模式；有条件时出“显示全部分支”，点了发出", async () => {
        const wrapper = await controlled({text: '<If test="panel.魔力 > 1">强<Else />弱</If>', inserts: [{label: "数值 · 魔力", snippet: '<V of="panel.魔力" />'}]});
        const row = (n: string) => wrapper.get(`[data-text-bar-row="${n}"]`);
        expect([row("1").find("[data-text-submit]").exists(), row("1").find("[data-text-cancel]").exists(), row("2").find("[data-text-insert]").exists(), row("2").find("[data-text-mode]").exists()]).toEqual([true, true, true, true]);
        const toggle = wrapper.get("[data-text-branches] [role='switch']").element as HTMLElement;
        toggle.click();
        await flushPromises();
        expect(wrapper.emitted("update:showBranches")).toEqual([[true]]);
        await pick(wrapper, "源文字");
        expect(wrapper.find("[data-text-branches]").exists()).toBe(false);
    });

    it("“插入”：值（下一级是字段）、计算、条件；源文字里选计算写进模板，没有找条目的入口时富文本里不出“条目”", async () => {
        const wrapper = await controlled({text: "甲", mode: "source", inserts: [{label: "数值 · 魔力", snippet: '<V of="panel.魔力" />'}]});
        const open = async () => {
            const trigger = wrapper.get("[data-text-insert]").element as HTMLElement;
            trigger.focus();
            trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
            await flushPromises();
            await flushPromises();
            return [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];
        };
        let items = await open();
        expect(items.map((item) => item.textContent?.replace(/\s+/gu, ""))).toEqual(["值", "计算{", "条件{", "条目@"]);
        // “值”的下一级是字段。
        items[0]!.focus();
        items[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await flushPromises();
        expect([...document.body.querySelectorAll<HTMLElement>(".nb-menu-level [role='menuitem']")].map((item) => item.textContent?.trim())).toEqual(["数值 · 魔力"]);
        items[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true, cancelable: true}));
        await flushPromises();
        const area = wrapper.get("textarea").element as HTMLTextAreaElement;
        area.setSelectionRange(1, 1);
        items[1]!.click();
        await flushPromises();
        expect(wrapper.emitted("update")?.at(-1)).toEqual(['甲<V expr="" />']);
        await pick(wrapper, "富文本");
        // 稿里有空的式子（写得不对）：富文本切不过去，留在源文字。先改回能读的。
        await wrapper.setProps({text: "甲"});
        await pick(wrapper, "富文本");
        // 切过去以后焦点进富文本（编辑器在下一帧才聚焦）：等它到了再开菜单，免得菜单刚开就因焦点移走而关上。
        await vi.waitFor(() => expect(wrapper.get("[data-rich-input]").element.contains(document.activeElement)).toBe(true));
        items = await open();
        expect(items.map((item) => item.textContent?.replace(/\s+/gu, ""))).toEqual(["值", "计算{", "条件{"]);
    });
});
