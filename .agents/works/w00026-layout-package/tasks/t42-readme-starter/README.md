---
schema: nbook.task/v2
taskId: t42-readme-starter
status: active
updated: 2026-11-19
---

# nb-layout 的 README 起步与三份短文档

## 目标与范围

按提案第一档第 5 项（从 t39 拆出）：README 写成复制能跑的五件事例子、我要做 X 用哪个导出的表、目前只在源码里的约定；useGridLayout（或 useGridHost）、useLayoutExtent、createDragSession 各一份短 .md；排在 t39 到 t41 的形状定了之后

合同：行为合同未变，只改文档与一个 Lab 场景；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的实现合同加上 README 与新的短文档。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)）。只改文档：按“按任务大小降级”不做设计审查，实现审查（Claude Sonnet，按文档审）兜底。

## 实施记录

worktree `w00026-t42-readme`（分支 `w00026/t42-readme`）：

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `34df7c4e0` | README：定位、起步例子（与 Lab 的 `starter` 场景同一份，`readme.test.ts` 核对）、导出对照表、约定；`lab-grid-structure.e2e.ts` 加“起步例子” |
| 2 | `c6800919e` | `useGridHost.md`、`useLayoutExtent.md`、`drag-session.md`；`NestedGrid.md` 的“接入”改成链接，只留组件这一侧的几条 |
| 3 | 进行中 | `NestedGrid.md`、`grid.md` 去掉“输出 N”（派 Claude Sonnet 做文案迁移，我审 diff） |

验证：

- `readme.test.ts` 通过；把 README 例子改一个字会红。
- 应用类型检查通过（场景能编译）；“起步例子”e2e 通过（拖宽、拆分、收起与展开）。
- `docs:check` 没有本 Task 的失败。

约定逐条对照过源码：

- 恢复时解析函数返回 `{ref}` 或 `null`：`grid-types.ts` 的 `GridRefResolution`、`GridRefResolver`；
- 层数与节点数的上限：`grid.ts:211、214`；
- 焦点只停在叶里能聚焦的元素上：`vue/grid-focus.ts` 的 `focusablesIn`；
- 拖动会话跳过反馈元素：`vue/drag-session.ts:79` 的 `FEEDBACK_SELECTOR`。

## 下一步

1. 开 worktree，按三片实施。
