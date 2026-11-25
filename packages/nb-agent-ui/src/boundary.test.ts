/**
 * 包的依赖边界（packages/nb-agent-ui/AGENTS.md）：核心只依赖 `@notnotype/nb-ui/text`（文字值的纯数据层，没有外部依赖、
 * 不引 Vue，docs/specs/ui/i18n.md），只许 `import type` 自 `vue`（注册表类型里有组件字段），这样服务端、nb-story 与以后的终端都能用分轮与适配器；Vue 渲染层只依赖 `vue`、`@notnotype/nb-ui`、`@notnotype/nb-layout`（消息视图的分栏）与核心。
 * 两层都不许引用宿主的源码：`nbook/…` 这样的应用别名与 `../../neuro-book/…` 这样的跨包相对路径都算越界。
 * 扫描的写法与它的取舍见 `@notnotype/neuro-book-test-support/import-boundary`。
 */

import {describe, expect, it} from "bun:test";
import {join} from "node:path";

import {offendingSpecifiers, scanImports, sourceFiles, type ImportRule} from "@notnotype/neuro-book-test-support/import-boundary";

const SOURCE_ROOT = import.meta.dir;
const VUE_ROOT = join(SOURCE_ROOT, "vue");

const CORE: ImportRule = {packages: [/^@notnotype\/nb-ui\/text$/u], typeOnly: [/^vue$/u], within: SOURCE_ROOT, excluding: VUE_ROOT};
const VUE: ImportRule = {packages: [/^vue$/u, /^@notnotype\/nb-ui(\/.*)?$/u, /^@notnotype\/nb-layout(\/vue)?$/u], within: SOURCE_ROOT};

describe("包的导入", () => {
    it("核心只导入核心自己的文件与 nb-ui 的纯数据层，另外只许 import type 自 vue", () => {
        expect(scanImports(sourceFiles(SOURCE_ROOT, new Set(["vue"])), CORE)).toEqual([]);
    });

    it("Vue 渲染层只导入 vue、nb-ui、nb-layout 与本包的文件", () => {
        expect(scanImports(sourceFiles(VUE_ROOT), VUE)).toEqual([]);
    });

    it("核心不许引用应用别名（旧 agent-view.types.ts 就引用过应用里的粘贴策略类型）", () => {
        expect(offendingSpecifiers(join(SOURCE_ROOT, "types.ts"), "import type {X} from \"nbook/app/components/common/form/prompt-editor/prompt-editor.types\";", CORE)).toEqual(["nbook/app/components/common/form/prompt-editor/prompt-editor.types"]);
    });
});
