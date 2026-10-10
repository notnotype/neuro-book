---
schema: nbook.task/v2
taskId: t73-lab-nb-ui-and-storage
---

# 完善新 Lab：nb-ui 进 Lab、偏好改存 Storage

## 目标与范围

开发者 2026-10-10 决定第 6 步之后先做 workbench 与 Lab，Lab 在前：

- nb-ui 的基础组件进入新应用的 Lab 组件索引，每个可挂载组件都有场景；
- Lab 不再用 localStorage 与 sessionStorage：界面偏好改存 `nbook.storage`，标签页内的状态放进地址栏；
- 迁移中可以顺带排错、优化与调整样式。

实施计划：[plan.md](plan.md)。

行为合同：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)；Storage 的记录规则见 [`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)，store 见 [`state/store.md`](../../../../../docs/specs/state/store.md)。

## 前置

第 6 步 Files 竖切 t68–t72 已完成。

## 当前状态

- 2026-10-10 调研完成，计划起草；开发者同意计划与三个待定项的推荐，并要求 omp 审查计划、补充遗漏的细节与更有用的功能，处理后实施 t73–t75。
