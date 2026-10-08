---
schema: nbook.task/v2
taskId: t59-plugin-definitions
---

# 插件定义统一为常量，宿主的东西走宿主能力服务

## 目标与范围

开发者 2026-10-08 问插件工厂参数的作用后同意统一：普通插件没有工厂参数、定义是常量，时钟、整页导航、Storage 的库目录这类宿主的东西改为宿主能力服务；只有 `nbook.http`、`nbook.diagnostics` 这类宿主自己的基础设施插件保留工厂；`nbook.commands` 一份定义声明两端入口。让内置插件与以后按清单装载的第三方插件拿宿主的东西走同一条路。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

[t58](../t58-service-ids-backend-dir/README.md)（服务键按 id 识别、`backend/` 目录）；t58 的 omp 审查修正完成后再实施。

## 当前状态

2026-10-08 计划经开发者确认；omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）6 条发现已吸收进计划，按 S0–S4 实施中。
