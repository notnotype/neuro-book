# Round 87: Profile Compile Command Evidence

## Scope

本轮确认 Slice 1 完成后应如何证明 profile source 已经变成 runtime artifact。结论是：要同时使用 profile CLI 的 `check/status/compile` 和 artifact 内容检查，不能只依赖测试通过。

## Current Evidence

- `package.json`
  - `system-assets:prepare` 执行 `bun scripts/build/prepare-system-assets.ts`。
  - `dev` 会执行 `bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets`。
  - 没有 package script 直接包装 `scripts/build/profile.ts`。
- `scripts/build/profile.ts`
  - 支持 `status | check | compile | preview`。
  - 支持 `--system` 切到 system profile root：`assets/workspace/.nbook/agent/profiles`。
  - 默认操作 user profile root：`workspace/.nbook/agent/profiles`。
  - `check` 会做 TS typecheck、catalog snapshot issue 检查。
  - `compile` 会写 `.compiled/artifacts/<sha>.mjs` 并更新 manifest。
  - target 可传 profileKey，如 `director`，脚本会从 manifest 或 source 中解析 fileName。
- `reference/agent/profile-compiled-artifacts.md`
  - `.compiled/manifest.json` 是当前指针。
  - `artifactSha` 是编译输出字节 hash。
  - `AgentProfileCatalog.get()` 只有 loaded 可返回。

## Operational Interface

Slice 1 后建议的证明顺序：

1. 检查 system director：
   ```powershell
   bun scripts/build/profile.ts check director --system
   ```
2. 编译 system director：
   ```powershell
   bun scripts/build/profile.ts compile director --system
   ```
3. 检查 user director：
   ```powershell
   bun scripts/build/profile.ts check director
   ```
4. 编译 user director：
   ```powershell
   bun scripts/build/profile.ts compile director
   ```
5. 查询状态：
   ```powershell
   bun scripts/build/profile.ts status director --system
   bun scripts/build/profile.ts status director
   ```

如果后续采用 sync user assets 更新 user copy，则 user compile 可以替换为：

```powershell
bun scripts/build/prepare-system-assets.ts --sync-user-assets
```

但这个替代只有在 user director 没有手改、仍跟随上游时成立。

## Acceptance

最小 artifact 内容检查：

- system source 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- user source 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- system manifest `profiles.director.artifactSha` 指向新 sha。
- user manifest `profiles.director.artifactSha` 指向新 sha。
- system artifact 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`，含 `world_engine_requests`。
- user artifact 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`，含 `world_engine_requests`。
- `get_agent_profile({profileKey:"director"})` 的 output schema summary 不含 `simulator_requests`，含 `world_engine_requests`。

## Risks

- `check` 通过不代表 artifact 已更新。
- `compile --system` 更新 system 不代表 runtime active user profile 更新。
- `prepare-system-assets --sync-user-assets` 非 force 会保留手改 user copy；这时必须处理 warning，而不能声称 runtime 已更新。

## Conclusion

Profile Contract Cleanup 的完成证据应是 source + manifest + artifact + discovery 四件套。CLI 的 `check/compile/status` 是实现后的操作 Interface，但 artifact 内容检查仍不可省略。

