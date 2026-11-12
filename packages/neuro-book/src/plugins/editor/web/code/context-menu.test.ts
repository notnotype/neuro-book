/**
 * 源码编辑器右键的内置项（docs/specs/workbench/editor.md 输出 64）：各状态下有哪些项。每项在真实 Monaco 上的效果由
 * `e2e/editor-code-menu.e2e.ts` 逐项点。
 */

import {describe, expect, it} from "bun:test";

import {codeMenuSections} from "./context-menu";
import type {CodeMenuSnapshot} from "./context-menu";

const ids = (snapshot: CodeMenuSnapshot): string[][] => codeMenuSections(snapshot).map((section) => section.map((item) => item.id));
const PLAIN: CodeMenuSnapshot = {readonly: false, hasSelection: false, canFormat: false, canFormatSelection: false};

describe("Spec workbench.editor 输出 64：源码编辑器右键的内置项", () => {
    it("可写的普通文件：剪贴板、全选、查找与修改三节，没有格式化", () => {
        expect(ids(PLAIN)).toEqual([["cut", "copy", "paste"], ["selectAll"], ["find", "replace", "changeAll"]]);
    });

    it("这门语言有格式化时多“格式化文档”；有选区且能格式化选区时再多“格式化选定内容”", () => {
        expect(ids({...PLAIN, canFormat: true, canFormatSelection: true}).at(-1)).toEqual(["find", "replace", "changeAll", "formatDocument"]);
        expect(ids({...PLAIN, hasSelection: true, canFormat: true, canFormatSelection: true}).at(-1)).toEqual(["find", "replace", "changeAll", "formatDocument", "formatSelection"]);
        expect(ids({...PLAIN, hasSelection: true}).at(-1)).toEqual(["find", "replace", "changeAll"]);
    });

    it("只读：只有复制、全选、查找，能格式化也不出现", () => {
        expect(ids({readonly: true, hasSelection: true, canFormat: true, canFormatSelection: true})).toEqual([["copy"], ["selectAll"], ["find"]]);
    });

    it("只标各平台一致的五个快捷键", () => {
        const items = codeMenuSections({...PLAIN, hasSelection: true, canFormat: true, canFormatSelection: true}).flat();
        expect(items.filter((item) => item.keybinding !== undefined).map((item) => item.id)).toEqual(["cut", "copy", "paste", "selectAll", "find"]);
    });
});
