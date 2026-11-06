---
schema: nbook.task/v2
taskId: t12-theme-editor-assets
status: planned
updated: 2026-11-06
---

# 主题编辑器补图标集、工作态场景与场景提供者

## 目标与范围

t06 给主题声明加了图标集（`Look.icons`）、工作态场景（`Look.workingScene`）和场景提供者（`sceneProvider`），编辑器还不能编辑它们，“我的主题”也因为没有素材管线不收前两项。本 Task 补齐：用户层的 SVG 图标素材与第二张场景图的素材管线，编辑器的“图标”分区与“场景与取景”分区的新编辑项，复制、导出、导入对这三项的支持。

合同：[`theme.editor`](../../../../../docs/specs/theme/editor.md)、[`theme.skins`](../../../../../docs/specs/theme/skins.md) 的边界与兼容（设计审查后改 Spec）。计划：[plan.md](plan.md)。

## 开发者的决定

1. （2026-11-06）`/autonomous-delivery`：补齐这三项的编辑能力，含用户层素材管线（SVG 与第二张场景图）的取舍。取舍记在 [pending-confirmations.md](../../pending-confirmations.md)。

## 当前状态

已合入 master（分支 `feat/w00041-t12-theme-editor-assets`，不 push）。

- **素材管线**：`PUT /api/nbook.files/theme-icons` 收 SVG 图标（严格词法状态机检查：元素与属性白名单、至多 16 KiB，单引号与双引号都收，因为打包器内联内置图标时用单引号），文件名 `<sha256>.svg`，与位图同在 `user://theme-assets/`；场景路由仍拒绝 SVG。“我的主题”持有 `icons` 与 `workingScene`（`forUserLayer` 删除，t06 的降级撤销）。
- **编辑器**：“场景与取景”分区加工作态场景、场景提供者下拉、预览状态；新增“图标”分区；复制插件主题、导出、导入都带这三项（素材先传完再写主题，主题记录原子、素材写入不回滚）；包文件数上限 64 改 300。
- **设计审查**：omp 12 条（阻断 1、重要 9、建议 2），全部并入计划，见 [evidences/design-review-disposition.txt](evidences/design-review-disposition.txt)。**实现审查**：后端 omp 4 条、前端 Sonnet 18 条，处理见 [evidences/impl-review-disposition.txt](evidences/impl-review-disposition.txt)；处理后没有再开第二轮。
- **e2e 发现的真问题**：书房的内置图标在生产构建里被打包器内联成单引号的 data 地址，第一版检查器只收双引号，复制书房时被路由拒绝；单元测试读的是源文件，没抓到。已改检查器并补单引号用例，复制书房的 e2e 用真实内置素材覆盖。
- **验证**：neuro-book 的 workbench、files、lab、plugin-sdk 单测通过（bun test 801 个；vitest 的 workbench 与 lab 里只有 `AgentCompactionDetail` 缺 Lab 场景一条失败，在 master 上同样存在，与本 Task 无关）；typecheck、governance:check、docs:check 无失败；`theme-editor.e2e` 24 个全过，`plugin-code.e2e` 新增的提供者下拉用例与 `themes.e2e` 通过（书房 light 可读性在整批里偶发超时，单独跑通过，已知）；SVG 检查器做了变异检查（去掉任一条规则都有用例变红）。Lab 夹具截图看过（场景、图标，手机与 1400 宽）。
- **未验证的边界**：真实 Agent 运行时下“跟随”状态切到工作中（沿用 t06 的 e2e 覆盖）；SVG 白名单只能靠反例集验证，不是形式化证明（兜底是 CSS mask 的静态模式与 raw 路由的 `sandbox`，后者只限制脚本，不限制资源加载）。

## 下一步

无。待开发者追认的决定见 [pending-confirmations.md](../../pending-confirmations.md) 的 t12 各行。
