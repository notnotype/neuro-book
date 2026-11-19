---
schema: nbook.task/v2
taskId: t38-grid-diagnostics
status: planned
updated: 2026-11-19
---

# 诊断的形状、码与只发新增

## 目标与范围

按提案第一档第 2 项的诊断一半：nb-layout（L0、L1）的诊断从中文字符串改成 `{code, message, params?}`，`message` 是库内的英文；通知宿主时只发新增。t34 拆出来的部分，先定合同再写计划。

合同：布局行为不变，诊断的形状、码与通知方式改变：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的诊断条目（输出 68 与新增条目）。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“错误与诊断一种形状”与决策记录、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 来源

t34 计划第 3 稿（`bd652653e` 的 [`plan.md`](../t34-unified-errors/plan.md)）把失败与诊断放在一起，三轮设计审查后失败的形状收敛了、诊断没有。开发者 2026-11-19 同意拆开：t34 只做失败的形状，诊断在本 Task 重新设计（[t34 README](../t34-unified-errors/README.md)）。

起点材料（都在 t34 的目录里）：

- 第 3 稿的“L0、L1 诊断”一节：诊断码表（`over-constrained` 的几个 `cause`、`unabsorbed-space`、`conflicting-bounds`、`no-collapse-policy`、`no-room-to-collapse`、`no-room-to-restore`、`swap-skipped`）、两个出口（`NestedGrid` 的 `issues` 事件、`useGridLayout` 的 `onIssues`）、“结果里逐条，通知时只发新增”、删 `SashGestureScope.issues` 改成 `onIssues` 回调、`allocateSashPanels` 的 `context` 改范围参数、`grid-swap` 的 `skip` 带诊断。
- 第三轮审查（[`evidences/design-review-r3.txt`](../t34-unified-errors/evidences/design-review-r3.txt)）里没解决、归本 Task 的：
  1. 同键合成后 `branch` 与度量只对应第一条、`ids` 却是并集，对不上；
  2. `flush` 里通知宿主时抛出，`finish` 不跑，手势卡住（第 3 稿只处理了 `finish` 里那一处）；
  4. `ids` 是字符串数组，宿主照 `ui/i18n` 把 `params` 交给翻译端口时类型不合、数组被丢；
  8. 诊断表几处 `ids` 的定义不准（`fixed-overflow`、`range-overflow`）；`allocateSashPanels` 的“内部范围参数”其实是公开函数的参数；
  9. `no-collapse-policy`、`no-room-to-restore`（194）在产品里发不到宿主；
  10. 通知是边沿、不是状态，合同里要告诉宿主“当前状态读 `layout.issues`”；
  11. `useGridLayout` 清空键集的两个触发条件怎么实现（记上一次的 `contextKey`；`grid` 换实例不清空要写明）；
  12. 失败码与诊断码不相交的类型级测试要覆盖事件里并存的整个并集（`not-published`、`notify-failed` 给一个命名联合）。
- 第三轮已核实、可以沿用的：诊断表的位置与 `cause` 划分和代码一一对应；窄窗口逐像素重算、同一场拖动只通知一次、`not-published` 改写这几条用例能用现有 harness 写出来。

## 继承的约束

- **诊断码不复用失败码**：t34 定下的失败码（L0 结构操作、快照恢复、L1 提交）与本 Task 的诊断码不相交：同一个码不会一会儿是“提交被拒、已回滚”，一会儿是“求解降级、没回滚”。第 3 稿因此把“没有收起策略”的诊断改名 `no-collapse-policy`，不与失败码 `not-collapsible` 同名。
- 诊断与失败同形：t34 的 `GridFailure` 是 `{ok: false, code, message, params?}`，诊断是去掉 `ok` 的同一个形状；`params` 的值类型 t34 只用了字符串与数字（对齐 `ui/i18n` 的 `TextRef.params`），诊断要不要数组在本 Task 定（上面第 4 条）。
- 提交被拒今天经诊断字符串发出（`useSashGesture.ts` 的“本次调整没有落账：…”，t34 之后后半句是英文的 `message`）；没接 `onGestureCommit` 时发两条（`NestedGrid.vue` 直接发一条，`useSashGesture` 又发一条）。改成“一个失败一条、码就是失败的码”在本 Task 做。

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。排在 t34 之后、t35 之前（[Work README](../../README.md)）。

## 下一步

1. t34 合入后开工：先写“结果是状态快照、通知只发边沿”的合同（Spec 条目草稿），再写计划。
2. 计划与设计审查按 autonomous-delivery。
