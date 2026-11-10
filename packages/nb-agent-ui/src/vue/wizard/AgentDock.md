---
标签: [state:local, state:inject]
别名: ["停靠区"]
---

# AgentDock

停在消息流与输入框之间的一块，放不阻塞的等用户事项：异步提问（`async`）与后代会话的审批、提问、模式切换请求（带 `source`）。内容与同步向导相同（审批、提问、模式切换三种向导，外框是 `AgentWizardFrame` 的停靠变体），不替换输入框。行为合同见 [`agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”。

## 布局与交互

- 一次一个事项。标题行：带 `source` 的写“子代理「名字」：……”、图标换成子代理的；“第 n / m 个”、上一个、下一个；打开子会话（`session.select`）；收起。标题放不下时省略号截断，计数与按钮固定在右边。
- 每个事项单独提交（`input.submit` 带 `sessionId`），没有“全部拒绝”“终止本轮”。
- 能收起成一条：写有几个、第一个的前半句，右边展开。`held`（同步向导在）时收成一条且不能展开；同步向导消失后回到用户原来的展开或收起。
- 最高为对话视图高度的 40%（`40cqh`，尺寸容器是视图根节点），里面滚动。
- 出现与事项变化时不移动焦点；读屏播报由视图层常驻的状态区负责，不在这里。
- 面：停靠的轻阴影、圆角同输入框，收起与展开相同（`design-language.md`“停靠的面不用浮层的阴影档”）。元素钩子 `data-agent-dock`。

## 数据

属性 `items`（`ctx.pendingInputs` 里进停靠区的）、`state`（`ctx.dockState`，挂载时读一次）、`held`。事件 `action`：`input.submit`（带 `sessionId`）、`dock.state`、`session.select`。

答过的事项由宿主从 `items` 去掉；这里按 id 记住看到的那个，它消失后停在原来的位置。

## 隐藏通道理由

`state:inject`：翻译端口与注入的表单组件，同视图里的其它零件；向导外框经注入读停靠区的标题行（`dock-frame.ts`）。
