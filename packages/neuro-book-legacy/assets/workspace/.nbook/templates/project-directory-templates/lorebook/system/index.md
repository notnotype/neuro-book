---
title: 系统机制
type: note
subtype: directory-index
status: active
icon: settings
aliases: []
tags:
  - 目录说明
summary: "System lorebook category."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 系统机制

本目录保存可运行或可模拟的机制、玩法模块和状态规则。

## 目录用途

`lorebook/system/` 存储项目内的可执行机制，如魔法系统、战斗规则、社交玩法、经济模型等。这些是"规则原型"，定义"系统如何工作"，不追踪"系统当前状态"（如玩家当前魔法值），动态状态登记为 World Engine subject，记录进时间线。

## 基本结构

子目录按系统类型组织，如 `magic/`、`combat/`、`economy/` 等。

## 相关文档

- Lorebook 分类规则（含 System 规则原型与 World Engine 动态状态的边界）：[reference/content/lorebook.md](../../../reference/content/lorebook.md)
