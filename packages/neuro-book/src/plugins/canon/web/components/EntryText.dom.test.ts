/**
 * EntryText（同名 .md，docs/specs/canon/author-ui.md 输出 10）：mdast 的块照常排版；值是按钮，未知、不完整与“改过”标记；点值
 * 发 value（不写条目的值指本条目），展开着的值所在的块后面是来历插槽；条目引用发 entry；出错的块写纯文本与原因。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import type {EntryTextBlock, EntryTextNode} from "./entry-text";
import EntryText from "./EntryText.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const t = (value: string): EntryTextNode => ({type: "text", value});
const p = (...children: EntryTextNode[]): EntryTextNode => ({type: "paragraph", children});
const root = (...children: EntryTextNode[]): EntryTextNode => ({type: "root", children});
const value = (path: string, display: string, extra: Partial<EntryTextNode> = {}): EntryTextNode => ({type: "canonValue", path, entry: null, label: path.split(".")[1], raw: display, display, ...extra} as EntryTextNode);

const blocks: EntryTextBlock[] = [
    {id: "b1", tree: root({type: "heading", depth: 2, children: [t("近况")]}, p(t("她有 "), value("panel.存款", "900"), t(" 元，"), value("panel.魔力", "未知", {unknown: true}), t("。")))},
    {id: "b2", tree: root(p(t("哥哥是 "), {type: "canonRef", id: "e2", name: "星瑾", deleted: false}, t("，"), {type: "canonRef", id: "e3", name: "旧人", deleted: true}, t("。")))},
    {id: "b3", tree: root(p(t("他的存款是 "), value("panel.存款", "50", {entry: "e2"})))},
    {id: "b4", error: {message: "不认识的标签 <Foo>"}, text: "<Foo />"},
];

function text(props: Record<string, unknown> = {}) {
    const wrapper = mount(EntryText, {
        props: {blocks, self: "e1", marks: {"panel.存款": "第 2 章改过"}, ...props},
        slots: {origin: ({address}: {address: {entry: string; path: string}}) => h("p", {"data-slot": ""}, `来历 ${address.entry} ${address.path}`)},
        global: {provide: provideText(port)},
    });
    mounted.push(wrapper);
    return wrapper;
}

describe("EntryText", () => {
    it("排版与值：标题、段落；值是按钮，未知写“未知”用警告色，本条目改过的值后面有标记，别的条目的值没有", () => {
        const wrapper = text();
        // 页面的 h1 是条目名，文字里的标题降一级：`##` 画成 h3。
        expect(wrapper.get("h3").text()).toBe("近况");
        const values = wrapper.findAll("[data-value]");
        expect(values.map((item) => item.text())).toEqual(["900", "未知", "50"]);
        expect(values[0]!.attributes("aria-label")).toBe("存款：900");
        expect(values[1]!.classes()).toContain("text-[var(--status-warning)]");
        expect(wrapper.get("[data-block='b1']").text()).toContain("900第 2 章改过");
        expect(wrapper.get("[data-block='b3']").text()).not.toContain("改过");
    });

    it("点值发 value，不写条目的指本条目；展开着的值所在的块后面是来历插槽", async () => {
        const wrapper = text({open: "e2|panel.存款"});
        expect(wrapper.findAll("[data-slot]").map((item) => item.text())).toEqual(["来历 e2 panel.存款"]);
        expect(wrapper.findAll("[data-value]")[2]!.attributes("aria-expanded")).toBe("true");
        await wrapper.findAll("[data-value]")[0]!.trigger("click");
        expect(wrapper.emitted("value")).toEqual([[{entry: "e1", path: "panel.存款"}]]);
    });

    it("条目引用是链接，已删除的不可点；出错的块写纯文本与原因", async () => {
        const wrapper = text();
        const refs = wrapper.get("[data-block='b2']").findAll("button");
        expect(refs.map((item) => item.text())).toEqual(["星瑾"]);
        await refs[0]!.trigger("click");
        expect(wrapper.emitted("entry")).toEqual([["e2"]]);
        expect(wrapper.get("[data-block='b2']").text()).toContain("旧人");
        expect(wrapper.get("[data-block-error]").text()).toBe("<Foo />这一块没有渲染出来：不认识的标签 <Foo>");
    });

    it("输出 48，不能点的画法（编辑时的预览）：值与引用是文字不是按钮，点了不发事件；根上的标记与阅读视图不同", async () => {
        const wrapper = text({interactive: false});
        expect([wrapper.findAll("button").length, wrapper.findAll("[data-value]").map((item) => [item.element.tagName, item.text()])]).toEqual([0, [["SPAN", "900"], ["SPAN", "未知"], ["SPAN", "50"]]]);
        expect(wrapper.get("[data-ref='e2']").text()).toBe("星瑾");
        await wrapper.findAll("[data-value]")[0]!.trigger("click");
        await wrapper.get("[data-ref='e2']").trigger("click");
        expect([wrapper.emitted("value"), wrapper.emitted("entry")]).toEqual([undefined, undefined]);
        expect([wrapper.find("[data-entry-text]").exists(), wrapper.find("[data-entry-preview]").exists(), text().find("[data-entry-text]").exists()]).toEqual([false, true, true]);
    });

    it("输出 48：块一级的元素带着它在源文字里的行号", () => {
        const at = (line: number) => ({position: {start: {line}}});
        const lined: EntryTextBlock[] = [{id: "source", tree: root(
            {type: "heading", depth: 1, ...at(1), children: [t("标题")]},
            {...p(t("一段")), ...at(3)},
            {type: "list", ordered: false, ...at(5), children: [{type: "listItem", ...at(5), children: [{...p(t("甲")), ...at(5)}]}, {type: "listItem", ...at(6), children: [{...p(t("乙")), ...at(6)}]}]},
        )}];
        const wrapper = text({blocks: lined});
        expect(wrapper.findAll("[data-source-line]").map((item) => [item.element.tagName, item.attributes("data-source-line")])).toEqual([["H2", "1"], ["P", "3"], ["LI", "5"], ["P", "5"], ["LI", "6"], ["P", "6"]]);
    });
});
