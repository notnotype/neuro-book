# Round 386 - Mutation Editor New Mode Dialog

## Context

Round 385 已把主 Workbench 顶层高风险确认迁到应用内 `useDialog()`，但继续审查 World Engine 范围后，发现主 Workbench 内部的 `WorldEngineMutationEditor.vue` 仍在“切换到新建模式”时使用原生 `window.confirm`。这条路径发生在作者载入已有 slice 编辑后，点击 `新建模式` 或父层触发新建 slice 请求时；如果当前编辑器有未保存草稿，仍会遇到 Round 384 里已经证明不稳定的原生确认。

## Changes

- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - 引入 `useDialog()`。
  - 将 `clearEditMode()` 改为 async。
  - dirty 草稿存在时，使用应用内 `confirmDialog("当前编辑器有未保存草稿，确定切换到新建模式吗？", "Slice Composer 草稿未保存")`。
  - `newSliceKey` watcher 和 Header 事件改为 `void clearEditMode()`，避免异步事件处理器被误用。

- `app/utils/world-engine-ide-entry.test.ts`
  - 更新静态契约断言：Mutation Editor 必须使用 `useDialog()` / `confirmDialog`，`clearEditMode()` 必须是 async，并且不再包含这条原生 `window.confirm`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 1 file / 3 tests passed。

- `rg -n "window\\.confirm|confirmDialog|async function clearEditMode|void clearEditMode" app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue app/pages/world-engine.preview.vue app/utils/world-engine-ide-entry.test.ts`
  - 主 Workbench 子编辑器只剩应用内 `confirmDialog`。
  - World Engine 范围内剩余原生确认只在独立 `/world-engine.preview` 删除 slice 入口；本轮没有扩大处理调试页。

## Actual vs Plan

- 原计划优先完成 Round 385 文档与 dev server 收尾；实际完成后继续处理了同一作者流里的残留原生确认。
- 没有启动新一轮浏览器验收；这轮只用既有静态契约测试覆盖，避免扩大测试面。
- 没有改后端、API、Agent 工具或真实 Project SQLite 数据。

## Follow-up

- 如需继续统一确认体验，再单独决定是否迁移独立 `/world-engine.preview` 删除 slice 的原生确认。
- 若继续真实浏览器验收，优先补验：编辑已有 slice 后点击 `新建模式` 的应用内确认取消分支，确认草稿保留。
