---
schema: nbook.task/v2
taskId: t08-scripts-typecheck-baseline
role: tasker
---

# 修复脚本类型检查基线

## 目标

修复 `packages/neuro-book` 的 `scripts:typecheck` 当前基线错误，使脚本 tsconfig 下的旧 sync-state JSON 解析通过严格 TypeScript 检查，同时保持迁移运行时的 fail-closed 校验和数据行为不变。

## 范围

- 仅修改 `server/workspace-files/system-asset-installation.ts` 中 `parseLegacySyncState` 及其局部类型守卫。
- 保持 `assets`、`profiles` 存在性、数组形状和条目字段验证语义。
- 使用现有 `system-asset-installation.test.ts` 的畸形输入与迁移行为作为回归证据。
- 写 walkthrough 记录错误原文、修复边界、验证命令与残余风险。

## 不做

不改迁移 schema、磁盘路径、清理规则、测试输入，不新增断言型静默 fallback，不修复其它未相关类型错误。

## 验收

1. `bun run scripts:typecheck` 通过。
2. `bun run test server/workspace-files/system-asset-installation.test.ts` 通过。
3. `bun run typecheck` 通过，迁移逻辑的 fail-closed 行为保持测试覆盖。
4. `docs:check` 与 `git diff HEAD --check` 通过。

## 固定依据

- `server/workspace-files/system-asset-installation.ts`
- `server/workspace-files/system-asset-installation.test.ts`
- `scripts/tsconfig.json`
