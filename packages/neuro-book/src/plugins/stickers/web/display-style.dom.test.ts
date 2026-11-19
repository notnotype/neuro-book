/**
 * 按贴纸显示的样式表放进页面（docs/specs/agent/stickers.md 输出 47）：一个窗口里只有一份，随偏好换内容，入口停下时移除。
 * 样式真的压过行内小图、图高变成 120 像素，在真实浏览器里由 `e2e/sticker-preview.e2e.ts` 量。
 */

import {afterEach, describe, expect, it} from "vitest";

import {mountStickerDisplayStyle} from "./display-style";

const styles = (): HTMLStyleElement[] => [...document.head.querySelectorAll<HTMLStyleElement>("style[data-nbook-sticker-display]")];

afterEach(() => {
    for (const style of styles()) style.remove();
});

describe("mountStickerDisplayStyle", () => {
    it("放一份；再调用换内容、不另加；交回的函数移除它", () => {
        mountStickerDisplayStyle(["user.a"]);
        const remove = mountStickerDisplayStyle(["builtin.lyra"]);
        expect(styles()).toHaveLength(1);
        expect(styles()[0]?.textContent).toContain(`[data-sticker-pack="builtin.lyra"]`);
        expect(styles()[0]?.textContent).not.toContain("user.a");
        remove();
        expect(styles()).toHaveLength(0);
    });

});
