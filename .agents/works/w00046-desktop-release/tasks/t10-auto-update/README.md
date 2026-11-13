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

2026-11-13：计划初稿，待设计审查。omp 正在做 t09 的实现审查，同一时间只跑一个 omp 审查，这一份等它跑完再开。

## 下一步

设计审查，处理后按切片实施；Windows 验收要等 pc-notype 恢复。
