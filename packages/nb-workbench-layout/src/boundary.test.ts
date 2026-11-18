/**
 * 包的依赖边界（AGENTS.md“边界”）：核心只经公开入口用 nb-layout，不依赖 Vue 与 DOM，因为服务端经应用的
 * `workbench/shared/` 也导入它；Vue 层再加 `vue`、nb-ui 与 nb-layout 的 `/vue`。都不用相对路径深入 nb-layout 的源码。
 * 新增文件同样受约束。扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

const CORE: ImportRule = {packages: [/^@notnotype\/nb-layout$/u], within: SOURCE_ROOT, excluding: VUE_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u, /^@notnotype\/nb-layout(\/vue)?$/u], within: SOURCE_ROOT};

describe("包的导入", () => {
    it("核心只导入 nb-layout 的核心入口与本包的核心文件", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 层只导入 vue、nb-ui、nb-layout 的两个入口与本包的文件", () => {
        expect(scanImports(sourceFiles(VUE_ROOT), VUE)).toEqual([]);
    });
});
