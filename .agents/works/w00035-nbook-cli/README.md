---
schema: nbook.work/v1
workId: w00035-nbook-cli
issueId: null
status: active
updated: 2026-10-30
---

# nbook 命令行：作品管理、服务形态与给 Agent 用的子命令

## 目标

设计随应用发布的 nbook 命令行的整体形态：作品管理（nbook project）、前台启动与后台服务（nbook start、nbook serve、注册成系统服务的那一个）、t15 定的 nbook skill init，以及应用内与外部 Agent 怎样知道并使用它。来源：w00032 t16 讨论（2026-10-30）。

## 已定的事

### `nbook project`（[w00032 t16](../w00032-agent-integration/tasks/t16-command-bridge/README.md) 讨论，开发者 2026-10-30 确认）

1. 一个命令行同时给用户、应用内的 Agent 与外部 Agent（Claude Code、Codex 等）用；应用内的 Agent 也在 shell 里调用 `nbook`，不另做工具。用途例子：用户让 Agent 新建一个作品；检查作品是否规范。
2. 第一批子命令：`list`、`info <短名或 id>`、`create <书名> [--parent --description --color]`（规则同书架页的新建，[`runtime.projects`](../../../docs/specs/runtime/projects.md) 输出 14）、`add <目录>`（登记已有目录）、`check [<短名、id 或目录>] [--fix]`。移出书架不进第一批。写操作要求应用在运行（登记表归服务端管，经认领套接字连上运行中的实例），没运行时报 `no-instance` 并提示 `nbook start`；`check` 只读目录，可以离线。照 `nbook` 的全局 `--json` 输出结构化结果与失败码。
3. `check` 可扩展：`nbook.projects` 查身份文件与登记，文件夹类型查清单（XML 不合法、条目名、未列入项、缺失条目），剧情插件这类插件经贡献点登记自己的检查（例如活页夹章节与清单是否一致）；每条问题带码、路径、严重程度、能否自动修复；`--fix` 只做确定安全的修复，缺省只报告。
4. 项目模板（旧应用的 `--template`）先不做，等剧情插件定了默认布局再加。
5. 旧应用 `workspace node …` 那组（内容节点的新建、解析、按类型的 frontmatter schema）不搬：新应用的内容规范是文件夹类型，经文件服务的操作自动同步清单，外部增删造成的不同步由 `check --fix` 兜底。
6. 让 Agent 知道这个命令：内置 Profile 的提示词里一两句话提到它并指向 `docs://` 下的说明；外部 Agent 另给一份 Skill（同 nb-story 的 `nbstory`）。第一版 Skill 只能由用户 `$` 触发（w00032 t15），不能只靠 Skill。

旧应用参照：`packages/neuro-book-legacy/server/workspace-files/workspace-command.ts`（`workspace project create/ensure/validate`、`workspace node new/state/parse/validate/schema`，输出 `nbook.workspace-cli/v1`）与 `assets/reference/agent/workspace-tool-use.md`。

### 其它来源

- `nbook skill init <id> [--yes]`：Skill 依赖的初始化，w00032 t15 已定。
- 现有命令行合同：[`runtime.cli`](../../../docs/specs/runtime/cli.md)（`nbook start` 前台运行、插件子命令离线写登记表）。

## 要讨论的问题

- 服务形态：`nbook start`（前台，终端拥有服务的寿命）、`nbook serve` 与注册成系统服务的子命令各是什么、哪个负责注册系统服务；与桌面外壳的关系。
- 子命令连运行中实例的协议（认领套接字上的请求形状）、没有实例时的行为。
- 命令行与 `nbook.projects` 远程服务的对应，`check` 的贡献点形状。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：子命令清单、与运行中实例的关系、服务形态、检查的扩展 | 未开工 |
