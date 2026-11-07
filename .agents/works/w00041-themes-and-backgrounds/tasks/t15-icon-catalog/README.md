---
schema: nbook.task/v2
taskId: t15-icon-catalog
status: done
updated: 2026-11-06
---

# 可覆盖图标目录

## 目标与范围

主题编辑器图标分区的名字补全、未知名提示、已覆盖行的原图标预览。合同：[`theme/editor.md`](../../../../../docs/specs/theme/editor.md) 输出 21、验收 21。计划：[plan.md](plan.md)。

## 决定

- 2026-11-06 开发者：做。目录取自页面里已加载样式表的 `.i-lucide-<名>` 规则（计划初稿写的是构建期扫源码，设计审查后改成这个：它就是产品此刻能画的图标，含插件带来的，不用新增构建步骤）。
- 设计审查（omp 第一段两条、Opus 第二段）修订：不缓存；原图标预览用行内 `--icon-url` 写默认 `--svg`，不挂 `i-lucide-<名>` 类；用 nb-ui 的 `SuggestionMenu`，候选不画预览；DOM 部分在 Chromium e2e 里测（happy-dom 解析样式表会丢 `@layer`）；开发服务与 e2e 外壳的目录比产品多出 Lab 里的图标，提示措辞只说“当前页面没有”。

## 完成情况

- `web/icon-catalog.ts`（纯数据：`parseIconSelector`、`matchIcons`）与 `web/icon-scan.ts`（DOM：递归遍历 `cssRules`、只认带 `--svg` 的规则、分组选择器、同名取第一条、跳过主题自己的覆盖表、读不了的样式表计数）。
- `ThemeEditorIcons.vue`：combobox 补全（`SuggestionMenu`，回车只在选过候选时填入，输入法组字不处理，Escape 与方向键重开）、未知名的非阻断提示（菜单开着或目录不全时不出现）、已覆盖行旁调淡的原图标预览；两份语言包与测试表、组件文档同步。
- 测试：`icon-catalog.test.ts`（纯数据）；`theme-editor.e2e` 新用例（真实 Chromium：候选含 `folder-plus` 与别名 `loader-2`、`loader-circle`，键盘语义，未知名提示，覆盖后原图标与覆盖图的 `mask-image` 不同，只存在于覆盖表里的名字不进候选）；“复制书房”用例收窄了选择器并断言工作态图一并复制。变异检查：不跳过覆盖表、回车总选第一项，e2e 都会失败。
- 验证：`workbench` 单测 476 通过；`theme-editor.e2e` 全文件通过；类型检查通过（别的会话的既有错误除外）；治理检查无失败。
- 实现审查：Sonnet（前端），1 条重要 7 条建议，全部已改，[报告](evidences/impl-review-frontend.txt)、[处理](evidences/impl-review-disposition.txt)。设计审查证据在 [t13 的 evidences](../t13-scene-provider-title/evidences/)。
- 提交：`b99dbf727`、`b765897f2`、修正 `0a849b863`，合入 `dc29250a2`、`30b72bc67`；Spec `706b6c734` 及后续。

## 下一步

无。
