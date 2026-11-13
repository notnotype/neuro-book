---
schema: nbook.task/v2
taskId: t07-managed-entry-payload
status: active
updated: 2026-11-13
---

# 应用包托管入口与桌面载荷组装

## 目标与范围

应用包补托管入口 server/main.js（pack-app.ts）；从同一个应用包 tarball 组装 Windows 桌面载荷（按根 bun.lock 装四个 @oh-my-pi 依赖闭包、保留许可与文档、文件清单与摘要进发行清单）。依据提案 4.1、ADR 0051 决定 3。

合同：[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“托管宿主”、[`runtime/cli`](../../../../../docs/specs/runtime/cli.md) 的托管入口（planned 条目）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13：计划经 Sonnet 设计审查（9 条均改，[处理](evidences/design-review-r1-disposition.txt)）。代码在分支 `feat/w00046-t07`（worktree `.worktree/w00046-t07`，从 master `4efe7dd88` 开出；Work 分支的 worktree 当时被 t06 的审查占着读代码）：

- `6bf47e78c` 应用包带托管入口 `server/main.js`，与 `nbook.js` 共用 chunk；打包后以托管方式核对；`release:smoke` 在 `bun add -g` 的布局下托管运行一次；
- `0d8470186`、`13ddc41c2`、`799e6d197` 桌面载荷组装 `packages/neuro-book/scripts/desktop-payload.ts`：输入发布清单，核对 tarball 摘要，锁文件按完整性哈希对照根 `bun.lock`，`--frozen-lockfile` 按目标平台安装，许可核对，写载荷清单；`release:smoke` 组装本机载荷并托管运行。

验证：包内 `bun test scripts/pack-app.test.ts scripts/desktop-payload.test.ts` 通过；`prox bun run release:smoke` 在 `13ddc41c2` 上通过（托管入口、桌面载荷两步都过）。Windows 载荷（本机 `--os win32 --cpu x64` 组装，158 MB、2064 个文件）正在传到 pc-notype 上实跑。实现审查（Sonnet）进行中，待处理。

## 下一步

Windows 实跑结果入证据；处理实现审查；合入 master 后在 cli、server-host 去掉托管入口的 planned、补实现合同与证据。
