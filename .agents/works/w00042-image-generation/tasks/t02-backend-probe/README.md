---
schema: nbook.task/v2
taskId: t02-backend-probe
status: planned
updated: 2026-11-06
---

# 后端接入探测

## 目标与范围

用真实令牌从 Bun 发普通请求，测通 NovelAI 的生成与 suggest-tags，定首发后端；实测 V5 的氛围迁移、质量词与负面预设由谁添加。

本 Task 只测，不写产品代码；结论写进 Work 决定表与本记录。令牌由开发者放进仓库根的 `.env`（例如 `NAI_TOKEN`），不进 Git。不模仿浏览器指纹。

## 当前状态

2026-11-06 经 nbdev 新建，尚未开工。

## 下一步

等开发者提供 NovelAI 令牌或 ComfyUI 地址。依据见[调研的 suggest-tags 一节](../../research/2026-11-06-tag-sources-and-novelai.md#suggest-tags)。
