# 各家的 MCP 客户端（2026-10-30）

- 问题：[t19](../tasks/t19-mcp/README.md) 要定 MCP 插件的配置、传输、认证、工具命名、审批、资源与生命周期。
- 做法：一个 Haiku 子代理读 omp 源码与 Claude Code、Codex、OpenCode、Cursor、Gemini CLI 的官方文档；主会话核对了 omp 的工具命名、审批档位与协议版本。
- 证据等级：**源码（核实）** 为主会话读过原文；**源码** 为子代理读源码；**文档** 为官方文档经抓取工具摘要（部分页面被截断）。

| 项 | omp | Claude Code | Codex | OpenCode | Gemini CLI |
|---|---|---|---|---|---|
| 配置与作用域 | 项目 `.mcp.json`、`mcp.json` 与用户配置；项目配置缺省启用，没有信任流程（源码） | 本地、项目（`.mcp.json`）、用户；项目级首次使用前要批准，`-p` 与 SDK 不问（文档） | `config.toml` 的 `[mcp_servers.<名>]`；项目级只在受信任项目生效（文档） | `opencode.json` 的 `mcp` 键（文档） | 用户与项目的 `settings.json`（文档） |
| 传输与变量 | stdio、http、sse（源码） | http、sse（弃用）、stdio、ws；`${VAR}`、`${VAR:-默认}`（文档） | stdio、Streamable HTTP；按名点出环境变量（文档） | local、remote；`{env:VAR}`（文档） | stdio、SSE、HTTP；`$VAR`（文档） |
| 认证 | OAuth 发现与流程（源码） | `/mcp` 开浏览器，token 安全存储并刷新（文档） | `codex mcp login`（文档） | 401 时自动 OAuth，token 存本机文件（文档） | 401 时自动 OAuth（文档） |
| 工具名 | `mcp__<服务>_<工具>`，超过 64 字符截断加 8 位哈希；注释写 OpenAI 的上限是 64，超过报 400（源码，核实） | `mcp__<服务>__<工具>`，超过 128 字符不能调用（文档） | 未查到 | 服务名前缀（文档） | `mcp_<服务>_<工具>`，超过 63 字符截断（文档） |
| 工具多时 | 可禁用服务，没有按需加载（源码） | 缺省开工具搜索，定义延迟加载（文档） | `enabled_tools`、`disabled_tools`（文档） | 按名或通配关闭（文档） | `includeTools`、`excludeTools`（文档） |
| 审批 | MCP 工具一律按“写”，只读标记只用于预读，不放宽审批（源码，核实）；可按工具配置 | 权限规则按服务或工具；文档没说只读标记能免审批（文档） | “非只读才问”的档位用只读标记（文档） | 未查到 | `trust: true` 跳过该服务的全部确认（文档） |
| 资源与 prompts | 资源经 `mcp://` 读；prompts 只列出；只声明 roots（源码） | `@服务:地址` 引用资源；prompts 是斜杠命令；支持 elicitation（文档） | 未查到 | 未查到 | `@服务://路径`；prompts 是斜杠命令（文档） |
| 生命周期 | 请求超时 30 秒；启动等 250 毫秒后转后台连接；断线退避重连 15 秒起、上限 5 分钟（源码） | 启动与调用超时可配；远程断线重试 5 次；工具结果缺省上限 25,000 token（文档） | 启动 10 秒、调用 60 秒（文档） | 缺省 30 秒（文档） | 缺省 600 秒（文档） |

- 规范：最新版 2026-07-28；omp 固定 2025-11-25（源码，核实）。规范写明工具注解应视为不可信，除非来自可信服务（文档）。
- 官方 TypeScript SDK：`@modelcontextprotocol/sdk` 1.x 为 MIT；2026-07 发布 v2，拆成 `@modelcontextprotocol/client` 与 `server`，许可证说明为新贡献 Apache-2.0、旧代码 MIT（检索，未核对 LICENSE 文件）。
