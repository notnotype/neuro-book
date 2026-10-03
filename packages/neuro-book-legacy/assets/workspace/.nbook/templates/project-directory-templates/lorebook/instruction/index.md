---
title: 创作指令
type: note
subtype: directory-index
status: active
icon: shield-alert
aliases: []
tags:
  - 目录说明
summary: "Instruction lorebook category."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 创作指令

本目录保存作品级 AI 使用说明，例如创作边界、检索、披露和 continuity。

## 目录用途

`lorebook/instruction/` 存储 AI 在执行创作任务时的专用指令，如"哪些内容不应直接展示"（creation-boundaries）、"如何选择检索内容"（retrieval）、"如何处理秘密披露"（disclosure）等。这些指令是作品级的创作规范，不是 profile 级的技术指导（profile 指导放入 `agents/`）。

## 基本结构

子目录按指令类型组织，如 `creation-boundaries/`、`retrieval/`、`disclosure/` 等。

## 相关文档

- Lorebook Instruction 分类：[reference/content/lorebook.md](../../../reference/content/lorebook.md)
- Agent Context vs Lorebook Instruction：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
