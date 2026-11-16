/**
 * 新建 frontmatter（docs/specs/workbench/markdown-editing.md 输出 48）：第一块开头打 `---` 的输入规则、紧接着退格还原、不命中时
 * 照旧是分割线；编辑动作 `properties`。真实语言、真实 Tiptap 与编辑器的扩展组；打字走 ProseMirror 的 `handleTextInput`（输入
 * 规则在这里），没人接手时按浏览器的默认插入。
 */

import {Editor} from "@tiptap/core";
import {EditorState} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {afterEach, describe, expect, it} from "vitest";

import {defaultChipEnv} from "../chip/chip";
import {codecFor, defaultMarkdownLanguage, frontmatterOf} from "../language";
import {markdownEditingActions} from "./editing-actions";
import {FRONTMATTER_REQUEST, setFrontmatterEol} from "./frontmatter";
import {createMarkdownEditorExtensions} from "./markdown-editor-extensions";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});

const language = defaultMarkdownLanguage();

function open(markdown: string): {editor: Editor; write: () => string; requests: () => number} {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: createMarkdownEditorExtensions({language, placeholder: "", host: {base: () => null, assets: null, chips: defaultChipEnv}, commentMarkerLabel: null})});
    editors.push(editor);
    const codec = codecFor(editor.schema, language);
    const read = codec.read(markdown);
    // 与宿主一样换整个编辑状态：`setContent` 不带文档的属性。
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    setFrontmatterEol(editor, read.map.eol);
    let requests = 0;
    editor.on("transaction", ({transaction}: {transaction: Transaction}) => {
        if (transaction.getMeta(FRONTMATTER_REQUEST) === true) requests += 1;
    });
    return {editor, requests: () => requests, write: () => {
        const written = codec.write(editor.state.doc, read.map);
        if (!written.ok) throw new Error(`写不出：${written.reason}`);
        return written.text;
    }};
}

function type(editor: Editor, text: string): void {
    for (const char of text) {
        const {from, to} = editor.state.selection;
        const view = editor.view;
        const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)));
        if (handled !== true) view.dispatch(view.state.tr.insertText(char, from, to));
    }
}

function backspace(editor: Editor): void {
    const view = editor.view;
    const event = new KeyboardEvent("keydown", {key: "Backspace", bubbles: true, cancelable: true});
    view.someProp("handleKeyDown", (handle) => handle(view, event));
}

describe("第一块开头打 ---（输出 48）", () => {
    it("三个字符不留在正文里，建一段空的 frontmatter（换行符同文档），光标后原有的字仍在第一块；事务带请求", () => {
        const {editor, write, requests} = open("正文\r\n\r\n乙\r\n");
        editor.commands.setTextSelection(1);
        type(editor, "---");
        expect(frontmatterOf(editor.state.doc)).toBe("---\r\n---\r\n");
        expect(editor.state.doc.firstChild?.textContent).toBe("正文");
        expect(requests()).toBe(1);
        expect(write()).toBe("---\r\n---\r\n正文\r\n\r\n乙\r\n");
    });

    it("紧接着按退格：还原成正文里的 --- 文字，没有 frontmatter；破折号写法同样命中", () => {
        const {editor} = open("\n");
        editor.commands.setTextSelection(1);
        type(editor, "---");
        backspace(editor);
        expect(frontmatterOf(editor.state.doc)).toBeNull();
        expect(editor.state.doc.firstChild?.textContent).toBe("---");
        const dash = open("\n");
        dash.editor.commands.setTextSelection(1);
        type(dash.editor, "—-");
        expect(frontmatterOf(dash.editor.state.doc)).toBe("---\n---\n");
    });

    it("已有 frontmatter、或不在第一块：照旧是分割线", () => {
        const fronted = open("---\na: 1\n---\n\n");
        fronted.editor.commands.setTextSelection(1);
        type(fronted.editor, "---");
        expect(frontmatterOf(fronted.editor.state.doc)).toBe("---\na: 1\n---\n");
        expect(fronted.editor.state.doc.firstChild?.type.name).toBe("horizontalRule");
        const second = open("甲\n\n\n");
        second.editor.commands.setTextSelection(second.editor.state.doc.content.size - 1);
        type(second.editor, "---");
        expect(frontmatterOf(second.editor.state.doc)).toBeNull();
        expect([...Array(second.editor.state.doc.childCount).keys()].map((index) => second.editor.state.doc.child(index).type.name)).toContain("horizontalRule");
    });
});

describe("编辑动作 properties（输出 48）", () => {
    it("没有 frontmatter 时建一段空的，一个撤销步；已有时不改文档、不进撤销历史，只发请求", () => {
        const {editor, write, requests} = open("甲\n");
        const action = markdownEditingActions.properties;
        expect(action?.enabled(editor, {})).toBe(true);
        action?.run(editor, {});
        expect(write()).toBe("---\n---\n甲\n");
        expect(requests()).toBe(1);
        action?.run(editor, {});
        expect(write()).toBe("---\n---\n甲\n");
        expect(requests()).toBe(2);
        editor.commands.undo();
        expect(frontmatterOf(editor.state.doc)).toBeNull();
        editor.setEditable(false);
        expect(action?.enabled(editor, {})).toBe(false);
    });
});
