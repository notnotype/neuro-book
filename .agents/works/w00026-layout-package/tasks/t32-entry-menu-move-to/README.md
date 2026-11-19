---
schema: nbook.task/v2
taskId: t32-entry-menu-move-to
status: done
updated: 2026-11-19
---

# 入口右键菜单的“移到”另外两个区域

## 目标与范围

补 ui/workbench-layout 输出 44 里还标着 planned 的“移到”菜单项：侧栏入口“移到右栏”“移到底部面板”，右栏、底部面板的入口对应另外两个区域；底层 moveContainerTo 已有（拖入口已经能搬整个容器，输出 46），只差菜单项、文案与测试；做完去掉输出 44 的两处标记

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 44 的两处 planned，做完去掉标记；搬法沿用输出 46，不改。实现审查后另改了输出 47 的一句（底部面板并成一行的入口，见“实现审查”）。

## 当前状态

2026-11-19 完成。计划第 1 稿（[`plan.md`](plan.md)）。照现成的“重置”菜单项加两项、底层操作已有：按“按任务大小降级”不做设计审查，实现审查（Claude Sonnet）兜底。

## 实施记录

worktree `w00026-t32-move-to`（分支 `w00026/t32-move-to`）：

| 提交 | 内容 | 验证 |
|---|---|---|
| `0aaa55f6e` | `containers.ts` 的 `containerMoveTargets`；`WorkbenchShell.vue` 的容器菜单先列“移到”两项再列“重置”；文案 `viewContainers.moveTo`；组件文档；`workbench-views.e2e.ts:682` 的“重置”用例改用“移到”造状态（不再改数据库记录），新增“移到”的用例 | 类型检查；`containers.test.ts`、`locales.test.ts`；两条 e2e |
| `20bf6b67f` | 实现审查的处理（见下） | 类型检查；单元测试 35 条；e2e：`workbench-views.e2e.ts:682`、`:733`，`workbench-containers.e2e.ts` 整个文件，共 37 条全过 |

## 实现审查

Claude Sonnet（`claude -p`），一轮，6 条：重要 1、建议 5（[`evidences/impl-review.txt`](evidences/impl-review.txt)）。

| # | 发现 | 处理 |
|---|---|---|
| 1 | “移到底部面板”之后单节的容器并进入口条，右键只开视图的“移动到”，整容器搬不出来；搬出去还会变成用户容器、再没有“重置” | 成立，产品取舍，按推荐做并记进[待确认清单](../../pending-confirmations.md)：并成一行时视图菜单末尾接上容器的“移到”；“重置”不接（容器只有这一节，就是视图的“重置位置”）；视图不让移动时开容器的菜单。Spec 输出 44、47 照此改 |
| 2 | 选“移到”之后焦点落在哪没有断言 | 成立。三处“移到”之后都断言焦点：右栏入口条、活动栏、底部面板入口条上这个容器的入口 |
| 3 | “入口排在最后”的断言在功能坏掉时仍会过（第一次进入的容器本来就被归整到最后） | 成立。用例改成：甲进底部面板、乙进来排在后面、甲回侧栏再进来一次，断言甲排到乙后面 |
| 4 | `MENU_REGIONS` 重复了 `VIEW_LOCATIONS` | 成立，改用 `VIEW_LOCATIONS` |
| 5 | 几处注释停在旧行为 | 成立，改写 |
| 6 | 菜单动作不看 `moveContainer` 的 `LayoutResult` | 原有做法（“重置”就这样），几乎不会失败，不改 |

## 合入与晋升

master 并进分支后（`390b50d35`）在合并后的状态上重跑：类型检查、单元测试 35 条、e2e 37 条全过。master 快进到它，2026-11-19 合入；worktree 与分支已删。

Spec `ui/workbench-layout`：输出 44 去掉两处 planned，删掉“现在拖入口……已经能搬整个容器”那半句，写上“移到”排在最前、选完焦点去新区域里的入口、并成一行的入口见输出 47；输出 47 写上并成一行时视图菜单末尾接容器的“移到”。

## 结论

完成：入口右键菜单有了“移到”另外两个区域，整个容器搬过去；底部面板并成一行的入口也能整容器搬出来。待开发者追认一条（并成一行时的菜单），见待确认清单。
