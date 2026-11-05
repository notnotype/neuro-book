---
标签: [state:inject]
别名: ["审批向导"]
---

# AgentApprovalWizard

一条回复里要批准的调用，一步一个。选批准、本会话都批准或拒绝（可带附言），能来回改，全部选完才能提交；“全部拒绝”随时可点。只有一个时选了就提交。没有“全部批准”。

## 布局与交互

`edit`、`write` 显示预览（`DiffView`，多文件按文件分节），过大或读不了的写明原因并列出参数；`shell` 显示命令、工作目录与超时；别的工具列参数。附言框写了字就是拒绝：批准不可点，有提示。

“本会话都批准”同时选中这批里同一个工具的其余调用。

## 数据

属性 `items`（`PendingApprovalView[]`）、`state`（`WizardState`）；事件 `update:state`、`submit`、`denyAll`（带附言）、`collapse`。状态由 `AgentWizard` 管。

## 隐藏通道理由

文字经翻译端口取，同视图里的其它零件。
