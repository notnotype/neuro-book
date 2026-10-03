# 2026-06-20 Inspector Cross-slice Metadata Drafts

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 右侧 Inspector 的 metadata 草稿现在按 slice id 暂存；用户修改当前 slice 元信息后切到其他 slice，再切回来时不会丢失未应用输入。
- `重置 mock` 会同步清空 Inspector 内部 metadata 草稿缓存，避免旧草稿污染新的 mock 世界。

## Changes

- `WorldEngineWorkbenchPreviewInspector`
  - 新增 `metadataDrafts` 本地缓存，按 `slice.id` 保存 `time / title / summary / kind` 草稿。
  - 切换 slice 前通过 `persistMetadataDraft(previousSliceId)` 保存旧 slice 的未应用 metadata。
  - `syncDraft()` 优先恢复当前 slice 的缓存草稿，否则使用外部 slice 元信息。
  - `applyPatch()` 和 `resetDraft()` 会清理当前 slice 的 metadata 草稿。
  - 新增 `resetKey` prop；mock reset 时调用 `resetMetadataDrafts()` 清空所有 metadata 草稿。
- `world-engine.workbench-preview.vue`
  - 向 Inspector 传入 `:reset-key="resetVersion"`。
  - Inspector 保持 `v-if="selectedSlice"` + `v-show="inspectorVisible"`，隐藏右栏不卸载组件。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - `GET http://localhost:3000/world-engine.workbench-preview` 返回 200。
  - `重置 mock` 后修改首个 slice title 为 `跨切片 metadata 草稿`，Inspector 显示 `未应用修改 · mock 本地预览`。
  - 切到 `艾莉娜抵达王都` 后，Inspector title 同步为该 slice 的原始标题。
  - 通过可见 slice stepper 回到首个 slice 后，title input 仍为 `跨切片 metadata 草稿`，并继续显示 `未应用修改`。
  - 点击 `还原` 后，title 恢复为 `世界初始化：雨城进入持续暴雨`，`还原` 消失，状态回到 `已同步`。
  - 再次制造 metadata 草稿后点击 `重置 mock`，title 回到 mock 原值，metadata 状态为 `已同步`，草稿缓存清空。

## Notes

- 浏览器验证中，部分 Playwright role / button locator 点击在当前页面偶发超时；验证改用 DOM CUA 的可见节点点击，状态读取仍使用只读 DOM 查询。这是验证层绕道，不影响产品实现。
- 浏览器日志中读到的 warning/error 均为 2026-06-19 的历史 dev 日志；本轮验收没有发现新的 metadata 草稿相关运行时错误。
- 本轮不接真实 API，不改后端 DTO；metadata 草稿仍只存在于 preview 组件运行态。
