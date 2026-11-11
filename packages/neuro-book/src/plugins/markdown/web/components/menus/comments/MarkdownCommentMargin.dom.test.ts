/**
 * 批注页边的排布（docs/specs/workbench/markdown-editing.md 输出 33）：happy-dom 没有排版，位置与卡片高度用桩喂（桩的是浏览器的几何，
 * 排布的算法是真实的）。真实浏览器里的位置在 `e2e/markdown-comments.e2e.ts` 里看。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {listComments} from "@notnotype/nb-markdown/editor";
import type {CommentInfo} from "@notnotype/nb-markdown/editor";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {markRaw, nextTick} from "vue";

import MarkdownCommentMargin from "./MarkdownCommentMargin.vue";
import type {MarginItem} from "./MarkdownCommentMargin.vue";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const labels = {empty: "空", counter: () => "n", previous: "上", next: "下", edit: "编辑", remove: "删除", save: "保存", cancel: "取消", body: "意见"};

function setup(markdown: string) {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    element.className = "markdown-control";
    scroller.append(element);
    document.body.append(scroller);
    const editor = new Editor({element, extensions: [...language.extensions]});
    const read = codecFor(editor.schema, language).read(markdown);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    // 浏览器的几何：行高 10px、每个文档位置占一行，卡片高度 40px。
    editor.view.coordsAtPos = (pos: number) => ({top: pos * 10, bottom: pos * 10 + 10, left: 100, right: 110});
    const heights = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {configurable: true, get: () => 40});
    cleanups.push(() => {
        if (heights === undefined) Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
        else Object.defineProperty(HTMLElement.prototype, "offsetHeight", heights);
        editor.destroy();
        scroller.remove();
    });
    return {editor, scroller, infos: listComments(editor.state.doc)};
}

const items = (infos: ReadonlyArray<CommentInfo>, modes: ReadonlyArray<MarginItem["mode"]> = []): MarginItem[] => infos.map((info, index) => ({key: info.identity, info, mode: modes[index] ?? "compact", anchor: info.start}));

function mountMargin(editor: Editor, scroller: HTMLElement, list: MarginItem[], total = list.length): VueWrapper {
    const wrapper = mount(MarkdownCommentMargin, {props: {editor: markRaw(editor), scroller, items: list, total, readonly: false, labels, session: 0, version: 0, draft: null}, attachTo: document.body});
    cleanups.push(() => wrapper.unmount());
    return wrapper;
}

const tops = (wrapper: VueWrapper): number[] => wrapper.findAll(".markdown-comment-margin__item").map((item) => Number.parseFloat((item.element as HTMLElement).style.top));

describe("排布", () => {
    it("顶边对着各自批注第一行；靠得太近的往下让（卡片高 40、间距 6），顺序与文档一致，不互相盖住", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment><comment body=\"乙\">三四</comment>\n\n五六七八九十\n\n<comment body=\"丙\">十一</comment>\n");
        const wrapper = mountMargin(editor, scroller, items(infos));
        (wrapper.vm as unknown as {layout: () => void}).layout();
        await nextTick();
        const [first, second, third] = tops(wrapper);
        expect(first).toBe((infos[0] as CommentInfo).start * 10);
        // 第二条的起点只比第一条大 2，对着它的位置会盖住第一张：往下让到第一张的下沿加间距。
        expect(second).toBe((first as number) + 40 + 6);
        // 第三条离得远：就在它自己的位置，不被前面的推走。
        expect(third).toBe((infos[2] as CommentInfo).start * 10);
        expect(third as number).toBeGreaterThan((second as number) + 40);
    });

    it("展开的与摘要的混排；待写的新批注（info 为 null）按它的位置排进去", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>三四五六七八九十\n\n<comment body=\"乙\">十一</comment>\n");
        const list = items(infos, ["compact", "view"]);
        list.splice(1, 0, {key: "pending", info: null, mode: "write", anchor: (infos[0] as CommentInfo).start + 4});
        const wrapper = mountMargin(editor, scroller, list, infos.length);
        (wrapper.vm as unknown as {layout: () => void}).layout();
        await nextTick();
        expect(wrapper.findAll(".markdown-comment-margin__item").map((item) => item.attributes("data-mode"))).toEqual(["compact", "write", "view"]);
        const ordered = tops(wrapper);
        expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
        expect(wrapper.find('.markdown-comment-margin__item[data-mode="write"] textarea').exists()).toBe(true);
    });

    it("折叠的提示块里的批注（coordsAtPos 给全 0）：退到最近有盒子的祖先的顶边", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>\n");
        editor.view.coordsAtPos = () => ({top: 0, bottom: 0, left: 0, right: 0});
        const folded = document.createElement("div");
        const inner = document.createElement("span");
        folded.append(inner);
        scroller.append(folded);
        folded.getBoundingClientRect = () => ({top: 123, bottom: 143, left: 0, right: 0, width: 0, height: 20, x: 0, y: 123, toJSON: () => ({})}) as DOMRect;
        editor.view.domAtPos = () => ({node: inner, offset: 0});
        const wrapper = mountMargin(editor, scroller, items(infos));
        (wrapper.vm as unknown as {layout: () => void}).layout();
        await nextTick();
        expect(tops(wrapper)).toEqual([123]);
    });

    it("位置超出文档（换文档之后到第一次重算之前）：夹在文档里，不抛错", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>\n");
        const seen: number[] = [];
        editor.view.coordsAtPos = (pos: number) => {
            seen.push(pos);
            return {top: pos * 10, bottom: pos * 10 + 10, left: 1, right: 2};
        };
        const stale = items(infos).map((item) => ({...item, anchor: 9999}));
        const wrapper = mountMargin(editor, scroller, stale);
        expect(() => (wrapper.vm as unknown as {layout: () => void}).layout()).not.toThrow();
        expect(seen.every((pos) => pos <= editor.state.doc.content.size)).toBe(true);
    });

    it("排完之前卡片先藏着（不从顶上滑下来）；事件带着卡片对应的批注转发", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>\n");
        const wrapper = mountMargin(editor, scroller, items(infos, ["view"]));
        expect((wrapper.find(".markdown-comment-margin__item").element as HTMLElement).style.visibility).toBe("hidden");
        (wrapper.vm as unknown as {layout: () => void}).layout();
        await nextTick();
        expect((wrapper.find(".markdown-comment-margin__item").element as HTMLElement).style.visibility).toBe("");
        await wrapper.get('[aria-label="编辑"]').trigger("click");
        await wrapper.get('[aria-label="下"]').trigger("click");
        expect(wrapper.emitted("edit")?.[0]).toEqual([infos[0]]);
        expect(wrapper.emitted("next")).toBeUndefined();
    });
});
