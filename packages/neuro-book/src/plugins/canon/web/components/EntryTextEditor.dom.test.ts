/**
 * 整篇编辑的编辑视图（EntryTextEditor.vue；docs/specs/canon/author-ui.md 输出 39、45、46）自己管的几件事：离开的按钮什么时候先问、
 * Esc、另一个窗口也在改与等结局时的按钮、打字与“插入”发出什么。输入框用组件自带的退路（普通文本框）。写入与提交在宿主那边，
 * 见 `entry-page.dom.test.ts`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
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

describe("author-ui 输出 48：预览栏", () => {
    const withPreview = (props: Record<string, unknown>) => {
        const wrapper = mount(EntryTextEditor, {props: {...base, ...props}, slots: {preview: () => h("p", {"data-rendered": ""}, "渲染出来的样子")}, global: {provide: provideText(port)}, attachTo: document.body});
        mounted.push(wrapper);
        return wrapper;
    };

    it("“预览”是个开关：开着时有预览栏、里面是宿主给的内容；点它发出反过来的值，关着时没有预览栏", async () => {
        const on = withPreview({preview: true});
        expect([on.get("[data-text-preview-toggle]").attributes("aria-pressed"), on.get("[data-text-preview]").find("[data-rendered]").text(), on.get("[data-text-preview]").attributes("aria-label")]).toEqual(["true", "渲染出来的样子", "预览"]);
        await on.get("[data-text-preview-toggle]").trigger("click");
        expect(on.emitted("update:preview")).toEqual([[false]]);

        const off = withPreview({preview: false});
        expect([off.get("[data-text-preview-toggle]").attributes("aria-pressed"), off.find("[data-text-preview]").exists(), off.find("[data-rendered]").exists()]).toEqual(["false", false, false]);
        await off.get("[data-text-preview-toggle]").trigger("click");
        expect(off.emitted("update:preview")).toEqual([[true]]);
    });

    it("宿主没给预览的内容（已删除的条目只列稿）、或读不出块：没有开关也没有预览栏", () => {
        const wrapper = show({preview: true});
        expect([wrapper.find("[data-text-preview-toggle]").exists(), wrapper.find("[data-text-preview]").exists()]).toEqual([false, false]);
        const frozen = withPreview({preview: true, frozen: true});
        expect([frozen.find("[data-text-preview-toggle]").exists(), frozen.find("[data-text-preview]").exists()]).toEqual([false, false]);
    });

    it("栏顶上的一句：写着的时候栏里的内容标成旧的；没有时不写、不标。播报的区域一直在，那一句写在它里面", async () => {
        const wrapper = withPreview({preview: true});
        const status = () => wrapper.get("[data-text-preview] [role='status']");
        expect([status().text(), wrapper.find("[data-text-preview-note]").exists(), wrapper.find("[data-stale]").exists()]).toEqual(["", false, false]);
        await wrapper.setProps({previewNote: "第 3 行第 3 列写得不对：缺一个花括号"});
        await flushPromises();
        expect([status().text(), status().find("[data-text-preview-note]").exists(), wrapper.find("[data-stale]").exists()]).toEqual(["第 3 行第 3 列写得不对：缺一个花括号", true, true]);
        await wrapper.setProps({previewNote: ""});
        await flushPromises();
        expect(wrapper.find("[data-stale]").exists()).toBe(false);
    });

    it("开着预览照样能打字、能“插入”：改动照常交出去", async () => {
        const wrapper = withPreview({preview: true, text: "甲", inserts: [{label: "面板 · 魔力", snippet: '<V of="panel.魔力" />'}]});
        const area = wrapper.get("textarea").element as HTMLTextAreaElement;
        area.value = "甲乙";
        area.dispatchEvent(new Event("input", {bubbles: true}));
        expect([wrapper.emitted("update"), wrapper.find("[data-text-insert]").exists()]).toEqual([[["甲乙"]], true]);
    });
});
