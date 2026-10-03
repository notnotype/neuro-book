# Workspace Tool Use

本文档写给需要读写 Project Workspace 的 Agent。它只记录稳定工具选择规则，不描述某个 profile 的身份或协作风格。

## File Tools

- 读普通文件正文用 `read`，不要用 `bash` 调 `cat` / `head` / `tail` / `sed` / `python` 代替。
- 大文件按 `read` 返回的 `offset` / `limit` 提示继续读取，直到拿到需要的内容。
- 新建文件或完整重写文件用 `write`；局部修改现有文件时不要用 `write` 覆盖整文件。
- 精确修改单文件用 `edit`。多个分散位置应放在同一次 `edit.edits[]` 中。
- `edit.oldText` 必须唯一、精确、非重叠。相邻或同一块改动合并成一个 edit。
- `apply_patch` 是 Codex 风格 freeform patch 工具，只用于当前内容已确认、天然适合一个 cohesive patch 的改动。不要传 JSON，不要传 `{ path, patch }`。
- `apply_patch` 失败后先重新读取当前文件，再生成新的修改。
- 相对路径从当前 File Scope 解析；任意绝对文件系统路径可直接用于 `read`、`write`、`edit` 和 `apply_patch`。
- 访问另一个 managed Project 且需要 Project open gate、History 或 Context Access 时，优先使用 `workspace/<project-slug>/<relative-path>`；外部绝对路径不自动获得这些 Project 语义。

## Bash

- `bash` 只用于真实终端操作：`rg`、`find`、`ls`、`git`、测试、构建、workspace CLI、脚本验证等。
- 搜索文件列表优先用 `rg --files`；搜索文本优先用 `rg`。
- `bash` 命令必须按 bash 语法编写；不要写 PowerShell、cmd 或其他 shell 语法。
- Agent 文件工具与 bash 已绑定同一 File Scope，不要传 `workdir`。
- 不要用 `bash` 拼接高风险写入命令替代 `edit`、`apply_patch` 或 `write`。
- 脚本失败时读取错误并说明阻塞原因，不要假装验证成功。

## Workspace CLI

- 内容节点 CLI 的稳定入口是 `workspace node ...`。
- Project-bound session 的 File Scope 是 Current Project Workspace；访问当前小说直接使用 `lorebook/...`、`manuscript/...`、`simulation/...`。
- 允许跨 Project Workspace 写作和检查；需要保留 managed Project 身份时使用 `workspace/<project-slug>/<relative-path>` 完整 Project File Address，已知绝对目标也可直接访问。
- 仓库源码与仓库级 `reference/` 位于当前 File Scope之外；当用户、skill catalog或其他上下文给出绝对路径时，直接使用该绝对路径。
- 路径分隔优先使用 `/`。

## Parallel Calls

- 可以并行调用互不依赖的工具。
- 依赖前一个结果时必须顺序调用。
