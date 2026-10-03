# Round 254: Bookshelf Switch Draft Guard

## Context

Round 253 已保护主 IDE 顶部 Project 下拉切换，但继续检查后确认还有一个常用入口：Bookshelf 弹窗内部也能切换 Project，并且它会在组件内部直接调用 `switchNovel()`。

此前情况：

- `WorldEngineWorkbenchDialog` 已向父页面上报会话草稿状态。
- 顶部 Header 切换 Project 会先询问是否放弃 World Engine 草稿。
- Bookshelf 内部的 `handleSwitchNovel()` / `handleCreateNovel()` 仍直接切换 store。
- 如果 Workbench 打开且存在会话草稿，从 Bookshelf 切换或新建后切换 Project 仍会让 `projectPath` 变化并清空 Workbench 草稿。

## Changes

- `NovelBookshelfDialog.vue`
  - 新增可选 prop：`beforeWorkspaceSwitch?: () => boolean | Promise<boolean>`。
  - 新增 `canSwitchWorkspace()` 包装宿主回调。
  - 在以下动作真正切换当前 Project Workspace 前先调用：
    - 创建新 Project 并切换到新 Project。
    - 切换到已有 Project。
    - 删除当前 Project。
  - 宿主返回 `false` 时停止当前动作。

- `app/pages/index.vue`
  - 把 Round 253 的 World Engine 草稿确认抽成 `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()`。
  - Header 切换 Project 和 Bookshelf 的 `beforeWorkspaceSwitch` 共用同一确认函数。
  - Bookshelf 现在通过 `:before-workspace-switch="confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch"` 接入。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，覆盖 Bookshelf before-switch prop、父页面传参和切换前拦截。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 打开主 Workbench 并制造 metadata / value 草稿。
- 打开 Bookshelf。
- 选择另一个 Project，或新建 Project 后切换。
- 应先看到 World Engine 草稿确认；取消后不切换。

## Result

实际结果与计划一致：只补 Bookshelf 内部 Project 切换入口的宿主拦截，不改后端、不引入持久草稿、不扩大测试面。
