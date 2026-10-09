---
schema: nbook.task/v2
taskId: t72-files-performance
---

# NeuroBook v2 Files 竖切五：性能验收

## 目标与范围

第 6 步 Files 竖切的最后一片（分解见 [t68 的计划](../t68-files-resource-layer/plan.md#第-6-步分解)）：在生产构建、参考机器的本机浏览器上，用约 3000 个文件的隔离项目逐项测资源管理器与编辑器区的性能标准，按测量修正，给出可复现的测量脚本与证据。

实施计划：[plan.md](plan.md)。

行为合同：[`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的“打开与切换”（性能标准表）与验收 12；行为合同未变，测量发现的标准不可达项交开发者决定。

## 前置

Files 竖切四 [t71](../t71-editor-area/README.md)。

## 当前状态

- 2026-10-09 计划起草；三个 omp 计划审查（测量方法、产品性能结构、可实施性）共 39 条发现（阻断 4 条：300 文件样本生成不了、样本没有源码文件、同一浏览器上下文共享客户端身份会恢复会话、Bun 跑 Playwright 会卡），全部核实成立并入计划，报告见 `evidences/plan-review-*.txt`，取舍记入待确认清单。
