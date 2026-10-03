# Round 148: editSlice 删除旧绝对 mutation 的 A issue

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 147 修复了 `editSlice` 原样保存误报和移动 instant 漏报，但继续审查同一逻辑时发现：如果编辑切面时删掉旧绝对 mutation，旧逻辑只用新 mutations 收集 A issue，会漏掉被删除旧 mutation 对下游相对 op 的影响。

典型场景：

- default `hp = 100`
- 10 秒 slice 写入 `hp set 80`
- 20 秒 slice 写入 `hp add -10`
- 编辑 10 秒 slice，删除 `hp set 80`

这时没有 E issue，因为 `hp add` 仍然有 default `100` 作为基准；但最终 `hp` 会从 70 变成 90，语义已经改变，应该返回 `base-shifted`。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `editSlice()` 在替换前解码旧 mutations。
  - `collectEditIssues()` 新增 `previousMutations` 输入。
  - 非原样保存时，A issue 同时观察：
    - 旧 mutations 在旧 instant 的下游影响。
    - 新 mutations 在旧 instant 与新 instant 的下游影响。
  - 继续复用 `excludeSliceId` 排除当前 slice 自身，并用 `dedupeIssues()` 去重。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：删除旧 `hp set 80` 后返回下游 `base-shifted`，同时确认最终 `hp` 从 70 变为 90。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - service 依赖变化后重新编译 `world.engine` profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 49 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 67 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十八轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 editSlice 删除旧绝对 mutation 的 A issue 收集规则。
- `PROJECT-STATUS.md`
  - 增加 round-148 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint，只修正现有 `editSlice` 的 `{sliceId, issues}` 返回语义。
