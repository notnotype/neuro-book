/**
 * 表情在展示器与编辑器里（docs/specs/agent/stickers.md 输出 10–12、21、22、24）：真实语言、真实 Tiptap 与展示器，宿主端口用
 * 可以晚到的测试目录（结果由测试决定什么时候给）。
 */
import {Editor} from "@tiptap/core";
import {mount} from "@vue/test-utils";
import {defineComponent, h} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defaultChipEnv} from "../../../chip/chip";
import MarkdownDisplay from "../../../display/MarkdownDisplay.vue";
import {createMarkdownEditorExtensions} from "../../../editor/markdown-editor-extensions";
import {provideMarkdownHost} from "../../../host";
import type {ResolvedSticker, StickerRef, StickerResolver} from "../../../stickers";
import {codecFor} from "../../codec/codec";
import {defaultMarkdownLanguage} from "..";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

/** 测试目录：每次查询记下来，由测试给结果；`known` 里的名字给图，别的给 null。 */
function catalog(known: readonly string[]) {
    const queries: Array<{ref: StickerRef; signal: AbortSignal; answer(): void}> = [];
    let released = 0;
    const resolver: StickerResolver = (ref, signal) => new Promise<ResolvedSticker | null>((resolve) => {
        queries.push({
            ref,
            signal,
            answer: () => resolve(known.includes(ref.raw) ? {url: `/stickers/${encodeURIComponent(ref.name)}.webp`, width: 64, height: 48, release: () => (released += 1)} : null),
        });
    });
    return {resolver, queries, released: () => released, answerAll: () => queries.splice(0).forEach((query) => query.answer())};
}

function display(text: string, stickers: StickerResolver | undefined) {
    const Outer = defineComponent({
        setup: () => {
            provideMarkdownHost({...(stickers === undefined ? {} : {stickers})});
            return () => h(MarkdownDisplay, {locale: "zh-CN", text});
        },
    });
    const wrapper = mount(Outer, {attachTo: document.body});
    let unmounted = false;
    cleanups.push(() => unmounted || wrapper.unmount());
    return {root: wrapper.element as HTMLElement, unmount: () => ((unmounted = true), wrapper.unmount())};
}

/** `root` 是展示器的根元素（外层组件没有自己的元素）。 */
const settledDisplay = (root: HTMLElement) => waitUntil("展示器画完", () => root.childElementCount > 0 || null);

function editor(markdown: string, stickers: StickerResolver | undefined): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const instance = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", commentMarkerLabel: null, host: {base: () => null, assets: null, chips: defaultChipEnv, stickers}})});
    cleanups.push(() => instance.destroy());
    instance.commands.setContent(codecFor(instance.schema, language).read(markdown).doc.toJSON());
    return instance;
}

/** 像键盘一样打字：经输入规则（`handleTextInput`），没被接手时照常插入。 */
function type(instance: Editor, typed: string): void {
    for (const char of typed) {
        const {from, to} = instance.state.selection;
        const handled = instance.view.someProp("handleTextInput", (handle) => handle(instance.view, from, to, char, () => instance.state.tr.insertText(char, from, to)));
        if (handled !== true) instance.view.dispatch(instance.state.tr.insertText(char, from, to));
    }
}

const json = (instance: Editor) => instance.state.doc.toJSON().content?.[0]?.content;

describe("展示器", () => {
    it("先显示原文占位，目录给了结果后换成图；认不出的留原文", async () => {
        const stickers = catalog([":lyra/开心:"]);
        const {root} = display("今天:lyra/开心:和:没有:\n", stickers.resolver);
        await settledDisplay(root);
        const [known, unknown] = [...root.querySelectorAll<HTMLElement>(".nb-sticker")];
        expect(known?.classList.contains("is-loading")).toBe(true);
        expect(known?.textContent).toBe(":lyra/开心:");
        stickers.answerAll();
        await waitUntil("换成图", () => known?.querySelector("img") ?? null);
        const image = known?.querySelector("img");
        expect(image?.getAttribute("alt")).toBe(":lyra/开心:");
        expect(image?.getAttribute("src")).toBe(`/stickers/${encodeURIComponent("开心")}.webp`);
        expect([image?.getAttribute("width"), image?.getAttribute("height")]).toEqual(["64", "48"]);
        expect(known?.title).toBe(":lyra/开心:");
        await waitUntil("认不出的去掉占位", () => (unknown?.classList.contains("is-loading") === false ? true : null));
        expect(unknown?.textContent).toBe(":没有:");
        expect(unknown?.querySelector("img")).toBeNull();
    });

    it("图读不出来时显示原文", async () => {
        const stickers = catalog([":a:"]);
        const {root} = display(":a: 句子\n", stickers.resolver);
        await settledDisplay(root);
        stickers.answerAll();
        const image = await waitUntil("换成图", () => root.querySelector<HTMLImageElement>(".nb-sticker img"));
        image.dispatchEvent(new Event("error"));
        expect(root.querySelector(".nb-sticker")?.textContent).toBe(":a:");
        expect(root.querySelector(".nb-sticker img")).toBeNull();
    });

    it("没有端口时显示原文，不是占位", async () => {
        const {root} = display(":a:\n", undefined);
        await settledDisplay(root);
        const element = root.querySelector(".nb-sticker");
        expect(element?.textContent).toBe(":a:");
        expect(element?.classList.contains("is-loading")).toBe(false);
    });

    it("一个文本块里只有一到三个表情时显示成大图；夹在文字里或超过三个时不是", async () => {
        const {root} = display(":a:\n\n:a: :b: :c:\n\n句子 :a:\n\n:a::b::c::d:\n\n- :a:\n", undefined);
        await settledDisplay(root);
        const large = [...root.querySelectorAll(".nb-sticker-block")].map((element) => element.textContent?.trim());
        expect(large).toEqual([":a:", ":a: :b: :c:", ":a:"]);
    });

    it("卸载时取消还在查的、释放已显示的", async () => {
        const stickers = catalog([":a:"]);
        const {root, unmount} = display(":a: :b:\n", stickers.resolver);
        await settledDisplay(root);
        const [first, second] = stickers.queries;
        first?.answer();
        await waitUntil("换成图", () => root.querySelector(".nb-sticker img"));
        unmount();
        expect(stickers.released()).toBe(1);
        expect(second?.signal.aborted).toBe(true);
    });
});

describe("编辑器", () => {
    it("元素结构与类名同展示器", async () => {
        const stickers = catalog([":a:"]);
        const instance = editor("x :a:\n", stickers.resolver);
        const {root} = display("x :a:\n", stickers.resolver);
        await settledDisplay(root);
        stickers.answerAll();
        await waitUntil("两边都换成图", () => (instance.view.dom.querySelector(".nb-sticker img") !== null && root.querySelector(".nb-sticker img") !== null) || null);
        const shape = (element: Element | null) => ({tag: element?.tagName, classes: [...(element?.classList ?? [])].filter((name) => !name.startsWith("ProseMirror")), sticker: (element as HTMLElement | null)?.dataset.sticker, children: [...(element?.children ?? [])].map((child) => `${child.tagName}.${child.className}`)});
        expect(shape(instance.view.dom.querySelector(".nb-sticker"))).toEqual(shape(root.querySelector(".nb-sticker")));
    });

    it("打出结尾的冒号变成表情节点，紧接着退格还原成打出的文字", () => {
        const instance = editor("今天\n", undefined);
        instance.commands.setTextSelection(3);
        type(instance, ":lyra/开心:");
        expect(json(instance)).toEqual([{type: "text", text: "今天"}, {type: "sticker", attrs: {raw: ":lyra/开心:"}}]);
        instance.view.someProp("handleKeyDown", (handle) => handle(instance.view, new KeyboardEvent("keydown", {key: "Backspace"})));
        expect(json(instance)).toEqual([{type: "text", text: "今天:lyra/开心:"}]);
    });

    it("时间不变成表情", () => {
        const instance = editor("x\n", undefined);
        instance.commands.setTextSelection(2);
        type(instance, "10:30:");
        expect(json(instance)).toEqual([{type: "text", text: "x10:30:"}]);
    });

    it("大图随同一段里的编辑更新", () => {
        const instance = editor(":a:\n", undefined);
        const paragraph = () => instance.view.dom.querySelector("p");
        expect(paragraph()?.classList.contains("nb-sticker-block")).toBe(true);
        instance.commands.setTextSelection(2);
        type(instance, "字");
        expect(paragraph()?.classList.contains("nb-sticker-block")).toBe(false);
        instance.commands.deleteRange({from: 2, to: 3});
        expect(paragraph()?.classList.contains("nb-sticker-block")).toBe(true);
    });

    it("从展示器复制来的 HTML 粘贴回来仍是表情，不变成图片；纯文字粘贴的写法留作文字", () => {
        const instance = editor("x\n", undefined);
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML("<p>前<span class=\"nb-sticker\" data-sticker=\":lyra/开心:\" title=\":lyra/开心:\"><img class=\"nb-sticker__image\" alt=\":lyra/开心:\" src=\"/api/nbook.stickers/image/user.lyra/a.webp\"></span>后</p>");
        expect(JSON.stringify(json(instance))).toContain("\"type\":\"sticker\"");
        expect(JSON.stringify(json(instance))).not.toContain("\"type\":\"image\"");
        const plain = editor("x\n", undefined);
        plain.commands.setTextSelection(2);
        plain.view.pasteText(":abc:");
        expect(json(plain)).toEqual([{type: "text", text: "x:abc:"}]);
    });

    it("复制的纯文字里是写法的原文", () => {
        const instance = editor("前:a:后\n", undefined);
        instance.commands.setTextSelection({from: 1, to: instance.state.doc.content.size - 1});
        const text = instance.view.someProp("clipboardTextSerializer", (serialize) => serialize(instance.state.selection.content(), instance.view));
        expect(text).toBe("前:a:后");
    });
});
