# Round 120: Profile Compile / Sync Verification Commands

## Scope

本轮把 Profile Contract Cleanup 后应执行的命令和证据解释写清楚。没有实际编译，也没有运行测试。

## Command Plan

Slice 1 修改完成后，先检查 system profile：

```powershell
bun scripts/build/profile.ts check builtin/director.profile.tsx --system
bun scripts/build/profile.ts compile builtin/director.profile.tsx --system
bun scripts/build/profile.ts status director --system
```

再同步 user assets：

```powershell
bun scripts/build/prepare-system-assets.ts --sync-user-assets
```

然后检查 active user profile：

```powershell
bun scripts/build/profile.ts check builtin/director.profile.tsx
bun scripts/build/profile.ts status director
```

最后检查 manifest 与 artifact 内容：

```powershell
$system = Get-Content -LiteralPath "assets\workspace\.nbook\agent\profiles\.compiled\manifest.json" -Raw | ConvertFrom-Json
$user = Get-Content -LiteralPath "workspace\.nbook\agent\profiles\.compiled\manifest.json" -Raw | ConvertFrom-Json
$system.profiles.director
$user.profiles.director

rg -n "simulator_requests|Simulation gate|simulator\.leader" `
  "assets\workspace\.nbook\agent\profiles\builtin\director.profile.tsx" `
  "workspace\.nbook\agent\profiles\builtin\director.profile.tsx" `
  "assets\workspace\.nbook\agent\profiles\.compiled\artifacts" `
  "workspace\.nbook\agent\profiles\.compiled\artifacts"
```

如果只想检查 active director artifact，先从 manifest 取 `profiles.director.artifactSha`，再 grep 对应 `<sha>.mjs`，避免被历史 artifact 干扰。

## Evidence Interpretation

- `profile check passed` 只说明 typecheck 与 catalog 没有 error；`system_profile_shadowed`、`not_compiled`、`compile_stale` 等 warning 仍需要人工解释。
- `profile status director --system` 为 `loaded` 只说明 system artifact fresh，不说明 active user runtime 也 fresh。
- `profile status director` 为 `loaded` 只说明 user root artifact fresh，不说明语义已移除旧字段；仍要 grep active artifact。
- `prepare-system-assets --sync-user-assets` 的输出必须看 `updated profiles` 和 `profile sync warning`。如果出现手改 warning，本轮不能继续假定 user source 已更新。
- `--force-sync-user-assets` 会覆盖用户 assets，只能在明确决定丢弃 user 手改时使用。

## Required Test Layer

Slice 1 代码改完后至少需要这些测试/断言：

- `server/agent/profiles/simulation-director-profiles.test.ts`：director prompt/toolset/schema contract。
- `server/agent/profiles/leader-assets-profile.test.ts` 或相邻 profile 测试：leader.default 能把 Scene / Chapter / brief 路由到 director。
- schema-only `Value.Check()` 正负例：新 `DirectorOutputSchema` 通过，旧 `simulator_requests`、旧 `plot` kind 和额外字段失败。
- writer profile 测试或 prompt 断言：writer 没有 Plot tools，但允许消费上游完整 Scene / World Context brief。

## Done Definition

Profile Contract Cleanup 的命令级完成定义：

1. system check/compile/status 通过。
2. user sync 没有未处理 shadow warning。
3. user check/status 通过。
4. system/user active manifest 均指向新 director artifact。
5. active artifact grep 不再命中旧 simulator contract。
6. profile tests 覆盖 schema strict、leader routing 和 writer isolation。

## Conclusion

后续实现不能只给出测试绿或 source grep 绿。Profile 运行时有 source、manifest、artifact、catalog 四个证据层；缺任一层，Agent 易用性改造都不能判定完成。

