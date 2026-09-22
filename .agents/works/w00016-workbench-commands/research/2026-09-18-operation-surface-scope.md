# 操作面需求全景与后续立项记录（2026-09-18）

> **性质**：需求记录，不是 Proposal、Spec 或 Task 合同。作为 w00016 范围之外后续立项（感知面、外部绑定、Headless 模式）的输入。
> **来源**：2026-09-18 开发者需求讨论。命令系统本体（本次范围）见 `docs/proposals/workbench-commands.md`（w00016 承接）。

## 总体方向

NeuroBook 要让**外部通用 agent**（Claude Code、Cursor 等，并非内置 Leader 专属）能够感知并操作自身：提供一套 API，形式上可以是 CLI / Skill / MCP。Web UI 的操作走命令系统，不依赖黑盒自动化（Playwright / computer-use）。

## 两种操作模式

| 模式 | 形态 | 操作者 | 特点 | 状态 |
|---|---|---|---|---|
| Headless（无头） | `nbook` CLI + 结构化输出；`nbook tui` | 外部 agent / 工具；**也可以是用户** | 快、直接、可脚本化、不依赖 UI | 未开始 |
| Live（在场） | Web UI + 命令系统（命令面 + 感知面） | 外部通用 agent | 以用户视角操作真实实例；操作可见、可教学 | 命令面进行中（w00016） |

开发者原话要点：CLI 就是快、直接；Web UI 能让 agent 以用户的角度解决问题、站在用户的角度，还可以作为教程 agent 引导用户使用软件。

## Live 感知面（需求草案，另行设计）

- **目的**：让外部 agent 读取运行中的 NeuroBook 状态。命令面回答"能做什么"，感知面回答"现在是什么"。
- **方向**：提供读工具——读组件状态、读整个应用状态、读 DOM；方式多样；还能截图。
- **展开时机**：开发者明确"后续需展开讨论"；本次（w00016）只做命令面，感知面不作实现承诺。
- **预留**：capability 名 `workbench.observation`（未登记 spec）。

## 外部接入形态（需求草案，另行设计）

- 形式：CLI 绑定 / Skill 绑定 / MCP 绑定；面向任何通用 agent。
- 与命令面的关系：绑定层把命令面（及未来感知面）导出为外部可用形式；命令描述符按"可机械导出为工具定义"的形状设计（提案已要求）。
- 安全：外部 agent 的操作权限与用户不等价；暴露策略默认关闭（见提案方案 6）。

## Headless 模式（愿景记录，本次不做）

- `nbook` CLI 以结构化形式暴露 NeuroBook 功能，例如：新建项目、查看配置、打开 agent TUI、headless 调用 agent。
- `nbook tui`：用户直接与 NeuroBook 里的 Leader agent 交流，不开启 Web UI 也能用。
- 操作者既可以是外部 agent / 工具，也可以是用户本人。
- 状态：未开始实现；开发者指示"本次不做 headless"。

## 对照要点（支撑材料）

- 黑盒 UI 自动化 vs 命令面：见提案「定位与术语」的对比表（稳定性 / 语义 / 失败诊断 / 结果 / 可见性 / 覆盖）。
- 行业参照：MCP 工具的显式声明与 annotations（`readOnlyHint` / `destructiveHint` / `idempotentHint`）；VS Code Language Model Tools 的"工具显式列举"惯例；VS Code 命令与快捷键机制（w00003 `research/2026-09-15-storage-layer-and-commands-vscode-comparison.md`）。
