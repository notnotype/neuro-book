---
标签: [state:inject]
别名: ["退出计划向导", "切换模式向导"]
---

# AgentModeSwitchWizard

模型用 `switch_mode` 申请切换 Agent 模式时的向导（[`agent/modes.md`](../../../../../docs/specs/agent/modes.md) 输出 8–10）。

## 什么时候用

只由 `AgentWizard` 用，事项是 `kind: "mode-switch"` 时。

## 行为

- 退出 `plan`（`item.plan` 有值）：内容区是计划全文，用注入的 Markdown 显示，外框放宽；下面是审批模式、附言与按钮，“批准并开始”“继续改”。审批模式默认保持当前，选了别的才随答案交回。
- 别的切换：一句话写从哪到哪，“同意”“不同意”。
- 附言写了字时批准不可点，和审批向导一样，免得写了的话被丢掉。
- 选了什么在 `WizardState` 里：向导收起、切标签回来还在。
