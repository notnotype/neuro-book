# Round 153: editSlice 混合编辑中保留 mutation 重排的 A issue

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 152 修复了同 instant 纯重排相关 mutation 时下游 A issue 漏报，但实现仍有一个边界：`reorderedOverlapCandidates()` 只在新旧 mutations 长度相同时运行。也就是说，如果同一次编辑既新增 / 删除了一个无关 mutation，又把共同保留的相关 mutation 调换顺序，重排检测会被跳过。

典型场景：

- 10s slice 原本是 `hp set 80` -> `hp set 90`。
- 20s slice 是 `hp add -10`。
- 编辑 10s slice 为 `hp set 90` -> `events listAppend` -> `hp set 80`。
- 新增的 `events` 是无关 mutation，但保留的两个 `hp set` 发生了顺序反转，下游 `hp add` 的累加基从 90 变成 80。

此前这种情况会被 `diffMutations()` 识别为“只新增了 events”，从而漏掉 hp 重排导致的 `base-shifted`。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `reorderedOverlapCandidates()` 不再要求新旧 mutations 长度相同。
  - 只要共同保留的 mutation 中存在同 subject 且 attr 同一路径或父子路径相关的相对顺序反转，就把这些 mutation 纳入 A issue 候选。
  - 完全相同序列仍会快速返回空候选，避免原样保存重复提醒。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：新增无关 `mind set` 的同时重排保留的 `hp set 80` / `hp set 90`，仍返回下游 `base-shifted`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 HTTP 日历字符串边界测试：新增 `events listAppend` 同时重排保留 `hp set`，`POST /slices/:id/edit` 返回 `{sliceId, issues}`。

- `server/agent/tools/world-engine-tools.test.ts`
  - 新增 `edit_world_slice` 契约测试，确认 Agent 工具层也暴露该混合编辑提醒。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 53 tests passed
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 77 tests passed
- 已通过：`bun run typecheck`

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百五十三轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 把顺序语义说明从“纯重排”扩展为“共同保留的相关 mutation 相对顺序反转”。
- `docs/tasks/56-world-engine/agent-tools.md`
  - 说明 `edit_world_slice` 即使同次新增 / 删除无关 mutation，也可能因保留相关 mutation 顺序反转返回 A issue。
- `PROJECT-STATUS.md`
  - 增加 round-153 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- 这轮没有新增 endpoint 或 DTO，只修正现有 `editSlice` / `edit_world_slice` 的 A issue 候选覆盖范围。
