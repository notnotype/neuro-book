---
schema: nbook.task/v2
taskId: t31-general-layout-library
status: active
updated: 2026-11-18
---

# nb-layout 做成可复用的通用布局库：提案

## 目标与范围

从 t26 拆出：开发者 2026-11-16 定 nb-layout 是可以发到 npm 的通用布局工具（丙）。写提案取代 ADR 0044 里“工作台的布局工具”的定位：通用层与工作台层的分界，布局文档那一半（区域名、活动栏与状态栏、容器）做成参数还是搬出包，拖动控制器是否进库，错误与诊断、入口、发布物；交开发者看过再做。

合同：提案阶段不改合同；提案接受后改 [`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 的 owner 与公开入口，可能新建一份通用停靠布局的 Spec。依据：开发者 2026-11-16 选丙（t26 README“开发者答第 1 件”）；第三方视角的 API 审查 `../t26-layout-deep-review/evidences/deep-review-api.txt`。

## 当前状态

2026-11-18 开工。主会话先写下自己的方案要点（主工作区 `.local/agent/works/w00026-layout-package/tasks/t31-general-layout-library/reports/my-outline.txt`）；同时派 Claude Sonnet 做独立设计（只给目标与仓库，不给主会话的方案，报告 `reports/independent-design.txt`）。两版对照后写提案 `docs/proposals/` 下的草稿，做设计审查，再交开发者看。

独立设计回来（[`evidences/independent-design.txt`](evidences/independent-design.txt)）。和主会话要点（[`evidences/main-outline.txt`](evidences/main-outline.txt)）有三处不同，都采用独立设计：

- 布局文档搬进不发布的工作区包，不做成通用停靠模型：只有一个使用方，概念还在变，发布后改不动；
- 拖动控制器不进库，库里只补两个组合函数；
- 推荐发编译产物，部分取代 ADR 0029：目标变成别的项目用之后，ADR 0029 选源码的前提“只承诺 Bun”不在了。

它还指出主会话漏掉的许可证问题（AGPL-3.0-only）。主会话的要点改作备选 A。提案草稿 `docs/proposals/nb-layout-general-library.md`，已登记进提案索引，`docs:check` 通过。按记忆里“设计稿先给开发者看”，先给开发者看要点，确认后再提交、送设计审查。

- 开发者 2026-11-18 答待定项：
  - 1 同意（布局文档搬进不发布的工作区包）；
  - 4 “可以发 MIT”；
  - 5、6 同意推荐；
  - 2 问“拖动控制器是什么”，3 问源码与编译产物的区别：在会话里解释了，即两者各指什么、为什么推荐、对使用者的区别，待答。

- 开发者答第 2 项时先问了三件：拖动控制器是不是调得最久、两种手感都靠的地方，它是否耦合应用，库的布局模型是什么。主会话核了代码后答：
  - 动画已经在库里，手感的编排在控制器里；
  - `live-drag.ts` 已经隔在 17 个回调的接口后面，几乎不耦合，`layout-drag.ts` 才是工作台的适配层；
  - 库的模型是网格树，带标签的面板与停靠是工作台的布局文档。

  推荐改成“手感引擎进库，工作台适配层留在 L2”。开发者 2026-11-18：“可以，没问题都按推荐。审查的时候记得拉远看 + 实际体验”。提案按此改好，提交 `0bf1567f5`。
- 设计审查三份，并行（Claude Sonnet，`claude -p`），报告在主工作区 `.local/agent/works/w00026-layout-package/tasks/t31-general-layout-library/reports/review/`：
  - 常规设计审查：看分界、手感引擎进库的可行性、编译产物、MIT、错误码、影响有无漏项；
  - 拉远看：只给提案；
  - 实际体验：扮演第三方 Vue 开发者，照提案的公开接口真写一个小编辑器布局并编译，在 `experience/` 目录里。

## 下一步

三份审查到齐后一起归类、改提案，再交开发者决定接受。
