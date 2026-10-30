---
schema: nbook.work/v1
workId: w00033-page-agent
issueId: null
status: active
updated: 2026-10-30
---

# Agent 操作 NeuroBook 界面：nb-page-agent 核心包与自操作插件

## 目标

让应用内的 Agent 像用户一样看懂并操作 NeuroBook 的窗口：可操作控件的文本快照与引用、点击输入等动作、截图、高亮引导、可见的 Agent 光标与操作提示。核心做成纯 TS 的包 nb-page-agent（只管在一个页面里做事），内置插件把它接进每个窗口，并经 eval 向 Agent 提供全局对象。来源：w00032 t16 讨论（2026-10-30）。
