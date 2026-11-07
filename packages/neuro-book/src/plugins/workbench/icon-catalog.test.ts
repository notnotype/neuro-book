/**
 * 图标目录的纯数据部分（docs/specs/theme/editor.md 输出 21）：从选择器里取图标名、补全候选的排序。读样式表的部分要真实的浏览器
 * （happy-dom 解析样式表会整块丢掉 `@layer`，产品的图标规则都在里面），由 e2e 在 Chromium 里测。
 */

import {describe, expect, it} from "bun:test";

import {matchIcons, parseIconSelector} from "./web/icon-catalog";

describe("从选择器取图标名", () => {
    it("单个类、分组选择器（别名）都取到；重复只留一个", () => {
        expect(parseIconSelector(".i-lucide-folder")).toEqual(["folder"]);
        expect(parseIconSelector(".i-lucide-loader-2,.i-lucide-loader-circle")).toEqual(["loader-2", "loader-circle"]);
        expect(parseIconSelector(".i-lucide-a, .i-lucide-a")).toEqual(["a"]);
    });

    it("后代选择器、伪类、别的类、不合名字规则的都不收；分组里只收合格的几段", () => {
        expect(parseIconSelector(".button .i-lucide-folder")).toEqual([]);
        expect(parseIconSelector(".i-lucide-folder:hover")).toEqual([]);
        expect(parseIconSelector(".i-lucide-Folder")).toEqual([]);
        expect(parseIconSelector("[class*=\"i-lucide-\"]")).toEqual([]);
        expect(parseIconSelector(".i-lucide-folder,.x .i-lucide-file")).toEqual(["folder"]);
    });
});

describe("补全候选", () => {
    const names = ["file", "folder", "folder-open", "git-fork", "search", "wand-sparkles"];

    it("以输入开头的在前，其余含有输入的在后，各自按名字排序", () => {
        expect(matchIcons(names, "fo")).toEqual(["folder", "folder-open", "git-fork"]);
        expect(matchIcons(names, "ark")).toEqual(["wand-sparkles"]);
    });

    it("输入为空或没有匹配时没有候选；大小写与首尾空白不影响", () => {
        expect(matchIcons(names, "")).toEqual([]);
        expect(matchIcons(names, "   ")).toEqual([]);
        expect(matchIcons(names, "zzz")).toEqual([]);
        expect(matchIcons(names, " FOLDER ")).toEqual(["folder", "folder-open"]);
    });

    it("至多 limit 个", () => {
        expect(matchIcons(Array.from({length: 20}, (_, i) => `icon-${String(i)}`), "icon", 8)).toHaveLength(8);
    });
});
