---
title: 正文
type: volume
subtype: null
status: draft
icon: book-open-text
aliases: []
tags: [] # 中文短标签；有明确分类意义、易理解、可复用，不要为了填字段随意设置。
summary: ""
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: manual
  review: proposed
ext: {}
---

# 正文

这里放正文草稿与章节节点。正式项目推荐使用 `manuscript/001-volume/001-chapter/` 这类卷/章层级；示范卷和示范章节只用于说明结构，可以重命名、改写或删除。

## 目录用途

`manuscript/` 存储项目的正式输出正文，按卷/章/节层级组织。这里是"最终交付"的内容，不是过程记录（剧情推演的过程状态记录进 World Engine 时间线）。

## 基本结构

推荐使用三级层级：`001-volume/`（卷）→ `001-chapter/`（章）→ `001-scene/`（节），每个节点包含 `index.md`（元数据和说明）和实际正文文件。

## 命名约定

卷/章/节目录使用三位数字前缀 + 短横线 + slug，如 `001-opening-volume`、`003-duel-chapter`。

## 相关文档

- Manuscript 组织规范：[reference/content/project-structure.md](../../reference/content/project-structure.md)
