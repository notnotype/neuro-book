# 2026-06-30 Round 62 - User Assets Shadow Risk

## Scope

本轮审计 system profile 与 user assets profile 的 shadow 风险。目标是明确 Slice 1 实现时如何避免“system source 已新、runtime 仍用 user 旧 prompt”的错配。

本轮不修改业务代码。

## Evidence

当前本地存在双份 director source：

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

两份当前都包含：

- `simulator.leader`
- `simulator_requests`
- `Simulation gate`

两份 compiled manifest 当前都指向同一旧 artifact hash：

- `c297de152fc11052461e029e4f4bdf2606d0c63d53e38f4e2e15cf3f591d66a9`

`AgentProfileCatalog` 当前行为：

- system profile 先加载，user profile 后加载并按同一 `profileKey` 覆盖。
- `readProfileShadowWarnings()` 会读取 system profile metadata；如果 user file hash 与 system metadata 不同，产生 `system_profile_shadowed` issue。
- `statusFromIssue("system_profile_shadowed")` 仍返回 `loaded`。
- `applyBuiltinSchemaLock()` 会在 builtin schema 不一致时把 profile 的 initial/payload/output schema 锁回内置 schema，但不会自动改 user source prompt。

## Risk

Slice 1 如果只改 system source 和 system compiled artifact，可能出现：

- user root 仍覆盖 `director`。
- user source prompt 仍要求 `simulator_requests`。
- builtin schema lock 让 runtime 使用新的 `DirectorOutputSchema`。
- 最终 director prompt 和 output schema 不一致：prompt 叫旧字段，schema 拒绝旧字段。

这比单纯 stale 更难排查，因为 catalog 可能仍显示 `loaded`，只是带 `system_profile_shadowed` issue。

## Implementation Options

### Option A: sync user assets after system compile

使用现有同步路径更新 active user root：

```powershell
bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets
```

优点：

- system / user source 和 compiled manifest 可一起更新。
- 最接近开发环境实际启动路径。

风险：

- `--force-sync-user-assets` 可能覆盖用户手改 profile。实现前应确认这是本地 dev 验收动作，不应作为无提示的用户数据迁移策略。

### Option B: only prove system root, then require no user shadow

实现只改 system root；验收时检查 active catalog 没有 user shadow。

优点：

- 不碰 Workspace Root `.nbook` 用户运行数据。

风险：

- 当前本地已有 user director source，所以这个选项在当前环境不能证明 runtime 使用新 profile。

### Option C: implement migration-aware sync check

实现后让验收脚本或文档要求：

- 如果 user source hash 等于旧 managed system hash，则可以自动同步。
- 如果 user source hash 已被用户手改，则保留 user shadow，但 build-status/issue 必须显式提醒。

优点：

- 尊重用户 assets，同时减少旧 managed copy 卡住 runtime 的风险。

风险：

- 超出 Slice 1 本身，可能属于 profile build/user assets sync 的独立改造。

## Recommendation

当前 Task 78 Slice 1 不应扩展成新的 user assets sync 机制。推荐：

- 业务代码只改 system source、reference、schema 和 tests。
- 本地验收时使用现有 prepare-system-assets sync 路径或明确检查 user shadow。
- 文档和 walkthrough 明确：如果 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 仍旧，不能声称真实 runtime 使用新 director。

## Result

Task 78 的 runtime completion audit 必须包含 user assets shadow 检查。尤其是当前本地已经存在 user director copy；下一步实现 Slice 1 后，如果不处理 user root，compiled current pointer proof 会失败或变成 prompt/schema 错配。

