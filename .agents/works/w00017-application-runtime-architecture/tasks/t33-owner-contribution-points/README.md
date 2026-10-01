---
schema: nbook.task/v2
taskId: t33-owner-contribution-points
---

# 贡献点由拥有者插件定义

## 目标与范围

阶段 1 内核切片的第二部分。贡献点改由拥有者插件定义（`contributionPoints`，含校验与是否需要实现），删除宿主传入接收者的做法；贡献按单条校验（`accepted`、`rejected`、`pending`/`unknown-point`），单条不合格不再拒绝整个插件；接收者由拥有者入口激活时交出，内核记账交付：拥有者接上时补交已可用的贡献，之后由内核推送，任一侧关闭时逐项撤回；贡献不构成依赖。浏览器端现有 Files 视图与命令改由过渡插件 `nbook.workbench` 的贡献点接收，行为不变。

行为依据：[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md) P1 第 2、4 项与 P3；[`runtime.plugin-manifest`](../../../../../docs/specs/runtime/plugin-manifest.md) 输出第 10 条；需修订的现行合同为 [`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md)（接收者五态与受控贡献事务保持成立）。

不做：清单文件与 JSON schema、运行期启用与禁用、`onCommand`/`onView` 激活事件、跨插件调用包装、工作台其它迁移。

编码由 omp 完成（`@default` 回退链，先后运行在 `openai-codex/gpt-6.1-sol` 与 `aihub/gpt-6.1-sol`），任务说明见 [brief.md](brief.md)，审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**行为变化**（已写入 [`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md) 输出第 15–18 条、交付状态表、场景 16–22 与实现合同；[`runtime.application`](../../../../../docs/specs/runtime/application.md) 清单删除 `receivers`；[`runtime.plugin-manifest`](../../../../../docs/specs/runtime/plugin-manifest.md) 实现进展加入第 10 条）：

- 插件定义 `contributionPoints`（`{id, implementation: "required" | "none", validate?}`）与顶层声明式 `contributions`；入口 `receives`，激活产出 `receivers`。`ContributionReceiver` 只保留 `prepare`/`commit`/`revoke`；`PluginHostOptions.receivers` 与 `ApplicationManifest.receivers` 删除。
- 登记只因结构错误整体拒绝（新增 `duplicate-contribution-point`、`unknown-contribution-point`、`duplicate-receiver`）；`unknown-receiver`、`invalid-declaration`、`duplicate-contribution` 改为单条结果。单条校验按存活登记推导：`pending`/`unknown-point`，`rejected`（`invalid-declaration`、`implementation-required`、`implementation-not-accepted`、`duplicate-contribution`），`accepted`。重复判定不再区分运行位置。
- 交付账本：拥有者发布前接上接收者并补交（入口贡献按贡献方代次整批，顶层逐条）；贡献方激活时对已接上的接收者走受控事务，未接上的等待接收者；关闭时按 `scope-closed` 或 `receiver-closed` 每条恰好撤回一次；同一接收者的回调串行；贡献不构成依赖。新增输出失败 `missing-receiver`、`undeclared-receiver`，撤回原因 `receiver-closed`、`delivery-failed`，诊断 `receiver-connected`、`receiver-closed`、`backfill-failed`、`delivery-failed`。
- `contribution(point, id)` 改为返回该身份的全部声明（数组），每条带 `validation` 与 `delivery`；句柄新增 `kind`，顶层句柄的 `implementation()` 抛 `PluginStateError`。
- 浏览器端新增过渡插件 `nbook.workbench`（启动必需），定义 `workbench.view` 与 `workbench.command` 并交出原 Files 接收者；smoke 的命令接收者改由启动必需的 `command-owner` 插件提供。

**过程**：首轮主会话读码与设计约 22 分钟后，把核心实现整块委派给子代理，子代理重读代码 15 分钟仍未改动核心文件。主 Agent 中断后在任务说明里要求设计与主要编码由主会话完成，续跑后核心实现由主会话写出。续跑在收尾时因系统内存不足被终止（后台 `nuxt dev` 热重载占满内存）。

**审查中处理的问题**（[review-1](reviews/review-1.md)）：删除了一条仍然成立的机制导入边界测试；`host.ts` 删掉 29 行仍然有效的注释；`nbook.workbench` 在 `requiredPlugins` 之外又加了激活门禁与 `onStartup`；一处无关的 import 顺序改动。均已修正。另有两点记为已知限制，归 `runtime.plugin-hot-plug`：拥有者已接上之后才登记的顶层声明要等下次接上才补交；之后登记的重复贡献使已交付的那条变为 `rejected`，但不撤回已有交付。

**验证**（主会话运行）：

| 项目 | 结果 | 证据 |
|---|---|---|
| `test:runtime-foundation` | 18 个文件、217 条全部通过 | [acceptance-test-runtime-foundation.txt](evidences/acceptance-test-runtime-foundation.txt) |
| `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck` | 0 错误 | [acceptance-typecheck.txt](evidences/acceptance-typecheck.txt) |
| `smoke:runtime-foundation` 的 `--host server`、`--services`、`--host browser --browser-executable /usr/bin/google-chrome-stable` | 全部通过 | [acceptance-smoke-runtime-foundation.txt](evidences/acceptance-smoke-runtime-foundation.txt) |
| `smoke:product-lifecycle --only L1`（含生产构建） | 通过，资源管理器渲染真实文件树 | [acceptance-smoke-product-lifecycle-L1.txt](evidences/acceptance-smoke-product-lifecycle-L1.txt)、[报告](evidences/acceptance-product-lifecycle-L1.json) |
| `bun run test` | 10 个文件 23 条失败、22 个 errors，与 t32 验收时完全相同，无新增 | [acceptance-test-full.txt](evidences/acceptance-test-full.txt) |
| `docs:check` | 通过 | |

omp 的输出与汇报：`evidences/` 下的 `test-*.txt`、`typecheck.txt`、`smoke-runtime-foundation.txt`、`delivery.md`。

## 下一步

服务端宿主切片：独立的 Nitro 入口、`nbook.http` 的监听与排空（503，20 秒）、退出码 0/1/75。
