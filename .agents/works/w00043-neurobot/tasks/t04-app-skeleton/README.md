---
schema: nbook.task/v2
taskId: t04-app-skeleton
status: shelved
updated: 2026-11-18
---

# NeuroBot 应用骨架与 gateway

## 目标与范围

新建应用包 packages/neuro-bot 与命令 nbot：数据目录 ~/.neurobot 的认领、用 nb-host 装配 gateway、本机口令（nb-host 的可选项，引导接口也不让本机进程拿到）、web 外壳与带 bot 的路由、gateway 换进程后外壳自动重建页面、设置存储与 bot 身份（第一版一个 bot，首次启动自动建缺省的看板娘，人设在文件里）、只读查看记忆目录与工作目录文件的入口、monorepo 包边界登记。

合同：新建 `docs/specs/bot/gateway.md`、`docs/specs/bot/bots.md`（还不存在，提案接受后先写成 planned）；安全规则沿用 [`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)。

依赖：[t01](../t01-direction/README.md) 提案接受；[t02](../t02-host-base/README.md) 的 `nb-file-lock` 与 `nb-host`（第 1 到 6 片）合入。不依赖 w00032 t32。

来源：w00043 的 [Task 规划](../../README.md#task-规划)（开发者 2026-11-10 同意）。

## 当前状态

2026-11-10 经 nbdev 新建，尚未开工。

2026-11-18 搁置：开发者定 bot 做成 NeuroBook 的内置插件，NeuroBot 独立应用暂停（w00043 决定表）。

## 下一步

等上面两项，再写 Spec 草稿与计划。
