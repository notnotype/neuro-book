/**
 * 选编辑器（docs/specs/workbench/editor.md 输出 37–39）与会话记录里的旧编辑器名：纯函数。
 */

import {describe, expect, it} from "bun:test";

import {CODE_EDITOR, MARKDOWN_EDITOR} from "./shared/contracts";
import type {EditorDeclaration} from "./shared/contracts";
import {BINARY_TAB_EDITOR, completedBuiltinEditors, candidatesFor, catalogOf, editorRefusal, resolveEditor} from "./web/editors";

const title = {"zh-CN": "x", "en-US": "x"};
const declare = (extra: Partial<EditorDeclaration>): EditorDeclaration => ({title, priority: "default", input: "text", ...extra});

const catalog = catalogOf([
    ...completedBuiltinEditors(),
    {id: "test.image.viewer", declaration: declare({input: "bytes", selector: {extensions: ["png", "svg"]}})},
    {id: "test.preview.html", declaration: declare({priority: "option", role: "preview", selector: {extensions: ["html"]}})},
    {id: "test.dts.editor", declaration: declare({selector: {extensions: ["d.ts"]}})},
    {id: "test.ts.editor", declaration: declare({selector: {extensions: ["ts"]}})},
    {id: "test.readme.editor", declaration: declare({selector: {filenames: ["README.md"]}})},
    {id: "test.alpha.png", declaration: declare({input: "bytes", selector: {extensions: ["gif"]}})},
    {id: "test.beta.png", declaration: declare({input: "bytes", selector: {extensions: ["gif"]}})},
]);

describe("Spec workbench.editor 输出 37：选择顺序", () => {
    it("default 档的命中优先；文件名强于扩展名，最长后缀优先，不分大小写；都不中落到源码编辑器", () => {
        expect(resolveEditor(catalog, "project://a.md")).toEqual({kind: "editor", editor: MARKDOWN_EDITOR});
        expect(resolveEditor(catalog, "project://docs/readme.MD")).toEqual({kind: "editor", editor: "test.readme.editor"});
        expect(resolveEditor(catalog, "project://A.PNG")).toEqual({kind: "editor", editor: "test.image.viewer"});
        expect(resolveEditor(catalog, "project://types/a.d.ts")).toEqual({kind: "editor", editor: "test.dts.editor"});
        expect(resolveEditor(catalog, "project://a.ts")).toEqual({kind: "editor", editor: "test.ts.editor"});
        // option 档的预览编辑器不会被不指定编辑器的打开选中。
        expect(resolveEditor(catalog, "project://index.html")).toEqual({kind: "editor", editor: CODE_EDITOR});
        expect(resolveEditor(catalog, "project://notes.txt")).toEqual({kind: "editor", editor: CODE_EDITOR});
        // 扩展名本身就是整个文件名（`.png`）不算命中。
        expect(resolveEditor(catalog, "project://.png")).toEqual({kind: "editor", editor: CODE_EDITOR});
    });

    it("同级两个 default 命中：按 id 取第一个，并交出冲突", () => {
        const conflicts: Array<ReadonlyArray<string>> = [];
        expect(resolveEditor(catalog, "project://a.gif", (ids) => conflicts.push(ids))).toEqual({kind: "editor", editor: "test.alpha.png"});
        expect(conflicts).toEqual([["test.alpha.png", "test.beta.png"]]);
    });

    it("已知二进制且没有编辑器认领：不能在这里打开；有编辑器认领时照常", () => {
        expect(resolveEditor(catalog, "project://a.pdf")).toEqual({kind: "binary"});
        expect(resolveEditor(catalog, "project://song.MP3")).toEqual({kind: "binary"});
        const withPdf = catalogOf([...catalog.list(), {id: "test.pdf.viewer", declaration: declare({priority: "option", input: "bytes", selector: {extensions: ["pdf"]}})}]);
        expect(resolveEditor(withPdf, "project://a.pdf")).toEqual({kind: "editor", editor: CODE_EDITOR});
        expect(BINARY_TAB_EDITOR).not.toBe(CODE_EDITOR);
    });
});

describe("Spec workbench.editor 输出 38–39：指定编辑器与重新打开的候选", () => {
    it("未登记的编辑器、按字节显示的编辑器打开它不认领的文件都被拒；文本编辑器可以打开任何文件", () => {
        expect(editorRefusal(catalog, "test.nope.editor", "project://a.md")).not.toBeNull();
        expect(editorRefusal(catalog, "test.image.viewer", "project://a.md")).not.toBeNull();
        expect(editorRefusal(catalog, "test.image.viewer", "project://a.svg")).toBeNull();
        expect(editorRefusal(catalog, CODE_EDITOR, "project://a.svg")).toBeNull();
        expect(editorRefusal(catalog, MARKDOWN_EDITOR, "project://a.json")).toBeNull();
    });

    it("候选：命中的全部编辑器（含 option 档与预览编辑器）按命中强弱，加上源码编辑器", () => {
        expect(candidatesFor(catalog, "project://a.svg")).toEqual(["test.image.viewer", CODE_EDITOR]);
        expect(candidatesFor(catalog, "project://index.html")).toEqual(["test.preview.html", CODE_EDITOR]);
        expect(candidatesFor(catalog, "project://types/a.d.ts")).toEqual(["test.dts.editor", "test.ts.editor", CODE_EDITOR]);
        expect(candidatesFor(catalog, "project://notes.txt")).toEqual([CODE_EDITOR]);
    });
});
