# Round 136: Profile Contract Cleanup Implementation

## Scope

本轮从纯探索进入 Slice 1 `Profile Contract Cleanup` 实现。目标是让旧 director simulator contract 在 Agent-facing Interface 上失效，为后续 OpenAPI explicit path、Chapter Writer Brief Module 和 Agent Tool Binding 提供稳定基底。

本轮修改了业务代码、profile source、reference、tests 和 compiled artifacts。没有进入 Slice 2。

## Files Changed

### Profile Contract

- `server/agent/profiles/builtin-contracts.ts`
  - `DirectorOutputSchema` 删除 `simulator_requests`。
  - `DirectorOutputSchema.plot_updates.kind` 删除 `"plot"`。
  - 新增 `world_engine_requests`。
  - root object 与 `plot_updates` item 显式 `additionalProperties: false`。
  - writer legacy Plot id 字段 description 改为要求上游使用完整 Scene / World Context brief。
  - 移除会被打包进 director artifact 的无关 `simulator.leader` 描述文本，避免 artifact grep 误判旧 director contract 仍存在。

### System / User Profile Source

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`

director 现在明确：

- 管理 Thread / Scene 和 writer handoff。
- 不写正文。
- 不写 World Engine。
- 需要未决 World Engine 状态时返回 `world_engine_requests` 给 `leader.default`。
- 不再包含 `simulator_requests` / `Simulation gate` / `simulator.leader`。

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`

leader.default 现在明确：

- World Engine 仍是动态世界状态与时间线唯一真相源。
- Plot System 是 Scene / Chapter 结构层，不是动态状态源。
- leader.default 不直接持有 Plot write tools。
- Thread / Scene / Chapter Plot / writer brief 编译路由到 `director`。
- director 返回 `world_engine_requests` 后，由 leader 用 `execute_world` 处理，复杂维护再转 `world.engine`。

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`

writer 现在明确：

- 不持有 Plot tools。
- 不根据 legacy `threadIds / sceneIds / plotIds` 自行读取 Plot。
- 可以消费 `invoke_agent.message` 中完整 Scene / World Context brief。

### References

- `reference/agent/leader-default.md`
- `reference/agent/profile-routing.md`
- `reference/agent/novel-writing-workflow.md`

reference 现在统一为：

- `leader.default -> director -> writer` 是普通写作中涉及 Scene / Chapter / brief 的结构链。
- `director` 不写 World Engine；未决问题通过 `world_engine_requests` 交回 leader。
- `writer` 不直接持有 Plot tools，但可消费上游完整 Scene / World Context brief。
- `simulation/` / `emulation` 仍属于 legacy RP / 历史维护资料，不作为普通写作动态状态源。

### Tests

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - 增加 `Value.Check()` 正负例。
  - 覆盖 valid new director output。
  - 覆盖 old `simulator_requests` fails。
  - 覆盖 old `plot_updates.kind = "plot"` fails。
  - 覆盖 root extra / item extra fails。
  - 覆盖 missing `world_engine_requests` fails。
  - director system prompt 负断言旧 simulator gate 消失。

- `server/agent/profiles/leader-assets-profile.test.ts`
  - leader.default 保持无 Plot tools。
  - leader.default reference 能看到 Scene / Chapter / writer brief 路由 director。
  - writer prompt 能看到 Scene / World Context brief consumption 和无 Plot tools 约束。
  - 更新 leader.assets 注入 routing reference 的旧 simulator 断言为 World Engine / world.engine。

## Verification

### Focused Tests

命令：

```powershell
bun vitest run server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts
```

结果：

- 2 test files passed。
- 17 tests passed。

第一次测试曾失败：

- `systemPrompt` 变量放错作用域，已修正为 director test 内局部变量。
- `leader.default` assets profile source 修改后未编译，catalog 拒绝加载，已通过 `bun run system-assets:prepare` 刷新 system compiled artifacts。

### Profile Compile

system artifacts：

```powershell
bun run system-assets:prepare
```

结果：

- `prepared system profiles: 14 profile(s), compiled 13 stale profile(s)`

active user artifacts：

```powershell
bun scripts/build/profile.ts compile --all
```

结果：

- compiled 14 user profile artifacts。
- `director` -> `af65b4e2fd098d7958b1fdabd1f943592af246a93a024fe51f13cfb09610f476`
- `leader.default` -> `0d7c8e2a2e2146f85ed001d8e8ca5255e42308870a8a564c10f4f348221aa406`
- `writer` -> `ddd57885118442ca8a0fba328e6db79543a40c97872b2a0049abda02360d000c`

system profile status：

- `director`: loaded, artifact `7c9b1f6c42c5742f9b60b8c8930266612cbef5166695d98192fbd1a9a0809ed9`
- `leader.default`: loaded, artifact `aefc58d10d2ff99b37ab649e6d645ff87863a01726855a73b9d9396ea8aecd80`
- `writer`: loaded, artifact `be5a0a3181800e3ff9b81961cff0a24b97e25ff81306d6d004eaaaf9999c5999`

active user profile status：

- `director`: loaded, artifact `af65b4e2fd098d7958b1fdabd1f943592af246a93a024fe51f13cfb09610f476`
- `leader.default`: loaded, artifact `0d7c8e2a2e2146f85ed001d8e8ca5255e42308870a8a564c10f4f348221aa406`
- `writer`: loaded, artifact `ddd57885118442ca8a0fba328e6db79543a40c97872b2a0049abda02360d000c`

Profile check：

```powershell
bun scripts/build/profile.ts check director
bun scripts/build/profile.ts check leader.default
bun scripts/build/profile.ts check writer
```

结果：

- all `profile check passed`

### Artifact Grep

对 current system/user director artifact 检查旧字段：

```powershell
rg -n 'simulator_requests|Simulation gate|simulator\.leader' <system-director-artifact> <user-director-artifact>
```

结果：

- no matches

对 current system/user director artifact 检查新字段：

```powershell
rg -n 'world_engine_requests|World Engine gate|不写 World Engine' <system-director-artifact> <user-director-artifact>
```

结果：

- system/user artifacts 均命中 `world_engine_requests`、`World Engine gate` 和 `不写 World Engine`。

## Actual Result / Plan Delta

计划是完成 Slice 1。实际完成范围符合计划，并额外处理了一个 runtime 证据问题：`builtin-contracts.ts` 中无关 simulator.actor description 会被打包进 director artifact，导致 artifact grep 命中 `simulator.leader`。本轮把该 description 改成 profile-key-free 表述，使 director artifact grep 可以直接证明旧 director contract 已消失。

另一个差异是 test command：`assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts` 没有被当前 vitest run 计入 test files；writer 相关断言实际通过 `server/agent/profiles/leader-assets-profile.test.ts` 的 writer prepare case 覆盖。

本轮没有做真实 Agent smoke，也没有验证 `get_agent_profile` discovery。Slice 1 的 static/runtime contract 已成立，但真实模型行为还未声明完成。

## Remaining Work

下一步进入 Slice 2 `OpenAPI Explicit Path`：

1. `RouteMetaEntry.path?: string`
2. `RouteMetaEntry.emitRouteMeta?: boolean`
3. shared operation builder
4. canonical spec duplicate guard
5. route-local representative selector
6. generated `defineRouteMeta()` path params proof

不要跳过 Slice 2 直接实现 `get_chapter_writer_brief`。
