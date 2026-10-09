---
schema: nbook.task/v2
taskId: t69-files-operations
---

# NeuroBook v2 Files 竖切二：文件操作

## 目标与范围

第 6 步 Files 竖切的第二片（分解见 [t68 的计划](../t68-files-resource-layer/plan.md#第-6-步分解)）：在 `nbook.files` 的两份远程合同上加文件操作：新建文件与文件夹、创建内容（排他创建空白 `index.md`）、改名、移动、复制、删除；批量的逐项结果、无覆盖冲突、父子去重、取消与停止条件；内容文件夹内的操作同步清单，调整顺序、改展示名与普通文件夹和内容文件夹的转换只改清单与后缀；经文件服务的操作发出精确的新建、改名、删除事件。资源管理器视图（t70）调用这些操作，本 Task 没有界面。

实施计划：[plan.md](plan.md)。

行为合同：[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)（本 Task 修订其中本片实现的部分）。

## 前置

Files 竖切一 [t68](../t68-files-resource-layer/README.md)。

## 当前状态

- 2026-10-09 计划起草，交三个 omp 审查（[设计与旧行为](evidences/plan-review-design.txt)、[运行时与边界](evidences/plan-review-runtime.txt)、[可实现性与测试](evidences/plan-review-tests.txt)，共 31 条），全部并入计划：源身份令牌、批量停止接内核信号、RPC 字节预算、内容树操作锁、部分完成的结果形状、复制与删除的失败政策、回声按目录项身份。取舍记入待确认清单。
- 下一步：S0 修订 Spec。
