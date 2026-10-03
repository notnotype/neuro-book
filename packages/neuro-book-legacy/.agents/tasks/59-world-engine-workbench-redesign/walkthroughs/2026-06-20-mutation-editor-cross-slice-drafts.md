# 2026-06-20 Mutation Editor Cross-Slice Drafts

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 目标是修正 Mutation Editor value 草稿在切换 slice 时可能被覆盖的问题，让 `未应用` 状态真正可信。
- 验证过程中发现 slice card 虽然整卡可点击，但缺少明确的原生选择入口；本轮一并补齐，方便键盘 / 辅助技术 / 自动化验证使用。

## Changes

- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增 `resetKey` prop，接收父页面 `resetVersion`。
  - `syncValueDrafts()` 不再覆盖已有 dirty 草稿；同一个 `sliceId:index` 的 value draft 会跨 slice 切换保留。
  - `resetAllValueDrafts()` 会在 `重置 mock` 时清空所有本地 value 草稿和解析错误。
  - 新增 `hasValueDraft()`，显式区分“还没有草稿”和“已有草稿但内容为空”。
  - 增加 `data-testid="world-mutation-editor"`、`mutation-editor-row`、批量 apply/reset 按钮标记，降低后续浏览器验证成本。
- `world-engine.workbench-preview.vue`
  - 将 `resetVersion` 传入 Mutation Editor。
- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 保留整卡鼠标点击选择。
  - 新增原生图标按钮 `world-slice-select-button`，`aria-label/title` 为 `选择切片 <title>`。
  - 避免把包含 subject action buttons 的整张卡片改成原生 button，防止 button 嵌套 button。
- `world-engine-workbench-preview.test.ts`
  - 补充跨 slice draft、reset hook、稳定 test id 和 slice 选择按钮的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `/world-engine.workbench-preview`。
  - `重置 mock` 后展开 Mutation Editor。
  - 将 `slice-world-init` 的第 0 行 value 改为 `跨切片草稿`，Editor 显示 `未应用 1`、`Draft Changes` 和 `dirty`。
  - 通过新增的原生 `选择切片 艾莉娜抵达王都` 按钮切到 `slice-erina-arrives`。
  - 通过 `上一个可见切片` 返回 `slice-world-init` 后，第 0 行 value 仍为 `跨切片草稿`，dirty 状态仍在。
  - 再次 `重置 mock` 后，Editor 回到 `已同步`，第 0 行 value 恢复为 `雨城纪元`。

## Notes

- 浏览器验证过程中，in-app browser 的 Playwright click 对部分非原生 article 点击会超时；这是发现 slice card 选择语义不够明确的直接证据。本轮改为提供原生选择按钮后，验证路径更稳定。
- 本轮仍不接真实 API；dirty draft 只存在于当前浏览器运行态，`应用全部` 后才写入 mock slice 并进入 localStorage 草稿。
