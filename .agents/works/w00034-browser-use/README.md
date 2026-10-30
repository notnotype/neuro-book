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
