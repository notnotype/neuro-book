---
schema: nbook.task/v2
taskId: t07-managed-entry-payload
status: done
updated: 2026-11-13
---

# 应用包托管入口与桌面载荷组装

## 目标与范围

应用包补托管入口 server/main.js（pack-app.ts）；从同一个应用包 tarball 组装 Windows 桌面载荷（按根 bun.lock 装四个 @oh-my-pi 依赖闭包、保留许可与文档、文件清单与摘要进发行清单）。依据提案 4.1、ADR 0051 决定 3。

合同：[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“托管宿主”、[`runtime/cli`](../../../../../docs/specs/runtime/cli.md) 的托管入口（planned 条目）。计划见 [plan.md](plan.md)。

## 当前状态

已完成（2026-11-13），合入 master `91addb492`。

- 计划经 Sonnet 设计审查（9 条均改，[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-disposition.txt)）。
- 代码（分支 `feat/w00046-t07`，经 Work 分支合入）：`6bf47e78c` 应用包带托管入口 `server/main.js`，与 `nbook.js` 共用 chunk，打包时托管核对；`0d8470186`、`13ddc41c2`、`799e6d197` 桌面载荷组装 `packages/neuro-book/scripts/desktop-payload.ts`；`release:smoke` 在装好的包与载荷里各托管运行一次。
- 实现审查（Sonnet，t06 的第二轮占着 omp）：7 条，[报告](evidences/impl-review-r1-sonnet.txt)、[处理](evidences/impl-review-r1-disposition.txt)，修正 `b29a6e2ac`、`dd78597a1`。
- 验证：包内 `bun test scripts/pack-app.test.ts scripts/desktop-payload.test.ts` 13 通过（合并 master 之后重跑）；`prox bun run release:smoke` 在 `dd78597a1` 上通过；包内与 `scripts` 的 `tsc --noEmit` 通过。
- Spec：`runtime/server-host` 的“托管宿主”与 `runtime/cli` 的托管入口去掉 planned，cli 加场景 8，证据补齐。

Windows：链路恢复后把本机组装的 Windows 载荷传到 pc-notype 运行（[证据](evidences/windows-payload-r1.txt)）：托管入口 1.4 秒就绪、首页可取；同一状态根第二个实例以 1 退出、诊断 `runtime.state-root.busy`；写 `stop` 与关闭标准输入都以 0 退出。
