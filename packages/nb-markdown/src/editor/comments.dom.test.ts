/**
 * 批注的数据操作（docs/specs/workbench/markdown-editing.md 输出 28–35）：真实语言、真实 Tiptap 与真实编解码器，判据是列出的先后、
 * 文档里剩下的批注，以及写回的文件。
 */
import {Editor} from "@tiptap/core";
import {undoDepth} from "@tiptap/pm/history";
import {Fragment, Slice} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {EditorState, TextSelection} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {codecFor, defaultMarkdownLanguage} from "../language";
import type {SourceMap} from "../language";
import {commentsAt, commentsAtPos, findComment, gotoComment, listComments, markShownComment, MarkdownShownComment, refOf, removeComment, SHOWN_COMMENT_CLASS, setCommentBody} from "./comments";

const language = defaultMarkdownLanguage();
const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

/** 读入原文建一个编辑器；`save` 写回并接受（之后以这次为原文）。 */
function open(source: string) {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...language.extensions, MarkdownShownComment]});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(source);
    let map: SourceMap = read.map;
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    return {
        editor,
        save(): string {
            const result = codec.write(editor.state.doc, map);
            if (!result.ok) throw new Error(`写不出：${result.reason}`);
            result.record();
            return result.text;
        },
    };
}

/** 文档里这段文字的起止位置。 */
function find(doc: PMNode, text: string): {from: number; to: number} {
    let found: {from: number; to: number} | null = null;
    doc.descendants((node, pos) => {
        const at = node.isText ? (node.text as string).indexOf(text) : -1;
        if (found === null && at >= 0) found = {from: pos + at, to: pos + at + text.length};
    });
    if (found === null) throw new Error(`找不到 ${text}`);
    return found;
}

const bodies = (editor: Editor): string[] => listComments(editor.state.doc).map((info) => info.body);
const ref = (editor: Editor, index: number) => refOf(listComments(editor.state.doc)[index] as ReturnType<typeof listComments>[number]);
/** 按意见找：同一段上重叠的批注读入时的先后不由写法的内外决定，用例按意见找，不按序号。 */
const named = (editor: Editor, body: string) => refOf(listComments(editor.state.doc).find((info) => info.body === body) as ReturnType<typeof listComments>[number]);
/** 文本节点上批注标记的先后（意见）。 */
const markOrder = (editor: Editor, text: string): string[] => {
    const {from} = find(editor.state.doc, text);
    return editor.state.doc.nodeAt(from)?.marks.filter((mark) => mark.type.name === "comment").map((mark) => String(mark.attrs.body)) ?? [];
};

describe("批注的先后与序号（输出 31）", () => {
    it("行内、块、分截一条算一条，按起点先后排，序号从 0 起连续", () => {
        const {editor} = open([
            "甲<comment body=\"一\">乙</comment>丙",
            "<comment body=\"块\">\n丁戊\n</comment>",
            "123<comment id=\"c1\" body=\"分截\">one</comment>\n\n<comment id=\"c1\">two</comment>",
            "己<comment body=\"末\">庚</comment>",
        ].join("\n\n") + "\n");
        const list = listComments(editor.state.doc);
        expect(list.map((info) => [info.index, info.body, info.block])).toEqual([[0, "一", false], [1, "块", true], [2, "分截", false], [3, "末", false]]);
        expect(list[2]?.segments).toHaveLength(2);
    });

    it("块批注的起点是块里第一个文字处；与行内批注起点终点都相同时外层的块在前，终点靠后的块在后", () => {
        const {editor} = open([
            "<comment body=\"块\">\n<comment body=\"首字\">丁</comment>戊\n</comment>",
            "<comment body=\"整块\">\n<comment body=\"整句\">己庚</comment>\n</comment>",
        ].join("\n\n") + "\n");
        // 第一块：块的终点（戊之后）比“首字”靠后，“首字”在前；第二块：起点终点都相同，块在前。
        expect(bodies(editor)).toEqual(["首字", "块", "整块", "整句"]);
    });

    it("起点相同的两条，终点靠前的在前", () => {
        const {editor} = open("<comment body=\"长\"><comment body=\"短\">甲乙</comment>丙</comment>\n");
        expect(bodies(editor)).toEqual(["短", "长"]);
    });

    it("同一段上的重叠批注按编号排，编号按数比（k10 在 k2 之后）", () => {
        const {editor} = open("甲\n");
        const mark = (key: string, body: string) => ({type: "comment", attrs: {id: null, body, key}});
        editor.commands.setContent({type: "doc", content: [{type: "paragraph", content: [{type: "text", text: "甲", marks: [mark("k10", "后"), mark("k2", "前")]}]}]});
        expect(bodies(editor)).toEqual(["前", "后"]);
    });
});

describe("光标处的批注（输出 30）", () => {
    it("在文字上与紧挨两端都算，一个字的批注也有光标位置，离开一格就不算", () => {
        const {editor} = open("甲乙<comment body=\"一\">丙丁</comment>戊戊<comment body=\"二\">己</comment>\n");
        const at = (pos: number): string[] => {
            editor.commands.setTextSelection(pos);
            return commentsAt(editor.state).map((info) => info.body);
        };
        const ding = find(editor.state.doc, "丙丁");
        expect(at(ding.from - 1)).toEqual([]);
        expect(at(ding.from)).toEqual(["一"]);
        expect(at(ding.from + 1)).toEqual(["一"]);
        expect(at(ding.to)).toEqual(["一"]);
        expect(at(ding.to + 1)).toEqual([]);
        const ji = find(editor.state.doc, "己");
        expect(at(ji.from)).toEqual(["二"]);
        expect(at(ji.to)).toEqual(["二"]);
    });

    it("紧挨的两条在交界处一起返回；块批注按光标在块里任何一处算；选区不空时没有", () => {
        const {editor} = open("<comment body=\"前\">甲乙</comment><comment body=\"后\">丙丁</comment>\n\n<comment body=\"块\">\n戊\n\n己\n</comment>\n");
        editor.commands.setTextSelection(find(editor.state.doc, "丙丁").from);
        expect(commentsAt(editor.state).map((info) => info.body)).toEqual(["前", "后"]);
        editor.commands.setTextSelection(find(editor.state.doc, "己").from + 1);
        expect(commentsAt(editor.state).map((info) => info.body)).toEqual(["块"]);
        editor.commands.setTextSelection(find(editor.state.doc, "甲乙"));
        expect(commentsAt(editor.state)).toEqual([]);
    });
});

describe("某个位置上的批注（输出 30 的悬停）", () => {
    it("行内批注：文字上与紧挨两端都算，不看选区；离开一格就不算", () => {
        const {editor} = open("甲<comment body=\"一\">乙丙</comment>丁\n");
        const {from, to} = find(editor.state.doc, "乙丙");
        expect(commentsAtPos(editor.state.doc, from).map((info) => info.body)).toEqual(["一"]);
        expect(commentsAtPos(editor.state.doc, from + 1).map((info) => info.body)).toEqual(["一"]);
        expect(commentsAtPos(editor.state.doc, to).map((info) => info.body)).toEqual(["一"]);
        expect(commentsAtPos(editor.state.doc, from - 1)).toEqual([]);
        expect(commentsAtPos(editor.state.doc, to + 1)).toEqual([]);
    });

    it("块批注：块里任何一处；重叠的几条一起返回，先后同 listComments", () => {
        const {editor} = open("<comment body=\"块\">\n戊己\n</comment>\n\n甲<comment body=\"外\">乙<comment body=\"内\">丙</comment></comment>\n");
        const block = find(editor.state.doc, "戊己");
        expect(commentsAtPos(editor.state.doc, block.from + 1).map((info) => info.body)).toEqual(["块"]);
        const inner = find(editor.state.doc, "丙");
        expect(commentsAtPos(editor.state.doc, inner.from + 1).map((info) => info.body)).toEqual(["外", "内"]);
    });
});

describe("按指纹找（输出 29 的失败行为）", () => {
    it("前面多出一条批注、序号变了，指纹唯一就还是它；意见变了或几条指纹相同就找不到", () => {
        const {editor} = open("甲<comment body=\"一\">乙</comment>丙\n\n丁<comment body=\"二\">戊</comment>\n");
        const second = ref(editor, 1);
        // 在最前面插入一条新批注：“二”从第 1 条变成第 2 条。
        editor.commands.setTextSelection({from: 1, to: 2});
        editor.commands.addComment("新");
        expect(findComment(editor.state.doc, second)?.body).toBe("二");
        expect(findComment(editor.state.doc, {...second, body: "别的"})).toBeNull();
        expect(findComment(editor.state.doc, {...second, index: 0})?.body).toBe("二");

        const {editor: twin} = open("甲<comment body=\"同\">乙</comment>\n\n甲<comment body=\"同\">乙</comment>\n");
        const first = ref(twin, 0);
        expect(findComment(twin.state.doc, first)?.index).toBe(0);
        // 序号 5 处没有批注，指纹又有两条相同：不知道是哪条。
        expect(findComment(twin.state.doc, {...first, index: 5})).toBeNull();
    });
});

describe("改意见（输出 35）", () => {
    it("行内批注：写回的文件里意见变了，换行写成 &#10;，别处不变，一个撤销步", () => {
        const {editor, save} = open("甲<comment body=\"一\">乙</comment>丙\n\n丁\n");
        const depth = undoDepth(editor.state);
        expect(setCommentBody(editor, ref(editor, 0), "第一行\n第二行")).toBe(true);
        expect(undoDepth(editor.state)).toBe(depth + 1);
        expect(save()).toBe("甲<comment body=\"第一行&#10;第二行\">乙</comment>丙\n\n丁\n");
        editor.commands.undo();
        expect(bodies(editor)).toEqual(["一"]);
    });

    it("意见没变不动文档；指纹对不上返回 false", () => {
        const {editor} = open("甲<comment body=\"一\">乙</comment>\n");
        const depth = undoDepth(editor.state);
        expect(setCommentBody(editor, ref(editor, 0), "一")).toBe(true);
        expect(undoDepth(editor.state)).toBe(depth);
        expect(setCommentBody(editor, {...ref(editor, 0), body: "旧"}, "新")).toBe(false);
        expect(bodies(editor)).toEqual(["一"]);
    });

    it("分截的批注：各截同一步变，意见写在第一截，id 保留，读回仍是一条", () => {
        const {editor, save} = open("123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>\n");
        expect(setCommentBody(editor, ref(editor, 0), "新意见")).toBe(true);
        const text = save();
        expect(text).toBe("123<comment id=\"c1\" body=\"新意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>\n");
        const {editor: again} = open(text);
        expect(bodies(again)).toEqual(["新意见"]);
        expect(listComments(again.state.doc)[0]?.segments).toHaveLength(3);
    });

    it("盖住同一段的两条：改其中一条，另一条还在，先后与标记的嵌套顺序不变", () => {
        const {editor, save} = open("<comment body=\"B\"><comment body=\"A\">甲乙丙</comment></comment>\n");
        const order = bodies(editor);
        const marks = markOrder(editor, "甲乙丙");
        expect(setCommentBody(editor, named(editor, "A"), "A2")).toBe(true);
        expect(bodies(editor)).toEqual(order.map((body) => (body === "A" ? "A2" : body)));
        expect(markOrder(editor, "甲乙丙")).toEqual(marks.map((body) => (body === "A" ? "A2" : body)));
        expect(setCommentBody(editor, named(editor, "B"), "B2")).toBe(true);
        expect(bodies(editor)).toEqual(order.map((body) => (body === "A" ? "A2" : "B2")));
        expect(save()).toMatch(/^<comment body="B2"><comment body="A2">甲乙丙<\/comment><\/comment>\n$|^<comment body="A2"><comment body="B2">甲乙丙<\/comment><\/comment>\n$/u);
    });

    it("块批注：改意见；列表项里、引用里的块批注也行，所在的列表整块重写", () => {
        const {editor, save} = open("<comment body=\"块\">\n甲\n</comment>\n");
        expect(setCommentBody(editor, ref(editor, 0), "新块")).toBe(true);
        expect(save()).toBe("<comment body=\"新块\">\n甲\n</comment>\n");

        const inList = open("- 乙\n\n  <comment body=\"项\">\n  丙\n  </comment>\n\n- 丁\n");
        expect(setCommentBody(inList.editor, ref(inList.editor, 0), "新项")).toBe(true);
        expect(inList.save()).toBe("- 乙\n\n  <comment body=\"新项\">\n  丙\n  </comment>\n\n- 丁\n");

        const inQuote = open("> <comment body=\"引\">\n> 丙\n> </comment>\n");
        expect(setCommentBody(inQuote.editor, ref(inQuote.editor, 0), "新引")).toBe(true);
        expect(inQuote.save()).toBe("> <comment body=\"新引\">\n> 丙\n> </comment>\n");
    });

    it("保存之后紧接着在块批注里打的字不并进这个撤销步", () => {
        const {editor} = open("<comment body=\"块\">\n甲\n</comment>\n");
        setCommentBody(editor, ref(editor, 0), "新");
        editor.commands.insertContentAt(find(editor.state.doc, "甲").to, "乙");
        editor.commands.undo();
        expect(editor.state.doc.textContent).toBe("甲");
        expect(bodies(editor)).toEqual(["新"]);
    });
});

describe("去掉批注（输出 34）", () => {
    it("只去这一条：盖住同一段的另一条留着，文字留着，Ctrl+Z 回来", () => {
        const {editor, save} = open("<comment body=\"B\"><comment body=\"A\">甲乙丙</comment></comment>\n");
        const order = bodies(editor);
        expect(removeComment(editor, named(editor, "A"))).toBe(true);
        expect(bodies(editor)).toEqual(["B"]);
        expect(save()).toBe("<comment body=\"B\">甲乙丙</comment>\n");
        editor.commands.undo();
        expect(bodies(editor)).toEqual(order);
    });

    it("分截的批注：各截一起去掉，文件里没有残留的 id", () => {
        const {editor, save} = open("123<comment id=\"c1\" body=\"意见\">one</comment>\n\n<comment id=\"c1\">two</comment>\n\n<comment id=\"c1\">three</comment>\n");
        expect(removeComment(editor, ref(editor, 0))).toBe(true);
        expect(listComments(editor.state.doc)).toEqual([]);
        expect(save()).toBe("123one\n\ntwo\n\nthree\n");
    });

    it("块批注：解开容器、内容留着，列表项里、引用里的也一样", () => {
        const {editor, save} = open("<comment body=\"块\">\n甲\n\n乙\n</comment>\n\n丙\n");
        expect(removeComment(editor, ref(editor, 0))).toBe(true);
        expect(save()).toBe("甲\n\n乙\n\n丙\n");

        const inList = open("- 乙\n\n  <comment body=\"项\">\n  丙\n  </comment>\n\n- 丁\n");
        expect(removeComment(inList.editor, ref(inList.editor, 0))).toBe(true);
        expect(inList.save()).toBe("- 乙\n\n  丙\n\n- 丁\n");

        const inQuote = open("> <comment body=\"引\">\n> 丙\n> </comment>\n");
        expect(removeComment(inQuote.editor, ref(inQuote.editor, 0))).toBe(true);
        expect(inQuote.save()).toBe("> 丙\n");
    });

    it("删块批注后光标留在原处（字没变，位置随开闭标记平移）；光标在块外时不动", () => {
        const {editor} = open("前\n\n<comment body=\"块\">\n甲甲甲\n\n乙乙乙\n\n丙丙丙\n</comment>\n\n后\n");
        const at = find(editor.state.doc, "乙乙乙").from + 1;
        editor.commands.setTextSelection(at);
        expect(removeComment(editor, ref(editor, 0))).toBe(true);
        // 光标原来在“乙乙乙”的第二个字前：解开之后还在那里。
        expect(editor.state.selection.from).toBe(find(editor.state.doc, "乙乙乙").from + 1);
        const {editor: outside} = open("前\n\n<comment body=\"块\">\n甲\n</comment>\n\n后\n");
        outside.commands.setTextSelection(find(outside.state.doc, "后").from + 1);
        expect(removeComment(outside, ref(outside, 0))).toBe(true);
        expect(outside.state.selection.from).toBe(find(outside.state.doc, "后").from + 1);
    });

    it("指纹对不上不动文档", () => {
        const {editor} = open("甲<comment body=\"一\">乙</comment>\n");
        expect(removeComment(editor, {...ref(editor, 0), body: "旧"})).toBe(false);
        expect(bodies(editor)).toEqual(["一"]);
    });
});

describe("跳到这一条（输出 31）", () => {
    it("光标放到开头：行内是第一截起点，块批注是块里第一个文字处；紧挨的批注光标不动也成功", () => {
        const {editor} = open("甲<comment body=\"一\">乙丙</comment><comment body=\"二\">丁</comment>\n\n<comment body=\"块\">\n戊己\n</comment>\n");
        expect(gotoComment(editor, ref(editor, 0))).toBe(true);
        expect(editor.state.selection.from).toBe(find(editor.state.doc, "乙丙").from);
        expect(gotoComment(editor, ref(editor, 2))).toBe(true);
        expect(editor.state.selection.from).toBe(find(editor.state.doc, "戊己").from);
        expect(gotoComment(editor, {...ref(editor, 0), body: "旧"})).toBe(false);
    });
});

describe("当前批注的标出（输出 32）", () => {
    const shown = (editor: Editor): string[] => [...editor.view.dom.querySelectorAll(`.${SHOWN_COMMENT_CLASS}`)].map((element) => element.textContent ?? "");

    it("行内批注的各截都标出，前面插入文字后跟着移动，null 撤掉", () => {
        const {editor} = open("甲<comment id=\"c1\" body=\"意见\">乙</comment>\n\n<comment id=\"c1\">丙</comment>\n");
        expect(markShownComment(editor, ref(editor, 0))).toBe(true);
        expect(shown(editor).join("")).toBe("乙丙");
        editor.commands.insertContentAt(1, "前");
        expect(shown(editor).join("")).toBe("乙丙");
        expect(markShownComment(editor, null)).toBe(false);
        expect(shown(editor)).toEqual([]);
    });

    it("块批注标在块上；标出与撤掉不进撤销历史、不改写回的文件", () => {
        const {editor, save} = open("<comment body=\"块\">\n甲\n</comment>\n");
        const before = save();
        const depth = undoDepth(editor.state);
        expect(markShownComment(editor, ref(editor, 0))).toBe(true);
        expect(editor.view.dom.querySelector(`.nb-comment-block.${SHOWN_COMMENT_CLASS}`)).not.toBeNull();
        markShownComment(editor, null);
        expect(undoDepth(editor.state)).toBe(depth);
        expect(save()).toBe(before);
    });
});

describe("替换批注文字时批注不丢（输出 36）", () => {
    const SOURCE = "她抬头<comment body=\"节奏\">看了他一眼</comment>，转身。\n";
    /** 选中 `from`–`to` 再打字：ProseMirror 处理这件事的那一步就是 `tr.insertText(text, from, to)`；真实的按键与输入法在 e2e 里走。 */
    const replace = (editor: Editor, from: number, to: number, text: string): void => {
        editor.view.dispatch(editor.state.tr.insertText(text, from, to));
    };

    it.each([
        ["整句", 0, 5, "换成别的", "换成别的"],
        ["后一半", 2, 5, "看", "看了看"],
        ["前一半", 0, 2, "盯着", "盯着他一眼"],
        ["中间", 1, 4, "X", "看X眼"],
    ])("%s被换掉后新字仍在这条批注里，意见不变", (_name, start, end, text, shown) => {
        const {editor, save} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        replace(editor, range.from + start, range.from + end, text);
        expect(listComments(editor.state.doc).map((info) => [info.body, info.quote])).toEqual([["节奏", shown]]);
        expect(save()).toBe(`她抬头<comment body="节奏">${shown}</comment>，转身。\n`);
    });

    it("盖住了批注以外的字时不继承：选区从批注里一直选到批注后面", () => {
        const {editor, save} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        replace(editor, range.from + 3, range.to + 1, "X");
        expect(save()).toBe("她抬头<comment body=\"节奏\">看了他</comment>X转身。\n");
        const before = open(SOURCE);
        const again = find(before.editor.state.doc, "看了他一眼");
        replace(before.editor, again.from - 1, again.from + 2, "X");
        expect(before.save()).toBe("她抬X<comment body=\"节奏\">他一眼</comment>，转身。\n");
    });

    it("只在两端打字、删除都不适用：新字在批注外，删光就没了", () => {
        const {editor, save} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        replace(editor, range.to, range.to, "X");
        expect(save()).toBe("她抬头<comment body=\"节奏\">看了他一眼</comment>X，转身。\n");
        const removed = open(SOURCE);
        const all = find(removed.editor.state.doc, "看了他一眼");
        removed.editor.view.dispatch(removed.editor.state.tr.delete(all.from, all.to));
        expect(listComments(removed.editor.state.doc)).toEqual([]);
    });

    it("盖住同一句的两条批注都继承，替换是一个撤销步，Ctrl+Z 回到原样", () => {
        const {editor, save} = open("她<comment body=\"外\"><comment body=\"内\">看了他</comment>一眼</comment>。\n");
        const range = find(editor.state.doc, "看了他");
        const original = editor.state.doc;
        const depth = undoDepth(editor.state);
        replace(editor, range.from, range.to, "盯");
        expect(listComments(editor.state.doc).map((info) => [info.body, info.quote])).toEqual([["内", "盯"], ["外", "盯一眼"]]);
        expect(undoDepth(editor.state)).toBe(depth + 1);
        expect(save()).toContain("盯");
        editor.commands.undo();
        expect(editor.state.doc.eq(original)).toBe(true);
    });

    it("一个字一个字打新句子：选中整句后第一个字替换选区，接着打的字也在批注里；光标挪开再回来就不续了", () => {
        const {editor, save} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        replace(editor, range.from, range.to, "新");
        replace(editor, range.from + 1, range.from + 1, "句");
        replace(editor, range.from + 2, range.from + 2, "子");
        expect(listComments(editor.state.doc).map((info) => [info.body, info.quote])).toEqual([["节奏", "新句子"]]);
        expect(save()).toBe("她抬头<comment body=\"节奏\">新句子</comment>，转身。\n");
        // 光标挪到别处再回到批注末尾：这里是普通的批注末尾，打字在批注外。
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from + 3)));
        replace(editor, range.from + 3, range.from + 3, "X");
        expect(save()).toBe("她抬头<comment body=\"节奏\">新句子</comment>X，转身。\n");
    });

    it("续写只认紧接着刚换进来的文字的末尾：在别处打字、撤销之后都不续", () => {
        const {editor, save} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        replace(editor, range.from, range.to, "新");
        // 在别处插入一个字（文档改了）：续断了，哪怕接着又回到批注末尾打字。
        replace(editor, 1, 1, "前");
        replace(editor, range.from + 2, range.from + 2, "X");
        expect(save()).toBe("前她抬头<comment body=\"节奏\">新</comment>X，转身。\n");
    });

    it("换进来的文字自己带着别的批注时，不再替它继承被换掉的那一条", () => {
        const {editor} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        const other = editor.schema.marks.comment?.create({body: "别人的", id: null, key: "kother"});
        if (other === undefined) throw new Error("没有批注标记");
        const slice = new Slice(Fragment.from(editor.schema.text("别人的字", [other])), 0, 0);
        editor.view.dispatch(editor.state.tr.replaceRange(range.from, range.to, slice));
        expect(listComments(editor.state.doc).map((info) => info.body)).toEqual(["别人的"]);
    });

    it("换进来的是整块内容（几段）时不继承", () => {
        const {editor} = open(SOURCE);
        const range = find(editor.state.doc, "看了他一眼");
        const {paragraph} = editor.schema.nodes;
        if (paragraph === undefined) throw new Error("没有段落");
        const two = Fragment.from([paragraph.create(null, editor.schema.text("甲")), paragraph.create(null, editor.schema.text("乙"))]);
        editor.view.dispatch(editor.state.tr.replaceRange(range.from, range.to, new Slice(two, 1, 1)));
        expect(listComments(editor.state.doc)).toEqual([]);
        expect(editor.state.doc.textContent).toContain("乙");
    });
});
