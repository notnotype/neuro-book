/**
 * 包的依赖边界（AGENTS.md“边界”）：核心不依赖任何包，这样插件激活时就能建模型、Bun 里也能测；Vue 层只依赖 `vue`、
 * `@notnotype/nb-ui` 与核心。新增文件同样受约束。扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

const CORE: ImportRule = {packages: [], within: SOURCE_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u, /^tabbable$/u], within: SOURCE_ROOT};

describe("包的导入", () => {
    it("核心只导入自己的文件", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 层只导入 vue、nb-ui、tabbable 与本包的文件", () => {
        expect(scanImports(sourceFiles(VUE_ROOT), VUE)).toEqual([]);
    });
});
