---
schema: nbook.task/v2
taskId: t25-plugin-marketplace
status: done
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

## 决定（开发者 2026-10-30）

整个 Task 移到新开的 [w00038 插件分发](../../../w00038-plugin-distribution/README.md)，决定记在那边的“已定的事”：安装来源有 git（任何 git 服务）、npm、官方市场、第三方市场与离线压缩包；更新第一版手动；装好的插件不让改，要改就复制到用户级；封禁的版本停用并通知、不自动卸载；Agent 只能推荐、安装要用户确认。官方网站与配套服务（登录、备份、跨设备同步、社区、官方市场，安全措施照 VS Code）另开 [w00037](../../../w00037-official-site/README.md)。调研：[插件市场](../../research/2026-10-30-plugin-marketplace-survey.md)。

## 当前状态

讨论完成，转入 w00038 与 w00037。

## 下一步

无；后续在 w00038、w00037。
