---
schema: nbook.task/v2
taskId: t60-plugin-api-ergonomics
---

# 插件写法收敛与内核精简

## 目标与范围

开发者 2026-10-08 评估内核 API 后确认：静态声明写合同对象、`defineEntry` 在编译期核对激活产出、远程结果的 `orThrow`、一条“本地服务、远程服务、贡献点”的选用规则（示例删去只转发的本地服务包装）；内核删去没有使用者的本地委托、贡献点校验里的跨点查询与接收者的 `commit`；把讨论中暴露的概念与规则补进术语表、作者 API、远程协议与示例 README。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`runtime/glossary.md`](../../../../../docs/specs/runtime/glossary.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 前置

[t56](../t56-plugin-state/README.md)、[t59](../t59-plugin-definitions/README.md) 完成。

## 后续

开发者 2026-10-08 确认在本 Task 之后另开：内核的目录查询（本实例的插件与服务、别的实例是否提供某份合同）与失败码 `not-provided`。按拓扑角色匹配入口（TUI 不改代码就能用 `nbook.storage` 这类插件）只在本 Task 写设计，随 TUI 实现。

## 当前状态

2026-10-08 计划经开发者确认；omp 计划审查进行中，实施从 S0 开始。
