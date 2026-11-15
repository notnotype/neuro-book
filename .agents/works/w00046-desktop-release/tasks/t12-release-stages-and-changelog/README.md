---
schema: nbook.task/v2
taskId: t12-release-stages-and-changelog
status: active
updated: 2026-11-15
---

# 发布阶段、变更记录与发版脚本

## 目标与范围

发布阶段 canary → preview（预览版，也叫测试版）→ stable 的规则（ADR 0053）、各发布单元的 CHANGELOG 与由它生成的中文 Release 说明、发版脚本 `release:prepare`、发布手册 `docs/standards/releasing.md`；安装包与便携版从下一版起改名为 `NeuroBook-win-x64-Setup.zip`、`NeuroBook-win-x64-portable.zip`；主题声明要求的 nb-ui 版本由 nb-ui 的测试核对。

开发者 2026-11-15 定：现在的版本都是 canary，GitHub 的 latest 可以指向最新的 canary；npm 的阶段规则只管以后，GitHub 上的 v0.13.0 现在就改（已改标题与说明）；治理大部分照 omp；Release 说明先只写中文；安装包只改以后的。

合同：产品行为合同不变；发布规则写进 ADR 0053 与发布手册。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建；计划初稿写成。

2026-11-15：切片 1 提交（`82d1affd6`，nb-ui 的测试核对自带主题的 `hostVersion` 接受当前版本；故意改坏一个主题时失败）。

2026-11-15：设计审查第 1 轮：omp 10 条（阻断 1、重要 8、建议 1）、Sonnet 拉远看 10 条，都成立或部分成立，计划改成 r2（[omp](evidences/design-review-r1-omp.txt)、[拉远看](evidences/design-review-r1-zoomout.txt)、[处理](evidences/design-review-r1-disposition.txt)）。要点：
- CHANGELOG 不进 npm 包：已发的库加上它字节就变，下次发 nb-story 会被发布计划拦下；
- 说明在门禁里生成并作为工件交给 Release 作业，生成失败停在远端写入之前；只展开应用的变更，同时发布的 npm 包每个一行链到它的 CHANGELOG；
- 门禁要求应用的 `[Unreleased]` 为空，堵住定稿到打标签之间进来的条目；
- 发版脚本只在与 origin 同步的 master 上跑，源码包照 ADR 0029 手工提版，先检查全部再一次写；
- ADR 0053 写第一个稳定版的迁移合同；
- 开发者选定安装包叫 `NeuroBook-win-x64-Setup.zip`、便携版 `NeuroBook-win-x64-portable.zip`（固定的最新版直链）。

## 下一步

按 r2 的切片 2 到 7 实施。
