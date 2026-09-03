---
schema: nbook.walkthrough/v1
taskId: t09-labshell-decomposition
sequence: 1
role: leader
status: blocked
createdAt: 2026-09-03T00:00:00Z
---

# t09 LabShell 拆分延期

## 决定

开发者决定延期 t09。延期不等于完成，也不改变 Task README 中的目标与验收；当前后续工作可以先补齐 Component Lab 合同并推进 Lab-first 组件迁移。

## 当前缺口

- `packages/neuro-book/app/component-lab/LabShell.vue` 当前约 1242 行，仍超过 `docs/standards/code/frontend.md` 的 800 行硬审查线，也没有满足本 Task 的 `<800` 行验收。
- 当前没有拆分实现、行为回归验证或完成型 walkthrough；不得把 t07、t10、t11 的功能验证当作 t09 完成证据。
- t09 延期期间，后续 Task 不得宣称 LabShell 已满足文件长度规范，也不得继续向 LabShell 增加与迁移无关的新职责。

## 恢复触发条件

以下任一条件出现时，Leader 应恢复本 Task，而不是继续延期：

1. Lab-first 组件迁移需要修改 LabShell 编排或新增其职责；
2. LabShell 文件继续增长，导致新迁移无法在不扩张该文件的前提下接入；
3. C 产品主题 clean cutover 开始前，需要调整 Lab 与产品主题宿主的共同边界；
4. 统一 Reviewer 审查开始前，本 Task 仍未满足 `<800` 行硬验收。

恢复后仍须保持 Lab 的桌面/窄屏、场景切换、侧栏、检查器、偏好和 reduced-motion 行为，补齐新增零件文档，并运行 Task README 要求的 typecheck、Component Lab smoke、相关测试、docs check 与 diff check。
