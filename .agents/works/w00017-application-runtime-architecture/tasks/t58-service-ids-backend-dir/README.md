---
schema: nbook.task/v2
taskId: t58-service-ids-backend-dir
---

# 服务键按 id 识别、插件后端目录改名 `backend/`、补项目级示例

## 目标与范围

开发者 2026-10-08 看 t57 的示例插件时指出工厂参数不一致、概念模糊、看不出应用级与项目级，同意三项改动并要求规范文档一起改：服务键按服务 id 识别、工厂只收宿主配置；插件里放后端代码的 `server/` 目录改名 `backend/`；补项目级示例与概念说明。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/application.md`](../../../../../docs/specs/runtime/application.md)、[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)。

## 前置

[t57](../t57-runtime-examples/README.md)（示例插件）。K5 的 [t56](../t56-plugin-state/README.md) 计划在本 Task 之后按新约定改写。

## 当前状态

2026-10-08 完成。计划确认（3 项待确认均同意），S0–S5 已实现，omp 只读审查 6 条均已修正。实施中两处偏离计划，已改 plan.md：文档随它描述的代码同片提交（Spec 里的源码链接要指向存在的文件）；应用包删 `keys` 并入 S1，保证每片提交都能通过。

| 片 | 提交 | 结果 |
|---|---|---|
| S0 | `ae722e40` | ADR 0025 |
| S1 | `71ab6a69` | 内核按 `key.name` 识别服务键，删去 `keys`、`hasKey`、`unknown-key`、`unknown-service-key`；检查门禁原来靠“登记时拒绝未登记的键”在检查前失败，改为先看装配报告，必需依赖静态不可满足时以同一次解析的原因（`missing-provider`）失败；应用包删去 `collectServiceKeys`；`runtime/services.md`、`plugins.md`、`application.md`、`plugin-manifest.md` 修订并清理旧格式。把内核提供者分组改回按对象身份的变异被新用例抓住 |
| S2 | `15fdb425` | workbench、projects、storage 的工厂不再收服务键，宿主上下文去掉 `projects`、`currentProject`；工作台对外合同移到 `plugins/workbench/shared/contracts.ts`；边界测试改为“跨插件运行时导入只能指向对方的 `shared/contracts.ts`”（去掉这条放行的变异被抓住）；`browser-host.md`、`quick-open.md` 路径修订并清理 |
| S3 | `2fe76f80` | `src/plugins/{diagnostics,http,projects,storage}/server` 与示例改名 `backend`；`nbook.http` 的合同挪到 `http/shared/contracts.ts`；边界测试的后端判定改为宿主 `server/`、`project/` 与插件 `backend/`（项目宿主原来不在判定里）；目录约定与 `persistence.md`、`server-host.md`、`diagnostics.md` 的路径修订，后两份清理旧格式 |
| S4 | `7b9dcd57` | 示例按新约定改写；新增项目级插件 `board` 与场景 6（场景宿主可起项目实例、按项目名绑定窗口）；README 补概念表、运行位置与目录、工厂参数规则 |

S5 的 omp 审查（[impl-review.txt](evidences/impl-review.txt)）6 条全部成立。内核与应用的 4 条修正在 `60146ff5`：

- 第 1 条，委托检查仍按键对象比较已声明的 `delegates`，同 id 的另一份键被拒：改为按服务 id 比较，委托测试的代理改用同 id 的另一份键；
- 第 2 条，同一服务 id 在一次激活里产出两次时后一项静默覆盖、失败清理漏掉前一项的释放回调：重复 id 按 `undeclared-service` 拒绝，清理按实际产出项对账，回归测试增补“同一服务 id 第二次产出”一例（还原任一处修正都会失败）；
- 第 4 条，应用 `tsconfig.json` 的后端 include 仍是 `plugins/*/server`，按路径启动的 `partition-writer.ts` 漏出类型检查：改为 `plugins/*/backend`，另补上一直没有进类型检查的 `src/project`（`main.ts`、`process.ts` 等 6 个文件）；编码规范路由表同步；
- 第 6 条，`services.ts` 头注释仍写“按对象身份比较”：改为按服务 id 识别。

示例宿主 `examples/scenarios/hosts.ts` 的 2 条另行修正：

- 第 3 条，已结束代次的重连被报成可重试的 `project-unavailable`：带代次的重连先判，那一代不在就是 `project-gone`；`Stage` 增加 `reconnect`，场景 6 补停止后重连的断言；
- 第 5 条，同名项目可以同时起两代：上一代没停完时 `project()` 直接报错，停止期间这一代不再接受绑定、停完才清掉。

两处修正各做了还原变异，新断言都会失败。修正后 `bun run test:affected --typecheck` 全部通过（内核 285 例，含示例场景），`docs:check`、`governance:check` 无失败。

收口验证：[test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)（`--since d49ae4e3`：内核 282 例含示例场景 9 例，应用 276 例与组件 57 例，两包类型检查）、[test-e2e.txt](evidences/test-e2e.txt)（45 例，含构建与打包检查；S4 只改示例）、[smoke-server.txt](evidences/smoke-server.txt)（S1–S8）；`docs:check`、`governance:check` 无失败。
