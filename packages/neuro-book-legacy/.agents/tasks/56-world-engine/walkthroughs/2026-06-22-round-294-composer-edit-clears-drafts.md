# Round 294 - Composer Edit Clears Drafts

## 背景

继续检查主 IDE Workbench 里多个编辑入口同时作用于同一个 slice 的路径时，发现一个会话草稿残留风险：

作者可能先在 Inspector 留下 metadata 草稿，或在底部 Mutation Editor 留下 value 草稿；随后又通过 Slice Composer 载入同一个 slice，整块编辑并保存。Composer 保存成功后，真实 slice 已经被刷新，但旧的 metadata / value 会话草稿仍可能留在 Drafts 队列里。

这会让作者误以为同一个 slice 还有未应用草稿，甚至可能再次应用旧草稿覆盖刚刚的整块保存结果。

## 实际变更

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `discardSessionDraftsForSlice(sliceId)`，专门清理某个 slice 的 metadata/value 会话草稿。
  - 删除 slice 的清理逻辑复用该函数，仍继续额外清理 transient issues、review focus 和 snapshots。
  - Slice Composer 保存成功且 `payload.editing === true` 时，调用该函数清理被整块保存 slice 的会话草稿。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Composer 编辑保存后会清理同 slice 的 metadata/value 草稿。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有改变 Inspector / Mutation Editor 自身的草稿保存模型。
- 本轮只处理 Composer 作为“整块保存入口”成功编辑已有 slice 后的会话草稿一致性。
