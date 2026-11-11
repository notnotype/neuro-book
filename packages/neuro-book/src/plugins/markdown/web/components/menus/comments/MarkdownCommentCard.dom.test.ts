/** 批注卡片（docs/specs/workbench/markdown-editing.md 输出 29）：看、写、只读、摘要，按下不夺焦、窗口失焦不丢字。 */
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import MarkdownCommentCard from "./MarkdownCommentCard.vue";

const labels = {empty: "没有写意见", counter: (index: number, total: number) => `第 ${index} 条，共 ${total} 条`, previous: "上一条", next: "下一条", edit: "编辑", remove: "删除", save: "保存", cancel: "取消", body: "批注意见"};

const wrappers: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

function card(props: Partial<InstanceType<typeof MarkdownCommentCard>["$props"]> = {}) {
    const wrapper = mount(MarkdownCommentCard, {props: {body: "第一行\n第二行", index: 1, total: 3, mode: "view", readonly: false, labels, session: 0, ...props}, attachTo: document.body});
    wrappers.push(wrapper);
    return wrapper;
}

const button = (wrapper: VueWrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`);
const field = (wrapper: VueWrapper) => wrapper.get("textarea");

describe("看", () => {
    it("意见保留换行，“第 i 条，共 n 条”与上一条、下一条、编辑、删除", async () => {
        const wrapper = card();
        expect(wrapper.get("[data-markdown-comment-body]").text()).toBe("第一行\n第二行");
        expect(wrapper.get("[data-markdown-comment-counter]").text()).toBe("第 2 条，共 3 条");
        for (const [name, event] of [["上一条", "previous"], ["下一条", "next"], ["编辑", "edit"], ["删除", "remove"]] as const) {
            await button(wrapper, name).trigger("click");
            expect(wrapper.emitted(event), name).toHaveLength(1);
        }
    });

    it("第一条的上一条、最后一条的下一条置灰；意见为空时是灰字提示", () => {
        const first = card({index: 0, body: ""});
        expect(button(first, "上一条").attributes("disabled")).toBeDefined();
        expect(button(first, "下一条").attributes("disabled")).toBeUndefined();
        expect(first.get("[data-markdown-comment-body]").text()).toBe("没有写意见");
        expect(first.get("[data-markdown-comment-body]").classes()).toContain("markdown-comment-card__body--empty");
        const last = card({index: 2});
        expect(button(last, "下一条").attributes("disabled")).toBeDefined();
    });

    it("只读时没有编辑与删除，上一条、下一条照常", () => {
        const wrapper = card({readonly: true});
        expect(wrapper.find('button[aria-label="编辑"]').exists()).toBe(false);
        expect(wrapper.find('button[aria-label="删除"]').exists()).toBe(false);
        expect(button(wrapper, "下一条").attributes("disabled")).toBeUndefined();
    });

    it("摘要：只有意见，没有按钮，点它发 select", async () => {
        const wrapper = card({compact: true});
        expect(wrapper.findAll("button")).toHaveLength(0);
        await wrapper.trigger("click");
        expect(wrapper.emitted("select")).toHaveLength(1);
    });
});

describe("写", () => {
    it("预填原意见、聚焦、光标在末尾；再进入（session 变）时重新预填", async () => {
        const wrapper = card({mode: "write", body: "原意见", session: 1});
        await nextTick();
        const input = field(wrapper).element as HTMLTextAreaElement;
        expect(input.value).toBe("原意见");
        expect(document.activeElement).toBe(input);
        expect(input.selectionStart).toBe(3);
        await field(wrapper).setValue("写了一半");
        await wrapper.setProps({body: "另一条", session: 2});
        await nextTick();
        expect((field(wrapper).element as HTMLTextAreaElement).value).toBe("另一条");
    });

    it("Ctrl+Enter 与 ⌘Enter 保存（去首尾空白），回车只是换行，空意见是取消，Esc 与取消按钮取消", async () => {
        const wrapper = card({mode: "write", body: "", session: 1});
        await nextTick();
        await field(wrapper).setValue("  第一行\n第二行 ");
        await field(wrapper).trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("submit")).toBeUndefined();
        await field(wrapper).trigger("keydown", {key: "Enter", ctrlKey: true});
        expect(wrapper.emitted("submit")?.at(-1)).toEqual(["第一行\n第二行"]);
        await field(wrapper).trigger("keydown", {key: "Enter", metaKey: true});
        expect(wrapper.emitted("submit")).toHaveLength(2);
        await button(wrapper, "保存").trigger("click");
        expect(wrapper.emitted("submit")).toHaveLength(3);

        await field(wrapper).setValue(" \n ");
        await field(wrapper).trigger("keydown", {key: "Enter", ctrlKey: true});
        await button(wrapper, "保存").trigger("click");
        expect(wrapper.emitted("cancel")).toHaveLength(2);
        expect(wrapper.emitted("submit")).toHaveLength(3);

        await field(wrapper).trigger("keydown", {key: "Escape"});
        await button(wrapper, "取消").trigger("click");
        expect(wrapper.emitted("cancel")).toHaveLength(4);
    });

    it("输入法组字中的 Ctrl+Enter 与 Esc 归输入法", async () => {
        const wrapper = card({mode: "write", body: "", session: 1});
        await nextTick();
        await field(wrapper).setValue("字");
        await field(wrapper).trigger("keydown", {key: "Escape", isComposing: true});
        await field(wrapper).trigger("keydown", {key: "Enter", ctrlKey: true, isComposing: true});
        expect(wrapper.emitted("cancel")).toBeUndefined();
        expect(wrapper.emitted("submit")).toBeUndefined();
    });

    it("意见区没有输入框的框：字段不带字段外框", async () => {
        const wrapper = card({mode: "write", body: "x", session: 1});
        await nextTick();
        expect(field(wrapper).classes()).not.toContain("nb-ui-control");
        expect(field(wrapper).classes()).not.toContain("border");
    });
});

describe("焦点", () => {
    it("点卡片的按钮与空白不夺走焦点；点输入控件照常", async () => {
        const wrapper = card();
        const onButton = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        button(wrapper, "下一条").element.dispatchEvent(onButton);
        expect(onButton.defaultPrevented).toBe(true);
        const onBlank = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        wrapper.get("[data-markdown-comment-body]").element.dispatchEvent(onBlank);
        expect(onBlank.defaultPrevented).toBe(true);
        const writing = card({mode: "write", body: "x", session: 1});
        await nextTick();
        const onField = new MouseEvent("mousedown", {bubbles: true, cancelable: true});
        field(writing).element.dispatchEvent(onField);
        expect(onField.defaultPrevented).toBe(false);
    });

    it("写的时候焦点移到卡片外才发 dismiss；移到卡片里的按钮、窗口失焦都不算", async () => {
        const outside = document.createElement("button");
        document.body.append(outside);
        const wrapper = card({mode: "write", body: "x", session: 1});
        await nextTick();
        const input = field(wrapper);
        await input.trigger("focusout", {relatedTarget: button(wrapper, "保存").element});
        expect(wrapper.emitted("dismiss")).toBeUndefined();
        // 窗口失焦：relatedTarget 为空，文档没有焦点。
        const original = document.hasFocus;
        document.hasFocus = () => false;
        await input.trigger("focusout", {relatedTarget: null});
        document.hasFocus = original;
        expect(wrapper.emitted("dismiss")).toBeUndefined();
        // 点了页面上没有焦点的地方：relatedTarget 为空，文档有焦点。
        document.hasFocus = () => true;
        await input.trigger("focusout", {relatedTarget: null});
        document.hasFocus = original;
        expect(wrapper.emitted("dismiss")).toHaveLength(1);
        await input.trigger("focusout", {relatedTarget: outside});
        expect(wrapper.emitted("dismiss")).toHaveLength(2);
        outside.remove();
    });

    it("看的时候焦点离开不发 dismiss", async () => {
        const wrapper = card();
        await wrapper.trigger("focusout", {relatedTarget: null});
        expect(wrapper.emitted("dismiss")).toBeUndefined();
    });
});
