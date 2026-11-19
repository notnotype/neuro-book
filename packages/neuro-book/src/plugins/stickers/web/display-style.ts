/**
 * 把按贴纸显示的样式表（nb-markdown 的 `stickerDisplayCss`，docs/specs/agent/stickers.md 输出 47）放进这个窗口的页面：`head` 里一个
 * `<style data-nbook-sticker-display>`，再调用就换内容。`picker` 入口随偏好调它，Lab 的场景同样调它。
 *
 * 入口也会在没有页面的宿主里激活（窗口合同测试用 Bun），那里没有 `document`，什么也不做。这个文件在后端的类型检查范围里
 * （经浏览器入口），没有 DOM 类型，只写用到的几个成员（同 `editor/web/plugin.ts` 的窗口失焦）。
 */

import {stickerDisplayCss} from "@notnotype/nb-markdown";

interface StyleElement {
    textContent: string | null;
    setAttribute(name: string, value: string): void;
    remove(): void;
}

interface Page {
    readonly head: {
        querySelector(selectors: string): StyleElement | null;
        append(node: StyleElement): void;
    };
    createElement(tagName: "style"): StyleElement;
}

const ATTRIBUTE = "data-nbook-sticker-display";

/** 放好（或换掉）样式表；交回的函数移除它。没有页面时两者都什么也不做。 */
export function mountStickerDisplayStyle(packIds: readonly string[]): () => void {
    // 先转 unknown：带 DOM 类型检查时（Lab、组件）`globalThis.document` 是完整的 Document，与这里只写几个成员的类型不算重叠。
    const page = (globalThis as unknown as {document?: Page}).document;
    if (page === undefined) return () => undefined;
    let style = page.head.querySelector(`style[${ATTRIBUTE}]`);
    if (style === null) {
        style = page.createElement("style");
        style.setAttribute(ATTRIBUTE, "");
        page.head.append(style);
    }
    style.textContent = stickerDisplayCss(packIds);
    const mounted = style;
    return () => mounted.remove();
}
