---
schema: nbook.task/v2
taskId: t03-search-settings-redesign
status: active
updated: 2026-11-25
---

# 搜索与网页设置页重做：服务商 logo、列表版式与四项新设置

## 目标与范围

“搜索与网页”页在服务商变多以后不变长：版式先出两版静态稿、评审后择一；每家服务商带 logo；加四项设置。定稿后改 Spec、再实现。

合同：[`web/settings-page.md`](../../../../../docs/specs/web/settings-page.md)、[`web/tools.md`](../../../../../docs/specs/web/tools.md)（新设置的行为），定稿后改。

## 来源

开发者 2026-11-25 看了 t02 的设置页：“设置怎么这么少？是不是少了一些设置？”；“使用”用分段单选，“如果搜索服务多起来后这个就会变得很长”；“可以给这些搜索服务的提供商提供 logo”。

现状：t02 的页面是单列，顶上“使用”一行分段单选（DeepSeek、Tavily），下面每家一整节（密钥、检测、说明）；接口地址只能改设置文件。参照是模型设置页的服务商列表（`ProvidersPage`：左栏 `ProviderRail` 加右边详情，窄于 600px 时左栏换成下拉；w00032 t29、t43 定的版式）。logo：模型页用的 `@lobehub/icons-static-svg`（MIT，应用的图标表 `src/ui/provider-icons/`）里已有 Tavily、Exa、DeepSeek、Brave、Bocha、Jina、Firecrawl、Kagi、Perplexity、SearXNG、Bing。

## 决定

开发者 2026-11-25（会话里选的）：

1. 加四项设置：每家的接口地址（现在只能改设置文件）、缺省结果条数（Agent 没写 `count` 时用）、屏蔽网站、Tavily 的搜索深度（basic 每条 1 点额度、advanced 2 点）。
2. 版式先出两版静态稿再定：照模型页的“左边列表、右边详情”，与“下拉加可折叠卡片”。

## 当前状态

2026-11-25：开工，出第 1 轮静态稿。

## 下一步

草稿 worktree 里搭两版静态稿，请 `@designer` 当顾问，发评审板。
