---
schema: nbook.task/v2
taskId: t40-phase1-closing
---

# 阶段 1 收尾：缺陷修复与 Nitro 插件迁移

## 目标与范围

阶段 1 的退出条件已经满足（设计稿 P9：旧启动与关闭路径删除、进程信号与停止通道由宿主处理、关闭顺序由依赖图产生、`index.vue` 不再创建运行时；`smoke:product-lifecycle` L1–L10 全部通过，见 [t39](../t39-browser-host/README.md)）。2026-10-02 主会话做了集成复核，开发者选定本任务的范围：

1. **修复复核发现的缺陷：**
   - `smoke:product-lifecycle` 在检查没有执行（`pending`）时仍以 0 退出，违反 [验证门禁](../../../../../docs/testing/README.md#验证门禁)；
   - 产品启动包装进程链（`product-command` → `product-start` → `index.mjs`）在整个进程组收到 SIGTERM 时，`product-start` 被第二次信号直接杀死，外层以 1 报告“被信号中断”；`product-start` 在收到停止信号后一律以 0 退出，盖掉服务进程的 1 或 75，与 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的退出码表不符；
   - `scripts/db/migrate-application-state.test.ts` 仍匹配源码字符串；t35 删除的“正式 Product builders 在同一个 esbuild graph 中完成链接与压缩”没有行为级检查替代。
2. **迁移 `server/plugins/` 下其余 5 个 Nitro 插件**（日志桥接、请求错误日志、Boot Config 校验、Storage 定义登记、Server Timing），由产品清单中的内置插件在激活与关闭时承担，不再有第二套启动路径。

行为依据：[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md)、[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P6、P9、P10。

不做（开发者决定留到阶段 2，由 Files 竖切真实消费时接入）：`nbook.sqlite`、`nbook.platform-files` 进入产品清单；`nbook.project` 的浏览器部分。

复核中核实后不处理的问题：归档临时目录泄漏在 t38、t39 的完整 smoke 中没有复现，`/tmp/nbook-project-archive-*` 的 15 个残留都是 10-01 crc32 修复前崩溃或强制结束留下的；L10 浏览器日志中的 `STORAGE_CONTEXT_INVALID` 403 在 t31 基线中已存在，属 Storage 多窗口问题，与运行时架构无关，建议另开 Issue（需授权）。

编码由 omp 完成（`@default`；中途因 `openai-codex` 额度用尽、`aihub` 余额不足，改用 `cctq` 后又按开发者要求换回 `aihub`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-02 验收通过。

**行为变化**（已写入 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的停止规则与实现进展、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 的产品装配与已知限制；设计细节见 [delivery.md](evidences/delivery.md) 第 2、3 节）：

- `server/plugins/` 下的旧入口全部删除。日志桥接（consola、`console.warn`/`console.error`、未处理异常、`app.logs.ready`）归 `nbook.diagnostics`，它进入产品清单，`nbook.http` 与 `nbook.app-state` 显式依赖它，其余必需插件经依赖闭包排在它之后，因此桥接最先安装、最后撤销；请求错误日志与 Server-Timing 归 `nbook.http`，Nitro `error`、`beforeResponse` 钩子随实例注册与注销（宿主入口与开发适配器把 `nitroApp` 传给 `startProductRuntime()`，CLI 不注册）；Boot Config 校验归 `nbook.app-state` 的激活，非法即启动失败；Storage 定义登记归 `nbook.storage` 的激活。
- 产品诊断出口借用 `appLogger` 的同一 JSONL writer（`writeDiagnostic`），进程内只有一个写入者；所有插件关闭后最后刷写并关闭 writer。
- 包装进程重复收到 SIGINT/SIGTERM 时只转发一次，等服务进程退出后才退出并原样传递 0、1、75；服务进程被信号结束时以 128 加信号编号退出（容器 PID 1 对自己发给自己的同一信号可能没有默认终止行为）。smoke 收尾的 `dispose-complete` 由 `exitCode: 1` 变为 0。
- `smoke:product-lifecycle` 仅在所选检查全部通过且主流程无异常时以 0 退出。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：omp 让产品 `AppFileLogger` 也参与 `runtime.diagnostics` 的日志位置授予锁。取不到授予时，`appLogger` 的全部写入（含 `fatalSync`）被静默丢弃；开发模式热重载时旧 worker 未释放锁，新 worker 整个生命周期都不写日志文件。这超出了“进程内单一写入者”的要求，已撤销，`AppFileLogger` 仍不参与授予（`runtime.diagnostics` 的已知限制保留）。omp 汇报的 `storage-service.test.ts` 并发读取失败经核实是 t34 以来每次全量测试都有的基线失败；`workbench-migration-e2e.test.ts`、`server-timing.test.ts` 不在允许清单内，但直接引用被删除的旧入口，改动接受。

**主会话修改**：删除 `jsonl-exporter.ts` 挪走格式函数后留下的一处多余空行。

**运行中断**：omp 两次中途退出——一次上游连接中断（`Upstream HTTP/2 stream failed`），一次 `aihub` 余额不足（403 `billing_error`，回退链不接手），均用原会话续跑。

**验证**（主会话运行，返工后）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation`；`server/plugins`、`server/features`、`server/runtime`、`server/host`、`server/middleware`、`server/routes`、`server/app-logs`、`server/storage`、`server/config`、`server/utils`、`scripts/db`、`scripts/smoke`；`scripts/build/product-command-graph.test.ts` | 20 个文件 231 条；67 个文件 527 条通过，1 条失败为基线 `storage-service`；构建产物检查 1 条通过 | [acceptance-test-targeted.txt](evidences/acceptance-test-targeted.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 三种模式 | 全部通过（`--services` 含 foundation 出口的位置冲突降级） | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle`（L1–L10，含生产构建） | 全部通过；产品收尾退出码均为 0，L6 为 75 | [acceptance-smoke-product-lifecycle.txt](evidences/acceptance-smoke-product-lifecycle.txt)、[报告](evidences/acceptance-lifecycle-report.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与基线相同 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |
| 包装进程链修改前复现与回归（omp 运行） | 旧实现上 4 条真实子进程回归全部失败，新实现全部通过 | [delivery.md](evidences/delivery.md) 第 1 节 |
| 生产日志探针（omp 运行，返工后） | `app.logs.ready` 可读，一次 `console.error` 恰好写一条 | [delivery.md](evidences/delivery.md) 返工 1 |

omp 的输出与汇报：`evidences/` 下的其余文件，含 [delivery.md](evidences/delivery.md)。

**后续问题**：t35 删除的构建约束只补了产物级的共享模块身份检查，不能证明所有正式 builder 在同一次遍历中完成链接与压缩；产品日志目录的跨进程互斥需要单独设计；Windows 上的包装进程链与服务进程被信号结束时的退出码映射未实测。

## 下一步

阶段 1 完成，进入阶段 2（Files 竖切）。
