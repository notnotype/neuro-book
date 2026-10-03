# 2026-06-30 Round 61 - Profile Compile Current Pointer Proof

## Scope

本轮审计 Slice 1 后如何证明 `.compiled` runtime current pointer 已更新。目标是避免只跑 source tests，却让运行环境继续加载旧 director artifact。

本轮不修改业务代码。

## Evidence

当前 profile 编译入口：

- `scripts/build/profile.ts`
  - 支持 `status | check | compile | preview`。
  - `--system` 指向 `assets/workspace/.nbook/agent/profiles`。
  - `compile` 会先跑 TS typecheck，再调用 `compileProfileArtifacts()`。
  - `compile builtin/director.profile.tsx --system` 会只编 system root 的 director。
- `scripts/build/prepare-system-assets.ts`
  - 编译 system variables 和 system profiles。
  - `--sync-user-assets` 会调用 `syncSystemAssetsToUserAssets()`。
  - `--force-sync-user-assets` 通过 force 同步用户 assets。
- `server/workspace-files/system-assets-preflight.ts`
  - `prepareSystemAssets()` 会编译 `assets/workspace/.nbook/agent/profiles`。
- `server/workspace-files/novel-workspace.ts`
  - 同步 system profile 到 user assets 时使用 `ProfileReleasePublisher({mode: "disk_only"})` 写 user root manifest。

当前 compiled state：

- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json` 的 `director.artifactSha` 是 `c297de152fc11052461e029e4f4bdf2606d0c63d53e38f4e2e15cf3f591d66a9`。
- `workspace/.nbook/agent/profiles/.compiled/manifest.json` 的 `director.artifactSha` 也是同一个 hash。
- 该 artifact 当前包含 `simulator_requests` / `Simulation gate`，不包含 `get_chapter_writer_brief` / `world_engine_requests`。

## Proof Sequence

Slice 1 后，compiled proof 应分成 system root 与 active user root 两步。

### 1. System source compile proof

先证明 system source 可编译：

```powershell
bun scripts/build/profile.ts check builtin/director.profile.tsx --system
bun scripts/build/profile.ts compile builtin/director.profile.tsx --system
```

然后读取 system manifest current pointer：

```powershell
$m = Get-Content -LiteralPath 'assets\workspace\.nbook\agent\profiles\.compiled\manifest.json' -Raw | ConvertFrom-Json
$m.profiles.director.artifactSha
```

再检查当前 artifact 内容：

```powershell
rg -F "simulator_requests" assets/workspace/.nbook/agent/profiles/.compiled/artifacts/<artifactSha>.mjs
rg -F "Simulation gate" assets/workspace/.nbook/agent/profiles/.compiled/artifacts/<artifactSha>.mjs
rg -F "world_engine_requests" assets/workspace/.nbook/agent/profiles/.compiled/artifacts/<artifactSha>.mjs
```

预期：旧字符串无命中，新字段有命中。

### 2. Active user root proof

当前 dev Workspace Root 下也存在 `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`。运行时 user profile 会覆盖 system profile，因此只证明 system root 不够。

需要确认 active user manifest：

```powershell
$m = Get-Content -LiteralPath 'workspace\.nbook\agent\profiles\.compiled\manifest.json' -Raw | ConvertFrom-Json
$m.profiles.director.artifactSha
```

并对 user artifact 做同样字符串检查。

### 3. Build-status proof

如果本地 server 在运行，还应通过 `/api/agent/profiles/build-status` 或对应 config service 确认 `director`：

- `loadStatus === "loaded"`
- `buildState.running === false`
- `buildState.queued === false`
- 没有 `compile_stale` / `compile_failed`

build-status 只能证明 catalog freshness，仍不能替代 artifact 内容检查。

## Result

Slice 1 的 compiled 验收不应只写“profile compile passed”。合格证明必须包含：

- system current pointer 更新。
- active user root current pointer 不再指向旧 artifact。
- 当前 artifact 不含旧 simulator 字段。
- build-status 未显示 stale/failed。

如果 active user root 仍旧，真实 runtime 可能继续加载旧 director，即使 source tests 全绿。

