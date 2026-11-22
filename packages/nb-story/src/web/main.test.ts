/**
 * 网页根上注入 nb-layout 的中文文字（docs/specs/ui/i18n.md 输出 8）：nb-layout 没有注入时是英文，这个界面只有中文，少了这一句
 * 分栏的读屏文字就静默变成英文。网页只有这一个根（`createApp` 只在 `main.ts`），所以读它的源码核对。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

describe("网页根的文字", () => {
    it("根上把 nb-layout 的文字接到它自带的中文目录", () => {
        const source = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");
        expect(source.match(/createApp\(/gu)).toHaveLength(1);
        expect(source).toMatch(/createApp\(App\)\.provide\(LAYOUT_TEXT_KEY, layoutCatalogTranslate\("zh-CN"\)\)/u);
    });
});
