/**
 * 按贴纸显示的样式表放进页面（docs/specs/agent/stickers.md 输出 47）：一个窗口里只有一份，随偏好换内容，入口停下时移除。
 * 样式真的压过行内小图、图高变成 120 像素，在真实浏览器里由 `e2e/sticker-preview.e2e.ts` 量。
 */

import {nextTick} from "vue";
import {afterEach, describe, expect, it} from "vitest";

import {memoryDisplay} from "./display";
import {followStickerDisplay, mountStickerDisplayStyle} from "./display-style";

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


    it("不同 owner 各一份：Lab 的那份移除时不动入口的那份", () => {
        mountStickerDisplayStyle(["builtin.lyra"]);
        const removeLab = mountStickerDisplayStyle(["user.lyra"], "lab");
        expect(styles()).toHaveLength(2);
        removeLab();
        expect(styles().map((style) => style.getAttribute("data-nbook-sticker-display"))).toEqual(["app"]);
    });
});

describe("followStickerDisplay", () => {
    it("样式表随偏好变；入口停下（signal 结束）后移除，之后再改偏好也不再放回", async () => {
        const display = memoryDisplay(() => null);
        const controller = new AbortController();
        followStickerDisplay(display, controller.signal);
        expect(styles()[0]?.textContent).toBe("");
        display.set("builtin.lyra", true);
        await nextTick();
        expect(styles()[0]?.textContent).toContain(`[data-sticker-pack="builtin.lyra"]`);
        controller.abort();
        expect(styles()).toHaveLength(0);
        display.set("user.cat", true);
        await nextTick();
        expect(styles()).toHaveLength(0);
    });
});
