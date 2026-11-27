---
schema: nbook.task/v2
taskId: t20-messages-view-second-round
status: active
updated: 2026-11-27
---

# 消息视图第二轮：浮动窗记住尺寸、停靠侧轨与展开列表重做

## 目标与范围

开发者 2026-11-27 看 t19 合入后的页面提了 6 点（原话与已修的三处见 [t19 README](../t19-messages-view-ui-polish/README.md) 末尾）。本 Task 做其余的：

1. **浮动窗记住尺寸**：归位后再浮动，用上次的位置与大小（窗口变小时夹到看得见）。改布局记录格式，加一个可选字段。
2. **停靠时的侧轨**：右边从顶通到底那一条能不能减重。候选 A 右栏只有消息时并进消息的卡片（画法同浮动窗）、只有一个容器时不画容器入口；B 允许整条隐藏；C 形状不变、只减轻存在感。先出稿。
3. **展开后的列表重做**，连同**浮动窗头上控件的摆放**：页签与“回到停靠”同排、展开后去掉重复的底部按钮、列表行样式。先出稿。

合同：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50、51（planned，t19 写的），[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21，[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 57；第 1 项要在 workbench-layout 的浮动窗条目里加“归位后再浮动用上次的矩形”。

## 开发者的决定

1. 第 1 项做、第 3 项按“先出静态稿”的方式做（开发者 2026-11-27 答“其他都同意”）；第 2 项“先看稿”再定。
2. 评审板第 1 轮（开发者 2026-11-27）：`rail-direction = two`（不推荐的方向二：停靠时没有窄列，列表按需打开），附言“侧柜右下角那第三个按钮可以在展开的时候做一个动画，放到底部，类似 app 底部导航栏的做法”；`list-rows = new`（列表行按改后的样子）。附言的理解在会话里确认（开发者 2026-11-27，选择框）：整条底部导航；收着时右下角照样有打开列表的按钮；“可以先出稿再定”。

## 当前状态

- 2026-11-27 新建。草稿 worktree `.worktree/w00043-t20-drafts`（分支 `w00043-t20/drafts`，不合并）：e2e 生产构建加假模型端点，截图脚本 `packages/neuro-book/e2e/zz-t20-draft.e2e.ts`（未跟踪）往页面注入草稿样式（`/tmp/t20-draft.css`）与按钮；方向二“收着时没有右轨”靠 `layout-constraints.ts` 里读 `localStorage` 的草稿开关。原图在本地 `shots/r1/`。
- 评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)）两题：`rail-direction` 右边那一列留不留（现在／方向一并进卡片的窄列，推荐／方向二没有窄列、聊天头上按钮打开列表），每个候选画停靠、停靠展开、浮动、浮动展开四张；`list-rows` 列表行改不改（会话用首字方块、当前项描边、空第二行不占高）。直接修的三项列在板上。
- 第 1 项“记住矩形”按 [`plan.md`](plan.md) 实现：`bf105beb6`、`c5eec6a12`（库的 `floatRects` 字段、出口结算、读入归一、形状比较；store 的 `floatTab` 用它）。`nb-workbench-layout` 293 条、工作台 607 条单测、类型检查、`agent-messages-float` e2e 15 条都过；变异 5 处都被抓到（“并进别的浮动窗不记”一处先空过，补了用例）。顺手补了入口清单里 t19 漏登记的 `setFloatRail`（`entry.test.ts` 自 t19 起就失败，t19 收口没跑这个包的全部单测）。
- 实现审查（快速审查）：Opus 重要 2、建议 4，omp `@review` 重要 7、建议 2（大半与 Opus 重合），处理见 [`evidences/impl-review-opus.txt`](evidences/impl-review-opus.txt)、[`evidences/impl-review-omp.txt`](evidences/impl-review-omp.txt)。修正 `3a2b05583`（按标签结算、再浮出整窗夹进树区域、不小于最小尺寸、重合时错开、读入丢文档里没有的键、结算先建表）、`475f88340`（宽高至少 1、空表省掉、e2e 先断言拖动生效）；Spec 输出 39 随之补全（`3ba51f7d3`）。不改的 1 条：记录上限附近一个可选矩形让停靠存不下（理由见证据）。
- **第 1 项已合入 master（`e276e6d37`）**。验证：布局库 295、工作台 609 条单测，类型检查，`agent-messages-float` 15 条、`workbench-float` 17 条（316 已知偶发，单独重跑 4/4 过）。

## 下一步

- 评审板第 2 轮（`bottom-nav`）：收着时聊天区状态行右端一个“打开列表”（带未读数），展开后列表底部是 Bot｜会话｜收起的导航条、顶上不再有页签，“新对话”留在聊天头左上角；停靠与浮动各两张，加 bot 页。原图在本地 `shots/r2/`（慢放的过渡帧没截出按钮的移动，没放上板）。等答复后把第 2、3 项写进 Spec 与计划。
