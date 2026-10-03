---
title: 实体
type: note
subtype: directory-index
status: active
icon: boxes
aliases: []
tags:
  - 目录说明
summary: "Stateful simulation entities."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 实体

本目录保存需要追踪状态的物品、地点机制、特殊对象或世界实体。

## 目录用途

`simulation/entities/` 存储所有需要追踪状态但不需要独立视角和记忆的世界元素，如魔法物品的当前耐久度、庄园的当前布局、机关的触发状态等。与 `simulation/subjects/` 不同，entities 没有主观体验和知识边界。

## 基本结构

每个 entity 可以是单个文件或子目录，取决于复杂度。简单 entity 直接用 `.md` 文件记录状态；复杂 entity 可建子目录包含多个状态文件。

## 命名约定

Entity ID 使用 kebab-case，如 `cursed-amulet`、`manor-east-wing`。

## 相关文档

- Entity 与 Subject 的区别：[reference/content/simulation.md](../../../reference/content/simulation.md)
- Lorebook Item vs Simulation Entity：[reference/content/lorebook.md](../../../reference/content/lorebook.md)
