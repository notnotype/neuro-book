# Round 270: Saving Project Switch Guard

## Context

Round 269 让 Slice Composer 保存请求飞行中不能关闭 Composer 或 Workbench。继续检查外层 Project 切换入口时发现还有一条链路：

- 主页面只通过 `hasUnsavedDraftsChange` 知道 Workbench 是否有会话草稿。
- 如果作者提交的是一个默认 clean 草稿，保存中不一定表现为 dirty。
- 这时顶部 Project 切换、Bookshelf 切换或 route/query 切换可能不知道 Slice Composer 正在保存。

正在保存时不应该给“放弃草稿并切换”的选择，因为请求已经发出，切走会让写入结果和反馈上下文分离。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 对外新增 `savingChange` 事件。
  - 监听 `sliceComposerSaving` 并向主页面同步。

- `app/pages/index.vue`
  - 新增 `worldEngineWorkbenchSaving`。
  - `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()` 先检查 Workbench 是否打开，再检查是否正在保存。
  - 保存中时显示“World Engine 正在保存 Slice，请等待保存完成后再切换 Project。”并返回 `false`，不继续进入草稿放弃确认。
  - `WorldEngineWorkbenchDialog` 绑定 `@saving-change`。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约，确保主页面保存中状态、保存中切换阻止、Workbench savingChange 外发都在。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：Slice Composer 点击写入 / 编辑后，在请求未完成前尝试顶部 Project 切换、Bookshelf 切换或修改 `?project=`，都应提示正在保存并留在当前 Project。

## Result

实际结果与本轮计划一致：只补 Project 切换保护对保存中状态的感知，不改变保存 API 和草稿确认语义。
