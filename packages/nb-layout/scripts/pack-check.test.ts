/**
 * 编译产物自查的判断（`pack-check.ts`）。完整构建约 5 秒，不进快速测试；它由 `bun run build:package` 自己跑、CI 的
 * `app-package` 作业与发布冒烟各跑一次。这里用小样本测每条判断拦得下、不误报。
 */

import {describe, expect, it} from "bun:test";

import {exportDiff, forbiddenFile, reachablePackages, specNumbers, staticImports} from "./pack-check";

describe("导入图", () => {
    it("认得压缩过的静态导入、副作用导入与再导出", () => {
        expect(staticImports(`import{a as b}from"./shared-x.js";import"./side.js";export{c}from"vue";const d="from";`).sort()).toEqual(["./shared-x.js", "./side.js", "vue"]);
    });
    it("纯 TS 的入口经共享块拉进了 Vue：报出来；没拉进来：空", () => {
        const files = new Map([
            ["index.js", `import{a}from"./shared-1.js";export{a};`],
            ["shared-1.js", `export const a=1;`],
            ["vue.js", `import{a}from"./shared-1.js";import{h}from"vue";import{tabbable}from"tabbable";`],
            ["bad.js", `import{b}from"./shared-2.js";export{b};`],
            ["shared-2.js", `import{ref}from"vue";export const b=ref(1);`],
        ]);
        expect(reachablePackages(files, "index.js")).toEqual([]);
        expect(reachablePackages(files, "vue.js")).toEqual(["tabbable", "vue"]);
        expect(reachablePackages(files, "bad.js")).toEqual(["vue"]);
    });
    it("引用了没生成的块：抛出", () => {
        expect(() => reachablePackages(new Map([["index.js", `import"./gone.js";`]]), "index.js")).toThrow("gone.js");
    });
});

describe("随包的内容", () => {
    it("Spec 的条目编号拦下，普通数字不拦", () => {
        expect(specNumbers("见输出 80 与失败5；验收 3")).toEqual(["输出 80", "失败5", "验收 3"]);
        expect(specNumbers("width: 280px; z-index: 10")).toEqual([]);
    });
    it("测试、夹具与 Lab 的入口不发", () => {
        expect(["grid.test.js", "test-fixtures.js", "lab-sources.js"].map(forbiddenFile)).toEqual([true, true, true]);
        expect(["index.js", "shared-BGRwNAXX.js", "style.css", "vue.d.ts"].map(forbiddenFile)).toEqual([false, false, false, false]);
    });
    it("导出名的差别：少了的与多出来的分开报", () => {
        expect(exportDiff(["a", "b", "c"], ["a", "c", "d"])).toEqual({missing: ["b"], extra: ["d"]});
        expect(exportDiff(["a"], ["a"])).toEqual({missing: [], extra: []});
    });
});
