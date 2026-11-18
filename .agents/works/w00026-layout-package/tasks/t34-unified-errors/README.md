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

2026-11-18 经 nbdev 新建。计划见 [`plan.md`](plan.md)（第 2 稿）。

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

- 盘点时发现提案“错误与诊断”有一句与代码不符：L1 的提交回调已有上下文已切换、版本已变、处理器抛出等失败，提案说不预设这些码。本 Task 给它们定码，提案追加决策记录，记入[待确认清单](../../pending-confirmations.md)。
- 代码在 t33 合入 master 之后开 worktree。

## 下一步

1. 第 2 稿设计审查（Claude Sonnet，第二轮，阻塞）。
2. master 上写两份 Spec 的 planned 条目。
3. t33 合入后开 worktree，按计划四片实施。
