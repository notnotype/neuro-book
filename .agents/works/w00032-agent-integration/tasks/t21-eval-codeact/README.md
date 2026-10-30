---
schema: nbook.task/v2
taskId: t21-eval-codeact
status: shelved
updated: 2026-10-30
---

# eval 工具（CodeAct）

## 目标与范围

参照 omp 的 eval：常驻代码内核，代码里调用工具、模型与子代理；与 t04 搁置的工具发现一起考虑

来源：t12 讨论（2026-10-28）；t04 定工具发现搁置时开发者说以后有需求打算用 CodeAct 实现。

合同：本 Task 搁置，行为合同未变。

## 已知情况

omp 的 eval（事实见[外部参照](../../../../../docs/research/agent-runtime-references.md)“omp 的 eval 与 Agent Hub”一节）：常驻内核（Python 子进程或 Bun 的 JS），每次调用执行一个单元、顶层状态保留；代码里可以 `tool.<名>(args)` 调会话里的工具、`judge`/`completion` 调模型、`agent`/`workpool` 派后台子代理分波次，`budget` 看额度，`%pip`/`%bun add` 装依赖。

对写作的用处：跨很多章节的批量检查（一段代码循环读章、批量判断）、统计、把子代理串成流水线。代价：内核状态不在会话日志里，回退与 fork 恢复不了（与 t03 的路径模型对不上）；内核管理与工具、模型、子代理三座桥的工作量大；执行任意代码属于执行档。2026-10-28 会话里的倾向：先只做 JS 后端（只依赖 Bun），与工具发现一起考虑。

## 后续确定的需求

- [t16](../t16-command-bridge/README.md)（开发者 2026-10-30）：Agent 操作 NeuroBook 界面与外部网站一定走 CodeAct，不作内置工具。eval 要有一个让插件登记全局对象的贡献点（名字、一行摘要、文档、宿主侧处理函数、审批档位），照 omp 的 prelude：eval 的工具描述里每个全局对象只有一行摘要加文档地址，完整文档在模型读它时才进上下文（事实见[调研](../../research/2026-10-30-host-control-survey.md)第 5 节）。使用方是 [w00033](../../../w00033-page-agent/README.md) 的 `nbook` 与 [w00034](../../../w00034-browser-use/README.md) 的 `browser`，所以 w00033 开工前本 Task 要重开。

- [t19](../t19-mcp/README.md)（开发者 2026-10-30）：MCP 服务的工具多时，照 Anthropic 的“用代码执行调 MCP”经 CodeAct 按需加载（[w00036](../../../w00036-mcp/README.md) 决定 6）。

## 当前状态

搁置（开发者 2026-10-28：本 Work 新开任务、先搁置，优先级不高）。

## 下一步

需要时重开，先与开发者讨论范围。
