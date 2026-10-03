# Round 152: editSlice 纯重排相关 mutation 的 A issue

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 151 把 `editSlice` 的同 instant 候选集收紧为“真正删除 / 修改 / 新增”的 mutation，解决了未变 mutation 重复触发 A issue 的噪音。但继续审查发现一个相反方向的漏报：同一 slice 内 `mutation.seq` 是 reduce 语义的一部分，纯重排同一组 mutation 可能改变状态。

典型场景：

- 10s slice 原本是 `hp set 80` -> `hp set 90`。
- 20s slice 是 `hp add -10`，最终 hp 为 80。
- 编辑 10s slice 只把顺序调成 `hp set 90` -> `hp set 80`。
- mutation multiset 没变，但 20s 的累加基从 90 变成 80，最终 hp 变成 70。

Round 151 的 `diffMutations()` 是 multiset 差异，纯重排会得到空候选，从而漏掉这类下游 `base-shifted`。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `collectEditIssues()` 在同 instant 编辑时，除删除 / 修改 / 新增候选外，额外合并 `reorderedOverlapCandidates()`。
  - `reorderedOverlapCandidates()` 会按 `mutationSignature()` 匹配新旧 mutation，并检测相对顺序是否反转。
  - 只有同一 subject 且 attr 同一路径或父子路径相关的重排才进入候选。
  - 无关属性重排不会触发 A issue，避免回到 round 151 之前的噪音。
  - 新增 `sameMutationInputSequence()`、`mutationsOverlap()`、`uniqueMutations()` 辅助函数。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：`hp set 80` / `hp set 90` 纯重排后，下游 `hp add` 返回 `base-shifted`，最终 hp 从 80 变成 70。
  - 新增护栏测试：`hp set` 与 `mind set` 这种无关属性纯重排不返回 A issue。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 日历字符串边界测试，确认 `POST /slices/:id/edit` 对纯重排相关 mutation 返回 `{sliceId, issues}`。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `edit_world_slice` 契约测试，确认 Agent 工具层也能看到纯重排带来的下游 `base-shifted`。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 52 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 74 tests passed
- 已通过：`bun run typecheck`
- 备注：目标测试组第一次重跑时 74 个断言均通过，但 Vitest worker 退出阶段出现一次测试池错误；立即重跑同一命令后通过。

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十二轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充同 instant 纯重排相关 mutation 会进入 A issue 候选；无关属性重排不提醒。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 补充 `edit_world_slice` 的 `mutations` 顺序是 reduce 语义的一部分。
- `PROJECT-STATUS.md`
  - 增加 round-152 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint 或 DTO，只修正现有 `editSlice` / `edit_world_slice` 的 A issue 候选精度。
