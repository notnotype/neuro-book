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

开发者 2026-10-08 确认的后续 Task（已先建，未开工）：

- [t61](../t61-kernel-catalog-failure-codes/README.md)：内核目录查询与失败码 `not-provided`；结果未知的写请求改报 `unknown-outcome`；`plugin-api.md` 的取服务写法与内核一致；命令与公开状态的同步服务注明只限内置插件。
- [t62](../t62-plugin-examples-in-app/README.md)：示例插件搬到应用包、合并为 5 个并补齐未演示的机制，开教学注释的例外；`testing/` 目录的约定与检查。

按拓扑角色匹配入口（TUI 不改代码就能用 `nbook.storage` 这类插件）只在本 Task 写设计，随 TUI 实现。

## 当前状态

2026-10-08 计划经开发者确认；S0–S6 已实现，omp 实现审查进行中。omp 计划审查（[evidences/omp-plan-review.md](evidences/omp-plan-review.md)）的发现与处理记在计划末尾的“实施中的调整”。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `66f720dd` | 7 份 Spec 与示例 README：术语表补插件、入口、服务、依赖等概念；作者 API 补选用规则与可选功能；远程协议补可达范围、`orThrow` 与“实现合同”；删去本地委托与接收者 `commit` 的条目；命令 `when` 改在求值时判断 |
| S1 | `dacb5ca1` | 删去本地委托（`resolveFor`、`delegates`）；签发记录与远程委托的收口保留（`#releaseIssued`），`src/plugins/delegation.test.ts` 的行为由 `src/remote/delegation.test.ts` 覆盖 |
| S2 | `241417d5` | 贡献点的 `validate` 只收这一条声明，删去校验环检测与查询缓存；命令登记不再核对 `when` 的键，求值时坏键使命令不可用。恢复登记期核对、去掉只报一次的两个变异各被 2 例抓住 |
| S3 | `8b3175ba` | 接收者只留 `prepare`、`published`、`revoke`；HTTP 路由表、命令表、工作台页面表与示例 menu 在 `published` 生效；补“贡献方在 `prepare` 之后停止只收到 `revoke`”（验收 27）。`published` 不等贡献方发布、路由表与页面表不挂载的变异分别被抓住 |
| S4 | `fa97f12f` | `remoteProvides`、`remoteDelegates` 写合同对象；`defineEntry`（产出单独推导为 `const` 类型参数，字面量不用 `as const`，多写的接收者与贡献实现另行报出）；`orThrow` 与 `RemoteCallError`。去掉多写核对、放宽产出约束的两个变异分别使 3 条与 10 条反例失效 |
| S5 | `c9ffe488` | counter、board 删去只转发的浏览器入口，窗口里的插件直接用合同；场景 4 核对提供方看到的调用方、演示 `orThrow`；全部示例入口改用 `defineEntry` |
| S6 | `9f78dfe9` | 产品插件、内核诊断插件与测试插件的入口改用 `defineEntry`；应用的诊断包装装饰宽类型入口，保留原写法 |
| 补正 | `3b01a401` | omp 计划审查补报：命令 `when` 的坏键逐个核对，按（命令，键）记诊断。让核对在第一个坏键处停下的变异被 2 例抓住 |

收口验证：

- [test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)：`--since 8aa26b09` 选中内核与应用，内核 292 例、应用 312 例与组件 57 例、两包类型检查通过。
- [test-e2e.txt](evidences/test-e2e.txt)：应用 e2e 48 例全部通过（含 Lab 命令场景与 `/lab` 页面，页面表改到 `published` 生效后照常列出）。
- [smoke-server.txt](evidences/smoke-server.txt)：S1–S8 全部 `ok`。
- `docs:check`、`governance:check` 无告警。
