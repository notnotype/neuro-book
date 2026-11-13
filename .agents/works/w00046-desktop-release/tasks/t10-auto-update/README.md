---
schema: nbook.task/v2
taskId: t10-auto-update
status: active
updated: 2026-11-13
---

# 桌面版自动更新

## 目标与范围

Electrobun Updater 接 GitHub Releases：后台检查与提示、下载前核对版本只升不降、下次启动时换上、安装级排他、目标移动后重新检查；便携版只提示。依据提案 4.6、ADR 0051 决定 6。

合同：[`runtime/desktop-update`](../../../../../docs/specs/runtime/desktop-update.md)；[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 11；[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 13。计划见 [plan.md](plan.md)，更新器调研见 [evidences/electrobun-updater-research.txt](evidences/electrobun-updater-research.txt)。

## 当前状态

2026-11-13：
- 页面一侧的设计审查（Sonnet）8 条，均改（[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-sonnet-disposition.txt)）。
- 壳与更新器的设计审查（omp）17 条，阻断 3 条（[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-omp-disposition.txt)）。阻断三条指向同一个上游问题：Spec 要求的“安装独占保持到新版本接手”，Electrobun 2.0.6 的原生 helper 做不到。**停下等开发者定方向**，未开始实施。

## 下一步

开发者在几个方向里选一个（见交付汇报），之后按方向修订 Spec 与计划，重新审查，再实施。
