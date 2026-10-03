---
title: 正文写手
type: note
subtype: directory-index
status: active
icon: pen-line
aliases: []
tags:
  - 目录说明
summary: "Writer profile context directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 正文写手

本目录保存 writer profile 的项目上下文、长期记忆和生成推荐。

## 目录用途

`agents/writer/` 存储 writer profile 在当前项目中的写作风格偏好、常用修辞手法、跨 session 记忆和程序生成的推荐。writer 专注于根据大纲或指令生成正文。

## 基本结构

包含三个文件：`context.md`（Agent 自主维护的上下文选择）、`memory.md`（跨 session 长期记忆）、`generated.md`（程序生成的结构化推荐）。

## 相关文档

- Profile Context Memory 机制：[reference/agent/profile-context-memory.md](../../../reference/agent/profile-context-memory.md)
