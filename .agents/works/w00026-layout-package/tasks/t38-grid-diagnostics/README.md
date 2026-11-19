---
schema: nbook.task/v2
taskId: t38-grid-diagnostics
status: active
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

2026-11-19 经 nbdev 新建、开工。计划见 [`plan.md`](plan.md)（第 2 稿）。

第 1 稿把 t34 第 3 稿的“同键合成”整个拿掉：每条诊断带它所在的节点 `id`，键是码、`cause`、轴与 `id`，参数只有标量；结果是快照，两个通知出口只发新出现的键。

第 1 稿的设计审查（第一轮，Claude Sonnet；代码按 t34 分支 `45350dd1c`）：

- 常规（[`evidences/design-review.txt`](evidences/design-review.txt)）：6 条，重要 4、建议 2，都成立，改成第 2 稿：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 键盘的 `no-collapse-policy` 与 Enter 的恢复空间不足从会话里拿不到：会话先挑有收起策略的面板，Enter 失败时诊断被 `solveSashDrag` 覆盖 | 会话不覆盖 `applyCollapse` 的诊断；`no-collapse-policy` 写明只在直接调用 `solveSashCollapse` 的结果里；键盘不管有没有预览都交通知；会话加 Bun 用例 |
  | 2 | 195 与 533 同一个分支同时发；`range-overflow` 本可以有 `id` | 195 不再单独发，533 按有没有展开的按比例分的子节点给 `cause`、受 `quiet` 约束；`SashDragInput` 加 `scope`，调用方给 `id` 与轴 |
  | 3 | 只保护了 `onIssues`，`@gesture-update`、`@gesture-cancel` 抛出照样卡住手势；`console.error` 绕过全局错误处理 | 改成控制流：先清状态后调回调、`onPointerUp` 用 `try`/`finally`，异常照常冒出；只有落账后重算的通知接住交 `reportError`；三种回调抛出各一条用例 |
  | 4 | 度量口径不自洽（`fixed-overflow` 的 `available` 比 `required` 大）、浮点尾巴、`required` 一词几义 | 每个 `cause` 写明 `available`、`required` 是什么；`fixed-overflow` 取预算；`range-overflow` 改成 `total`、`min`、`max`；参数过 `round` |
  | 5 | 键与去重在两个 Vue 文件里各写一份，没有 DOM 测不了 | L0 的 `issueKey` 与 `createIssueGate`，两个出口共用，Bun 里测 |
  | 6 | `GridLayoutResult.issues` 也经 `gesture-update` 到插件；“运行时会出错”夸大；事件元素缺判别；判据要写两半 | 公开面清单补上；变更记录写“读到错的值”；被拒的提交原样带 `ok: false`；判据两半、每个新行为变异；`swap-skipped` 的叶列表不进参数（标量放不下，`cause` 已够） |

- 拉远看（[`evidences/zoom-out.txt`](evidences/zoom-out.txt)）：5 条。
  - 第 1、3 条质疑“通知只发边沿”本身：今天没有消费者，建议只留快照与事件型通知、每帧原样交本批，键怎么取由宿主定。这碰到开发者同意过的方向（“结果是快照、通知只发边沿”）与已接受提案的两句原文（“每次布局都发的诊断合并成一条”“`issues` 只发新增”），作者不替开发者驳回，记入[待确认清单](../../pending-confirmations.md)；第 2 稿把去重放在独立的第 3 片，拿掉时整片不做。
  - 第 2 条（保留的参数名、`cause` 的默认分支、`field` 与 `cause` 两个名字、上界）：计划写明保留的三个名字、不认识的 `cause` 按码处理、`field` 与 `cause` 意思不同各用各的、上界 O(节点数)。
  - 第 4 条（回调抛出是在补“同步通知放在状态机中间”）：同常规第 3 条，改成控制流。
  - 第 5 条（缺谁消费、取舍、数值口径）：Context 补“谁消费”与待定的一处；数值过 `round`。

第 2 稿送第二轮设计审查（常规，Claude Sonnet；代码按 master，t34 已合入）。

## 下一步

1. 第二轮设计审查，阻塞；处理完在 master 上写 `ui/nested-grid` 输出 139、140（planned）。
2. 开 worktree，按计划五片实施。
