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

## 当前状态

- 2026-11-27 新建。先出第 2、3 项的静态稿（草稿 worktree 沿用 `.worktree/w00043-t19-drafts`），第 1 项随后写计划实施。

## 下一步

- 静态稿第 1 轮：停靠侧轨 A/B/C，展开列表与浮动窗头的候选。
