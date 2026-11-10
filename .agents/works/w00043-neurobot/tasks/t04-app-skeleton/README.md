---
schema: nbook.task/v2
taskId: t04-app-skeleton
status: planned
updated: 2026-11-10
---

# NeuroBot 应用骨架与 gateway

## 目标与范围

新建应用包 packages/neuro-bot 与命令 nbot：数据目录 ~/.neurobot 的认领、用 nb-host 装配 gateway、web 外壳与带 bot 的路由、设置存储与 bot 身份（第一版一个 bot）、monorepo 包边界登记。

合同：新建 `docs/specs/bot/gateway.md`、`docs/specs/bot/bots.md`（还不存在，提案接受后先写成 planned）；安全规则沿用 [`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)。

依赖：[t01](../t01-direction/README.md) 提案接受；[t02](../t02-host-base/README.md) 的 `nb-file-lock` 与 `nb-host`（第 1 到 6 片）合入。不依赖 w00032 t32。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

## 下一步

等上面两项，再写 Spec 草稿与计划。
