---
title: 模拟记录
type: note
subtype: directory-index
status: active
icon: activity
aliases: []
tags:
  - 目录说明
summary: "Simulation run index."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 模拟记录

本文件索引当前 Project Workspace 的 simulation / emulation tick。`runs/` 是过程记录，不是 canonical lorebook，也不是 subject 长期记忆。

## 目录用途

`simulation/runs/` 记录每一轮 RP tick 或世界推演的完整过程，包括裁决报告、用户可见正文、输入材料和工具日志。这些记录是可追溯的审计日志，不应被后续 tick 修改或覆盖。

| Run | Title | Mode | World Time | Status | Summary |
| --- | --- | --- | --- | --- | --- |
| 000000 | Initial State | bootstrap | 待填写 | draft | 初始运行态模板。 |

## 维护规则

- tick 目录使用 `000001-short-slug` 形式命名。
- 每个 tick 第一版只要求维护 `report.md` 和可选 `prose.md`。
- `report.md` 写后台推演、裁决、状态提交和 writer-safe brief。
- `prose.md` 只写用户可见正文；RP Tick 应保存 `rp.writer` 输出的完整正文，`rp.leader` 只负责链接和元场景组装。
- `input.md`、actor packets、commit log 和 tool log 等机械产物后续可由 workflow/runtime 自动生成，第一版不要求手写。
