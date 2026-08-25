---
schema: nbook.task/v1
taskId: 00156-issue131-plot-drag-verification
actionIssueId: 131
worktreeId: null
branchId: null
status: completed
createdAt: 2026-08-25T05:00:08Z
updatedAt: 2026-08-25T05:35:00Z
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
  verification:
    required:
      - browser
      - smoke
    notRun:
      - check: focused-test
        reason: 纯验收任务，无源码改动，无新增聚焦测试面。
      - check: typecheck
        reason: 无源码改动；主线 typecheck 基线失败由 Issue #163 独立跟踪，不属于本缺陷门禁。
      - check: build
        reason: 无源码改动；主线构建基线与 #163 同源，不作为本任务门槛。
      - check: regression-test
        reason: 行为合同未变且无新代码合同，回归以运行时浏览器证据承载。
---

# Issue 131 剧情拖拽运行时验收

## 目标

在当前 `master` 上为 [Issue #131](https://github.com/notnotype/neuro-book/issues/131) 建立可重复的剧情拖拽运行时验收：确认三个产品拖拽入口不再抛出 `AutoScroller plugin depends on Scroller plugin`，留下正式脱敏证据，并产出给 PM 的基线更正简报。

## 授权与范围

- 授权来源：开发者 2026-08-25 会话明确批准验收计划（`local://issue131-plot-drag-verification-plan.md`），授权本地自动化浏览器验收、系统临时根造数与本 Task 文档写入。
- 修复基线：提交 `8cd7d7fa`（经 PR #164 合入）移除三个产品入口的外部 `defaultPreset`；`origin/master=557d721e` 为本轮验证 revision。
- 验收范围（开发者 2026-08-25 决定）：仅 Plot 产品路径——剧情线面板、剧情工作台、TSX Profile 可视化编辑器。`app/pages/dnd.preview.vue` 的 preset 残留经产品决定不纳入本 Issue，不做修改也不做验收。

## 合同依据

- 产品行为合同未变：修复仅消除依赖副本冲突，拖拽交互合同仍由 [Plot 前端参考](../../../packages/neuro-book/assets/reference/plot/frontend.md) 与既有实现定义。
- 崩溃机理：外部 `@dnd-kit/dom` preset 的 `AutoScroller` 依赖精确 `Scroller` 类身份；Vite 依赖优化产生双副本时注册失败（见 dnd-kit dom 源码 AutoScroller 构造器）。

## 验收矩阵

| 路径 | 组件 | 断言 |
| --- | --- | --- |
| 剧情线面板 | `PlotThreadScenePanel.vue` | 指针拖拽 Scene 行换序成功，console 无目标错误 |
| 剧情工作台 | `PlotWorkbenchSceneList.vue` | 指针拖拽 Scene 卡片换序成功，console 无目标错误 |
| TSX Profile 可视化编辑器 | `ProfileTemplateVisualEditor.vue` | 组件库项拖入画布产生新节点，console 无目标错误 |

## 完成标准

- 三条路径全部通过：README 晋升 `completed`。
- 任一路径复现目标错误或 TSX Profile 编辑器 headless 不可达：README 保持 `blocked`（不得 completed），附对应红态/排除证据，交开发者决策。
- 全程不改源码；commit/push/PR/Issue 编辑等远端写动作未获授权前不执行。

## 执行记录

- 运行环境、fixture 参数与逐项结果见 [context.md](context.md) 与 `walkthroughs/`、`evidences/`。
