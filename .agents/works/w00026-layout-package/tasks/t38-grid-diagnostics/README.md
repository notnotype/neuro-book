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

2026-11-19 经 nbdev 新建、开工。计划见 [`plan.md`](plan.md)（第 3 稿）。

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

**实施**（worktree `w00026-t38-grid-diagnostics`，分支 `refactor/w00026-t38-grid-diagnostics`）：

- 第 1 片 `520ab0258`：`GridIssue` 与诊断码、库内的构造（`grid-issue.ts`）、每一处的码与参数；`allocateSashPanels` 去掉两个参数，内部 `allocatePanels` 带回调；195 并进 533；`range-overflow` 由会话给 `id` 与轴；Enter 折叠没有变化时会话状态不动、诊断不被盖掉。L0 测试按码与参数断言，补求解与会话用例、诊断码与失败码不相交与码的写法测试。变异检查：会话里丢掉折叠的诊断、195 照旧单独发，各有用例红。
- 第 2 片 `d8493c029`：`SashGestureScope.issues` 删掉、`onIssues` 加上，事件发对象，被拒的提交是失败本身；没接回调只发一条；键盘求解后交诊断；收尾先于宿主回调，松手与卸载用 `try`/`finally`；`useGridLayout` 拆成发布与通知、落账后的通知接住。`WorkbenchSurface` 与两个 Lab 夹具的读法一起改。用例：`not-published`、键盘 Enter、三种回调抛出与卸载、落账后抛出两条。变异检查：没有变化时先调回调再收尾、取消时先调回调、Enter 不交通知、落账后不接住，各有用例红。
- 第 3 片 `119fbe575`：`issueKey` 与闸门；两个出口接上。用例：闸门（Bun）、窄窗口逐像素重算（消失再出现、隐藏再显示、换上下文、换实例）、一场拖动一次与下一场。变异检查：去掉两个闸门、`begin` 不换闸门，各有用例红。落账后抛出那条用例在闸门下会空过（持续的诊断不再通知），改成先换上下文再提交。
- 第 4 片 `252dc1ef9`：SDK 导出三个类型、变更记录、包文档。
- 并 master `a9df56ba5`（别的 Work 的表情包改动，没有冲突）。
- 和计划不同的：第 1 片里 Lab 夹具也先读 `message`（它直接读 `layout.issues`），否则那一片应用的类型检查是红的；`GridLayoutResult.issues` 等列表收窄成 `GridIssue<GridIssueCode>`，省掉一处类型断言。
- 未验证：`reportError` 那一支（happy-dom 没有，dom 测试走 `console.error`）。
- 收口验证（并 master 之后）：应用三份类型配置、`docs:check` 都过；`test:affected --since master` 只有 `neuro-book` 的 bun 测试有失败，都不在本分支的改动里：`nbook.stickers` 清单不一致的 7 条（同 t34 记下的）、`sdk.test.ts` 组件子路径漏列 `ImagePreviewDialog`（主工作区 master 上同样失败，来自表情包那次合入）、agent 的 `eval.test.ts` 一条（内核重置后的输出）；nb-layout 与 nb-workbench-layout 的测试全过。e2e：`lab-nested-grid` 17、`workbench-shell` 18 全过；`lab-grid-swap`、`lab-grid-panels`、`lab-workbench-surface` 在负载 17 到 21 时各有 2、3、4 条失败，都是 Lab 15 秒内没就绪，负载 3 到 7 时整份重跑 5、17、17 全过。

第 2 稿的设计审查（第二轮，Claude Sonnet；代码按 master `5ee62b05a`，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）：9 条，阻断 0、重要 2、建议 7，都成立，改成第 3 稿。第一轮各条它逐条核过，大多到位，没到位的就是下表的几条。都是给了改法的细化、没有方向问题，第 3 稿不再送审，实现审查兜底：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 落账之后的通知有两处（重算那一批、`notify-failed`）；接住的范围若是整个 `recompute`，`grid.layout()` 自己抛出也被吞、提交却报成功 | `recompute` 拆成发布与通知两步；两处都经 `notifyAfterCommit`，只包通知 |
| 2 | 533 的 `cause` 判据在 `measure` 里没有来源，和 195 的 `weighted.length === 0` 不是同一个集合；收紧到 `quiet` 是没列的行为变化 | 判据由 `allocatePanels` 交回，与 195 相同；补刚性按比例叶、祖先收起两条用例 |
| 3 | 第 4 片的 Lab 夹具依赖第 3 片的 `issueKey`；第 2、3 片应用的类型检查是红的 | 夹具自己写键；`WorkbenchSurface` 的类型与夹具读法放第 2 片，第 2 片加应用的类型检查 |
| 4 | `fixed-overflow` 的 `required` 在 185 行已被改写；`range-overflow` 的合计要改 `boundsFit` | 表里写明取值时机与“按此刻的收起覆盖算” |
| 5 | 悬停与光标的处理还在回调之后；`invalidate`、`dispose`、卸载先 `cancel` 后拆，回调抛出时监听与光标令牌留着 | 悬停与光标也放到回调之前；三处写成 `try`/`finally`；补卸载时抛出的用例 |
| 6 | “不再落到 `solveSashDrag`”有一种读法会清掉会话状态 | 改写状态的几句挪到“有没有变化”之后，照旧落下去、合并两处诊断；补“先拖再折叠失败、位移照常提交”的用例 |
| 7 | happy-dom 没有 `reportError`，真实派发测不到 | dom 测试只断言提交仍成功（走 `console.error`），不桩；`reportError` 那一支记为未验证 |
| 8 | 空发布清空会让隐藏再显示时全量重发；键集更新与通知的先后、`begin` 里清空的位置没定；键盘每按一次是一场手势 | 空发布不经闸门；键集在通知前更新；`begin` 成功后才清；键盘的行为写进 Spec；三个操作缩成 `take`、`replace` |
| 9 | `GridIssue` 与 `GridFailure` 的联合上不能直接读 `ok` | 合同写 `"ok" in issue`，按码收窄只对诊断那一支成立 |

## 下一步

1. 实现审查（前端包，Claude Sonnet，审查 worktree `review-t38-impl` 固定在 `a9df56ba5`）在后台；处理完合入 master，`ui/nested-grid` 输出 139、140 去掉 planned、补实现合同。
