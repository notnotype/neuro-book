---
标签: [state:inject]
别名: ["提问向导"]
---

# AgentQuestionWizard

一次 1 到 4 题，一步一题。单选或多选，总带“其它”；带表单的题用宿主注入的 `renderers.form`（编辑态）。全部答完才能提交；“停止这一轮”随时可点。

## 数据

属性 `item`（`PendingQuestionsView`）、`state`（`WizardState`）；事件 `update:state`、`submit`、`stop`、`collapse`。表单组件收 `schema`、`modelValue`，发 `update:modelValue`、`update:valid`。

## 隐藏通道理由

文字经翻译端口取，表单组件经 `useAgentRenderers` 注入，同视图里的其它零件。
