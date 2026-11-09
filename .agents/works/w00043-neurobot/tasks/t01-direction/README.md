---
schema: nbook.task/v2
taskId: t01-direction
status: active
updated: 2026-11-09
---

# 方向讨论与同类项目调研

## 目标与范围

调研同类产品与开源实现的技术架构，盘点仓库里能复用的东西，和开发者讨论方向，定下要开发者拍板的分叉；方向定了再写提案（`docs/proposals/`）。需求原文见 [Work README](../../README.md#需求开发者-2026-11-09)。

非目标：本 Task 不建实现分支，不写代码。

合同：行为合同未变；提案接受后再定改哪些 Spec。

## 当前状态

2026-11-09：调研完成；开发者已定底座、QQ、记忆与第一版范围（见 [Work README 的决定](../../README.md#决定)）。Agent 能力怎么抽包在讨论：方案是按 w00032 t02 决定 3 把落在 `nbook.agent` 里的通用部分补回 nb-harness，等开发者定时机。

- [仓库内的现状](../../research/2026-11-09-repo-survey.md)：Agent 能力哪些在包里、哪些在应用插件里，压缩触发点，多 Agent 已定设计，与多实例拓扑的对照，nb-memory 的现状。
- [商业产品](../../research/2026-11-09-commercial-bots.md)：Grok Bot、Muse、ChatGPT Dots、DeepSeek super-agent（是技术文章加开源原型，不是论文）。
- [开源实现](../../research/2026-11-09-open-source-architecture.md)：OpenClaw（gateway、node、channel、会话键、压缩、做梦）、“OpenBOT”最可能是 CopilotKit/OpenBot、nanobot 与 Letta 的记忆整理、QQ 接入三条路线、Koishi 与 Satori 的适配器。
- 抽查过的事实：DeepSeek 原型仓库、CopilotKit/OpenBot 与 OpenClaw 的 star 数与创建时间（`gh api`），OpenClaw 的私信会话范围与做梦的缺省时间（克隆的文档原文）。

## 下一步

开发者定抽包的时机后写提案（`docs/proposals/`），先给开发者看要点再提交。
