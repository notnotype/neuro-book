/**
 * 按块编辑的编辑视图（EntryTextEditor.vue；docs/specs/canon/author-ui.md 输出 39、45、46）自己管的几件事：离开的按钮什么时候先问、
 * Esc、另一个窗口也在改与等结局时的按钮、拆开以后焦点与光标去哪。输入框用组件自带的退路（普通文本框）。写入与提交在宿主那边，
 * 见 `entry-page.dom.test.ts`。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import EntryTextEditor from "./EntryTextEditor.vue";
import type {EditorBlock} from "./entry-text-editor";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const free = {edit: "", remove: "", split: "", merge: "", add: ""};
const block = (key: string, text: string, extra: Partial<EditorBlock> = {}): EditorBlock => ({key, text, state: "same", story: false, blocked: free, problem: "", ...extra});
const base = {addFirstBlocked: "", count: 0, saved: "none" as const, phase: "idle" as const, submitBlocked: "", message: ""};

const mounted: Array<ReturnType<typeof mount>> = [];
const show = (props: Record<string, unknown>) => {
    const wrapper = mount(EntryTextEditor, {props: {...base, blocks: [block("b1", "第一块。")], ...props}, global: {provide: provideText(port)}, attachTo: document.body});
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
        for (const props of [{count: 1, blocks: [block("b1", "改过。", {state: "edited"})]}, {frozen: true}, {phase: "confirming" as const}]) {
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
        const diverged = show({count: 1, saved: "diverged", blocks: [block("b1", "改过。", {state: "edited"})]});
        await diverged.get("[data-text-take-over]").trigger("click");
        await diverged.get("[data-text-adopt]").trigger("click");
        expect([diverged.emitted("take-over")?.length, diverged.emitted("adopt")?.length, diverged.get("[data-text-submit]").attributes("disabled") !== undefined]).toEqual([1, 1, true]);

        const confirming = show({count: 1, saved: "saved", phase: "confirming", blocks: [block("b1", "改过。", {state: "edited"})]});
        expect([confirming.get("[data-text-confirming]").text(), confirming.find("[data-text-saved]").exists(), confirming.get("[data-text-submit]").attributes("disabled") !== undefined]).toEqual(["正在确认上一次提交", false, true]);
        await confirming.get("[data-text-retry]").trigger("click");
        expect(confirming.emitted("retry")?.length).toBe(1);
        // 等结局时输入框只读。
        expect(confirming.get("textarea").attributes("readonly")).toBeDefined();
    });

    it("“提交”点不了的原因写在状态行；整批的说明里正写着同一句时不写两遍", async () => {
        const reason = "世界是只读的";
        const wrapper = show({count: 1, saved: "saved", submitBlocked: reason, blocks: [block("b1", "改过。", {state: "edited"})]});
        expect([wrapper.get("[data-text-submit-blocked]").text(), wrapper.find("[data-text-message]").exists()]).toEqual([reason, false]);
        await wrapper.setProps({message: reason});
        expect([wrapper.find("[data-text-submit-blocked]").exists(), wrapper.get("[data-text-message]").text()]).toEqual([false, reason]);
    });
});

describe("author-ui 输出 39：拆开以后", () => {
    it("带着光标的位置发 split；宿主给回两块以后焦点进新的那一块，光标在它的开头", async () => {
        const wrapper = show({blocks: [block("b1", "前半。后半。")]});
        // 同真实的宿主：收到 split 就在同一拍里把新的块给回来。
        const offsets: number[] = [];
        await wrapper.setProps({onSplit: (_key: string, offset: number) => {
            offsets.push(offset);
            void wrapper.setProps({blocks: [block("b1", "前半。", {state: "edited"}), block("new:1", "后半。", {state: "new"})], count: 2});
        }});
        const area = wrapper.get("textarea").element as HTMLTextAreaElement;
        area.focus();
        area.setSelectionRange(3, 3);
        await wrapper.get("[data-text-split]").trigger("click");
        await flushPromises();
        const areas = wrapper.findAll("textarea").map((item) => item.element as HTMLTextAreaElement);
        expect([offsets, areas.map((item) => item.value), document.activeElement === areas[1], areas[1]?.selectionStart]).toEqual([[3], ["前半。", "后半。"], true, 0]);
    });
});
