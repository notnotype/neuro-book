---
schema: nbook.task/v2
taskId: t12-release-stages-and-changelog
status: done
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

2026-11-15：切片 2 到 7 完成（Work 分支 `feat/w00046-t12-release-stages`，worktree `.worktree/w00046-t12-release-stages`：`9befa0c18`、`ff3951f2c`、`b17d40b17`、`8764fa23d`、`1ccfb9946`、`3bca6fd8b`）。验证见 [local-verification-r1.txt](evidences/local-verification-r1.txt)：
- scripts 218 条、nb-ui 主题 78 条、neuro-book 的 `src/shared` 与 `src/desktop` 167 条测试通过；类型检查、actionlint、`docs:check`、`governance:check` 通过；
- `release:prepare` 在一次性克隆里真实跑了一次：落后 origin 时什么都不写；同步后提交 `release: v0.13.1`（版本两处、CHANGELOG 定稿、`bun.lock`），随后门禁的说明检查通过；
- 本机渲染了下一次演练会生成的 0.13.0 说明与一份 0.13.1 样例。
- 与计划的出入：ADR 0053 写成“补充” 0029 决定 5 与 0051 决定 7，不是部分取代（第一个稳定版之前 npm 仍只发 `latest`，0029 没有被推翻的部分）；根 `AGENTS.md` 没改（主工作区有开发者没提交的改动），它的“发布操作”一行指向 `repository-workflow.md`，那里链到发布手册；改变更记录的规则写进 `packages/AGENTS.md`。

2026-11-15：实现审查第 1 轮（omp）4 条（重要 3、建议 1），都成立已改（[报告](evidences/impl-review-r1-omp.txt)、[处理](evidences/impl-review-r1-omp-disposition.txt)）：发版脚本的“上一版”改为与门禁同一来源（GitHub 上有安装包的）、写入之后失败就还原、源码包不许降版本、变更记录的版本段要从新到旧。两处 IO 改动在一次性克隆里真实运行验过。变基后快进合入 master（`159fd4cca`）。

## 下一步

推 master 之后（要开发者授权）在 Actions 上演练一次：门禁输出阶段并生成说明（看作业摘要）、桌面冻结的改名与安装版、便携版冒烟。草稿的标题与正文、`upgrade-from-previous` 认旧安装包名，到下一个标签第一次真正用上。
