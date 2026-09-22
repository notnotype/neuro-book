// @vitest-environment jsdom
import {mount, flushPromises} from "@vue/test-utils";
import * as Vue from "vue";
import {describe, expect, it, vi} from "vitest";
import TipTapMarkdownEditor from "./TipTapMarkdownEditor.vue";
import type {MarkdownEditorHandle} from "./markdown-editor.types";

vi.mock("nbook/app/composables/useDialog", () => ({useDialog: () => ({confirm: async () => true})}));
vi.mock("nbook/app/composables/useNotification", () => ({useNotification: () => ({error: () => undefined, warning: () => undefined, success: () => undefined})}));
// Nuxt 自动导入在测试环境里由全局补齐。
Object.assign(globalThis, Vue, {useI18n: () => ({t: (key: string) => key})});

// jsdom 没有布局：ProseMirror 的光标/滚动测量需要这些方法，补空矩形即可。
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
    const emptyRects = () => ({length: 0, item: () => null, [Symbol.iterator]: function* () {}} as unknown as DOMRectList);
    const emptyRect = () => ({x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({})}) as DOMRect;
    Range.prototype.getClientRects = emptyRects;
    Range.prototype.getBoundingClientRect = emptyRect;
}
if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () => ({length: 0, item: () => null, [Symbol.iterator]: function* () {}} as unknown as DOMRectList);
}

const initial = "---\ntitle: 退潮\n---\n\n# 开场\n\n第一段。\n";

async function mounted() {
    const wrapper = mount(TipTapMarkdownEditor, {
        props: {initialValue: initial, activePath: "manuscript/chapter-01.md"},
        attachTo: document.body,
    });
    await flushPromises();
    return {wrapper, root: wrapper.find(".ProseMirror").element, handle: wrapper.vm as unknown as MarkdownEditorHandle};
}

function paste(root: Element, text: string): void {
    const event = new Event("paste", {bubbles: true, cancelable: true});
    Object.defineProperty(event, "clipboardData", {value: {getData: () => text}});
    root.dispatchEvent(event);
}

/** 走真实键盘通道：TipTap 的 undo 命令在 jsdom 里 focus 链路不完整，Ctrl+Z 才是用户路径。 */
function pressUndo(root: Element): void {
    root.dispatchEvent(new KeyboardEvent("keydown", {key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true}));
}

const body = (root: Element): string => (root.textContent ?? "").replace(/\s+/gu, " ").trim();

describe("TipTapMarkdownEditor 外部回灌的撤销基线", () => {
    it("自己的输入可撤销，外部回灌不入撤销栈", async () => {
        const {wrapper, root} = await mounted();
        expect(body(root)).toContain("第一段。");

        paste(root, "粘贴进来的句子");
        await flushPromises();
        expect(body(root)).toContain("粘贴进来的句子");

        pressUndo(root);
        await flushPromises();
        expect(body(root)).not.toContain("粘贴进来的句子");
        expect(body(root)).toContain("第一段。");

        // 外部权威正文（兄弟视图 / 磁盘）：整篇替换不进历史，Ctrl+Z 不能把它撤回去。
        wrapper.vm.update("---\ntitle: 退潮\n---\n\n# 开场\n\n外部权威正文。\n");
        await flushPromises();
        expect(body(root)).toContain("外部权威正文。");
        expect(body(root)).not.toContain("第一段。");

        pressUndo(root);
        await flushPromises();
        expect(body(root)).toContain("外部权威正文。");

        // 回灌之后的新输入照常可撤销。
        paste(root, "同步后的输入");
        await flushPromises();
        expect(body(root)).toContain("同步后的输入");
        pressUndo(root);
        await flushPromises();
        expect(body(root)).not.toContain("同步后的输入");
        expect(body(root)).toContain("外部权威正文。");
        wrapper.unmount();
    });
});
