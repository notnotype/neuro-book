---
schema: nbook.task/v2
taskId: t25-plugin-marketplace
status: planned
updated: 2026-10-30
---

# 插件市场

## 目标与范围

参照 Claude Code 的插件市场设计 NeuroBook 的插件市场：索引格式、来源、版本与更新、本地改动、信任与下架；Skill 经插件分发

来源：t15 讨论（开发者 2026-10-30）：Skill 的更新与市场参照 Claude Code 的插件市场，另开 Task 讨论。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec（[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 现在只收本地目录）。

## 已知情况

- 调研：[各家的 Skill](../../research/2026-10-30-skill-survey.md) 第 4 节（Claude Code 的 `marketplace.json`、ClawHub、omp、旧应用的账本与“接受上游 / 保留本地”）。
- 开发者 2026-10-30 定（t15 第 9 条）：最小安装单位是插件，市场分发的是插件，Skill 跟着插件走。
- 2026-10-30 t15 讨论中的推荐（未定）：单个 Skill 上架时由工具自动包成只含 Skill 的插件；更新缺省手动、可固定版本；本地改过时给“用新版（旧内容进回收区）”与“保留自己的”两个出口。

## 当前状态

草稿，未开工（2026-10-30 建）。

## 下一步

轮到时与开发者逐条讨论。
