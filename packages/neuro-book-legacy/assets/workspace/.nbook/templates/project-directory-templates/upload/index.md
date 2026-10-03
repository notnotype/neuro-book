---
title: 上传
type: note
subtype: directory-index
status: active
icon: upload
aliases: []
tags:
  - 目录说明
summary: "Uploaded project material directory."
refs: []
retrieval:
  enabled: false
  trigger: null
governance:
  source: system-template
  review: reviewed
ext: {}
---

# 上传素材

本目录保存用户上传到当前 Project Workspace 的待整理文件和素材。

## 目录用途

`upload/` 是用户上传文件的默认存放位置，所有通过 UI 或 API 上传的文件会先落地到这里。这是一个临时暂存区，上传后应根据内容类型整理到 `lorebook/`、`reference/`、`manual/` 等目录。

## 基本结构

文件按上传时间或用户自定义分组存放，可使用子目录组织。

## 相关文档

- Upload 目录清理规范：[reference/content/project-structure.md](../../reference/content/project-structure.md)
