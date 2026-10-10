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
- 2026-10-10 S1+S2（`5c4a5f19`）：
  - **入口与索引**：nb-ui 公开入口 `@notnotype/nb-ui/lab-sources`；组件索引并入 nb-ui，组件名全局唯一（重名只收路径在前的一个并提示）。
  - **场景**：75 个 nb-ui 组件的场景，按 nb-ui 分类放在 `fixtures/nb-ui/`。
    - 透传登记加了 `slotPresets` 与 `rootless`；
    - Dialog、DialogWindow、ContextMenu 手写夹具；
    - 日期组件当非受控用；`Table` 用实例化表达式按行类型检查；
    - `GridRenderer` 标 `验证入口: WorkbenchShellLayout`。
  - **截图检查**：`lab:shot` 扫了全部组件，组合为手机与 1400×900、深浅配色，共 980 张。
    - 页面问题 36 张，都是根为传送门或片段的组件接不住 `data-lab-subject`，已修；
    - 越界报告多为测量误报（读屏播报区、视觉隐藏的 input），Lab 的测量改为跳过看不见的元素，e2e 补了用例；
    - 真实问题只有 Collapsible：内容区向外扩 6px，在贴边容器里造成 6px 横向溢出。这是保护焦点光环的设计取舍，写进组件文档。
  - **验证**：nb-ui 与 neuro-book 的 typecheck、`build` 与 `check:dist`、Lab 的 Bun 37 例、Vitest 27 例、e2e `lab.e2e.ts` 与 `lab-shot.e2e.ts` 11 例，全部通过。变异 6 个全杀。
- 2026-10-10 计划审查（omp 一个会话，报告 [evidences/design-review.txt](evidences/design-review.txt)）：14 条问题、7 条补充，全部核实成立。
  - **并入 t73 计划**：P01–P06、F01–F03，包括：
    - 恢复默认改为写空对象；
    - 偏好的界面状态表；
    - 地址栏由 Router 维护；
    - 迁移对照表与遍历全部场景的 e2e；
    - 双窗口并发写的验收；
    - `check:dist` 识别 `lab-sources`。
  - **写进后续 Task**：P07–P09、F04–F05 写进 t74 README；P10–P14、F06–F07 写进书架页提案。

