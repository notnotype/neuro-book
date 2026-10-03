---
title: 世界引擎
type: note
subtype: directory-index
status: active
icon: upload
aliases: []
tags:
  - 目录说明
summary: ""
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 世界引擎

本目录保存当前 Project Workspace 的 World Engine 配置。

- `calendar.ts`：项目日历与时间字符串 parse / format 真相源。
- `schema/index.ts`：项目 World Engine schema 真相源，使用 TypeScript + Zod。

这两个文件都是单文件配置入口。不要把 Project 本地 helper 拆成 `./xxx.ts`、绝对路径或 `file://` URL 再 import；需要 helper 时请直接写在入口文件里，或使用 `zod`、`nbook/world-engine/schema` 等包级 import 与 `node:` 内置模块。

普通写作模式下，动态世界状态与时间线只走 World Engine。不要在本目录创建 `schema.yaml` 或 `calendar.yaml`；旧 YAML 资料只作为历史迁移参考。
