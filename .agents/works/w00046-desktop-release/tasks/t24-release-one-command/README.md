---
schema: nbook.task/v2
taskId: t24-release-one-command
status: active
updated: 2026-11-20
---

# 发版跑通：CI 全绿、一条命令推送、流水线发 npm 与 Release（含 macOS）

## 目标与范围

来源：开发者 2026-11-20（“可以再发一个新 canary 版了，本次把 CI 全流程都彻底跑通，做到一条命令帮助推送，然后 github action 全发布，包括 npm，release。还有再研究一下 release note 谁来写”）。

- 修好 master 上让 Release 流水线跳过 npm 与 Release 的 CI 失败（v0.14.0、v0.14.1 都因此没发 npm）；
- 一条命令发版：准备提交、master 与标签原子推送、盯流水线；
- macOS 桌面包并进 Release 流水线（t23 的工作流改成可复用），不再手动补传；
- 调研 Release 说明由谁写：推送时记、还是在 Actions 里用 Agent 写；参照 omp。
- 发一个新的 canary 版本。

合同：行为合同未变（发布手册 `docs/standards/releasing.md` 随流程一起改）。

## 当前状态

进行中。
