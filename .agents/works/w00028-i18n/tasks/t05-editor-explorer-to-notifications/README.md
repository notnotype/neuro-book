---
schema: nbook.task/v2
taskId: t05-editor-explorer-to-notifications
status: planned
updated: 2026-11-07
---

# 编辑器与资源管理器的失败与状态改走通知

## 目标与范围

2026-11-07 从 [t04](../t04-failure-details/README.md) 的设计评审（评审板第 2、3 轮）拆出：开发者指出编辑器顶部“文件没有保存”横幅整行占了画面，并要求统一“报错/通知”这一套，外部改动、冲突这类状态也一并统一。t04 做载体（通知的动作行、详情对话框、堆叠上限），本 Task 把使用方迁过去：

- **编辑器**（`packages/neuro-book/src/plugins/editor/web/components/EditorGroup.vue` 的 `banner`）：去掉顶部横幅行。保存失败、文件被外部改动、编辑冲突、文件被删除、格式无法表示、未决状态、会话结束都改成与文档状态绑定的常驻通知（带原横幅上的动作：重载、覆盖、采用当前、保留视图、定位），状态消失时通知跟着移除，切换与关闭标签时随文档增减；标签上“保存失败”换警告图标，“有改动未保存”仍是小圆点。
- **资源管理器**（`explorer/web/components/ExplorerFeedback.vue`）：单行的 `notice` 改发通知；批量进行中、逐项结果、结果未知（要重查或放弃）这几块带持续状态与列表，是否一并迁，开工时按它们的形状定。
- **外部改动与冲突的解决方式**：开发者提到“diff 解决”。现在只有“重载”“覆盖”两个动作；改成按差异逐块解决是新功能，要先做设计（评审板），不在本 Task 默认范围内，开工时与开发者再确认。
- 失败原因里的开发诊断原文走 t04 的详情载体；原文由谁产出（错误码与参数）属于 [w00031 t03](../../../w00031-language-policy/tasks/t03-failure-projection/README.md)。

依据：[t04 README 的设计决定](../t04-failure-details/README.md)、评审板截图 `editor-failure`、`explorer-failure`。

合同：改 [`workbench/notifications.md`](../../../../docs/specs/workbench/notifications.md) 的发出方分工、编辑器与资源管理器相关 Spec（开工时补全清单）。

t04 计划审查留给本 Task 的：通知去重与按键更新（状态消失时按键移除或更新同一条，避免重试循环里常驻通知堆积）、“全部关闭”；这三样要和“与文档状态绑定的通知”一起设计。

## 当前状态

2026-11-07 建，未开工；依赖 t04 先交付通知载体。

## 下一步

t04 合入后写计划：先读 `EditorGroup.vue` 的横幅状态来源与资源管理器 `feedback` 的状态机，再决定“与文档状态绑定的通知”的服务形状（可能需要通知服务支持按键更新或去重）。
