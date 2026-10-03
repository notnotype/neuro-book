# 2026-06-20 Inspector Metadata Dirty State

## Context

Inspector 的 `Metadata` 表单已经支持本地修改并应用到 mock 预览，但 `应用到预览` 始终可点击。用户无法判断当前表单是否已经和选中 slice 同步，也没有一键放弃本地草稿的入口。

本轮把 metadata 编辑改成更明确的工作台表单流程：未修改时显示同步态并禁用应用，修改后显示未应用状态，并提供还原。

## Changes

- `WorldEngineWorkbenchPreviewInspector` 新增：
  - `metadataDraftDirty`
  - `metadataDraftStatusLabel`
  - `resetDraft`
- `applyPatch()` 在无 dirty 时直接返回，避免重复提交无变化 patch。
- Metadata 底部状态从固定 `mock 阶段只更新本地预览状态` 改为：
  - `已同步 · mock 本地预览`
  - `未应用修改 · mock 本地预览`
- `应用到预览` 仅在 dirty 时可用。
- `还原` 按钮只在 dirty 时出现，点击后恢复当前 slice 元信息。
- 目标契约测试补充 dirty 状态与还原入口关键字符串。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - `GET http://localhost:3000/world-engine.workbench-preview` 返回 200。
  - Chrome DevTools Protocol 1366x900 交互验证通过：
    - 初始状态显示 `已同步 · mock 本地预览`，`应用到预览` disabled，`还原` 不显示。
    - 修改 title 后显示 `未应用修改 · mock 本地预览`，`应用到预览` enabled，`还原` 显示。
    - 点击 `还原` 后恢复原 title，回到同步态。

## Notes

- 浏览器验证第一次尝试用 label 反查输入框时没有命中 title input，dirty 状态未触发；随后通过 `input.value.includes("世界初始化")` 精确定位 title 输入框，并使用原生 `HTMLInputElement.value` setter + `input` event 完成验证。这是验证脚本绕道，不涉及产品代码绕道。
- 本轮仍保持 mock-only，不接真实 API，不改 DTO。
