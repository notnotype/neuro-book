/**
 * 菜单里的剪贴板动作（docs/specs/workbench/markdown-editing.md 输出 22、23）。
 *
 * 复制、剪切先把焦点还给正文，再 `execCommand`：这样走 ProseMirror 的 copy、cut 处理器，和 Ctrl+C、Ctrl+X 是同一条路径，粘贴回来
 * 结构还在，非安全上下文也能用。菜单选项是在 click 里同步调到这里的，浏览器认这是用户手势。`execCommand` 被废弃了，真被移除时只
 * 改这一个函数。粘贴只能走异步剪贴板接口：`execCommand("paste")` 网页用不了。
 */

import type {Editor} from "@tiptap/core";

import {isClipboardDenied, readClipboardText} from "nbook/shared/clipboard-read";
import type {PasteFailure} from "nbook/shared/clipboard-read";

export type {PasteFailure};

export function copyOrCut(editor: Editor, command: "copy" | "cut"): void {
    editor.view.focus();
    document.execCommand(command);
}

interface ClipboardReader {
    read?(): Promise<ReadonlyArray<ClipboardItem>>;
    readText?(): Promise<string>;
}

/** 读不到时给出原因，文档不变。权限被拒是 `NotAllowedError`，按错误类型分，不按文案。 */
export async function paste(editor: Editor, plain: boolean, clipboard: ClipboardReader | undefined = navigator.clipboard): Promise<PasteFailure | null> {
    if (clipboard?.readText === undefined || (!plain && clipboard.read === undefined)) return "pasteUnsupported";
    try {
        if (plain) {
            const read = await readClipboardText(clipboard);
            if (!read.ok) return read.failure;
            editor.view.focus();
            editor.view.pasteText(read.text);
            return null;
        }
        const items = await clipboard.read!();
        for (const item of items) {
            if (item.types.includes("text/html")) {
                const html = await (await item.getType("text/html")).text();
                editor.view.focus();
                editor.view.pasteHTML(html);
                return null;
            }
            if (item.types.includes("text/plain")) {
                const text = await (await item.getType("text/plain")).text();
                editor.view.focus();
                editor.view.pasteText(text);
                return null;
            }
        }
        return "pasteEmpty";
    } catch (error) {
        if (isClipboardDenied(error)) return "pasteDenied";
        throw error;
    }
}
