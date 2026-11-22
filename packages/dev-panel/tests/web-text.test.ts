/**
 * 网页根上的 nb-layout 文字（docs/specs/ui/i18n.md 输出 8）：nb-layout 没有注入时是英文，这个界面只有中文，少了注入分栏的读屏
 * 文字就静默变成英文。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {LAYOUT_TEXT_KEY} from "@notnotype/nb-layout/text";
import {createApp, inject} from "vue";

import {installLayoutText} from "../src/web/host/layout-text.js";

describe("网页根的 nb-layout 文字", () => {
    it("installLayoutText 给根注入的是中文：组件在根下取到的分隔线文字是中文", () => {
        const app = installLayoutText(createApp({render: () => null}));
        const translate = app.runWithContext(() => inject(LAYOUT_TEXT_KEY));
        expect(translate?.("splitter.collapsed")).toBe("已收起");
        expect(translate?.("splitter.resizeWidth", {before: "a", after: "b"})).toBe("调整 a 与 b 的宽度");
    });

    it("网页唯一的根（main.ts）经它建", () => {
        const source = readFileSync(fileURLToPath(new URL("../src/web/main.ts", import.meta.url)), "utf8");
        expect(source).toContain("installLayoutText(createApp(App))");
    });
});
