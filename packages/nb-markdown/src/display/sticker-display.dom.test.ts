/**
 * 按贴纸显示的样式表（docs/specs/agent/stickers.md 输出 47）：选中哪些包、丢掉不合格的 id、一个文档里只有一份、能移除。
 * 选择器要压过 `stickers.css` 的行内小图与大图块的规则，这条在真实浏览器里由 neuro-book 的 e2e 量图高。
 */

import {afterEach, describe, expect, it} from "vitest";

import {mountStickerDisplayStyle, stickerDisplayCss} from "./sticker-display";

afterEach(() => {
    document.head.querySelectorAll("style[data-nb-sticker-display]").forEach((style) => style.remove());
});

const styles = () => [...document.head.querySelectorAll<HTMLStyleElement>("style[data-nb-sticker-display]")];

describe("stickerDisplayCss", () => {
    it("没有包时是空串", () => {
        expect(stickerDisplayCss([])).toBe("");
    });

    it("按表情包 id 选中有图的表情与它的图，大图高度用 --nb-sticker-large-size", () => {
        const css = stickerDisplayCss(["builtin.lyra", "user.cat"]);
        expect(css).toContain(`.nb-sticker.has-image[data-sticker-pack="builtin.lyra"]`);
        expect(css).toContain(`.nb-sticker.has-image[data-sticker-pack="user.cat"] .nb-sticker__image`);
        expect(css).toContain("height: var(--nb-sticker-large-size, 120px)");
        expect(css).toContain("margin-block: 0");
    });

    it("不合格的 id 丢掉（引号、空白、大写都可能逃出属性选择器），重复的只写一次", () => {
        const css = stickerDisplayCss(["user.a", "user.a", "x\"] body {", "User.B", ""]);
        expect(css.match(/data-sticker-pack=/gu)).toHaveLength(2);
        expect(css).not.toContain("body");
        expect(stickerDisplayCss(["x\"]"])).toBe("");
    });
});

describe("mountStickerDisplayStyle", () => {
    it("在 head 里放一份；再调用换内容、不另加；交回的函数移除它", () => {
        mountStickerDisplayStyle(document, ["user.a"]);
        const remove = mountStickerDisplayStyle(document, ["user.b"]);
        expect(styles()).toHaveLength(1);
        expect(styles()[0]?.textContent).toContain("user.b");
        expect(styles()[0]?.textContent).not.toContain("user.a");
        remove();
        expect(styles()).toHaveLength(0);
    });
});
