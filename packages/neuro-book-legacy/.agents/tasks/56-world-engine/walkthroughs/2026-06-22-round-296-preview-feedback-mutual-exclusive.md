# Round 296 - Preview Feedback Mutual Exclusive

## 背景

继续检查独立 `/world-engine.preview` 的常用操作时，发现多个本地校验错误直接写 `error.value`，但不会清理旧的成功 `notice`。

例如作者刚写入成功后，再清空 time、写入非法 mutations、空查询或在 Mutation Builder 里漏填 subject/attr，页面可能同时显示旧成功提示和当前错误。主 Workbench 已经有互斥反馈，这里需要跟上。

## 实际变更

- `world-engine.preview.vue`
  - 新增 `setPreviewError(message)`：设置错误并清理旧成功提示。
  - 新增 `setPreviewNotice(message)`：设置成功 / 状态提示并清理旧错误。
  - 替换常用入口的直接赋值：
    - Project 创建标题校验与创建结果。
    - 示例世界 schema / calendar 校验与结果。
    - subject 创建结果 / 错误。
    - slice 写入 / 编辑的 time、mutations 校验与结果。
    - delete、query、load slice for edit。
    - Mutation Builder 的 subjectId / attr / value / JSON object / append 校验。
    - Project list / world load 的错误反馈。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 使用互斥反馈 helper，并确认写入 / 查询本地校验走 `setPreviewError`。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有自动浏览器验证，符合当前约定。
- 本轮没有引入全局通知系统，也没有改主 Workbench。
- 本轮只让独立 Preview 的错误 / 成功提示不再互相残留。
