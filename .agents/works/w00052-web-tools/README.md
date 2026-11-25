---
schema: nbook.work/v1
workId: w00052-web-tools
issueId: null
status: done
updated: 2026-11-25
---

# 网页工具插件：web_search 与 web_fetch

## 目标

单独做成一个插件，给 Agent 提供搜索引擎与简单的网页读取（web_search、web_fetch）；与浏览器插件（w00034）分开安装、互不依赖。来源：w00032 t12（2026-10-28 定网页工具不进 Agent 插件、单独做插件，网页搜索另开 Work）；开发者 2026-11-19 在 w00034 t01 讨论里整理的能力划分。

## 已知情况

见 [w00034 调研](../w00034-browser-use/research/2026-11-19-browser-agents-survey.md)：

- jina reader（Apache-2.0）：读取先用 curl-impersonate，正文太少或要选择器、截图时才开浏览器；readability 抽正文加自家的 markify 转 Markdown；`s.jina.ai` 搜索后把前几条结果的正文也读回来。本机实测 `r.jina.ai` 读到了起点月票榜（无头浏览器被拦的页面），但自定义字体的数字读不出。
- Agent-Reach 的网页渠道就是“Exa 的托管搜索加 Jina Reader 读取”，各平台（B 站、小红书等）另走各自的命令行。
- DeepSeek 有独立的搜索与读取接口（`POST /v1/tools/search`、`/v1/tools/fetch`，与对话同一个密钥，按成功的请求计费，每千次 5 元）。2026-11-19 实测：搜索约 2 到 3 秒，中文结果带摘要与正文；读取 1.3 到 12 秒，读到了无头浏览器被拦的起点月票榜；回环地址它自己拒绝（403）。原始输出在本地 `.local/agent/works/w00052-web-tools/tasks/t01-design/logs/`。
- omp（MIT）有约 30 个搜索服务的实现（含 deepseek、exa、tavily）与一个读取工具，在 `@oh-my-pi/pi-coding-agent` 的 `web/search`；应用没有依赖这个包（它带 25 个依赖），作参照移植。
- 两个插件分开装、互不依赖（w00034 t01 决定 3）。

实施位置：worktree `.worktree/w00052-web-tools`，分支 `feat/w00052-web-tools`；插件 id `nbook.web-tools`。

## 已定的事

- 开发者 2026-11-19：先做本插件，再做 w00034 的浏览器插件；`web_search` 要支持各大搜索 API（Exa、Tavily 等），优先用 DeepSeek 的搜索接口。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计与实现：`nbook.web-tools`（`web_search`、`web_fetch`、“搜索与网页”设置页），只接 DeepSeek | 完成：`4c0c25023` 合入 master，两份 Spec 晋升 |
| [t02](tasks/t02-tavily-and-batch-search/README.md) | 接入 Tavily、设置页选一家、`web_search` 一次几条查询、插件 id 改回 `nbook.web` | 完成：`6824bf5dc`、`8a975d6fe` 合入 master，两份 Spec 晋升 |
| [t03](tasks/t03-search-settings-redesign/README.md) | 设置页改左边列表、右边详情，加默认结果条数、屏蔽网站、各家接口地址与 Tavily 搜索深度，服务商带 logo | 完成：`da4b4ecf5`、`26afc5480` 合入 master，两份 Spec 晋升 |

## 后续

- 密钥框：`ApiKeyField`（本插件）与模型页 `ProviderDetail.vue` 的 `draftField` 合并，并与 `forms.md` 输出 31 的 `SecretInput` 对齐（t01 设计审查 Sonnet 第 5 条）。
- 更多服务：Exa 等（t01 决定 3；Tavily 在 t02 做）。
- 官方站用量统计：使用档第 1 版的插件名单里是 `nbook.web-tools`（发布后不改），w00053 出第 2 版时写 `nbook.web`（t02 改名）。
- 带日期过滤搜出 0 条时去掉日期再搜一次（omp 对 Tavily 的做法），t02 记为候选。
- 从仓库根跑测试（`bun run test:affected --tier llm`）时 Bun 自动加载根 `.env`，里面所有键进测试进程与 Agent 的 eval 子进程（t02 omp 审查第 6 条；原有问题，不只 Tavily）：根入口与派生的 Bun 禁用自动加载，送进场地的环境走白名单。
- 测试缺口：存档失败的文字、在途时改密钥、设置页分区声明与核对报告里“无测试的边角”（t01 当前状态末两条）。
- 另记（t01 设计审查 omp 第 16 条，Agent 插件原有）：同一个交给模型的名字有两个工具时，eval 与内核选中的不是同一个。
- 另记（omp 第 7 条，影响 `nbook.models`）：OMP 凭据库的清除在锁竞争下报成功、重启后旧密钥回来，清除只是软删除。

## 相关

- [w00032 t12](../w00032-agent-integration/tasks/t12-builtin-tools/README.md)：定网页工具不进 Agent 插件。
- [w00034](../w00034-browser-use/README.md)：浏览器插件。
