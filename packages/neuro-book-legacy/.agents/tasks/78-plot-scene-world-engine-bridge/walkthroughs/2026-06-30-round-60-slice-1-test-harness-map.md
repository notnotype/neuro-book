# 2026-06-30 Round 60 - Slice 1 Test Harness Map

## Scope

本轮审计 Slice 1 `Profile Contract Cleanup` 的测试落点。目标是把“改了 director prompt/schema”变成可机械验证的测试面，而不是只靠人工 grep。

本轮不修改业务代码。

## Evidence

当前最直接测试文件是 `server/agent/profiles/simulation-director-profiles.test.ts`：

- 已导入 `DirectorInitialSchema` / `DirectorOutputSchema`。
- 已直接 import `assets/workspace/.nbook/agent/profiles/builtin/director.profile`。
- 当前 director 测试只断言：
  - `directorProfile.initialSchema === DirectorInitialSchema`
  - `directorProfile.outputSchema === DirectorOutputSchema`
  - root tools 包含 `get_scene_world_context`
  - root tools 不包含 `write` / `edit`
  - prompt 包含 `剧情导演`、`Thread / Scene`、`reference/plot/agent-spec.md`
- 当前测试没有断言：
  - prompt 不包含 `Simulation gate`
  - prompt 不包含 `simulator_requests`
  - prompt 不包含“调用 simulator.leader”
  - prompt 包含 `world_engine_requests`
  - `DirectorOutputSchema` 拒绝旧字段和旧 kind

当前 `server/agent/profiles/builtin-contracts.ts`：

- `DirectorOutputSchema.plot_updates.kind` 仍是 `thread | scene | plot`。
- `DirectorOutputSchema` 仍有 `simulator_requests`。
- root object 和 `plot_updates` item 没有显式 `additionalProperties: false`。

当前 `server/agent/tools/agent-collaboration-tools.ts` 的 `get_agent_profile` 只返回 schema summary 和 root tool keys，不返回 full schema / reportResultSchema；因此字段 description 是 leader 发现 director Interface 的 Agent-facing 文档。

## Recommended Test Changes

Slice 1 应至少补三类测试。

### 1. Director prompt assertions

放在 `simulation-director-profiles.test.ts` 现有 director case 中：

- `expect(prompt).not.toContain("Simulation gate")`
- `expect(prompt).not.toContain("simulator_requests")`
- `expect(prompt).not.toContain("调用 simulator.leader")`
- `expect(prompt).toContain("world_engine_requests")`
- `expect(prompt).toContain("World Engine")`

这些断言证明 source prompt 不再给普通写作 director 旧 route。

### 2. Director schema strict assertions

可以放在同一文件，也可以新增 `server/agent/profiles/director-output-schema.test.ts`。建议新增独立 schema-only 测试，避免 profile prepare 噪音。

测试应导入 `Value`：

```ts
import {Value} from "typebox/value";
```

必须验证：

- 合法新 payload 通过，包含 `world_engine_requests: []`。
- legacy-only payload 失败，只有 `simulator_requests` 没有 `world_engine_requests`。
- mixed payload 失败，root 混入 `simulator_requests`。
- `plot_updates[0].kind = "plot"` 失败。
- `plot_updates[0]` 混入旧字段如 `plotId` 失败。

### 3. Writer prompt/comment assertion

writer 仍不应持有 Plot tools，但不能再表达“写作模式不使用 Plot 系统”。推荐测试落点：

- 如果已有 writer profile prompt 测试，加入负断言。
- 如果没有，新增小测试只 prepare writer prompt。

断言目标：

- writer root tools 不包含 `get_plot_tree` / `get_chapter_plot` / `get_chapter_writer_brief`。
- writer prompt 不包含“写作模式不使用 Plot 系统”。
- writer prompt 或注释应表达“writer 不直接使用 Plot tools；消费上游完整 brief”。

## Validation Commands

实现 Slice 1 后建议先跑最小测试：

```powershell
bunx vitest run server/agent/profiles/director-output-schema.test.ts server/agent/profiles/simulation-director-profiles.test.ts --reporter=dot
```

如果 writer 测试新增到独立文件，把它加入同一命令。

不要用宽泛 `bun test server/agent/profiles/...` 作为第一轮验证；历史记录显示 Bun 可能匹配 `product/server/**` staged output 镜像测试，导致旧 compiled artifact 干扰判断。

## Result

Slice 1 的测试 Interface 应以 `DirectorOutputSchema` 和 prepared prompt 为主。`simulation-director-profiles.test.ts` 是 prompt/toolset 主落点；schema strict 负例建议独立文件承载。这样能在不启动真实 Agent 的情况下，机械证明旧 simulator contract 已被 source 层拒绝。

