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

- 2026-11-25 经 nbdev 新建。评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)）两题已答，见决定 2。草稿在草稿 worktree `.worktree/w00043-t18-drafts`（分支 `w00043-t18/drafts`，不合并），Lab 组件 `MessagesWindow`。
- **第 1、2 条已合入 master（`c37a64baa`）**：
  - 第 1 条 `f637471ae`：`AgentMessages` 的列表栏与聊天区改成 nb-layout `Splitter` 的两块面板；列表栏 200 到 420 像素、聊天区至少 320 像素，拖到 200 以内再过 40 像素收成头像列；宽度由宿主记在内存里（同收起状态，重开窗口回到 260）。
  - nb-layout 的两处改动：`SplitterPanelConfig` 加可选的 `overflow: "visible"`（面板一律裁切溢出，窄版的列表抽屉要从 52 像素的头像列那块面板里伸出去；用 `Teleport` 挪列表会丢焦点与滚动位置）；预览回到手势开始时的样子时补发一次 `gesture-update`（审查第 1 条）。API 报告、`CHANGELOG.md`、应用的 SDK 快照跟着更新。
  - 发布脚本 `eaf3d66ea`、`c88a69f5b`：nb-agent-ui 新增对 nb-layout 的发布依赖，只载源码包的 `release:check` 与 `release:publish` 的闸门原先把 nb-layout 当成不发布的包；`checkReleasePackages` 缺省认已首发的生成包。**下次发版时 nb-layout 要与 nb-agent-ui 一起提版本**（nb-agent-ui 用到了新的 `overflow`）。
  - 第 2 条 `55579e680`：`AgentMessagesList` 的 nb-ui `Tabs` 换成标题式的 `tablist`，收起按钮经插槽 `switch-end` 进这一行；中文标签写“Bot”。
  - 实现审查：Sonnet 9 条（阻断 1、重要 1、建议 7），[处理](evidences/impl-review-1-disposition.md)，修正 `c88a69f5b`。接受取舍、交开发者知悉的两条：头像列与列表在收起那一刻直接换、不随 280ms 的宽度过渡；视图窄、宽度被压着时拖一下，记着的宽度换成压过的值。
  - 验证：nb-layout bun 670 条、vitest 358 条；nb-agent-ui bun 301 条、vitest 225 条；应用 agent、bots、Lab 的 vitest 125 条、agent 与 SDK 的 bun 80 条；发布脚本 vitest 120 条、`packages.test.ts` 13 条；类型检查三个包；`api:check`。e2e：`lab-agent-ui` 的“消息视图的分栏”6 条，`agent-conversation`、`bots-chat` 32 条里 31 条一次过、“按状态换场景”一条（测试自己的请求被对端断开）单独重跑通过。合入前那一轮与两条归为原有或负载的失败见处理表末尾。
  - 变异检查：宽度回写、收起回写、面板不裁切、发布检查的缺省、补发预览（组件测试与 e2e 各一条），都有用例失败。第一版的窄版用例没看住“不裁切”（`click` 会先把行滚进被裁切的面板再点），改成按行中心 `elementFromPoint` 判断。
  - Spec（planned）：`22101b06b`，[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 消息视图一段。
- 第 3 条（浮动窗自绘头）：计划 [`plan.md`](plan.md)（草稿 1），等开发者确认；三处待确认见计划末尾。

## 下一步

- 第 3 条：开发者确认计划后做设计审查（Sonnet），再实施。
- 第 3 条做完后一起核对 Spec 的 planned 标记并晋升。
