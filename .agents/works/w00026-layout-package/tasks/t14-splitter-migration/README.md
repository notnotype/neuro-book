---
schema: nbook.task/v2
taskId: t14-splitter-migration
status: active
updated: 2026-11-19
---

# 迁移 nb-story、dev-panel 到 nb-layout

## 目标与范围

把 nb-story、dev-panel 的 Splitter 改用 nb-layout，然后删掉 nb-ui 里冻结的 Splitter 与分隔线核心（t04 留下的那一份）。开发者同意用子代理做，不急。nb-story 的发布依赖从 8 个包变成 9 个，要写新 ADR 部分取代 ADR 0029。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-05 经 nbdev 新建。开发者 2026-11-06：这一轮先不做；2026-11-19 的推进顺序把它排在第一档最后（t37 → t32 → t14）。

2026-11-19 开工前核实（写计划之前）：

- **发布前提与目标里那句不符**：nb-story 只给网页用的工作区包都在 devDependencies，网页在打包前构建进包里（ADR 0029 决策 3）；发布清单检查（`scripts/release/packages.ts`）明写 devDependencies 可以引用不发布的工作区包。所以 nb-layout 做 nb-story 的 devDependency 就够，不用发布、不用新 ADR。“从 8 个包变成 9 个”是 2026-11-05 的估计，已过时。实施时用 `release:check` 与打包安装冒烟（`release:smoke`）确认一次。
- **删 nb-ui 那一份被旧应用挡住**：旧应用的 Component Lab 夹具 `packages/neuro-book-legacy/app/component-lab/fixtures/WorkbenchPanelSurfaceFixture.vue` 从 `@notnotype/nb-ui/components` 导入 `Splitter`。旧应用只读、不在里面改代码，所以这一片做不了，交开发者定：改旧应用那一行，或等旧应用退役再删。迁移照做。
- **文字与样式不用补接**：nb-story 与开发者面板都没给 nb-ui 注入文字，用的是自带的中文；nb-layout 没有注入时同样用自带的中文目录。nb-layout 的 Splitter 用组件自带的样式，不靠宿主的 Tailwind 扫描；它读的 `--nb-layout-*` 由 nb-ui 的 `tokens.css` 接到主题的名字上（nb-layout README 的“主题”）。
- **两份 Splitter 自 t04 起有约 560 行差异**：行为差别的逐项比对在做（Claude Sonnet，只读），写计划要用。

## 下一步

拿到比对结果后写计划第 1 稿，设计审查（Claude Sonnet，阻塞：这次要从一个已发布包的入口拿掉导出，不算简单任务）。基线先于实施：开发者面板导航与产物页、nb-story 各档的亮色截图（宽、窄、收起），每条分隔线的键盘调整与收起，开发者面板的测试单独跑一遍，nb-story 的打包冒烟。
