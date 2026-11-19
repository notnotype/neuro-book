---
schema: nbook.work/v1
workId: w00034-browser-use
issueId: null
status: active
updated: 2026-11-19
---

# 浏览器插件：Agent 操作外部网站与本机登录的导入

## 目标

让 Agent 驱动真实浏览器操作外部网站（调研网站、帮用户去小说网站发布等），并让应用能导入并管理本机的登录信息，供 Agent 的浏览器使用。做成可选安装的插件，经 eval 向 Agent 提供全局对象 browser；页面内的快照、高亮、光标复用 nb-page-agent 核心包，动作经 CDP 发可信输入。来源：w00032 t16 讨论（2026-10-30）；登录信息的导入与管理，开发者 2026-11-19 在 t01 的讨论里加入。

## 已定的事

来自 [w00032 t16](../w00032-agent-integration/tasks/t16-command-bridge/README.md) 的讨论（开发者 2026-10-30）：

- 与 Agent 操作 NeuroBook 自己的窗口（[w00033](../w00033-page-agent/README.md)）分成两个插件：本插件可选安装，服务端驱动真实浏览器，经 eval 的贡献点向 Agent 提供全局对象 `browser`；外部网页里的快照、高亮、光标复用 w00033 的核心包，动作经 CDP 发可信输入。
- 一定用 CodeAct，同 w00033。
- 网页工具（`web_fetch`、`web_search`）单独做成插件，在 [w00052](../w00052-web-tools/README.md)（t12 定，开发者 2026-11-19 重申）。

来自 [t01](tasks/t01-design/README.md) 的讨论（开发者 2026-11-19）：

- 浏览器的操作一律按执行档审批，不区分读与写。
- computer use 另开 [w00051](../w00051-computer-use/README.md)，本 Work 不做。
- 本 Work 加上“导入并管理本机的登录信息”；方向参照 Agent-Reach：专用浏览器在后台运行，第一次用某个网站时从用户的 Chrome 复制这个站的登录，原浏览器不变，不读密码库。
- 与 [w00033](../w00033-page-agent/README.md) 能力有重合但不是一个东西：w00033 操作 NeuroBook 自己的界面、当用户的引导者，控件有用 `v-nb-target` 指令登记的稳定名与命令绑定；外部网页没有这些，编号靠浏览器给的节点 id。

## 要讨论的问题

- 引擎与给模型的接口：推荐薄的 CDP 客户端加薄接口（见 t01）。
- 导入登录怎样读到用户 Chrome 里的 Cookie（Windows 上 Chrome 127 起不能直接解 Cookie 库）；后台无头被风控拦时怎样交给用户；登录信息的管理界面。
- 域名范围；外部网页内容是不可信输入（提示注入）。

## 调研

- [浏览器 Agent 调研与实测](research/2026-11-19-browser-agents-survey.md)（2026-11-19）：browser-use 1.0、browser-harness、omp、opencli、bilibili-cli、Agent-Reach、jina reader、page-agent 与厂商的 computer use；假作家后台、B 站、起点三个任务的实测；外部网站上的注入与快照探针。
- [Agent 操作宿主应用与网页界面](../w00032-agent-integration/research/2026-10-30-host-control-survey.md)：网页界面的感知与操作（第 2 节）、omp 的浏览器（第 5 节）、CodeAct 的文档形式（第 6 节）；其中 browser-use 的几行是 0.x 的做法。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：引擎、浏览器配置与登录态、对外操作的确认、域名范围 | 调研与实测完成，开发者定了 4 条，余下待定 |

## 前置

[w00032 t21](../w00032-agent-integration/tasks/t21-eval-codeact/README.md)（2026-11-18 完成，贡献点 `agent.evalObjects` 已可用）；[w00033](../w00033-page-agent/README.md) 的核心包。
