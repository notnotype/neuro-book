---
schema: nbook.work/v1
workId: w00052-web-tools
issueId: null
status: active
updated: 2026-11-19
---

# 网页工具插件：web_search 与 web_fetch

## 目标

单独做成一个插件，给 Agent 提供搜索引擎与简单的网页读取（web_search、web_fetch）；与浏览器插件（w00034）分开安装、互不依赖。来源：w00032 t12（2026-10-28 定网页工具不进 Agent 插件、单独做插件，网页搜索另开 Work）；开发者 2026-11-19 在 w00034 t01 讨论里整理的能力划分。

## 已知情况

见 [w00034 调研](../w00034-browser-use/research/2026-11-19-browser-agents-survey.md)：

- jina reader（Apache-2.0）：读取先用 curl-impersonate，正文太少或要选择器、截图时才开浏览器；readability 抽正文加自家的 markify 转 Markdown；`s.jina.ai` 搜索后把前几条结果的正文也读回来。本机实测 `r.jina.ai` 读到了起点月票榜（无头浏览器被拦的页面），但自定义字体的数字读不出。
- Agent-Reach 的网页渠道就是“Exa 的托管搜索加 Jina Reader 读取”，各平台（B 站、小红书等）另走各自的命令行。
- w00034 t01 的推荐：`web_fetch` 先直连，装了浏览器插件时再退回浏览器；两个插件分开装、互不依赖。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：搜索后端、读取的引擎与正文抽取、与浏览器插件的关系 | 未开工 |

## 相关

- [w00032 t12](../w00032-agent-integration/tasks/t12-builtin-tools/README.md)：定网页工具不进 Agent 插件。
- [w00034](../w00034-browser-use/README.md)：浏览器插件。
