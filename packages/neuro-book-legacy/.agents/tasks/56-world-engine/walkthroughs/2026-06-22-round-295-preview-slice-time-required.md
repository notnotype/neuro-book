# Round 295 - Preview Slice Time Required

## 背景

主 IDE Workbench 的 Slice Composer 已经在前端校验 `time` 必填，但独立 `/world-engine.preview` 的 `writeSlice()` 仍只校验 `mutations` JSON。

作者在 Preview 调试台清空 time 后点击写入 / 编辑，会直接把空 time 请求发到后端，再看到较底层的 API 错误。这个入口和主 Workbench 的交互不一致。

## 实际变更

- `world-engine.preview.vue`
  - `writeSlice()` 在解析 mutations 前先校验 `sliceForm.time.trim()`。
  - time 为空时直接显示 `time 不能为空`，并清掉旧成功 notice，不再发起写入 / 编辑请求。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认独立 Preview 写入入口也有 time 必填前置校验。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有改后端/API。
- 本轮只对齐独立 Preview 与主 Workbench 的 slice time 必填体验。
