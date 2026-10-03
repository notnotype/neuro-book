# Round 311 - Preview Write Busy Guard

## 背景

独立 `/world-engine.preview` 的写入 / 编辑请求飞行中，提交按钮会因为 `actionBusy` 禁用，但 Write Slice 区域里的 metadata 输入、Mutation Builder 和 mutations textarea 仍然可编辑。

请求完成后页面会刷新 timeline、推进时间或重置草稿。作者如果在请求飞行中继续修改 Builder / textarea，这些修改可能被请求完成后的刷新覆盖。

## 实际变更

- `app/components/novel-ide/world-engine/WorldEnginePreviewActions.vue`
  - 给 Write Slice 区域增加 `fieldset :disabled="actionBusy"`。
  - 禁用范围覆盖：
    - time / title / kind / summary；
    - Mutation Builder 内的 subject / attr / op / value 和动作按钮；
    - mutations textarea；
    - 取消编辑与写入按钮。
  - Query 和 Create Subject 入口保持原有禁用逻辑。

- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Write Slice 区域存在 `actionBusy` fieldset guard。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

通过。

## 与计划出入

- 本轮没有修改后端、API 或主 Workbench。
- 本轮没有自动浏览器验证，符合当前约定。
