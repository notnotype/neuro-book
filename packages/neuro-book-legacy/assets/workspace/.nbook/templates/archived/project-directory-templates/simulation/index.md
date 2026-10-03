---
title: 世界模拟
type: note
subtype: directory-index
status: active
icon: activity
aliases: []
tags:
  - 目录说明
summary: "World simulation runtime directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 世界模拟

本目录保存世界运行态、subject 状态、entity 实例和 tick 过程记录。

## 目录用途

`simulation/` 是项目的运行态根目录，存储所有会随剧情推进而变化的动态状态。与 `lorebook/` 的静态设定不同，这里记录的是"世界正在发生什么"——角色的当前想法、物品的实时状态、每一轮推演的过程记录。

## 基本结构

包含三个子目录：`subjects/`（信息控制主体）、`entities/`（有状态物品/地点）、`runs/`（tick 过程记录）。

## 相关文档

- Simulation 目录总览与设计理念：[reference/content/simulation.md](../../reference/content/simulation.md)
- Simulation vs Lorebook 边界：[reference/content/project-structure.md](../../reference/content/project-structure.md)
