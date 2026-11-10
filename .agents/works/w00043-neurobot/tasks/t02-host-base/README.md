---
schema: nbook.task/v2
taskId: t02-host-base
status: planned
updated: 2026-11-10
---

# 把两端宿主的通用部分与模型服务抽成包

## 目标与范围

NeuroBot（[提案](../../../../../docs/proposals/neurobot.md)）是 monorepo 里第二个建在 nb-runtime 上的应用。仍在 NeuroBook 应用里、NeuroBot 也要的部分，开发者 2026-11-10 选了提案第二稿待定项 1 的 (b)：只把安全攸关、已经调好的抽成包，两边共用；其余 NeuroBot 自己写。

要抽的（行为不变）：

- 服务端宿主中与应用无关的部分（`packages/neuro-book/src/server/`，非测试代码 3,952 行，其中多少与应用无关要在计划里分清）：只许监听回环地址、`Host` 与 `Origin` 核对、数据目录（状态根）认领、内核 RPC 端口的监听与握手、启动与停止。
- 浏览器宿主中与应用无关的部分（`packages/neuro-book/src/web/`）：浏览器一侧的内核实例与 RPC 连接、断线与重连。
- HTTP 的来源核对：`packages/neuro-book/src/plugins/http/backend/` 的准入与分发（`Host` 421、`Origin` 403）。
- 模型服务：`packages/neuro-book/src/plugins/models/backend/core.ts`（按角色解析模型、服务商与模型配置、OMP 凭据库、给 harness 的模型端口）。设置页留在应用。

不抽、NeuroBot 自己写的：设置、存储、把 harness 接进应用的那层、网页对话宿主。

安全规则以 [`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md) 为准（只监听回环、`Host` 421、`Origin` 403），抽出后两边共用一份实现，并由测试守住。

非目标：不改 NeuroBook 用户可观察的行为、配置与环境变量；不实现 NeuroBot 的任何东西；不搬 `plugin-platform`（ADR 0030 的条件按开发者 2026-11-10 的决定另写 ADR 修订）。

合同：行为合同未变；[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`models/service.md`](../../../../../docs/specs/models/service.md) 的 owner 与实现合同几节随代码改。

## 与其它工作的关系

- [w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md) 把模型角色与压缩触发点的规则搬进 nb-harness 的 `./models/rules`；本 Task 的模型服务部分建在它之上，排在 t32 合入之后。两端宿主与 HTTP 的部分不碰 t32 的文件，可以先做。
- 抽到哪个包（nb-runtime 的新子路径，还是新包）在计划里定：nb-runtime 现在运行时依赖只有 TypeBox、前后端共用、与应用无关（[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 决策 1），服务端宿主要用 Bun 的服务与文件锁。
- 代码在 Work 分支上做（`feat/w00043-neurobot`，worktree `.worktree/w00043-neurobot`），开工时建。

## 当前状态

2026-11-10：[plan.md](plan.md) 初稿已写（Opus），未定稿：新包 `packages/nb-host`（服务端宿主、HTTP、两端共用的套接字链路、浏览器宿主），模型服务进 nb-harness 的 `./models`（t32 合入之后），一份 ADR 记新包、模型服务的位置与 ADR 0030 决策 2 的修订。计划审查与独立设计进行中。

## 下一步

处理计划审查（Opus 审服务端、HTTP 与模型服务，Sonnet 审浏览器宿主）与独立设计（包放哪、模型服务怎么分）的结论，改第二稿，交开发者确认。
