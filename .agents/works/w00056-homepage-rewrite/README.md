---
schema: nbook.work/v1
workId: w00056-homepage-rewrite
issueId: null
status: active
updated: 2026-11-26
---

# 官网首页重写

## 目标

重写文档站首页（blog.notnotype.com/neuro-book/official/）：换上 2026-09 定稿的品牌，照实讲 v2 的现状与愿景，用滚动叙事讲一个故事，做出高级感；先定故事与脚本，再定动效语言与分镜，关键一幕做原型验证，然后实现与上线。

## 背景（2026-11-26 查）

- 现在的首页是另一个仓库 `agent-design-template` 里 landing-v2（React）的构建产物，副本在 [`docs/archived/vitepress/public/official/`](../../../docs/archived/vitepress/public/official/index.html)；源码在本机与 GitHub 的 notnotype 名下都没搜到，重写等于从零做。它讲的是 0.10.x 的功能（世界引擎、剧情工坊、承诺系统、写作工作室、llmlint）与旧的下载方式，没用上 2026-09 定稿的品牌（[`brand/logo/`](../../../brand/logo/README.md)、[`brand/mascot/`](../../../brand/mascot/README.md)）。
- 同域名的根路径 `/neuro-book/` 是 0.10.x 的 VitePress 文档站（源在 `docs/archived/vitepress/`）；部署流程在 w00017 t43 重组仓库时删了，线上是最后一次部署的样子。应用里“帮助 > 文档”用的地址 `notnotype.github.io/neuro-book/` 会跳到那里。
- 与 [w00037](../w00037-official-site/README.md) 的账号服务站（`nbook.notnotype.com`）不是同一个站。

## 范围

这个 Work 只做首页。文档站要不要按 v2 重建另议。

## Task

| Task | 内容 |
|---|---|
| [t01](tasks/t01-story-and-motion-design/README.md) | 首页的故事、脚本与动效设计：定位、基调、流程与三个方案共用的决定（进行中） |
| [t02](tasks/t02-paper-study-scheme/README.md) | 方案 A 书房《一部长篇的一生》：脚本、分镜与关键一幕原型（第 1 轮脚本待答） |
| [t03](tasks/t03-starsea-library-scheme/README.md) | 方案 B 星海书庭《书庭的一夜》：脚本、分镜与关键一幕原型（第 1 轮脚本待答） |
| [t04](tasks/t04-words-to-worlds-scheme/README.md) | 方案 A+B《从文字到世界》：脚本、分镜与关键一幕原型（第 1 轮脚本待答） |
