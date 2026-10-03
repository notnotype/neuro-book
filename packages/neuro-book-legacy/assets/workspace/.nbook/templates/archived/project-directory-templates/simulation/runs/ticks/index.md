---
title: Tick 记录
type: note
subtype: directory-index
status: active
icon: list-tree
aliases: []
tags:
  - 目录说明
summary: "Simulation tick records."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# Tick 记录

本目录保存每一轮 simulation / RP tick 的报告、正文和相关过程材料。

## 目录用途

`simulation/runs/ticks/` 是所有 tick 过程记录的存储位置，每个 tick 是一个独立子目录。Tick 目录包含推演报告、用户可见正文、输入材料和可选的中间产物，用于复盘、调试和审计。

## 基本结构

每个 tick 目录命名格式为 `000001-short-slug`，必须包含 `report.md`（裁决报告），推荐包含 `prose.md`（用户可见正文）。其他文件（如 `input.md`、actor packets、tool logs）可由 runtime 自动生成。

## 命名约定

Tick 目录使用六位数字 + 短横线 + slug，如 `000001-manor-arrival`、`000042-duel-outcome`。

## 相关文档

- Tick 记录规范与文件职责：[reference/content/simulation.md](../../../../reference/content/simulation.md)
- RP Tick 工作流：[reference/agent/rp-tick/README.md](../../../../reference/agent/rp-tick/README.md)
