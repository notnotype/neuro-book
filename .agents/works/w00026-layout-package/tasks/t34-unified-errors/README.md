---
schema: nbook.task/v2
taskId: t34-unified-errors
status: active
updated: 2026-11-18
---

# 统一失败形状与错误码

## 目标与范围

按提案第一档第 2 项：{ok:false, code, message, params?}，L0 的 35 处中文 reason 与 L2 的 rejected 归并成码，码集合开放；issues 只发新增；改两份 Spec 的失败与恢复

合同：布局行为不变，失败与诊断的形状、码与文字改变：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 失败与恢复、输出 68 与新增的诊断条目，[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 失败与恢复的码表。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)的“错误与诊断一种形状”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-18 经 nbdev 新建。计划见 [`plan.md`](plan.md)（第 3 稿）。**停下等开发者**，见下面第三轮审查一条。

- 第 1 稿的设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)）：15 条，重要 7、建议 8，都成立（第 6 条的 `PLUGIN_API_SINCE` 一项除外，见表），改成第 2 稿；几条改了设计（只发新增的判据、切片边界、公开面清单），第 2 稿再送一轮：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 757 不是宿主规则，代码里没有“标签数上限” | 归 `not-allowed`；`policy-refused` 只留 `accepts`、`can-insert`；`rule` 一种规则一个名字 |
  | 2 | 合成同一个码后，靠两句文案区分的用例按 `params` 区分不了 | `over-constrained` 加 `cause`，311 单独成码，`invalid-argument` 每种检查一个 `field`，725 拆条件；L0 每处的 `params` 逐行写进计划 |
  | 3 | “只发新增”没定义，每帧仍会重发 | 定判据：键是码加 `params`；手势内同键只发一次，重算按上一次的键集比，事件型的不去重 |
  | 4 | 没接 `onGestureCommit` 一次发两条，`handler-missing` 没有归宿 | 放进提交码，删掉直接发的那一条 |
  | 5 | `notify-failed` 的出口与类型和计划不符 | 只在 `useGridLayout.onIssues`，不进组件事件的码；`WorkbenchSurface` 的事件写并集 |
  | 6 | 公开面漏列（`GridGesturePreview`、`SashGestureScope.issues` 是公开的、`allocateSashPanels` 的 `context` 等）；`PLUGIN_API_SINCE` 要改 | 计划加公开面变更清单；`PLUGIN_API_SINCE` 不在本 Task 改：`releasing.md` 第 2 步要它改成“这次发布的版本”，发布时才定，交付时写明 |
  | 7 | Lab 夹具的去重、显示、恢复结果读取与一条 e2e 断言没列；输出 68 的 e2e 覆盖落空 | 第 1、2 片列入范围；输出 68 改由真实存在的 dom 测试覆盖 |
  | 8 | 617、632 不可达；L2 约 40 条 `rejected` 断言要迁 | 留作防御分支、不写用例；L2 的迁移写进测试迁移规则 |
  | 9 | 第 1、2 片的边界会返工 | 第 1 片只做失败，诊断整个放第 2 片 |
  | 10 | 类型可以更少；`GridRestoreResult` 不是判别联合；码集合开放要对齐 `ui/i18n` | `GridFailure` 写成 `GridIssue & {ok: false}`；恢复结果写成判别联合；对齐开放错误域。不按操作收窄码（接受取舍：码集合开放，调用方本来就要有默认分支） |
  | 11 | 229、298、509、280 的归类，快照 `actual` 不准，L2 不转交 L0 失败 | 逐条按建议改；L2 的两个码补 `params`，800 保持 `not-found` 免得命令分支变化 |
  | 12 | 逗号连 id、非有限数进 JSON 变 `null` | 值允许字符串数组；非有限数写成字符串 |
  | 13 | `LayoutDocValidation` 留着 `detail`；L2 拆码没有消费者 | 同批改名 `message`；拆码按已定提案做，`rule` 一种规则一个名字 |
  | 14 | `plugin.ts:205` 记的不是求解诊断 | 删掉那条，改成 `structureFailure` 读 `message` |
  | 15 | Spec 文字同步 | 并入计划“Spec 与文档改动” |

- 对待确认项，审查同意定码，并建议 `handler-missing` 进提交码、决策记录写明 `not-published`、`notify-failed` 只是诊断：决策记录与待确认清单已照改。
- 第 2 稿的设计审查（第二轮，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）：12 条，阻断 1、重要 5、建议 6，都成立，改成第 3 稿，送第三轮（同一对象最后一轮）：

  | 条 | 内容 | 处理 |
  |---|---|---|
  | 1 | 键含数值参数，拖窗口每个像素都是新诊断（阻断） | 键只取码、`cause`、轴；`ids`、`branch` 与度量不进键 |
  | 2 | `not-collapsible` 一码两义 | 诊断改名 `no-collapse-policy`；失败码与诊断码不相交，加类型级测试 |
  | 3 | 快照恢复漏了 209 | 新码 `unresolved-root`，带 `dropped` |
  | 4 | 合成后的 `params` 没定义，删 `context` 丢了分支与轴 | 逐个 `cause` 写 `ids` 是什么、带不带 `branch`、`axis`；`allocateAxis` 传内部范围参数；结果里不合成，只在通知时同键合成 |
  | 5 | 第 1 片验证漏两个包，第 3 片漏约 36 处读 `detail` | 每片三个包都做类型检查；测试迁移规则列全文件 |
  | 6 | 作用域边界：空布局、`gesture-update`、键盘、同步回调 | 空布局与换工作面清空键集；载荷是快照不去重；键盘不发诊断记为已知限制；通知挪到收尾之后 |
  | 7 | 两处靠中文碰巧通过的断言 | `useGridLayout.dom.test.ts:208` 改成真的检查并先变异；e2e 395 读码与版本属性，夹具去掉中文兜底 |
  | 8 | `PLUGIN_API_SINCE` 理由成立但缺防遗忘；SDK 一列可以定；新类型要不要进 SDK | Work README 加“发版前”一行；SDK 一列填定；`GridIssue` 等几个类型进 SDK 的类型导出，写“新增” |
  | 9 | `collapsePolicyProblem`、`serializeTree`、`swapSkipped` 三处中文 | 前者归 t36 定入口时一起定；`serializeTree` 的异常文字改英文；`swapSkipped` 并入第 2 片 |
  | 10 | `params` 没有类型；`duplicate-id` 与 `id-taken` 两个名字 | 每层一张内部映射类型加构造函数，编译期检查；L2 改回 `duplicate-id` |
  | 11 | 232、280、503、506、`stale-*` 的取值歧义 | 逐条写明 |
  | 12 | 和提案不同的不止一处 | 决策记录追加第二条，待确认清单加一行 |

- 第 3 稿的设计审查（第三轮，[`evidences/design-review-r3.txt`](evidences/design-review-r3.txt)）：12 条，阻断 0、重要 6、建议 6。第二轮 12 条里 8 条核实到位，L0 的 34 处、诊断表的位置与 `cause`、两个出口的时序都与代码对上；剩下的重要问题：
  1. 同键合成后 `branch`、度量只对应第一条，`ids` 却是并集，对不上；
  2. 宿主的 `onIssues` 在松手那一帧（`flush`）抛出时 `finish` 不跑，手势卡住（计划只处理了 `finish` 里那一处）；
  3. L0 的 401、452 一个条件管“不存在”与“不是分支”，应像 475、594 那样拆开；
  4. `ids` 是字符串数组，宿主照 `ui/i18n` 把 `params` 交给翻译端口时类型不合、数组被丢；
  5. L2 几处 `not-found`、`duplicate-id`、`limit-exceeded` 的 `params` 取不到 id（`freshId` 吞了撞车的 id、落点只有目标），L2 的逐行表还没写；
  6. `validateLayoutDoc` 的 32 条中文问题文字仍进 `message`，与“`message` 是英文”不一致。

  **停下等开发者**（满三轮仍有实质问题，reviewing 与 autonomous-delivery 的停止条件）。三轮下来，失败的形状（L0 结构操作、快照恢复、L1 提交码）已经收敛，第三轮只剩 401、452 一处；反复出边界问题的是诊断的“合成与只发新增”与 L2 拆码。推荐：
  - **拆成两个 Task**：t34 只做失败的形状（计划第 1 片，加 401、452 拆开，`GridParamValue` 按第 4 条定），设计已收敛，可以直接做；诊断（码、两个出口、只发新增与合成、删 `SashGestureScope.issues`）另建 Task，重新出设计，先定“结果是状态快照、通知只发边沿”的合同再写计划。
  - **L2 拆码延后**：把 `rejected` 拆成四个码今天没有使用方（应用只看 `not-found`、`limit-exceeded`，第一轮第 13 条），nb-workbench-layout 也不发布；本档只把 `detail` 改名 `message`、改英文，拆码等有使用方时再做。
  - 备选：照第三轮的建议改成第 4 稿，不再送审直接实施，实现审查兜底。

- 盘点时发现提案“错误与诊断”有一句与代码不符：L1 的提交回调已有上下文已切换、版本已变、处理器抛出等失败，提案说不预设这些码。本 Task 给它们定码，提案追加决策记录，记入[待确认清单](../../pending-confirmations.md)。
- 代码在 t33 合入 master 之后开 worktree。

## 下一步

1. 等开发者定：拆成“失败的形状”与“诊断”两个 Task、L2 拆码延后（推荐），或改成第 4 稿直接实施。
2. master 上写两份 Spec 的 planned 条目。
3. t33 合入后开 worktree，按计划四片实施。
