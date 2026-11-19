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

## 设计审查

Claude Sonnet（`claude -p`），一轮，7 条：重要 2、建议 5（[`evidences/design-review.txt`](evidences/design-review.txt)）。都成立，改成计划第 2 稿：

| # | 发现 | 处理 |
|---|---|---|
| 1 | 开发者面板的构建哈希与“代码已更新”的判据只认 nb-ui，迁移后改 nb-layout 不会重建、不会提示 | 第 1 片把 `packages/nb-layout` 加进 `computeBuildHash` 与 `CODE_PATHS`，补测试，改 `panel.md` |
| 2 | 验收挂空：nb-story 的 e2e 与发布冒烟都不拖、不按分隔线，换错了也会过 | 探针加真操作，改前改后对照：拖窄、拖到 0、从 0 拖开（读偏好里的宽度），Home、End、Enter（读读屏属性），减少动效 |
| 3 | 唯一看得见的变化落在不截图的开发者面板上 | 想起一份只读的面板实例截收起态：面板锁按主工作区取，起不了第二份。如实记为没看过，待确认那一行补上收起态与第一帧的时机 |
| 4 | 迁移后还写着“只给两个宿主用”的文档没列全 | 第 1、4 片一并改：`panel.md` 两处、`monorepo-boundaries.md`、nb-layout 的 `AGENTS.md`；nb-ui 的 README 与 `Splitter.md` 随第 3 片删改 |
| 5 | 删除延后的理由站不住：旧应用对 nb-ui 已有 39 个文件导入失效 | 改判：删除放回本 Task（第 3 片）；删 nb-ui 的文件不改旧应用的文件。待确认清单那一行改写 |
| 6 | 删除清单漏项；nb-ui 是已发布的包 | 清单补全（e2e、playground、文案键、几处测试、Lab 源）；写迁移说明，版本号记进待确认清单 |
| 7 | 发布门禁不盯 nb-layout 的目录 | 原有缺口（应用包早就如此），不在本 Task 修，记进待确认清单 |

## 下一步

基线在跑（第 1 稿时启动，审查不改基线的内容）；跑完先单独跑一遍探针的基线，再按第 2 稿的切片实施。
