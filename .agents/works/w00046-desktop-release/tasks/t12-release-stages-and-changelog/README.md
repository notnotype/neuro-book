---
schema: nbook.task/v2
taskId: t12-release-stages-and-changelog
status: active
updated: 2026-11-15
---

# 发布阶段、变更记录与发版脚本

## 目标与范围

发布阶段 canary → preview（预览版，也叫测试版）→ stable 的规则（ADR 0053）、各发布单元的 CHANGELOG 与由它生成的中文 Release 说明、发版脚本 `release:prepare`、发布手册 `docs/standards/releasing.md`；安装包从下一版起改名为 `NeuroBook-<版本>-win-x64-Setup.zip`；主题声明要求的 nb-ui 版本由 nb-ui 的测试核对。

开发者 2026-11-15 定：现在的版本都是 canary，GitHub 的 latest 可以指向最新的 canary；npm 的阶段规则只管以后，GitHub 上的 v0.13.0 现在就改（已改标题与说明）；治理大部分照 omp；Release 说明先只写中文；安装包只改以后的。

合同：产品行为合同不变；发布规则写进 ADR 0053 与发布手册。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建；计划初稿写成，交 omp 做计划审查。

## 下一步

处理计划审查，按切片实施。
