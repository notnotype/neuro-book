---
schema: nbook.task/v2
taskId: t34-builtin-service-plugins
---

# 产品内置服务迁为插件

## 目标与范围

阶段 1 的第三个实现切片。产品服务端的进程级服务（App SQLite 与迁移门禁、Session Store 租约、Project owner 与文件索引、Storage host、Agent Harness）的生命周期迁成内置插件 `nbook.app-state`、`nbook.session-store`、`nbook.project`、`nbook.storage`、`nbook.agent`，启动与关闭顺序改由插件依赖图产生，`product-shutdown.ts` 的手写关闭清单只剩应用停止与日志刷写。插件的激活与关闭诊断写进产品日志，`smoke:product-lifecycle` 的 L2 与 L3、L4 的关闭顺序子断言改为读取日志判定。只迁生命周期，调用方的访问方式不变。

行为依据：[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P9 阶段 1 与 P11；[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 停止序列第 2 条；[`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md) 输出第 13、14 条。

不做：自有服务端入口、`nbook.http`、停止来源汇合与排空修复（下一个 Task）；开发模式热重载与停止（#244）；删除 `productRuntimeReady()`、启动中间件与关闭控制器；调用方改经服务键取得服务；`nbook.diagnostics` 取代 `appLogger`。

切片顺序调整：原计划先做自有入口，但入口新建的运行实例会与 `productRuntimeReady()` 的实例并存，形成两条路径；先迁内置服务，下一个 Task 再由入口接管同一个实例。

编码由 omp 完成（`@default` 回退链，实际运行在 `aihub/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，续跑说明见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过，附两个已知问题（见下文），各自另开 Task 处理。

**行为变化**（已写入 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 证据的实现进展与 [`runtime.application`](../../../../../docs/specs/runtime/application.md) 已知限制）：

- 新增启动必需的服务端内置插件 `nbook.app-state`（工作区目录、State Root 完整性检查、迁移门禁；释放时先 checkpoint，再断开 Prisma）、`nbook.storage`、`nbook.session-store`（租约）、`nbook.project`（Project owner 根作用域与文件索引）、`nbook.agent`（只管 Agent Harness 的生命周期）；`nbook.files` 补上对 `nbook.project` 的依赖。依赖边与代码依据见 [delivery.md](evidences/delivery.md) 第 2 节；旧关闭清单的每个先后关系都由依赖图保证。
- 产品清单删除原 `agent-session-store` 本地能力与全部门禁，改由 `requiredPlugins` 与依赖图决定顺序；`product-shutdown.ts` 的关闭清单只剩 `product-runtime` 与 `app-logger`。调用方访问方式不变。
- Project owner 的根作用域是 `nbook.project` 激活时新建的独立运行实例，由服务释放关闭。如果挂在 `entry-work` 之下，应用停止时会被级联提前关闭，早于 Agent 释放。
- 产品 JSONL 日志新增 `runtime.plugins.catalog`（启动目录：入口、依赖与提供的服务键）与 `runtime.plugins.diagnostic`（插件诊断原字段）。`smoke:product-lifecycle` 的 L2 与 L3、L4 的 `close-order` 改为读取日志、由目录推导依赖边后判定（`scripts/smoke/product-lifecycle/plugin-order.ts`）。

**主会话修改**：
- `scripts/build/product-runtime-islands.ts`：Profile Authoring Worker 的不透明动态导入登记从 3 改为 2。旧 `product-shutdown.ts` 在模块顶层构造关闭控制器并引用 App SQLite checkpoint，Worker 经 `product-project → product-startup → product-shutdown` 带入了 `app-sqlite-migrations.ts` 中选择 SQLite 驱动的 `import(specifier)`；迁移后该引用移入插件函数，被摇树去掉（[worker-closure-proof.txt](evidences/worker-closure-proof.txt)）。
- `scripts/db/migrate-application-state.test.ts`：迁移命令提示的源码守卫改读 `server/features/session-store/plugin.ts`，提示随 Session Store 错误处理迁到了那里。

**已知问题**：
1. **内核显式恢复每次只推进一层依赖**（已由 [t36](../t36-lifecycle-recover-cascade/README.md) 修复）。 一处释放失败修好后，第 1 次 `recover()` 关闭 Agent、Project、Files，第 2 次关闭 Session Store 与 Storage，第 3 次才关闭 App State（[source-recovery-proof.txt](evidences/source-recovery-proof.txt)）。[`runtime.lifecycle`](../../../../../docs/specs/runtime/lifecycle.md) 状态表要求失败资源重试成功即到已关闭，所以这是内核原有的缺陷（从代码推断），以前产品没有多层插件依赖，暴露不出来。产品正常关闭不受影响，只在关闭失败后的显式恢复时出现。`product-startup.test.ts` 的对应用例暂时按逐次恢复断言（每次未关闭子作用域严格减少、Project 未关闭不释放租约、Project 先于租约释放），内核修复后恢复为一次恢复即关闭。
2. **生产构建中项目归档下载崩溃。** `yazl` 以 `require("buffer-crc32")` 加载 crc32，`buffer-crc32` 1.0.0 同时提供 CJS 与 ESM 入口，打包后 `require` 取到 ESM 命名空间对象，`.unsigned` 为 `undefined`，下载在 42 字节处抛出未捕获异常。t31 基线中 L3、L4 的“在途下载只收到 42 字节”即此原因，不是排空问题（推断 master 同样存在，未验证）。该请求的 Project 操作一直不结束，使 SIGTERM 后 Project 根无法关闭，直到 Nitro 60 秒强制退出，所以 L3、L4 的 `close-order` 如实判为失败：Project、Session Store、Storage、App State 没有 `closed`。

**验证**（主会话运行）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `bun run test server/runtime server/features scripts/smoke/product-lifecycle` | 16 个文件、129 条全部通过 | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `scripts/build/product-runtime-islands.test.ts` | 通过 | [acceptance-test-islands.txt](evidences/acceptance-test-islands.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:product-lifecycle --only L1,L2,L3,L4,L5,L6`（含生产构建） | L1、L2、L5、L6 通过；L3、L4 失败（已知问题 2：在途下载崩溃，`close-order` 因 Project 未关闭而失败；L3 的 503 子断言仍为连接被拒，属下一个 Task） | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json)、各检查项日志 `acceptance-L*-plugins.jsonl` |
| 无在途请求时的生产关闭顺序（用 L2 的生产日志判定） | 激活与关闭顺序都通过：关闭依次为 Files、Agent、Project、Storage、Session Store、App State | [acceptance-l2-close-order.txt](evidences/acceptance-l2-close-order.txt) |
| `bun run test` | 修正守卫测试后与 t32、t33 基线相同（10 个文件 23 条失败、22 个 errors）；修正前多出 `migrate-application-state.test.ts` 1 条 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt)（修正前的完整运行） |

omp 的输出与汇报：`evidences/` 下的 `test-targeted.txt`、`typecheck.txt`、`source-*`、`worker-closure-proof.*`、`delivery.md`。上一轮生产 smoke 因构建登记未执行，结果为 `pending`（`smoke-product-lifecycle.txt`）。

## 下一步

先修已知问题 1（内核显式恢复按依赖顺序一次完成）与已知问题 2（归档下载的 crc32 打包），再进入自有宿主入口与 `nbook.http`。
