---
title: 世界书
type: note
subtype: directory-index
status: active
icon: library
aliases: []
tags:
  - 目录说明
summary: "Project lorebook directory conventions."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 世界书

本目录保存稳定设定、世界规则、角色/地点/势力/物品资料和可复用 AI instruction。会随剧情变化的动态状态记录进 World Engine 时间线，临时计划放入 `.agent/plan/` 或 Plot System。

## 目录用途

`lorebook/` 是项目的静态知识库，存储全知视角的世界设定和创作规范。这里的内容是"真相"和"原型"，不随剧情推进变化。会变化的运行态数据（角色当前想法、物品实时状态）由 World Engine 时间线记录，不放进 `lorebook/`。

## 基本结构

## 基本结构

- `world/`：世界结构、历史、地理、文化、生态和世界内规则。
- `character/`：上帝视角角色设定、背景、秘密和作者备注。
- `location/`：地点，按真实空间层级组织。
- `faction/`：国家、阵营、政治实体和冲突集团。
- `item/`：物品原型、装备、道具、文档、材料和设备。
- `event/`：已发生的历史事件和背景事件。
- `system/`：可运行或可模拟的机制、玩法模块和状态规则。
- `instruction/`：作品级 AI 使用说明，例如创作边界、检索、披露和 continuity。
- `note/`：初始化素材、低置信设定、待整理说明和临时世界书笔记。

## 相关文档

- Lorebook 分类规则与内容指南：[reference/content/lorebook.md](../../reference/content/lorebook.md)
- Lorebook 与 World Engine 的分工边界：[reference/content/project-structure.md](../../reference/content/project-structure.md)
