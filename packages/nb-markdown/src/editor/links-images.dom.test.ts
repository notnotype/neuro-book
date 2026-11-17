/**
 * 链接与图片的编辑动作（docs/specs/workbench/markdown-editing.md 输出 52、54、55）：真实的语言、真实的 Tiptap，判据是写回的
 * Markdown。链接按“碰到的整条链接”改与去掉（Tiptap 自带的 `setLink`、`unsetLink` 会把链接切碎）；图片是行内节点，几张图的落点
 * 按光标所在的块定（表格单元格只能有一段）。
 */

import {Editor} from "@tiptap/core";
import {TextSelection} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import {markdownEditingActions} from "./editing-actions";
import {insertImages} from "./images";
import {linksTouching, sharedHref} from "./links";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();

function open(markdown: string): {editor: Editor; write: () => string; select: (from: number, to?: number) => void; at: (text: string, offset?: number) => number} {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions]});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    editor.commands.setContent(read.doc.toJSON());
    return {
        editor,
        write: () => {
            const written = codec.write(editor.state.doc, read.map);
            if (!written.ok) throw new Error(`写不出：${written.reason}`);
            return written.text;
        },
        select: (from, to = from) => editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to))),
        // 文档里 `text` 第一次出现的位置（加偏移）；文本块里的字从位置 1 起。
        at: (text, offset = 0) => {
            let found = -1;
            editor.state.doc.descendants((node, pos) => {
                if (found >= 0 || !node.isText) return true;
                const index = (node.text ?? "").indexOf(text);
                if (index >= 0) found = pos + index;
                return found < 0;
            });
            if (found < 0) throw new Error(`文档里没有 ${text}`);
            return found + offset;
        },
    };
}

const act = (editor: Editor, id: string, args: Record<string, unknown> = {}): boolean => {
    const action = markdownEditingActions[id];
    if (action === undefined) throw new Error(`没有动作 ${id}`);
    return action.run(editor, args);
};

describe("链接：改地址按整条链接（输出 52）", () => {
    const SOURCE = "见[林雪的设定](a.md)吧\n";

    it("选区只盖住链接的一部分（在链接内部、跨出链接的边）：整条链接换成新地址，不被切成几段", () => {
        const inside = open(SOURCE);
        inside.select(inside.at("雪的"), inside.at("雪的") + 2);
        expect(act(inside.editor, "link", {href: "b.md"})).toBe(true);
        expect(inside.write()).toBe("见[林雪的设定](b.md)吧\n");
        const across = open(SOURCE);
        across.select(across.at("设定"), across.at("吧") + 1);
        expect(act(across.editor, "link", {href: "b.md"})).toBe(true);
        // 选区碰到了链接：只改这条链接，选区里的普通文字“吧”不变成链接。
        expect(across.write()).toBe("见[林雪的设定](b.md)吧\n");
    });

    it("光标在链接里（折叠的选区）：同样改整条；光标在链接末尾（链接不包含末尾）不算在里面", () => {
        const cursor = open(SOURCE);
        cursor.select(cursor.at("设"));
        expect(linksTouching(cursor.editor).map((range) => range.href)).toEqual(["a.md"]);
        expect(act(cursor.editor, "link", {href: "b.md"})).toBe(true);
        expect(cursor.write()).toBe("见[林雪的设定](b.md)吧\n");
        const edge = open(SOURCE);
        edge.select(edge.at("吧"));
        expect(linksTouching(edge.editor)).toEqual([]);
        expect(markdownEditingActions.link?.active?.(edge.editor)).toBe(false);
    });

    it("去掉链接：选区在内部、跨出边、光标在里面，都去掉整条、文字留着，不留残链", () => {
        for (const pick of [(h: ReturnType<typeof open>) => h.select(h.at("雪的"), h.at("雪的") + 2), (h: ReturnType<typeof open>) => h.select(h.at("设定"), h.at("吧") + 1), (h: ReturnType<typeof open>) => h.select(h.at("设"))]) {
            const harness = open(SOURCE);
            pick(harness);
            expect(act(harness.editor, "link-remove")).toBe(true);
            expect(harness.write()).toBe("见林雪的设定吧\n");
        }
        const none = open("没有链接\n");
        none.select(none.at("有"));
        expect(act(none.editor, "link-remove")).toBe(false);
        expect(markdownEditingActions["link-remove"]?.enabled(none.editor, {})).toBe(false);
    });

    it("碰到的几条链接地址不同：共同地址为空（卡片不预填）；一起改成同一个地址", () => {
        const harness = open("[甲](a.md)[乙](b.md)\n");
        harness.select(harness.at("甲"), harness.at("乙") + 1);
        const touched = linksTouching(harness.editor);
        expect(touched.map((range) => range.href)).toEqual(["a.md", "b.md"]);
        expect(sharedHref(touched)).toBeNull();
        expect(act(harness.editor, "link", {href: "c.md"})).toBe(true);
        expect(harness.write()).toBe("[甲乙](c.md)\n");
        expect(sharedHref(linksTouching(harness.editor))).toBe("c.md");
    });

    it("链接标记上的别的属性（标题）在改地址时保留", () => {
        const harness = open('[甲乙](a.md "说明")\n');
        harness.select(harness.at("乙"));
        expect(act(harness.editor, "link", {href: "b.md"})).toBe(true);
        expect(harness.write()).toBe('[甲乙](b.md "说明")\n');
    });
});

describe("链接：加链接（输出 52）", () => {
    it("选着字：选中的字成为链接文字", () => {
        const harness = open("见林雪吧\n");
        harness.select(harness.at("林雪"), harness.at("林雪") + 2);
        expect(act(harness.editor, "link", {href: "设定/林雪.md"})).toBe(true);
        expect(harness.write()).toBe("见[林雪](设定/林雪.md)吧\n");
    });

    it("光标处：插入一段链接（文字是 label，没有就是地址本身），光标在它后面，接着打的字在链接外", () => {
        const harness = open("见吧\n");
        harness.select(harness.at("吧"));
        expect(act(harness.editor, "link", {href: "设定/林雪.md", label: "林雪"})).toBe(true);
        expect(harness.write()).toBe("见[林雪](设定/林雪.md)吧\n");
        harness.editor.commands.insertContent("打");
        expect(harness.write()).toBe("见[林雪](设定/林雪.md)打吧\n");
        const bare = open("\n");
        bare.select(1);
        expect(act(bare.editor, "link", {href: "https://example.com"})).toBe(true);
        // 文字就是网址：写回时转义冒号，免得被读成自动链接（方言输出 3）。
        expect(bare.write()).toBe("[https\\://example.com](https://example.com)\n");
    });

    it("不安全的地址（javascript:、data:、空）不写，文档不变；代码块里不能加链接", () => {
        const harness = open("见吧\n");
        harness.select(harness.at("吧"));
        for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "", "   "]) expect(act(harness.editor, "link", {href})).toBe(false);
        expect(harness.write()).toBe("见吧\n");
        const code = open("```js\nlet a\n```\n");
        code.select(code.at("let"));
        expect(markdownEditingActions.link?.enabled(code.editor, {})).toBe(false);
        expect(act(code.editor, "link", {href: "a.md", label: "x"})).toBe(false);
        harness.editor.setEditable(false);
        expect(markdownEditingActions.link?.enabled(harness.editor, {})).toBe(false);
    });
});

describe("图片的落点（输出 55）", () => {
    it("单张插在光标处；有选中的字时替换选中的字；说明按给的", () => {
        const harness = open("前半后半\n");
        harness.select(harness.at("后半"));
        expect(insertImages(harness.editor, [{src: "插图/a.png", alt: "甲"}])).toBe(true);
        expect(harness.write()).toBe("前半![甲](插图/a.png)后半\n");
        const replaced = open("前半后半\n");
        replaced.select(replaced.at("后半"), replaced.at("后半") + 2);
        expect(insertImages(replaced.editor, [{src: "a.png"}])).toBe(true);
        expect(replaced.write()).toBe("前半![](a.png)\n");
    });

    it("几张图：有字的段落、标题、列表项里依次行内插入，不劈开块", () => {
        for (const [source, mark, expected] of [
            ["前半后半\n", "后半", "前半![](a.png)![](b.png)后半\n"],
            ["# 标题\n", "题", "# 标![](a.png)![](b.png)题\n"],
            ["- 项目\n", "目", "- 项![](a.png)![](b.png)目\n"],
        ] as const) {
            const harness = open(source);
            harness.select(harness.at(mark));
            expect(insertImages(harness.editor, [{src: "a.png"}, {src: "b.png"}])).toBe(true);
            expect(harness.write()).toBe(expected);
        }
    });

    it("几张图、光标在不在表格里的空段落：各占一段，第一张用这个空段落；只有一张时仍是行内", () => {
        const harness = open("甲\n\n\n\n乙\n");
        // 第二个顶层块是空段落（连续的空段落）。
        let empty = -1;
        harness.editor.state.doc.forEach((node, offset, index) => {
            if (empty < 0 && index > 0 && node.type.name === "paragraph" && node.content.size === 0) empty = offset;
        });
        expect(empty).toBeGreaterThan(0);
        harness.select(empty + 1);
        expect(insertImages(harness.editor, [{src: "a.png"}, {src: "b.png"}])).toBe(true);
        const kinds: string[] = [];
        harness.editor.state.doc.forEach((node) => kinds.push(node.textContent === "" && node.firstChild?.type.name === "image" ? "图段" : node.textContent));
        expect(kinds.filter((kind) => kind === "图段")).toHaveLength(2);
        expect(harness.write()).toContain("![](a.png)\n\n![](b.png)");
        const single = open("\n");
        single.select(1);
        expect(insertImages(single.editor, [{src: "a.png"}])).toBe(true);
        expect(single.write()).toBe("![](a.png)\n");
    });

    it("表格单元格：几张图依次放在这个单元格的这一段里，写得出来（不劈开成两段）", () => {
        const harness = open("| 甲 | 乙 |\n| --- | --- |\n| 丙 | 丁 |\n");
        harness.select(harness.at("丙"));
        expect(insertImages(harness.editor, [{src: "a.png"}, {src: "b.png"}])).toBe(true);
        expect(harness.write()).toContain("| ![](a.png)![](b.png)丙 | 丁 |");
        // 空单元格同样：不当成“空段落各占一段”。
        const blank = open("| 甲 | 乙 |\n| --- | --- |\n|  | 丁 |\n");
        let cell = -1;
        blank.editor.state.doc.descendants((node, pos) => {
            if (cell < 0 && node.type.spec.tableRole === "cell" && node.textContent === "") cell = pos;
            return cell < 0;
        });
        blank.select(cell + 2);
        expect(insertImages(blank.editor, [{src: "a.png"}, {src: "b.png"}])).toBe(true);
        expect(blank.write()).toContain("| ![](a.png)![](b.png) | 丁 |");
    });

    it("代码块与不能放图片的位置：不接手，文档不变；没有图、不可写同样返回 false", () => {
        const code = open("```js\nlet a\n```\n");
        code.select(code.at("let"));
        expect(insertImages(code.editor, [{src: "a.png"}])).toBe(false);
        expect(code.write()).toBe("```js\nlet a\n```\n");
        const plain = open("甲\n");
        plain.select(1);
        expect(insertImages(plain.editor, [])).toBe(false);
        plain.editor.setEditable(false);
        expect(insertImages(plain.editor, [{src: "a.png"}])).toBe(false);
        expect(markdownEditingActions.image?.enabled(plain.editor, {})).toBe(false);
    });

    it("动作 image：带 src 与 alt 执行；没有 src 不做", () => {
        const harness = open("甲\n");
        harness.select(harness.at("甲") + 1);
        expect(act(harness.editor, "image", {})).toBe(false);
        expect(act(harness.editor, "image", {src: "插图/a b.png", alt: "说明"})).toBe(true);
        expect(harness.write()).toBe("甲![说明](<插图/a b.png>)\n");
    });
});
