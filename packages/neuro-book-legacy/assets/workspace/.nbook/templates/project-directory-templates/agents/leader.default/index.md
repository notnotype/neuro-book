---
title: 默认负责人
type: note
subtype: directory-index
status: active
icon: compass
aliases: []
tags:
  - 目录说明
summary: "Default leader profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 默认负责人

本目录保存 leader.default profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agents/leader.default/` 存储 leader.default profile 在当前项目中的协调偏好、决策规则、跨 session 记忆和程序生成的推荐。leader.default 是通用协调者，适用于没有专门 leader profile 的场景。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
