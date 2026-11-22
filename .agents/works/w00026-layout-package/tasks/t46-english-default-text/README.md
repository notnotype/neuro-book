---
schema: nbook.task/v2
taskId: t46-english-default-text
status: done
updated: 2026-11-22
---

# nb-layout 默认英文文案

## 目标与范围

nb-layout 没有注入文字时改用英文目录、源语言改成 `en-US`（提案第二档第 5 项）；nb-story 与开发者面板今天不注入、会静默变成英文，同一 Task 里给它们注入中文；改 `ui/i18n` 输出 8 与说缺省是 zh-CN 的文档。

合同：[`ui/i18n`](../../../../../docs/specs/ui/i18n.md) 输出 8、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 143。

## 当前状态

2026-11-22 完成，合入 master（`6170f83ad`；实现审查修正 `ec63bbaf8`）。

- [计划](plan.md)第 2 稿：设计审查（Claude Sonnet）9 条（重要 5、建议 4）都成立，处理见计划的“修订记录”，[证据](evidences/design-review.txt)。
- nb-layout：源语言改成 `en-US`，没有注入时组件是英文；`./text` 新增 `layoutCatalogTranslate(语言)` 与类型 `LayoutCatalogLocale`，给只有一种语言、没有翻译引擎的宿主；缺省翻译也改用它，取文字只有一份实现。两份目录的键与占位符此前没有任何地方核对，补了 `src/vue/text.dom.test.ts`（键与组件用的键双向一一对应、两种语言占位符相同、只用 `{名字}`）。核对放在 Vue 层，由 Vitest 跑：键的类型在 `text.ts`，核心不依赖 Vue 层，Vue 层的 tsconfig 又不带 Bun 的类型。
- 宿主：应用登记 nb-layout 目录时读 `NB_LAYOUT_SOURCE_LOCALE`；nb-story 与开发者面板的网页根注入 `layoutCatalogTranslate("zh-CN")`，各有一条源码守卫测试；nb-story 的 `viewer.e2e.ts` “外壳”一条断言分隔线的读屏名称是中文（变异过：去掉注入就变红）。
- 文档：nb-layout 的 README（入口注释、“我要做 X”表、“文字”一节加注入例子与“1 pixels”的已知限制）、`Splitter.md`、`SortableList.md`；nb-ui 的迁移说明；Spec `ui/i18n` 输出 8（含同屏中英混排的已知限制）、`ui/nested-grid` 输出 143；提案追加决策记录（`message-catalogs` 只查 JSON 那个前提）。

## 实现审查

Claude Sonnet，阻断 0、重要 0、建议 6，都成立（[证据](evidences/impl-review.txt)），修正 `ec63bbaf8`：

1. 两处注释指向不存在的 `locales.test.ts`：改指 `text.dom.test.ts`。
2. “缺键回源语言”一支没有用例：两份目录的键由测试保证相同，这一支护的是不会发生的事，删掉；Spec 输出 143 与 README 的那句一起删。
3. 目录外的语言静默变英文：改成抛 `RangeError`，在宿主提供文字时就报出来（Spec 输出 143、README 写明）。
4. 两条守卫测试只测写法：两个宿主的注入抽成 `installLayoutText(app)`，测试用真的 Vue 应用取出注入的函数断言是中文，`main.ts` 只核对经它建根；`viewer.e2e.ts` 那行与 `frame.e2e.ts` 重复，删掉。
5. `host-text.ts` 头注释的方向反了：改成“不注入就一直是英文”。
6. 测试的措辞写成“`LayoutTextKey` 里的键”。

修正后 nb-layout `typecheck`、`test`（Bun 398 条、Vitest 270 条），nb-story 与开发者面板 `typecheck`，nb-story `frame.e2e.ts` 8 条，两个宿主的新测试各 2 条，都过。

## 验证

- nb-layout `typecheck`、`test`（Bun 398 条、Vitest 270 条）；应用 `host-text`、`text-engine` 测试 37 条与 `typecheck`；nb-story `typecheck`、守卫测试、`build:web`、`viewer.e2e.ts` 的“外壳”与 `frame.e2e.ts` 8 条（并入 t44 之后）；开发者面板 `typecheck` 与 `web-text`、`web-build`、`panel-server` 三个测试文件 27 条。
- 合入后补跑（master `36891fd68`）：nb-workbench-layout `test`（Bun 267 条、Vitest 48 条）；应用 `test:vitest` 1024 条；开发者面板 `web-build`、`web-text` 3 条；应用 e2e `lab-sortable-list`（断言“拖到这里”）与 `workbench-containers`（按读屏名称取分隔线）43 条。应用的组件与 Lab 都在注入了宿主文字的根下，缺省改英文不影响它们。
- 未验证：应用的英文窗口（本来就注入，不受影响）。

## 下一步

t47 建 nb-layout 变更记录时写这次的不兼容改动（已记在 t47 的“输入”）。
