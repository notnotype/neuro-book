---
schema: nbook.task/v2
taskId: t14-splitter-migration
status: done
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

## 实施记录

worktree `w00026-t14-splitter`（分支 `w00026/t14-splitter`）。基线（起点 `caed94657`）：开发者面板类型检查通过、测试 490 条、网页产物 1,489,299 字节；nb-story 类型检查通过、单元测试 669 条、e2e 56 条、网页产物 2,767,354 字节；`release:check` 通过；探针一组。

| 片 | 提交 | 内容 | 验证 |
|---|---|---|---|
| 1 | `a423e8cc8` | 开发者面板改用 nb-layout 的 `Splitter`；编进网页的工作区包收成 `build.ts` 的 `PANEL_SOURCE_PACKAGES`（nb-ui、nb-layout），构建哈希与“代码已更新”的 `CODE_PATHS` 都从它生成；补测试；`panel.md` 四处 | 类型检查；测试 491 条；构建通过，产物 1,503,144 字节（多 0.9%） |
| 2 | `e978d88e8` | nb-story 改用 nb-layout 的 `Splitter`，nb-layout 是 devDependency（`workspace:*`） | 类型检查；单元测试 669 条；e2e 56 条；网页产物 2,785,455 字节（多 0.7%）；`release:check` 通过；探针改前改后对照（[`evidences/probe.txt`](evidences/probe.txt)）：只有收到 0 的一侧不画接缝；打包安装冒烟通过（提交之后跑：冒烟要求工作树干净，第一次在提交前跑被门禁拒了），nb-story 装出来不带 nb-ui、vue、typescript |
| 3 | `0f564f866` | 删掉 nb-ui 冻结的那一套（编码子代理，Claude Sonnet，[报告](evidences/slice3-report.txt)）：19 个文件，比清单多一个 `useLayoutExtent.ts`（只被冻结的那一份用、依赖被删的类型）；导出、`splitter` 文案键、playground 的那一页、几处测试与 Lab 源；`migration-0.4.md` 加“0.4 之后：`Splitter` 移到 nb-layout”（我审 diff 时改准了两处：两个只给内嵌网格用的属性没了、接缝不画；nb-layout 还没发布到 npm） | nb-ui 类型检查、559 条测试；nb-agent-ui、nb-form、nb-markdown、开发者面板、nb-story、应用的类型检查；应用 SDK 两份测试 17 过 1 挂，挂的是 master 上原有的 `ImagePreviewDialog` 不在 SDK 组件清单里；文档检查通过 |
| 4 | `717b1b171` | nb-layout 的 `Splitter.md` 去掉已删的 `sashLineEnds`；nb-layout 的 `AGENTS.md` 写明两个宿主在用、改时怎么验；应用 SDK 测试两句过时的注释 | nb-layout 的 `readme.test.ts`、`exports.test.ts` |

## 实现审查

Claude Sonnet（`claude -p`），一轮，5 条，都是建议（阻断 0、重要 0）（[`evidences/impl-review.txt`](evidences/impl-review.txt)）。审查者核过删得干净、`useLayoutExtent.ts` 删得对、发布路径与测试支持包同一条。都成立，修正在合入前的最后一个提交：

| # | 发现 | 处理 |
|---|---|---|
| 1 | 依赖方向的清单没加 nb-layout：nb-story 的 `AGENTS.md`、Spec `story/viewer` 的“owner 与依赖方向”、开发者面板的 `AGENTS.md` | 三处都加上（Spec 在主工作区改） |
| 2 | 迁移说明说“只有两处不同”，漏了读屏文字的来源与 `splitter.*` 键、收起被拒绝、禁用时按键无效 | 改成逐条列出，写明 `LAYOUT_TEXT_KEY` 怎么接 |
| 3 | 构建输入的清单靠手写，测试只钉住“清单里现在有谁” | 加一条测试：扫网页源码导入的 `@notnotype/*` 包，都要在 `PANEL_SOURCE_PACKAGES` 里。变异（拿掉 nb-layout）时两条测试都红 |
| 4 | `tokens.css` 的注释指向的文档已不含那句话 | 改指 `NestedGrid.md` |
| 5 | playground 验收定义的头注释语句不通 | 不写数量 |

修正后：开发者面板的类型检查、`panel-server.test.ts` 25 条，文档检查通过。

## 合入

master 并进分支（`dd4b01ea6`，master 那边只有文档提交），master 快进到它，2026-11-19 合入；主工作区跑过 `bun install`；worktree 与分支已删。`docs/modules/monorepo-boundaries.md` 与 Spec `story/viewer` 的那两句随记录一起提交。

合入后复核（advisor 指出发布证据早于删除）：在 master `6ec147a1f`（含删除）的干净 detached 检出上重跑，`release:check`、打包安装冒烟、开发者面板的 `web-build.test.ts`、nb-ui playground 的 `checkbox.spec.ts`（走改过的验收页路由）都过。旧应用导入已不存在的 `@notnotype/nb-ui/layout` 的文件自己数过是 39 个（nb-ui 的 `exports` 里没有 `./layout`）。t32 的组件文档 `WorkbenchShell.md` 补写并成一行的入口菜单（`16d4d700c`）。

## 结论

完成：nb-story 与开发者面板的分栏都用 nb-layout 的 `Splitter`，nb-ui 里冻结的那一套删掉了（5630 行）。待开发者知悉或追认的，见待确认清单 t14 的四行：删除连带旧应用一处导入失效；收到 0 的一侧不画接缝（开发者面板的收起态没看过图）；已发布的 nb-ui 拿掉公开导出，下次发布升小版本；发布门禁不盯 nb-layout 的目录。合入后要开发者重启面板服务，面板才用上新代码。
