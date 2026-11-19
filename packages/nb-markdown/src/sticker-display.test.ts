/**
 * 按贴纸显示的样式表（docs/specs/agent/stickers.md 输出 47）：选中哪些包、丢掉不合格的 id。选择器要压过 `stickers.css` 的行内小图
 * 与大图块的规则，这条在真实浏览器里由 neuro-book 的 e2e 量图高。
 */

import {describe, expect, test} from "bun:test";

import {stickerDisplayCss} from "./sticker-display";

describe("stickerDisplayCss", () => {
    test("没有包时是空串", () => {
        expect(stickerDisplayCss([])).toBe("");
    });

    test("按表情包 id 选中有图的表情与它的图，大图高度用 --nb-sticker-large-size", () => {
        const css = stickerDisplayCss(["builtin.lyra", "user.cat"]);
        expect(css).toContain(`.nb-sticker.has-image[data-sticker-pack="builtin.lyra"]`);
        expect(css).toContain(`.nb-sticker.has-image[data-sticker-pack="user.cat"] .nb-sticker__image`);
        expect(css).toContain("height: var(--nb-sticker-large-size, 120px)");
        expect(css).toContain("margin-block: 0");
    });

    test("不合格的 id 丢掉（引号、空白、大写都可能逃出属性选择器），重复的只写一次", () => {
        const css = stickerDisplayCss(["user.a", "user.a", "x\"] body {", "User.B", ""]);
        // 合格的只有 user.a：两条规则里各出现一次。
        expect(css.match(/data-sticker-pack=/gu)).toHaveLength(2);
        expect(css).not.toContain("body");
        expect(stickerDisplayCss(["x\"]"])).toBe("");
    });
});
