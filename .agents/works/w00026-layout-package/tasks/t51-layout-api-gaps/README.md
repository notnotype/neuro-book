---
schema: nbook.task/v2
taskId: t51-layout-api-gaps
status: done
updated: 2026-11-22
---

# nb-layout 补公开面：给一栏设宽度、离开的内容留到过渡结束、分隔线显示名

## 目标与范围

把第一个外部使用方（nb-story，t44、t45）撞到的 nb-layout 公开面缺口补上，做完再按新入口重写 t45 的计划。来源：t45 计划审了三轮（[t45 README](../t45-story-side-by-side-cards/README.md)），问题多来自公开面的缺口；t44 的接入记录。

## 决定

开发者 2026-11-22 在会话里定：

1. t45 “先补 nb-layout 再做”（选项“先补 nb-layout 再做（推荐）”）。
2. 三样都做（选项“做：原地增删不压固定栏（推荐）”）：
   - **原地增删不压固定栏**：`addLeaf`、`removeLeaf` 只从按比例分的兄弟里让出或吸收空间，保留像素的兄弟不动；另加一个给保留像素的节点设宽度意图的入口。现有结构操作的语义因此改变（工作台不调用它们，靠布局文档重建网格）。
   - **离开的内容由库留住**：内容项从 `contents` 里去掉后，库把它留到这次布局过渡结束，宿主不用自己维护“正在关的内容”。
   - **分隔线显示名**：分隔线的读屏名称可以用宿主给的显示名，不给时照旧用节点 id（e2e 与性能脚本按 id 匹配）。

问开发者时给的依据：t45 三轮审查的重要问题各由哪一样消掉（离开的内容管 3 条，设宽度管 3 条，显示名一条也不管、是读屏的改进）；工作台靠布局文档重建网格，第三方照 README 原地 `addLeaf` 会悄悄把固定宽度的兄弟压窄（t45 探针：导航 188 变 150）。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新增条目（planned，计划定稿时写）。

## 当前状态

2026-11-22：[计划](plan.md)第 1 稿（三样一起）的设计审查（阻断 1、重要 5、建议 4，[证据](evidences/design-review.txt)）与 API 形状审查（重要 6、建议 5，[证据](evidences/api-review.txt)）之后，拆成三个 Task：本 Task 只做分隔线的显示名（计划第 2 稿）；结构操作的语义与 `setSize` 拆到 [t52](../t52-grid-structure-semantics/README.md)；离开的内容拆到 [t53](../t53-leaving-contents/README.md)（[待确认清单](../../pending-confirmations.md)）。显示名改动小、缺省行为不变，按 reviewing 的“按任务大小降级”不再做设计审查（API 形状审查第 9 条已看过它的形状），做实现审查。

API 形状审查第 1 条（没有运行时改收起策略的入口，t45 两张时“拖不出收起”仍要它）不在开发者定的三样里，记进 t45 的输入，t45 重写计划时再定。

## 完成

2026-11-22 合入 master（`4aebbc14d`，合并提交 `161219dd0`）。`ui/nested-grid` 输出 152 去掉 planned。

- 改动：`NestedGrid` 加 `paneLabel(id)`，分隔线读屏名称的两侧用显示名，挨着分支时问分支 id，没给或空串用 id；滑出去、缩回去的分隔线并进 `sashLooks`，用离开前最后一次的名字。`Splitter` 面板配置加 `label`。文档：`NestedGrid.md`、`Splitter.md`、README 的“我要做 X”表（属性名不加反引号：表里加反引号的名字由 `readme.test.ts` 核对必须是入口导出）；应用 `CHANGELOG.md` 的 `[Unreleased]` 新增一行（插件 SDK 重导出 `NestedGrid`）。
- 验证：nb-layout `typecheck`、`test`（Bun 398 条、Vitest 含新增 3 条）；应用 `typecheck`。变异：离开的线不用记下的名字时，“滑出去的分隔线”那条变红。
- 动 `NestedGrid` 之前在分支起点跑了 e2e 基线（给 t52、t53 用）：应用 `workbench-live-drag`、`workbench-dnd`、`editor-area`、`workbench-views`、`lab-grid-structure` 166 条过 165 条，`editor-area.e2e.ts:2202`（编辑器标签并入别的组，实时布局）在起点上就失败，与已知的 2171、2207 同一类；nb-story `frame.e2e.ts` 8 条全过。
- 宿主没有采用：nb-story 在 t45 用；工作台要用时另提（它的 e2e 与性能脚本按 id 匹配）。

## 下一步

实现审查（Claude Sonnet，不阻塞）；然后 t52。
