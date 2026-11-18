/**
 * 包的依赖边界（AGENTS.md“边界”）：核心不依赖任何包，这样插件激活时就能建模型、Bun 里也能测；Vue 层只依赖 `vue`、
 * `@notnotype/nb-ui` 与核心。新增文件同样受约束。扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 *
 * `workbench/` 是工作台的布局模型，要搬进 `@notnotype/nb-workbench-layout`（ADR 0054）：网格与 Vue 层不许导入它。两个入口文件
 * 暂时还转出它，搬走时一起去掉，这里先豁免。
 */

import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");
const WORKBENCH_ROOT = join(SOURCE_ROOT, "workbench");
const ENTRIES = new Set([join(SOURCE_ROOT, "index.ts"), join(VUE_ROOT, "index.ts")]);
const outsideEntries = (files: string[]): string[] => files.filter((file) => !ENTRIES.has(file));

const CORE: ImportRule = {packages: [], within: SOURCE_ROOT, excluding: WORKBENCH_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u, /^tabbable$/u], within: SOURCE_ROOT, excluding: WORKBENCH_ROOT};

describe("包的导入", () => {
    it("核心只导入自己的文件，不导入工作台的布局模型", () => {
        expect(scanImports(outsideEntries(sourceFiles(SOURCE_ROOT, new Set(["vue", "workbench"]))), CORE)).toEqual([]);
    });

    it("Vue 层只导入 vue、nb-ui、tabbable 与本包的文件，不导入工作台的布局模型", () => {
        expect(scanImports(outsideEntries(sourceFiles(VUE_ROOT)), VUE)).toEqual([]);
    });
});
