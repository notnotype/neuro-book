# 2026-06-29 Round 17 - Profile Test Impact Map

## Scope

本轮核对 profile prompt / routing 迁移会影响哪些测试。目标是让后续实现 P1 时有清晰验收面，而不是只靠字符串搜索或人工读 prompt。

本轮不修改业务代码。

## Current Evidence

当前相关测试主要有两组：

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - 已测试 `simulator.leader` 工具边界与 prompt。
  - 已测试 `director` 有 Plot System 合同、`get_scene_world_context`，没有 `write/edit`。
  - 当前没有断言 director 去除普通写作 `Simulation gate`。
  - 当前没有断言 `DirectorOutputSchema` 不再有 `plot` kind / `simulator_requests`。
- `server/agent/profiles/leader-assets-profile.test.ts`
  - 第一个测试会组装完整 `leader.default` prompt 和 history references。
  - 它已经断言 `leader.default` 不持有 Plot tools，且会注入 `reference/agent/profile-routing.md`、`reference/agent/leader-default.md`。
  - 该测试较重，已有 20 秒预算；继续把大量断言塞进这里会增加维护成本。
  - 其中 writer payload 测试确认 `threadIds/sceneIds/plotIds` 不进入 writer context。

## Test Gap

P1 profile/routing 去旧语义后，应新增或修改断言覆盖：

- `leader.default` prompt 不再说 Plot 不存在。
- `leader.default` routing 允许普通写作里调用 `director` 处理 Thread / Scene / Chapter Scene 顺序。
- `director` prompt 不再包含普通写作 `Simulation gate`。
- `director` prompt 不再指示普通写作未裁决状态交给 `simulator.leader`。
- `writer` prompt 不再说“写作模式不使用 Plot 系统”，而是“writer 不直接消费 Plot tools / payload ids；上游 brief 已编译 Scene/World Context”。
- `DirectorOutputSchema` 不再允许 `plot_updates.kind = "plot"`，不再使用 `simulator_requests`。

## Recommended Test Placement

### 1. `simulation-director-profiles.test.ts`

这里适合放 director 相关断言：

- `directorProfile.rootToolKeys` 保持：
  - 包含 Plot read/write tools。
  - 包含 `get_scene_world_context`。
  - 后续包含 `get_chapter_writer_brief`。
  - 不包含 `execute_world`、`write`、`edit`。
- director prompt：
  - 包含 `World Engine boundary` 或等价边界说明。
  - 包含 `Scene World Anchor`。
  - 不包含 `Simulation gate`。
  - 不包含“调用 simulator.leader 裁决普通写作状态”。
- schema：
  - `DirectorOutputSchema` 只允许 `thread | scene`。
  - 使用 `world_engine_requests`。

这组测试是 P1 的主验收面。

### 2. `leader-assets-profile.test.ts`

这里只放少量 leader 集成断言，避免扩大慢测：

- `visiblePrompt` 包含 `Plot System` / `Scene-only` / `director`。
- `visiblePrompt` 不包含 `plot / simulator / director / emulation 都不在 leader.default 的职责内`。
- `profile.rootToolKeys` 仍不包含 Plot 写工具。

不要在这个慢测里检查大量文案细节。

### 3. 新增轻量测试候选

如果 P1 改动导致 `leader-assets-profile.test.ts` 更慢或更脆，可以新增专门测试：

```text
server/agent/profiles/profile-plot-routing.test.ts
```

它只直接 prepare `leader.default`、`director`、`writer` 三个 profile，不加载完整 `AgentProfileCatalog`。这样可以把 Plot routing 的断言从大型 profile catalog 测试里拆出来。

## Schema Migration Test Detail

`DirectorOutputSchema` 用 TypeBox 定义。修改后建议用 `Value.Check()` 做明确断言：

- 接受 `plot_updates: [{kind: "thread"}]`
- 接受 `plot_updates: [{kind: "scene"}]`
- 拒绝 `plot_updates: [{kind: "plot"}]`
- 接受 `world_engine_requests: []`
- 拒绝旧字段只含 `simulator_requests` 的 data

这比只检查源码字符串更稳定。

## Brief Tool Tests Later

`get_chapter_writer_brief` 实现时不要混进 P1 测试，应单独覆盖：

- `server/agent/tools/plot-tools.test.ts`
  - tool 参数 schema 接受 `projectPath/chapterPath`。
  - tool 调 `plotFacade.getChapterWriterBrief()`。
  - result `details` 返回 `ChapterWriterBriefDto`。
- `server/agent/profiles/simulation-director-profiles.test.ts`
  - director rootToolKeys 包含 `get_chapter_writer_brief`。

## Result

后续实现应先写或更新这些测试，再改 prompt/schema。P1 的成功标准不是“文案看起来对”，而是 profile 的 routing、工具边界和输出合同都被测试锁住。

