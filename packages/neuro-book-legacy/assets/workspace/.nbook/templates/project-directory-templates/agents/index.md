---
title: 智能体上下文
type: note
subtype: directory-index
status: active
icon: bot
aliases: []
tags:
  - 目录说明
summary: "Profile-scoped agent context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 智能体上下文

本目录保存各 profile 的项目专用上下文、长期记忆和自动生成的推荐材料。

## 目录用途

`agents/` 为每个 profile 提供项目级的专用存储空间，保存 Agent 在特定项目中的上下文选择、跨 session 记忆和程序生成的推荐。与项目根的 `AGENTS.md`（对所有 profile 可见）不同，这里的内容按 profile 隔离。

## 基本结构

每个 profile 可按需拥有一个子目录（如 `leader.default/`、`writer/`），包含三个标准文件：`context.md`（Agent 自主维护）、`memory.md`（跨 session 记忆）、`generated.md`（程序生成推荐）。普通写作模式默认不创建 RP / simulator / director 上下文目录；需要 RP 或历史世界模拟能力时使用专用模板或手工迁移（相关 skill 已归档，见 `docs/archived/skills/`）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../reference/agent/profile-context-memory.md)
- Agent Context vs AGENTS.md 边界：[reference/content/project-structure.md](../../reference/content/project-structure.md)
