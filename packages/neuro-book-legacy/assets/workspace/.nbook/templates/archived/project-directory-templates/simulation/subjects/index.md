---
title: 主体
type: note
subtype: directory-index
status: active
icon: users-round
aliases: []
tags:
  - 目录说明
summary: "Information-control subjects."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 主体

本目录保存玩家、NPC 和其他信息控制主体的事件、记忆、心理和状态。

## 目录用途

`simulation/subjects/` 存储所有需要独立视角、记忆和心理的角色（包括玩家化身、NPC、组织代表等）。每个 subject 是一个**信息控制主体**，拥有自己的知识边界、误解空间和成长轨迹，与 `lorebook/character/` 的上帝视角设定形成互补。

## 基本结构

每个 subject 是一个子目录，包含六个标准文件：`soul.md`（跨剧情恒定性格）、`subject.md`（全知秘密档）、`events.jsonl`（第一人称经历流）、`memory.jsonl`（对特定主体的稳定看法）、`mind.md`（当前想法）、`state.md`（可见状态）。

## 命名约定

Subject ID 使用 kebab-case，如 `protagonist`、`elder-maid`、`baron-brauer`。

## 相关文档

- 详细文件职责与分流规则：[reference/content/subjects.md](../../../reference/content/subjects.md)
- Subject 创建流程：[reference/agent/rp-tick/subject-creation-guide.md](../../../reference/agent/rp-tick/subject-creation-guide.md)
- Simulation 目录总览：[reference/content/simulation.md](../../../reference/content/simulation.md)
