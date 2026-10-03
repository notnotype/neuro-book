# Round 199：Preview 下一写入时间与查询刷新

## 背景

Round 198 的 P0 真实驾驶测试暴露了两个会打断作者首轮写作的 P1 问题：

- 一键示例世界之后，写入表单仍停在示例事件的同一 instant，作者自然写下一条事件会直接撞 `same instant` 错误。
- 写入 / 编辑成功后，timeline 已刷新，但 State Query 结果仍显示旧状态，作者需要手动再点一次“查询状态”才知道 reduce 结果是否符合预期。

本轮只修这两个从真实使用暴露出来的问题，不继续补输入 guard，不改后端契约，不启动 P2 分叉迁移。

## 变更

- `app/pages/world-engine.preview.vue`
  - 新增 `advanceSliceFormTime()`，复用已有 `suggestNextPreviewTime()`，根据当前 schema calendar examples 与已存在 slices 推导下一条未占用的 slice time。
  - 一键示例世界成功后，自动把写入表单 time 推进到下一个未占用 instant，避免作者下一次自然写入撞到示例事件。
  - 写入 / 编辑 slice 成功、`loadWorld()` 刷新 timeline 后，也自动推进写入表单 time，避免连续写下一条时重复使用刚保存的 instant。
  - 写入 / 编辑成功后，如果 State Query 已经有 `subjectIds` 或 `type` scope，则自动调用 `queryState({clearActionIssues: false})`，让页面状态跟随刚写入的世界更新。
  - `clearSliceEditMode()` 也改用 `advanceSliceFormTime()`，退出编辑回到新建 slice 时不再回到固定 `examples[0]+1s`。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补静态契约断言，确保 Preview 页面保留 `advanceSliceFormTime()`、使用 `suggestNextPreviewTime()`，并在写入 / 编辑后刷新 query。

## 验证

已通过：

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件通过，19 条测试通过。

未通过：

```powershell
bun run typecheck
```

失败位置不在本轮修改文件：

```text
app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue(449,213):
Property 'filteredMutationCount' does not exist

app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue(496,100):
Property 'filteredResultStats' does not exist
```

本轮没有顺手修该 mock workbench preview 类型错误，因为它不是 round-198 P0 清单中阻塞 Preview 作者首轮写作的问题，也不在本轮改动面内。

## 与计划出入

- 原计划只需要修“示例世界后下一条默认撞同 instant”。实现时顺带修了同一 P0 清单里的“写入 / 编辑后 State Query 不自动刷新”，因为两者都在 `writeSlice()` 成功后的同一段 Preview 状态生命周期里，改动范围很小。
- 没有做浏览器自动验收。按项目约束，浏览器验证需要用户明确允许；本轮只跑目标 vitest 和 typecheck。

## 后续

- 若用户允许浏览器验收，建议复跑 round-198 的首轮链路，重点看：
  - 创建示例世界后，写入表单 time 是否自动变为 `00:00:02` 或下一个未占用时间。
  - 写入 `erina.hp add -10` 后，State Query 是否自动从 `hp=100` 更新到 `hp=90`。
  - 编辑旧 slice 追加事件后，State Query 是否自动包含新事件。
- P1 剩余问题仍包括 Project 列表污染 / 加载慢、同 instant 错误文案暴露 `edit_world_slice` 工具名、Timeline 编辑/删除图标发现性不足。
