/**
 * 从菜单粘贴时读系统剪贴板的文字（docs/specs/workbench/markdown-editing.md 输出 23，docs/specs/workbench/editor.md 输出 64）。
 * 网页只能经异步剪贴板接口读，读不到有三种原因，界面要分别说明；按错误类型分，不按文案。两种编辑器的菜单共用这一份。
 */

export type PasteFailure = "pasteUnsupported" | "pasteDenied" | "pasteEmpty";

/** `navigator.clipboard` 里用到的部分；非安全上下文里整个对象都没有。 */
export interface ClipboardTextReader {
    readText?(): Promise<string>;
}

export type ClipboardText = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly failure: PasteFailure};

/** 权限被拒：浏览器以 `NotAllowedError` 拒绝读取。 */
export function isClipboardDenied(error: unknown): boolean {
    return error instanceof DOMException && error.name === "NotAllowedError";
}

/** 读到的文字，或读不到的原因；别的错误照常抛出。 */
export async function readClipboardText(clipboard: ClipboardTextReader | undefined): Promise<ClipboardText> {
    if (clipboard?.readText === undefined) return {ok: false, failure: "pasteUnsupported"};
    try {
        const text = await clipboard.readText();
        return text === "" ? {ok: false, failure: "pasteEmpty"} : {ok: true, text};
    } catch (error) {
        if (isClipboardDenied(error)) return {ok: false, failure: "pasteDenied"};
        throw error;
    }
}
