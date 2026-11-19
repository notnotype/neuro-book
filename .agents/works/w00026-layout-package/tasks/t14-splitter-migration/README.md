---
schema: nbook.task/v2
taskId: t14-splitter-migration
status: active
updated: 2026-11-19
---

# 迁移 nb-story、dev-panel 到 nb-layout

## 目标与范围

把 nb-story、dev-panel 的 Splitter 改用 nb-layout，然后删掉 nb-ui 里冻结的 Splitter 与分隔线核心（t04 留下的那一份）。开发者同意用子代理做，不急。（2026-11-05 写的“发布依赖从 8 个包变成 9 个、要写新 ADR”核实后不成立，见“当前状态”；删 nb-ui 那一份这次不做，见待确认清单。）

合同：行为合同未变（没有 Spec 写两个宿主用哪个包的分栏）；看得见的一处变化（收到 0 的一侧不画接缝）记进[待确认清单](../../pending-confirmations.md)。

## 当前状态

2026-11-05 经 nbdev 新建。开发者 2026-11-06：这一轮先不做；2026-11-19 的推进顺序把它排在第一档最后（t37 → t32 → t14）。

2026-11-19 开工前核实（写计划之前）：

- **发布前提与目标里那句不符**：nb-story 只给网页用的工作区包都在 devDependencies，网页在打包前构建进包里（ADR 0029 决策 3）；发布清单检查（`scripts/release/packages.ts`）明写 devDependencies 可以引用不发布的工作区包。所以 nb-layout 做 nb-story 的 devDependency 就够，不用发布、不用新 ADR。“从 8 个包变成 9 个”是 2026-11-05 的估计，已过时。实施时用 `release:check` 与打包安装冒烟（`release:smoke`）确认一次。
- **删 nb-ui 那一份被旧应用挡住**：旧应用的 Component Lab 夹具 `packages/neuro-book-legacy/app/component-lab/fixtures/WorkbenchPanelSurfaceFixture.vue` 从 `@notnotype/nb-ui/components` 导入 `Splitter`。旧应用只读、不在里面改代码，所以这一片做不了，交开发者定：改旧应用那一行，或等旧应用退役再删。迁移照做。
- **文字与样式不用补接**：nb-story 与开发者面板都没给 nb-ui 注入文字，用的是自带的中文；nb-layout 没有注入时同样用自带的中文目录。nb-layout 的 Splitter 用组件自带的样式，不靠宿主的 Tailwind 扫描；它读的 `--nb-layout-*` 由 nb-ui 的 `tokens.css` 接到主题的名字上（nb-layout README 的“主题”）。
- **两份 Splitter 自 t04 起有约 560 行差异**：逐项比对见 [`evidences/drift.txt`](evidences/drift.txt)（Claude Sonnet，只读）。三处使用方的模板与逻辑不用改，只改导入、依赖声明与注释；看得见的只有收到 0 的一侧不画接缝。

## 下一步

计划第 1 稿（[`plan.md`](plan.md)），设计审查（Claude Sonnet，阻塞）。审查处理完先跑基线，再按切片实施。
