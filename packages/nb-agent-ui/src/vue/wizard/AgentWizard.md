---
标签: [state:local, state:inject]
别名: ["向导"]
---

# AgentWizard

等用户时替换输入框的位置：审批一批走 `AgentApprovalWizard`，提问走 `AgentQuestionWizard`，申请切换模式走 `AgentModeSwitchWizard`。可以收起成一条小条，写等什么、第几个，没有批准按钮。行为合同见 [`conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 10–14。

## 布局与交互

放在消息流内容的末尾，`position: sticky`：贴底时不盖最后一条，往上滚时浮在内容上。出现时焦点到容器，不到批准按钮，有读屏播报，没有焦点陷阱；收起后焦点到展开按钮；Esc 只收起。

## 数据

属性 `pending`（`ctx.pendingInputs`）、`state`（`ctx.wizardState`，挂载时读一次）。事件 `action`：`input.submit`（一个事项一条）、`input.cancelRun`、`wizard.state`。

这一批的 id 出现新的就从头来；别的窗口先答了的事项从 `pending` 消失，这里跟着走。

## 隐藏通道理由

`state:inject`：翻译端口与注入的表单组件，同视图里的其它零件。
