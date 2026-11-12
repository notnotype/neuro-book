/**
 * 批注页边的排布（docs/specs/workbench/markdown-editing.md 输出 33）：happy-dom 没有排版，各段的盒子、卡片的自然高度与卡片的样式用桩喂
 * （桩的是浏览器的几何，排布的算法是真实的；高度范围的算术在 `margin-layout.test.ts`）。真实浏览器里的位置在 `e2e/markdown-comments.e2e.ts` 里看。
 */
import {codecFor, defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {listComments, nextTerritory, territoryOf} from "@notnotype/nb-markdown/editor";
import type {CommentInfo} from "@notnotype/nb-markdown/editor";
import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import {mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {markRaw, nextTick} from "vue";

import MarkdownCommentMargin from "./MarkdownCommentMargin.vue";
import type {MarginSlot} from "./MarkdownCommentMargin.vue";

const language = defaultMarkdownLanguage();
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const labels = {empty: "空", counter: () => "n", previous: "上", next: "下", edit: "编辑", remove: "删除", save: "保存", cancel: "取消", body: "意见"};

/** 行高 20、卡片内边距上下各 6、卡片面描边各 1：一行意见的卡片 34，八行 174。 */
const LINE = 20;
const CHROME = 14;

interface Box {
    readonly top: number;
    readonly height: number;
}

/**
 * 浏览器的几何：`boxes` 按段的起点位置给各段的盒子；卡片的自然高度看意见文字（含“长”的 148，其余 32）加卡片面的描边 2；
 * 卡片与卡片面的样式用行内样式给（样式表在 happy-dom 里不生效）。
 */
function setup(markdown: string, boxes: (editor: Editor, infos: CommentInfo[]) => Map<number, Box>) {
    const scroller = document.createElement("div");
    const element = document.createElement("div");
    element.className = "markdown-control";
    scroller.append(element);
    document.body.append(scroller);
    const editor = new Editor({element, extensions: [...language.extensions]});
    const read = codecFor(editor.schema, language).read(markdown);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    const infos = listComments(editor.state.doc);
    const table = boxes(editor, infos);
    const asked: number[] = [];
    editor.view.nodeDOM = (pos: number) => {
        asked.push(pos);
        const box = table.get(pos);
        if (box === undefined) return null;
        const dom = document.createElement("div");
        dom.getBoundingClientRect = () => ({top: box.top, bottom: box.top + box.height, height: box.height, left: 0, right: 0, width: 0, x: 0, y: box.top, toJSON: () => ({})}) as DOMRect;
        scroller.append(dom);
        return dom;
    };
    const heights = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const inner = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
            if (this.matches("[data-markdown-comment-card]")) return (this.textContent ?? "").includes("长") ? 148 : LINE + 12;
            return this.matches(".markdown-comment-margin__surface") ? 999 : 0;
        },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {configurable: true, get: () => 997});
    cleanups.push(() => {
        if (heights === undefined) Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
        else Object.defineProperty(HTMLElement.prototype, "offsetHeight", heights);
        if (inner === undefined) Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
        else Object.defineProperty(HTMLElement.prototype, "clientHeight", inner);
        editor.destroy();
        scroller.remove();
    });
    return {editor, scroller, infos, asked};
}

/** 一段一个槽位：key 取 `s` 加起点位置。 */
function slot(editor: Editor, infos: ReadonlyArray<CommentInfo>, extra: Partial<MarginSlot> = {}, commented: ReadonlySet<number> = new Set()): MarginSlot {
    const anchor = territoryOf(editor.state.doc, infos[0] as CommentInfo);
    const next = nextTerritory(editor.state.doc, anchor);
    return {key: `s${anchor}`, anchor, next, nextCommented: next !== null && commented.has(next), infos, active: 0, mode: "idle", expanded: false, ...extra};
}

function mountMargin(editor: Editor, scroller: HTMLElement, slots: MarginSlot[], total = slots.reduce((sum, item) => sum + item.infos.length, 0)): VueWrapper {
    const wrapper = mount(MarkdownCommentMargin, {props: {editor: markRaw(editor), scroller, slots, total, readonly: false, labels, session: 0, version: 0, draft: null}, attachTo: document.body});
    cleanups.push(() => wrapper.unmount());
    // 卡片的样式：量行高与内边距的地方读行内样式。
    for (const card of document.body.querySelectorAll<HTMLElement>("[data-markdown-comment-margin] [data-markdown-comment-card]")) {
        card.style.lineHeight = `${LINE}px`;
        card.style.paddingTop = "6px";
        card.style.paddingBottom = "6px";
    }
    for (const surface of document.body.querySelectorAll<HTMLElement>("[data-markdown-comment-margin] .markdown-comment-margin__surface")) {
        surface.style.borderTopWidth = "1px";
        surface.style.borderBottomWidth = "1px";
    }
    return wrapper;
}

const layout = (wrapper: VueWrapper): void => (wrapper.vm as unknown as {layout: () => void}).layout();
const itemOf = (wrapper: VueWrapper, index: number) => wrapper.findAll(".markdown-comment-margin__item")[index] as ReturnType<VueWrapper["find"]>;
const numberOf = (value: string): number => Number.parseFloat(value);
const topOf = (wrapper: VueWrapper, index: number): number => numberOf((itemOf(wrapper, index).element as HTMLElement).style.top);
const idleOf = (wrapper: VueWrapper, index: number): number => numberOf((itemOf(wrapper, index).element as HTMLElement).style.height);
const surfaceOf = (wrapper: VueWrapper, index: number): number => numberOf((itemOf(wrapper, index).get(".markdown-comment-margin__surface").element as HTMLElement).style.height);

const THREE = "<comment body=\"甲\">一二</comment>三四\n\n<comment body=\"乙\">五六</comment>七八\n\n<comment body=\"丙\">九十</comment>\n";

describe("排布", () => {
    it("槽位顶边对着各自这一段的顶边；各段互不挤时位置不被推；高度是意见的自然高度夹在范围里", async () => {
        const {editor, scroller, infos} = setup(THREE, (ed, list) => new Map(list.map((info, index) => [territoryOf(ed.state.doc, info), {top: 100 + index * 150, height: 100}])));
        const wrapper = mountMargin(editor, scroller, infos.map((info) => slot(editor, [info], {}, new Set(infos.map((other) => territoryOf(editor.state.doc, other))))));
        layout(wrapper);
        await nextTick();
        expect([0, 1, 2].map((index) => topOf(wrapper, index))).toEqual([100, 250, 400]);
        // 一段高 100、下一段有批注：范围是 [96, 96]，意见自然高度 34 被抬到最小高度。
        expect([0, 1, 2].map((index) => idleOf(wrapper, index))).toEqual([96, 96, 96]);
        expect(surfaceOf(wrapper, 0)).toBe(96);
    });

    it("一行的短段放一行意见：卡片比这一段高，后面的槽位往下让，不互相盖住", async () => {
        const {editor, scroller, infos} = setup(THREE, (ed, list) => new Map(list.map((info, index) => [territoryOf(ed.state.doc, info), {top: 100 + index * 30, height: 28}])));
        const wrapper = mountMargin(editor, scroller, infos.map((info) => slot(editor, [info], {}, new Set(infos.map((other) => territoryOf(editor.state.doc, other))))));
        layout(wrapper);
        await nextTick();
        // 一行意见的卡片 34 高，比这一段（28）高；各段的顶边相隔 30，后一个让到前一个的下沿加间距。
        expect([0, 1, 2].map((index) => idleOf(wrapper, index))).toEqual([34, 34, 34]);
        expect([0, 1, 2].map((index) => topOf(wrapper, index))).toEqual([100, 138, 176]);
    });

    it("下一段没有批注：长意见可以长到两倍段高，但不越过下一段的底边", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"长意见\">一二</comment>三四\n\n五六七八\n\n九十\n", (ed, list) => {
            const first = territoryOf(ed.state.doc, list[0] as CommentInfo);
            const second = nextTerritory(ed.state.doc, first) as number;
            return new Map([[first, {top: 100, height: 60}], [second, {top: 180, height: 30}]]);
        });
        const wrapper = mountMargin(editor, scroller, [slot(editor, infos)]);
        layout(wrapper);
        await nextTick();
        // 两倍段高是 100 + 120 = 220，下一段的底边在 210：上限 210 - 100 - 4 = 106；意见自然 150 被夹到 106。
        expect(idleOf(wrapper, 0)).toBe(106);
    });

    it("展开：槽位占位仍是展开之前的高度，卡片面向下长到自然高度，别的槽位不动", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"长意见\">一二</comment>三四\n\n<comment body=\"乙\">五六</comment>七八\n", (ed, list) => new Map(list.map((info, index) => [territoryOf(ed.state.doc, info), {top: 100 + index * 80, height: 60}])));
        const commented = new Set(infos.map((info) => territoryOf(editor.state.doc, info)));
        const wrapper = mountMargin(editor, scroller, infos.map((info) => slot(editor, [info], {}, commented)));
        layout(wrapper);
        await nextTick();
        const before = {tops: [0, 1].map((index) => topOf(wrapper, index)), idle: idleOf(wrapper, 0), surface: surfaceOf(wrapper, 0)};
        expect(before.surface).toBe(before.idle);
        await wrapper.setProps({slots: infos.map((info, index) => slot(editor, [info], index === 0 ? {mode: "current", expanded: true} : {}, commented))});
        layout(wrapper);
        await nextTick();
        expect(idleOf(wrapper, 0)).toBe(before.idle);
        expect(surfaceOf(wrapper, 0)).toBe(150);
        expect([0, 1].map((index) => topOf(wrapper, index))).toEqual(before.tops);
        expect(itemOf(wrapper, 0).attributes("data-expanded")).toBeDefined();
        expect(itemOf(wrapper, 1).attributes("data-expanded")).toBeUndefined();
    });

    it("同一段几条批注：只显示 active 那一条与 1/3，箭头发 select（不展开），点卡片空白发 select（展开）", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一</comment><comment body=\"乙\">二</comment><comment body=\"丙\">三</comment>四\n", (ed, list) => new Map([[territoryOf(ed.state.doc, list[0] as CommentInfo), {top: 100, height: 60}]]));
        const wrapper = mountMargin(editor, scroller, [slot(editor, infos, {active: 1})]);
        expect(wrapper.findAll(".markdown-comment-margin__item")).toHaveLength(1);
        expect(wrapper.get("[data-markdown-comment-body]").text()).toBe("乙");
        expect(wrapper.get("[data-markdown-comment-pager]").text()).toBe("2/3");
        await wrapper.get('[aria-label="下"]').trigger("click");
        await wrapper.get('[aria-label="上"]').trigger("click");
        expect(wrapper.emitted("select")).toEqual([[infos[2], false], [infos[0], false]]);
        await wrapper.get("[data-markdown-comment-body]").trigger("click");
        expect(wrapper.emitted("select")?.[2]).toEqual([infos[1], true]);
    });

    it("待写的新批注（infos 为空）：浮着、有输入；不推别的槽位，不占别的槽位的位置", async () => {
        const {editor, scroller, infos} = setup(THREE, (ed, list) => new Map(list.map((info, index) => [territoryOf(ed.state.doc, info), {top: 100 + index * 150, height: 100}])));
        const commented = new Set(infos.map((info) => territoryOf(editor.state.doc, info)));
        const pending: MarginSlot = {...slot(editor, [infos[0] as CommentInfo]), key: "pending", infos: [], mode: "write", expanded: true};
        const wrapper = mountMargin(editor, scroller, [slot(editor, [infos[0] as CommentInfo], {}, commented), pending, slot(editor, [infos[1] as CommentInfo], {}, commented)]);
        layout(wrapper);
        await nextTick();
        expect(wrapper.find('.markdown-comment-margin__item[data-mode="write"] textarea').exists()).toBe(true);
        expect([0, 1, 2].map((index) => topOf(wrapper, index))).toEqual([100, 100, 250]);
    });

    it("折叠的提示块里的批注（段的盒子高度为 0）：退到最近有盒子的祖先的顶边", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>\n", () => new Map());
        const folded = document.createElement("div");
        const inner = document.createElement("span");
        folded.append(inner);
        scroller.append(folded);
        folded.getBoundingClientRect = () => ({top: 123, bottom: 143, left: 0, right: 0, width: 0, height: 20, x: 0, y: 123, toJSON: () => ({})}) as DOMRect;
        editor.view.nodeDOM = () => inner;
        const wrapper = mountMargin(editor, scroller, [slot(editor, infos)]);
        layout(wrapper);
        await nextTick();
        expect(topOf(wrapper, 0)).toBe(123);
    });

    it("位置超出文档（换文档之后到第一次重算之前）：夹在文档里，不抛错", async () => {
        const {editor, scroller, infos, asked} = setup("<comment body=\"甲\">一二</comment>\n", () => new Map());
        const wrapper = mountMargin(editor, scroller, [{...slot(editor, infos), anchor: 9999, next: 9999}]);
        expect(() => layout(wrapper)).not.toThrow();
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((pos) => pos <= editor.state.doc.content.size)).toBe(true);
    });

    it("新槽位排好位置之前没有 data-ready（藏着、没有过渡），位置落下后下一帧才有；事件带着卡片对应的批注转发", async () => {
        const {editor, scroller, infos} = setup("<comment body=\"甲\">一二</comment>\n", (ed, list) => new Map([[territoryOf(ed.state.doc, list[0] as CommentInfo), {top: 100, height: 60}]]));
        const wrapper = mountMargin(editor, scroller, [slot(editor, infos, {mode: "current"})]);
        expect(itemOf(wrapper, 0).attributes("data-ready")).toBeUndefined();
        layout(wrapper);
        await vi.waitFor(() => expect(itemOf(wrapper, 0).attributes("data-ready")).toBeDefined());
        await wrapper.get('[aria-label="编辑"]').trigger("click");
        expect(wrapper.emitted("edit")?.[0]).toEqual([infos[0]]);
        expect(wrapper.emitted("select")).toBeUndefined();
    });

    it("位置按槽位记，不按下标：中间插进一个新槽位时，已有的槽位不会先拿到邻居的旧位置（位置过渡会让它滑向邻居再折回）", async () => {
        const {editor, scroller, infos} = setup(THREE, (ed, list) => new Map(list.map((info, index) => [territoryOf(ed.state.doc, info), {top: 100 + index * 150, height: 100}])));
        const commented = new Set(infos.map((info) => territoryOf(editor.state.doc, info)));
        const wrapper = mountMargin(editor, scroller, [slot(editor, [infos[0] as CommentInfo], {}, commented), slot(editor, [infos[2] as CommentInfo], {}, commented)]);
        layout(wrapper);
        await nextTick();
        const before = [0, 1].map((index) => topOf(wrapper, index));
        await wrapper.setProps({slots: [slot(editor, [infos[0] as CommentInfo], {}, commented), slot(editor, [infos[1] as CommentInfo], {}, commented), slot(editor, [infos[2] as CommentInfo], {}, commented)]});
        // 新槽位还没排：在 0，没有 data-ready；原来两个的位置一个像素没动。
        expect(topOf(wrapper, 0)).toBe(before[0]);
        expect(topOf(wrapper, 2)).toBe(before[1]);
        expect(itemOf(wrapper, 1).attributes("data-ready")).toBeUndefined();
    });
});
