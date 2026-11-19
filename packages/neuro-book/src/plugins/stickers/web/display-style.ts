/**
 * 把按贴纸显示的样式表（nb-markdown 的 `stickerDisplayCss`，docs/specs/agent/stickers.md 输出 47）放进这个窗口的页面：`head` 里一个
 * `<style data-nbook-sticker-display="<owner>">`，同一个 owner 再调用就换内容。`picker` 入口用 `app`、随偏好更新（`followStickerDisplay`）；
 * Lab 的场景用自己的 owner，不覆盖、不删掉入口那一份。
 *
 * 入口也会在没有页面的宿主里激活（窗口合同测试用 Bun），那里没有 `document`，什么也不做。这个文件在后端的类型检查范围里
 * （经浏览器入口），没有 DOM 类型，只写用到的几个成员（同 `editor/web/plugin.ts` 的窗口失焦）。
 */

import {effectScope, watch} from "vue";

import {stickerDisplayCss} from "@notnotype/nb-markdown";

import type {StickerDisplayService} from "../shared/contracts";

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

/** 放好（或换掉）`owner` 的那份样式表；交回的函数移除它。owner 只用小写字母与连字符。没有页面时两者都什么也不做。 */
export function mountStickerDisplayStyle(packIds: readonly string[], owner = "app"): () => void {
    // 先转 unknown：带 DOM 类型检查时（Lab、组件）`globalThis.document` 是完整的 Document，与这里只写几个成员的类型不算重叠。
    const page = (globalThis as unknown as {document?: Page}).document;
    if (page === undefined) return () => undefined;
    let style = page.head.querySelector(`style[${ATTRIBUTE}="${owner}"]`);
    if (style === null) {
        style = page.createElement("style");
        style.setAttribute(ATTRIBUTE, owner);
        page.head.append(style);
    }
    style.textContent = stickerDisplayCss(packIds);
    const mounted = style;
    return () => mounted.remove();
}

/**
 * 入口用：样式表随偏好更新（`packs()` 是响应式的，别的窗口改了经记录的通知到这里），`signal` 结束（入口停下）时停止跟随并移除样式表。
 */
export function followStickerDisplay(display: Pick<StickerDisplayService, "packs">, signal: AbortSignal): void {
    const scope = effectScope(true);
    let unmount = (): void => undefined;
    scope.run(() => watch(() => display.packs(), (packs) => {
        unmount = mountStickerDisplayStyle(packs);
    }, {immediate: true}));
    signal.addEventListener("abort", () => {
        scope.stop();
        unmount();
    }, {once: true});
}
