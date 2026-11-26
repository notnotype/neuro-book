/**
 * EntryText（同名 .md，docs/specs/canon/author-ui.md 输出 10；canon.rendering 输出 7）：源文按条目文法排版，活的标签换成值表里对应的项；
 * 值是按钮，未知、不完整与“改过”标记；点值发 value（不写条目的值指本条目），展开着的值所在的块后面是来历插槽；条目引用发 entry；
 * 条件只画生效的那一支；出错的块、值表对不上的块写纯文本与原因。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {h} from "vue";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import type {EntryTextBlock, EntryTextValue} from "./entry-text";
import EntryText from "./EntryText.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** 一块：源文与值表；值表每项的起点按它对应的标签在源文里第几次出现算。 */
function block(id: string, source: string, items: ReadonlyArray<readonly [string, Record<string, unknown>]>): EntryTextBlock {
    let cursor = 0;
    const values = items.map(([tag, item]) => {
        const start = source.indexOf(tag, cursor);
        if (start < 0) throw new Error(`no ${tag}`);
        cursor = start + 1;
        return {tag: /^<(\w+)/u.exec(tag)![1], start, ...item} as unknown as EntryTextValue;
    });
    return {id, source, values};
}
const value = (path: string, display: string, extra: Record<string, unknown> = {}) => ({path, entry: null, label: path.split(".")[1], raw: display, display, ...extra});

const blocks: EntryTextBlock[] = [
    block("b1", '## 近况\n\n她有 <V of="panel.存款" /> 元，<V of="panel.魔力" />。', [['<V of="panel.存款"', value("panel.存款", "900")], ['<V of="panel.魔力"', value("panel.魔力", "未知", {raw: null, unknown: true})]]),
    block("b2", '哥哥是 <Ref id="e2" />，<Ref id="e3" />。', [['<Ref id="e2"', {id: "e2", name: "星瑾", deleted: false}], ['<Ref id="e3"', {id: "e3", name: "旧人", deleted: true}]]),
    block("b3", '他的存款是 <V entry="e2" of="panel.存款" />', [["<V entry", value("panel.存款", "50", {entry: "e2"})]]),
    {id: "b4", error: {message: "不认识的写法"}, text: "<div>旧</div>"},
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
        expect(wrapper.get("[data-block-error]").text()).toBe("<div>旧</div>这一块没有渲染出来：不认识的写法");
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
        const wrapper = text({blocks: [block("source", "# 标题\n\n一段\n\n- 甲\n- 乙\n\n> 引用", [])]});
        expect(wrapper.findAll("[data-source-line]").map((item) => [item.element.tagName, item.attributes("data-source-line")])).toEqual([["H2", "1"], ["P", "3"], ["LI", "5"], ["LI", "6"], ["BLOCKQUOTE", "8"], ["P", "8"]]);
    });

    it("条件只画生效的那一支；判断未知时写“未知”；都不成立又没有 Else 时什么都不画", () => {
        const source = '<If test="panel.存款 > 100">有钱<ElseIf test="panel.魔力 > 0" />有魔力<Else />都没有</If>';
        const at = (taken: number | null, results: readonly [boolean | null, boolean | null]) => block("c", source, [["<If", {result: results[0], taken}], ["<ElseIf", {result: results[1]}]]);
        expect(text({blocks: [at(0, [true, null])]}).get("[data-block='c']").text()).toBe("有钱");
        expect(text({blocks: [at(2, [false, false])]}).get("[data-block='c']").text()).toBe("都没有");
        expect(text({blocks: [at(null, [false, null])]}).get("[data-block='c']").text()).toBe("未知");
        const none = block("d", '前<If test="panel.存款 > 100">有钱</If>后', [["<If", {result: false, taken: null}]]);
        expect(text({blocks: [none]}).get("[data-block='d']").text()).toBe("前后");
    });

    it("字面的标签照原文；正文里的实体画成它表示的字；读不到的值写原因；没登记的标签写“需要插件”", () => {
        const source = '写法是 `<V of="panel.存款" />`，\\<Ref id="e2" />，a &lt; b，<V of="panel.不在" />，<Plot id="x" />';
        const wrapper = text({blocks: [block("e", source, [['<V of="panel.不在"', value("panel.不在", "未知", {raw: null, unknown: true, unavailable: "没有这个字段"})], ["<Plot", {needsPlugin: true}]])]});
        expect(wrapper.get("[data-block='e']").text()).toBe('写法是 <V of="panel.存款" />，<Ref id="e2" />，a < b，没有这个字段，需要插件');
        expect(wrapper.get("[data-block='e']").find("code").exists()).toBe(true);
    });

    it("值表与源文对不上（起点不同、多出一项）：整块按出错显示，不按位置猜", () => {
        const item = {tag: "V", start: 0, ...value("panel.存款", "900")} as unknown as EntryTextValue;
        const wrapper = text({blocks: [{id: "f", source: '她有 <V of="panel.存款" />', values: [item]}, {id: "g", source: "没有标签", values: [item]}]});
        expect(wrapper.findAll("[data-block-error]").map((found) => found.text().split("这一块")[0])).toEqual(['她有 <V of="panel.存款" />', "没有标签"]);
        expect(wrapper.findAll("[data-value]")).toHaveLength(0);
    });
});
