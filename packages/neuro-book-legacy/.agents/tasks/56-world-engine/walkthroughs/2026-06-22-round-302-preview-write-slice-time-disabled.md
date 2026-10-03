# Round 302 - Preview Write Slice Time Disabled

## 背景

主 Workbench 的 Slice Composer 已经把 `time` 必填前移到按钮禁用和函数入口校验。但独立 `/world-engine.preview` 的写入 / 编辑 slice 按钮仍然只看 Project 是否已选和是否 busy。

作者清空 `time` 后，按钮仍可点击，点完才看到 `time 不能为空`。这不影响后端安全，但在 Preview 连续推演时是一处小摩擦。

## 实际变更

- `WorldEnginePreviewActions.vue`
  - 新增 `canWriteSlice`。
  - 写入 / 编辑 slice 按钮现在要求 Project ready、非 busy、`sliceForm.time` 非空才可点击。

- `world-engine.preview.vue`
  - 保留 `writeSlice()` 入口的 `time 不能为空` 校验，避免事件绕过按钮后直接请求后端。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 写 slice 按钮绑定 `canWriteSlice`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改变写入 API 或 mutation JSON 校验。
- 本轮没有自动浏览器验证，符合当前约定。
