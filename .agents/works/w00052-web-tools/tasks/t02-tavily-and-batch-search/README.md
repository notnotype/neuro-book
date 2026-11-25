---
schema: nbook.task/v2
taskId: t02-tavily-and-batch-search
status: active
updated: 2026-11-25
---

# 接入 Tavily、一次多条查询、插件 id 改回 nbook.web

## 目标与范围

网页工具接入第二家服务 Tavily，设置页选用一家；`web_search` 一次收几条查询、并发搜；插件 id 从 `nbook.web-tools` 改回 `nbook.web`（目录仍是 `web-tools`）。做完给开发服务配上 Tavily 密钥并选用 Tavily。

合同：[`web/tools.md`](../../../../../docs/specs/web/tools.md)、[`web/settings-page.md`](../../../../../docs/specs/web/settings-page.md)，新行为在条目里标“（planned）”。

## 来源与诊断

开发者 2026-11-25 反馈“DeepSeek 搜索返回的结果太少，Agent 一次要调用几十次 search”，指的是开发服务上标题为“在你的世界观中，NeuroBook 是什么？”的会话（Lyra，`magpie/agy-cli/gemini-4-hydrogen`）。查会话日志：

- 46 次 `web_search`，每次返回的条数都等于 Agent 要的条数（43 次要 5 条、3 次要 8 条），DeepSeek 没有少给。
- 次数来自任务：开发者让它查候选名重不重名，它把四十几个名字逐个搜。最初两次把几个名字拼成一条（`OR` 或空格）只回了 1 条，之后改成一个名字一次。2026-11-25 重放这两条：DeepSeek 一条回 8 条不相关的、一条回 0 条；Tavily 两条都回 8 条，`OR` 那条命中其中两个名字。
- 慢在往返：这条模型路由每次响应至多 1 个工具调用（开发服务上全部会话 129 次带工具的响应都是），`deepseek-v4-flash` 39 次里 7 次并发；仓库里没有 `parallel_tool_calls` 设置。Lyra 的 Profile 没有 `eval`。所以 46 次搜索就是 46 次模型往返。

参照 omp（`@oh-my-pi/pi-coding-agent` 的 `web/search`）：一个工具一条查询；约 20 家纯搜索服务加几家带联网的模型，按设置里的顺序跳过没密钥的、失败换下一家并在结果里写明；模型在查询里写 `site:`、`after:` 等，由它解析成各家的原生参数，结果再按条件宽松地筛；Tavily 用 `search_depth: basic`、缺省 5 条、要 `include_answer`，带日期过滤搜出 0 条时去掉日期再搜一次；给模型的每条摘要截到 240 字；读网页走另一个工具，带 78 个站点的专用抓取器。

## 决定

开发者 2026-11-25：

1. 两家都有密钥时，设置页选一家，搜索与读取都用它；选中的那家出错照常报错，不自动换。开发服务上选 Tavily。
2. `web_search` 一次收几条查询：`queries` 最多 10 条，服务端并发搜、按查询分组交回；只有一条时每条缺省 8 个结果，几条时缺省 5 个。
3. 插件 id 改回 `nbook.web`。当初改名只因为目录不能叫 `web`（架构测试按路径里的 `web` 认浏览器一侧），所以目录仍是 `web-tools`。

实施者定的（低风险、可改）：

- 改名不做迁移：v0.17.0 已经带着 `nbook.web-tools` 发出，用户层里 `nbook.web-tools/deepseekBaseUrl` 的值与 Profile 工具绑定里的旧工具 id 不再生效；密钥文件位置不变。官方站用量统计的插件名单新旧两个 id 都留着。
- 选用的服务存成设置项 `nbook.web/provider`（只有用户层，缺省 `deepseek`），设置页像“网络”页一样经设置服务写；Tavily 的地址前缀是设置项 `nbook.web/tavilyBaseUrl`，只能改设置文件（测试指向本机假端点）。
- Tavily 搜索 `search_depth: "basic"`、`include_published_date: true`，不要它的 `include_answer`（Agent 只拿原始结果）；`sites`、`after`、`before` 给原生参数；查询上限 1,500 字（Tavily 的建议值）。读取用 `/extract` 的 `format: "markdown"`。
- 几条查询时每条摘要截到 300 字（10 条乘 5 个结果约 3.5 万字）；有的没搜成时整次仍算成功、组头写原因，全都没搜成时报第一条的码；有一条查询不合要求时一条也不发。
- 带日期过滤搜出 0 条时去掉日期重搜（omp 的做法）先不做，记为候选。
- Tavily 密钥存在仓库根 `.env` 的 `TAVILY_API_KEY`（Git 忽略），只给真实服务测试用；开发服务经设置页的远程合同写入。

## 实施步骤

代码在 worktree，主会话写；Spec 与记录在 master。

1. 改名：插件、工具、设置项、远程合同、分区的 id，插件名单、`server.test.ts`、e2e、Lab 场景、用量统计名单。
2. 服务表：`provider` 设置项与地址前缀，工具每次调用读选用的服务与它的密钥；失败文字按服务名；密钥状态两家。
3. Tavily 客户端与本机假端点、合同测试、真实服务测试。
4. 多条查询：参数版本 2、并发、分组文字、结构值 `searches`、部分失败。
5. 设置页：Tavily 一节、“使用”单选（经设置服务写）、DOM 测试、e2e、Lab 场景。
6. 验证：类型检查、受影响的测试、e2e、真实 DeepSeek 与 Tavily；后端（密钥与外部请求）交 Opus 审查、omp `@review` 后台同审，设置页交 Sonnet。
7. 合入后给开发服务写 Tavily 密钥、选用 Tavily，真实会话里试一次多条查询。

## 当前状态

2026-11-25：Spec 两份已按决定改成 planned 条目；代码未开工。

## 下一步

开 worktree，按实施步骤 1 起做。
