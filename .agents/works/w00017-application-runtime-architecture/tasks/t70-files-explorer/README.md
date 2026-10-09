---
schema: nbook.task/v2
taskId: t70-files-explorer
---

# NeuroBook v2 Files 竖切三：资源管理器视图

## 目标与范围

第 6 步 Files 竖切的第三片（分解见 [t68 的计划](../t68-files-resource-layer/plan.md#第-6-步分解)）：主页面侧栏的资源管理器视图。两个根（项目、用户资产）按需展开与增量刷新，大目录虚拟滚动，三类文件夹的呈现，选择与键盘，右键菜单与视图工具栏，新建、改名、删除、创建内容、转换、展示名与清单修正，窗口内文件剪贴板，树内拖动移动与内容文件夹里的拖动排序，碰撞时改名、跳过或取消，逐项结果的反馈。打开文件执行 `nbook.editor.open`（编辑器区随 t71）；dirty 文档的复制、移动与删除结算随 t71。

实施计划：[plan.md](plan.md)。

行为合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md)（本 Task 修订其中本片实现的部分）、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“文件操作”、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

Files 竖切二 [t69](../t69-files-operations/README.md)。

## 当前状态

- 2026-10-09 计划起草；三个 omp 计划审查（设计与 Spec、界面与无障碍、可实现性与测试）的 28 条发现已并入计划，取舍记入待确认清单。
- 2026-10-09 S0 Spec 修订（files-explorer 新增“新应用的插件、命令与界面”一节与验收 14–16；commands 加 `files` 域与资源管理器命令目录）。
- 2026-10-09 S1 树模型（目录槽、失效规则、投影、选择与按键）与控制器的浏览部分；测试窗口的链路可记录请求、扣住回复与推迟发送（`files/testing/tap.ts`）。31 个用例，变异 28 个杀死 27 个；存活的“作废目录不删缓存”与“事件同时标脏目录自身”等价（被作废的目录总会因自身事件重列）。
