---
schema: nbook.task/v2
taskId: t01-baseline
status: planned
updated: 2026-11-24
---

# 量出现在的类型检查耗时与构成

## 目标与范围

量出现在的类型检查慢在哪，给 t02 与后面的提速改法一个有数字的起点。只量、不改配置与源码。

- 各包 `typecheck` 的耗时，分三类记：只跑 `tsc` 的包、带 `vue-tsc` 的包（`neuro-book` 一个包里就有一条 `tsc` 加两条 `vue-tsc`）、依赖 TypeScript 编程接口的脚本与架构测试（`plugin-sdk/pack.ts`、`nb-layout/scripts/api-*.ts`、`source-imports.ts` 等）。
- `bun run test:affected --typecheck` 在典型改动（改一个包、改一个被依赖多的包）下的总耗时，与 CI `check` 作业里类型检查占的时间；记下当时的负载（`/proc/loadavg`）。
- 每条命令在同一负载下各量三遍，取较低的一端；冷启动与增量（`tsBuildInfo`）分开记。

合同：行为合同不变（只量，不改产品）。

## 当前状态

2026-11-24 经 nbdev 新建，尚未开工。

## 下一步

开工时先看 `packages/*/package.json` 的 `typecheck` 脚本与各 `tsconfig`，写 `plan.md`，再量。结果写进 `evidences/baseline.txt`。起因与 TypeScript 7.0 的背景见 Work README。

## 顺手量到的一次（2026-11-25，w00046 t23 的 worktree）

`packages/neuro-book` 的 `bun run typecheck`（tsc、vue-tsc 两个 web 配置）墙钟 7 分 18 秒，用户态 430 秒；当时机器负载约 10（别的会话在跑），所以只能当上界参考，t01 要在空闲时重量。
