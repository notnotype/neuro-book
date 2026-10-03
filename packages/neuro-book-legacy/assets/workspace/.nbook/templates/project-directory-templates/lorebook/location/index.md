---
title: 地点
type: note
subtype: directory-index
status: active
icon: map-pinned
aliases: []
tags:
  - 目录说明
summary: "Location lorebook category."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 地点

本目录保存地点、空间层级、区域关系、环境细节和地点秘密。

## 目录用途

`lorebook/location/` 存储具体地点的静态设定，如城市、建筑、房间的布局、外观、历史和隐藏秘密。按真实空间层级组织（大陆 → 国家 → 城市 → 街区 → 建筑 → 房间）。不追踪动态状态（如"房间当前有什么人"），需要追踪的地点动态状态登记为 World Engine subject，记录进时间线。

## 基本结构

子目录按空间层级组织，从大到小嵌套。

## 命名约定

地点目录使用 kebab-case，如 `imperial-capital`、`manor-east-wing`。

## 相关文档

- Lorebook 分类规则：[reference/content/lorebook.md](../../../reference/content/lorebook.md)
