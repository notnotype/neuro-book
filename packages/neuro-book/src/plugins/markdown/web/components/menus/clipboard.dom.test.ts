/** 菜单粘贴（docs/specs/workbench/markdown-editing.md 输出 23）：真实 Tiptap；剪贴板是接口的形状，接真实浏览器的路径在 e2e。 */
import {Editor} from "@tiptap/core";
import {defaultMarkdownLanguage} from "@notnotype/nb-markdown/language";
import {afterEach, describe, expect, it} from "vitest";

import {paste} from "./clipboard";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) editor.destroy();
});
function open(): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({element, extensions: [...defaultMarkdownLanguage().extensions]});
    editors.push(editor);
    return editor;
}
const denied = (): Promise<never> => Promise.reject(new DOMException("denied", "NotAllowedError"));

describe("菜单粘贴", () => {
    it("接口不可用", async () => {
        const editor = open();
        expect(await paste(editor, false, {})).toBe("pasteUnsupported");
        expect(await paste(editor, true, undefined as never)).not.toBeNull();
    });

    it("权限被拒", async () => {
        const editor = open();
        expect(await paste(editor, false, {read: denied, readText: denied})).toBe("pasteDenied");
        expect(await paste(editor, true, {read: denied, readText: denied})).toBe("pasteDenied");
    });

    it("剪贴板里没有文字（图片或文件）", async () => {
        const editor = open();
        const image = {types: ["image/png"]} as unknown as ClipboardItem;
        expect(await paste(editor, false, {read: async () => [image], readText: async () => ""})).toBe("pasteEmpty");
        expect(await paste(editor, true, {read: async () => [image], readText: async () => ""})).toBe("pasteEmpty");
        expect(editor.getText()).toBe("");
    });

    it("别的错误不当成权限问题吞掉", async () => {
        const editor = open();
        const broken = (): Promise<never> => Promise.reject(new Error("坏了"));
        await expect(paste(editor, false, {read: broken, readText: broken})).rejects.toThrow("坏了");
    });

    it("纯文本写进正文", async () => {
        const editor = open();
        expect(await paste(editor, true, {readText: async () => "字"})).toBeNull();
        expect(editor.getText()).toBe("字");
    });
});
