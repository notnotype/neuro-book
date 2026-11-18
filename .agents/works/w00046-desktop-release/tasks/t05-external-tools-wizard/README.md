---
schema: nbook.task/v2
taskId: t05-external-tools-wizard
status: planned
updated: 2026-11-13
---

# 外部工具安装向导

## 目标与范围

第一版只检测、提示（开发者 2026-11-13 在提案第一轮审查后定）：Agent 用到找不到的外部工具（git、python 等）时，在对话里说明缺什么、去哪装（官方地址或 winget 命令）。随 NeuroBook 安装（PortableGit、uv 管 Python）与装到系统两条安装路径，等有了实际需求再做；当初确认的完整方案见 [t01](../t01-distribution-proposal/README.md) 开发者决定第 3 条。与桌面壳没有技术依赖，npm 版同样适用。

合同：新建 Spec `runtime/external-tools`（检测与提示），见提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.7 节。

## 当前状态

2026-11-13 经 nbdev 新建，尚未开工。

## 下一步

待补充。
