# Round 310 - Preview Edit Save Resets Draft

## 背景

独立 `/world-engine.preview` 保存已有 slice 编辑成功后，会清空 `editingSliceId`，按钮从“保存 Slice 编辑”变回“写入 Slice”。但旧逻辑只推进了 `time`，`title / summary / kind / mutations` 仍保留刚编辑的旧 slice 内容。

作者下一次点击“写入 Slice”时，可能把刚编辑的旧 slice 内容复制到新的时间点。

## 实际变更

- `app/pages/world-engine.preview.vue`
  - `writeSlice()` 保存编辑成功后，刷新 timeline，然后调用 `clearSliceEditMode()` 回到新的默认 slice 草稿。
  - 普通新写入仍保持原来的连续推演行为：只推进下一条时间。
  - `clearSliceEditMode()` 生成默认 mutation 时，优先使用当前 Builder subject，其次才回退到 subject form / `world`。

- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 编辑保存后走 `clearSliceEditMode()`，普通写入仍走 `advanceSliceFormTime()`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

通过。

## 与计划出入

- 本轮没有修改后端、API 或主 Workbench。
- 本轮没有自动浏览器验证，符合当前约定。
