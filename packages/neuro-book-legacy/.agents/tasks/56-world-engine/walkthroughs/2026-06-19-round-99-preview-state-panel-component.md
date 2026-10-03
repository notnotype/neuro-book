# Round 99: Preview State Panel 组件拆分

## 背景

独立 Preview 页面 `world-engine.preview.vue` 长期卡在 799 行。第九十八轮已经给主 IDE Mutation Editor 拆出表单组件，本轮继续处理 Preview 页面，避免后续真实验收或小优化时再次触碰 800 行限制。

## 变更

- 新增 `WorldEnginePreviewStatePanel.vue`：
  - 承载 World State 标题、错误/通知/re-settle 提示。
  - 承载 subject 列表、刷新按钮、timeline 列表和 State Query JSON 展示。
  - 通过 `refresh`、`load-subject`、`load-slice` 事件回传操作。
  - 内部保留 `formatSliceMutations()`，页面不再负责 timeline mutation JSON 展示。
- 更新 `world-engine.preview.vue`：
  - 引入 `WorldEnginePreviewStatePanel`。
  - 页面继续负责 Project / API / 表单状态。
  - 文件体量从 799 行降到 746 行。
- 更新 `world-engine-ide-entry.test.ts`：
  - 纳入 `WorldEnginePreviewStatePanel.vue` 读取。
  - 断言 Preview 页面接入新组件。
  - 断言新组件保留 World State、State Query、timeline mutation 格式化和事件名。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮是 Preview 页面组件边界拆分，不改变 World Engine API、Project SQLite schema、Agent 工具或 Preview 行为。
- `world-engine.preview.vue` 获得明显行数余量，后续可以更安全地做真实验收后的修复。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 主 IDE Workbench 与独立 Preview 都已腾出一些维护空间。
- 下一步更适合进入真实浏览器验收，跑完整用户流并记录体验问题。
