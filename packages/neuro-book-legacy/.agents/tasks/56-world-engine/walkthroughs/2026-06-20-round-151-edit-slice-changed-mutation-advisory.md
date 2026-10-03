# Round 151: editSlice 只为实际变化 mutation 收集 A issue

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 148 / 149 / 150 把 `editSlice` 删除旧绝对 mutation 的 A issue 语义补到了 facade、HTTP API 和 Agent 工具层。继续审查同一块逻辑时发现一个误报风险：只要同一个 slice 中任意 mutation 变化，旧逻辑会把整块旧 mutations 和整块新 mutations 都拿去重新收集 A issue。

这会导致一个糟糕体验：slice 中 `hp set 80` 未变化，只是把 `mind set "警惕"` 改成 `"冷静"`，下游 `hp add -10` 却会再次触发 `base-shifted`。这不是本次编辑实际改变的语义。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `collectEditIssues()` 在同 instant 编辑时使用 `diffMutations()` 分别计算旧侧删除 / 修改候选与新侧新增 / 修改候选。
  - 未变化的 mutation 不再参与 A issue 收集。
  - 移动 instant 时仍把整组 mutation 视为被移动，继续观察旧位置与新位置。
  - 新增 `diffMutations()`，按 `mutationSignature()` 做 multiset 差异，支持重复 mutation 的计数差异。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：同一 slice 中 `hp set 80` 未变化，只修改 `mind set` 时，不为下游 `hp add` 返回 `base-shifted`。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - service 依赖变化后重新编译 `world.engine` profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 50 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 70 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十一轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充同 instant 部分修改时只对真实变化 mutation 收集 A issue。
- `PROJECT-STATUS.md`
  - 增加 round-151 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint，只修正现有 `editSlice` 的 `{sliceId, issues}` 精度。
