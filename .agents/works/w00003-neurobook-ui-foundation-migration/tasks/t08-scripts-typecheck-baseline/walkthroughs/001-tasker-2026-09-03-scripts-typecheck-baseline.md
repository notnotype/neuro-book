---
schema: nbook.walkthrough/v1
taskId: t08-scripts-typecheck-baseline
sequence: 1
role: tasker
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t08 脚本类型检查基线修复

## 问题

`scripts:typecheck` 原先在 `server/workspace-files/system-asset-installation.ts` 报错：`assets`/`profiles` 从 `object` 上读取、条目回调隐式 `any`，以及返回值不满足 `LegacySyncStateDocument`。运行时校验本身已有 fail-closed 测试覆盖，问题是 JSON `unknown` 在通过 object 检查后没有进入明确的结构类型。

## 实际改动

- 将旧 sync-state 结构拆成 `LegacySyncStateRecord` 与 `LegacySyncStateDocument`：记录保留任意旧协议键，`assets`/`profiles` 明确为记录数组。
- `parseLegacySyncState` 保留原有 JSON 解析、键存在性、数组类型和条目 `assetPath`/`fileName` 字符串检查。
- 在数组校验前绑定 `assets`/`profiles` 局部值，使 `.every` 的条目保持 `unknown` 并由现有运行时条件收窄；没有新增静默 fallback、schema 变更、磁盘路径变更或清理行为变更。

## 验证

- `bun run scripts:typecheck`：通过，原基线错误消失。
- `bun run test server/workspace-files/system-asset-installation.test.ts`：1 file，34 tests passed。
- `bun run typecheck`：通过。
- `bun run test`：432 files passed，1 skipped；3315 tests passed，3 skipped。输出中的 SQLite experimental warning、故障注入 warning 与 workspace-history fail-open 日志均为既有测试/运行诊断，没有失败。
- `bun run docs:check`：通过，5353 files，0 failures。
- `git diff HEAD --check`：通过。

## 未运行项与残余风险

未运行真实迁移生产环境、真实用户数据或远端服务；本任务仅修复严格类型边界并复用已有迁移测试。未新增行为测试，因为现有 34 个迁移测试已覆盖正常迁移、幂等、畸形结构和条目 fail-closed 行为。
