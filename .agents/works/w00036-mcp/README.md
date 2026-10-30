---
schema: nbook.work/v1
workId: w00036-mcp
issueId: null
status: active
updated: 2026-10-30
---

# MCP 插件：连接 MCP 服务，把工具与资源接进 Agent

## 目标

做 MCP 客户端插件 nbook.mcp：用户级配置与设置页、stdio 与 Streamable HTTP、OAuth、工具 id 与绑定、审批、mcp:// 资源与服务生命周期。来源：w00032 t19 讨论（2026-10-30）。

## 已定的事（[w00032 t19](../w00032-agent-integration/tasks/t19-mcp/README.md) 讨论，开发者 2026-10-30 全部按推荐）

1. 形态：单独的插件 `nbook.mcp`，与模型服务一样独立于 Agent 插件；服务进程在服务端，stdio 子进程用 `owned-process` 托管。
2. 配置：第一版只有用户级，存进 NeuroBook 的设置并有设置页；格式与 `.mcp.json` 的 `mcpServers` 相同，设置页有“从 JSON 导入”。不读项目里的 `.mcp.json`：作品文件夹可能来自别人，stdio 服务就是在本机执行命令（t05 也不做项目级 Profile）。
3. 传输与密钥：stdio 与 Streamable HTTP，旧的 SSE 只在 SDK 自带回退时顺带支持；变量写法 `${VAR}`、`${VAR:-默认值}`；请求头与环境变量里的密钥进 OMP 凭据库（w00032 t09），配置里只写引用；OAuth 也做（应用打开浏览器、token 进凭据库），可排在后一个切片。
4. 工具 id 与交给模型的名字：id 为 `mcp.<服务>.<工具>`；服务名限小写字母、数字与连字符，工具名里不合规的字符、`.` 与 `__` 换成 `_`；换完撞名或交给服务商的名字超过 64 字符时截断加固定哈希（同 omp）。w00032 t04 的名字校验从 128 改为 64（OpenAI 的上限）。
5. 绑定：在 w00032 t04 按 Profile 的工具绑定上加“按服务绑定”：服务可绑到选定的 Profile，服务里的单个工具可关；缺省不绑到任何 Profile。设置页显示每个服务的工具声明约占多少 token。
6. 工具太多：第一版不做工具发现（w00032 t04 决定 5）；以后照 Anthropic 的“用代码执行调 MCP”经 CodeAct 按需加载，记在 w00032 t21。
7. 审批：MCP 工具缺省算“执行”档（默认模式下会询问），可按工具放行（w00032 t06 决定 1）；每个服务有“相信这个服务的只读标记”开关，缺省关，打开后标了只读的工具按“读”算。
8. 资源：经 `mcp://<服务>/<资源>` 用 read 读（w00032 t08）；`mcp://` 根列出各服务，`mcp://<服务>/` 列出它的资源。输入框 `@` 引用 MCP 资源、prompts 变斜杠命令、elicitation 接进提问通道以后再做；sampling 与 roots 不做（roots 会把本机目录暴露给服务）。
9. 生命周期：应用启动时后台连接已启用的服务，断线退避重连；缓存每个服务上次列出的工具，没连上时会话照样看到工具，调用时等连接、超时失败；超时缺省启动 30 秒、单次调用 60 秒，可按服务改；结果过长按工具结果的通用规则截断、全文进 `session://artifacts/`（w00032 t14）；设置页显示每个服务的状态（已连接、失败、要登录）。
10. 谁能改配置：添加服务等于信任它（同装插件，ADR 0022），只由用户在设置里添加；Agent 改这份配置要询问。
11. SDK：用官方 SDK，1.x 还是 v2 的 client 包在实施时按许可证与稳定性选型。

## 调研

[各家的 MCP 客户端](../w00032-agent-integration/research/2026-10-30-mcp-client-survey.md)（omp、Claude Code、Codex、OpenCode、Gemini CLI 的配置、传输、认证、命名、审批、资源与生命周期）。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-design/README.md) | 设计定稿：Spec 与实施计划 |

## 前置

w00032 的 t04（工具登记与绑定）、t06（审批）、t08（资源地址）、t09（凭据库）、t10（Agent 插件与 `agent.tools`）实现之后再实施；w00032 t20 排在最前。
