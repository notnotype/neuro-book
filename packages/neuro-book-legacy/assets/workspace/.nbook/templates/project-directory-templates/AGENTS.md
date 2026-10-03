# Project Agent Instructions

本文件是当前 Project Workspace 的项目级 Agent 入口。所有 profile 先遵守本文件，再遵守自己的 `agents/{profile}/context.md`、`agents/{profile}/memory.md` 与 `agents/{profile}/generated.md`。

## 文件用途

`AGENTS.md` 是项目的全局 Agent 指令，对所有 profile 可见。这里放置跨 profile 的通用规则、项目整体风格要求、禁忌事项等。与 `agents/{profile}/` 不同，这里的内容不按 profile 隔离。

## 典型内容

- 项目整体创作原则（如叙事风格、题材边界）
- 跨 profile 的通用禁忌（如避免的内容类型）
- 项目特定术语和约定
- 全局工作流提醒

## 相关文档

- AGENTS.md vs agents 边界：[reference/agent/profile-context-memory.md](../reference/agent/profile-context-memory.md)
- Profile Context Memory 机制：[reference/content/project-structure.md](../reference/content/project-structure.md)
