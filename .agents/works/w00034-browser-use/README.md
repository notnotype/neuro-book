---
schema: nbook.work/v1
workId: w00034-browser-use
issueId: null
status: active
updated: 2026-10-30
---

# 浏览器插件：Agent 操作外部网站

## 目标

让 Agent 驱动真实浏览器操作外部网站（调研网站、帮用户去小说网站发布等）。做成可选安装的插件，经 eval 向 Agent 提供全局对象 browser；页面内的快照、高亮、光标复用 nb-page-agent 核心包，动作经 CDP 发可信输入。来源：w00032 t16 讨论（2026-10-30）。

## 已定的事

来自 [w00032 t16](../w00032-agent-integration/tasks/t16-command-bridge/README.md) 的讨论（开发者 2026-10-30）：

- 与 Agent 操作 NeuroBook 自己的窗口（[w00033](../w00033-page-agent/README.md)）分成两个插件：本插件可选安装，服务端驱动真实浏览器，经 eval 的贡献点向 Agent 提供全局对象 `browser`；外部网页里的快照、高亮、光标复用 w00033 的核心包，动作经 CDP 发可信输入。
- 一定用 CodeAct，同 w00033。
- t12 已定网页工具（`web_fetch`、`web_search`）单独做成插件；本 Work 开工时定与它们的关系。

## 要讨论的问题

- 引擎：Puppeteer（omp 的做法）还是 Playwright。
- 浏览器配置与登录态：独立的浏览器配置，还是经扩展或 relay 驱动用户自己的 Chrome（发布到小说网站要用户的登录态）。
- 对外操作（发布、提交表单、登录）怎样确认；域名范围；外部网页内容是不可信输入（提示注入）。
- computer use（操作系统级）是否另开插件。

## 调研

- [Agent 操作宿主应用与网页界面](../w00032-agent-integration/research/2026-10-30-host-control-survey.md)：网页界面的感知与操作（第 2 节）、omp 的浏览器（第 5 节）、CodeAct 的文档形式（第 6 节）。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：引擎、浏览器配置与登录态、对外操作的确认、域名范围 | 未开工 |

## 前置

[w00032 t21](../w00032-agent-integration/tasks/t21-eval-codeact/README.md)；[w00033](../w00033-page-agent/README.md) 的核心包。
