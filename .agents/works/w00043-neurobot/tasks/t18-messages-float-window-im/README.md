---
schema: nbook.task/v2
taskId: t18-messages-float-window-im
status: active
updated: 2026-11-25
---

# 消息视图浮动成窗口时像 IM：列表栏可拖宽、bot 与会话的切换控件、浮动窗里视图自绘头

## 目标与范围

开发者 2026-11-25 把“消息”视图浮成窗口来看（[t15](../t15-messages-view/README.md) 的成果），指出三处，目标是浮成窗口时像 IM 软件：

1. **列表栏拖宽**：列表栏现在固定 260px、只有收起按钮。改用 nb-layout 的 `Splitter`：拖动改宽度，拖窄过了最小宽度吸成头像列，往回拖展开；宽度由宿主记住。nb-agent-ui 新增对 nb-layout 的依赖。`Splitter` 会裁切面板，窄版的列表是压在聊天区上的抽屉，列表要在两处之间挪动而不重挂；挪不干净时把缺口提给 nb-layout（导出不管面板、只给分隔条的零件）。
2. **bot 与会话的切换控件**：现状是 nb-ui 的下划线 `Tabs`，开发者觉得丑。出静态稿定。
3. **浮动窗里视图自绘头**：现状是工作台的面板头（“消息”一行）加对话头（“星璃”一行）。浮动窗的外框来自 nb-layout（矩形、叠放、缩放手柄），头由工作台的 `WorkbenchPanelHead` 画；已有的“视图接管标题区”（[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19）只给标题行里的三格，消息视图宽版交还了它（t15 决定 6）。改成浮动窗里内置视图可以自绘整个头：工作台不画标题行，视图画到顶、标出可拖的区域，框架按钮由工作台叠在右上角并告诉视图留多少位置，键盘移动与右键“移动到”仍归工作台。只对浮动窗，停靠时不变。

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)（消息视图的版式）；[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19 与 [`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 39（第 3 条要改）。

## 开发者的决定

1. 第 3 条按“浮动窗里自绘整个头、停靠不变”走（2026-11-25 答“同意”）；第 1 条直接做，第 2、3 条出静态稿，定了再写 Spec 与计划。
2. 评审板第 1 轮（开发者 2026-11-25，两题都按推荐）：浮动窗的头用自绘头（列表栏通到顶，对话头那一行就是窗口头，“回到停靠”在右上角、排在“⋯”后面，两栏第一行等高）；bot 与会话的切换用标题式（没有横线，当前页靠字重与颜色区分，未读数跟在“Bot”后面，收起按钮在这一行右端）。

## 当前状态

- 2026-11-25 经 nbdev 新建。
- 评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)，`06682d240`）两题已答，见决定 2。草稿在草稿 worktree `.worktree/w00043-t18-drafts`（分支 `w00043-t18/drafts`，不合并），Lab 组件 `MessagesWindow`。
- 第 1 条尚未开工。

## 下一步

- 第 2、3 条：写 Spec（planned）与 `plan.md`，交开发者确认后实施。
- 第 1 条：在 Work 的 worktree 里实现，先验证 `Splitter` 加挪动列表的做法。
