# Round 84: Director Runtime Truth Source

## Scope

本轮确认 `director` profile 的真实运行状态应该以什么为准。结论是：不能只看 system source，也不能只看 user source；runtime 真相源是 `AgentProfileCatalog` 解析后的 active profile，以及 `.compiled/manifest.json -> artifacts/<sha>.mjs`。

## Current Evidence

- `reference/agent/profile-compiled-artifacts.md`
  - `.compiled/manifest.json` 是当前指针。
  - `artifactSha` 指向内容寻址不可变 artifact。
  - `AgentProfileCatalog.get()` 只有 `loaded` 可返回 profile。
- `server/agent/profiles/catalog.ts`
  - 用户 profile 按 key 覆盖系统 profile。
  - `loadInventory()` 先加载 system，再加载 user；user source 会覆盖同 key system source。
  - `system_profile_shadowed` 是 warning，不阻止 user source 被加载。
  - build running/queued 时 `get()` 直接拒绝运行。
- `workspace/.nbook/.system-assets-sync-state.json`
  - `builtin/director.profile.tsx` 的 user copy 当前是从旧 upstream hash 同步来的，`lastSyncedUserHash` 等于旧 upstream hash。
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - 仍含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - 仍含同样旧合同。
- `workspace/.nbook/agent/profiles/.compiled/manifest.json`
  - `director` 是 `loaded`。
  - artifact sha 为 `b2fd54a5...`。
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json`
  - system `director` 也是 `loaded`。
  - artifact sha 为 `33e5a16f...`。
- 当前 user/system director compiled artifacts 都能检索到：
  - `simulator_requests`
  - `Simulation gate`
  - `simulator.leader`
  - 没有 `world_engine_requests`
  - 没有 `get_chapter_writer_brief`

## Interface Problem

Slice 1 如果只修改 `assets/workspace/.../director.profile.tsx`，runtime 仍可能继续使用 `workspace/.nbook/.../director.profile.tsx`。如果只修改 source，不重新编译，manifest 仍可能指向旧 artifact。两者任何一个漏掉，都不能证明 Agent 已经使用新合同。

这里的 Module 是 `AgentProfileCatalog`，它的 Interface 不是“某个文件存在”，而是：

- active source root。
- loadStatus。
- source hash / artifact sha freshness。
- imported compiled artifact 内容。
- build coordinator 状态。

## Acceptance Requirements

Profile Contract Cleanup 后，最小验收应检查：

- `get_agent_profile({profileKey:"director"})` 可用，说明 catalog active profile 是 loaded。
- active user source（若 user root 存在同 key）不含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- active user manifest `profiles.director.artifactSha` 指向新 artifact。
- active user artifact 不含 `simulator_requests` / `Simulation gate` / `simulator.leader`。
- active user artifact 含 `world_engine_requests`。
- system source/artifact 也同步更新，避免下次 user assets sync 后回退。

## Deepening Note

这不是新增 Module 的建议，而是验收 Interface 的收缩：后续测试和手工验证应跨 `AgentProfileCatalog` seam，而不是停在 source file seam。

## Conclusion

Task 78 的 Agent 易用性不能用 source 修改证明完成。director 的当前 runtime truth source 明确仍是旧 simulator gate；Slice 1 必须把 source、manifest、artifact 和 `get_agent_profile` discovery 一起纳入验收。

