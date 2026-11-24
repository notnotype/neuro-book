---
schema: nbook.task/v2
taskId: t02-ts7-trial
status: planned
updated: 2026-11-24
---

# 在纯 TS 包上试 TypeScript 7.0：耗时与要改的 tsconfig

## 目标与范围

挑两三个只用 tsc 的包（例如 nb-runtime、nb-host），在 worktree 里用 7.0 的 tsc 与 6.0 各跑一遍类型检查，记下耗时、报错与要改的 tsconfig（baseUrl、types、rootDir、strict 默认值）；vue-tsc 与直接 import typescript 的脚本继续用 6.0（官方的 npm 别名并存做法），不动它们。依赖 t01 的基线数字。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-24 经 nbdev 新建，尚未开工。

## 下一步

待补充。
