# Round 265: Route Switch Draft Guard

## Context

继续沿真实作者流程检查“有草稿时切换 Project”的保护面。

此前顶部 Project 切换和 Bookshelf 内部切换都已经接入 `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()`，但页面 query 变化触发的 `syncWorkspaceRoute()` 只检查普通 workspace 文件未保存状态。作者如果通过深链、地址栏、或其它 route 入口切换 Project，有机会绕过 World Engine Workbench 草稿确认。

## Changes

- `app/pages/index.vue`
  - 在 `syncWorkspaceRoute()` 发现当前 store 和页面 query 不一致后，先调用 `confirmWorldEngineWorkbenchDraftDiscardForProjectSwitch()`。
  - 用户取消时直接返回，不继续处理普通 workspace 未保存文件，也不切换 Project Workspace。
  - 用户确认放弃后沿用原有流程：再处理普通 workspace 未保存文件，再初始化目标 workspace。

- `app/utils/world-engine-ide-entry.test.ts`
  - 补充静态契约，要求 route sync 切换前也必须走 World Engine Workbench 草稿确认。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：打开 Workbench 留下 metadata/value/Slice Composer 草稿后，通过 URL query 或其它路由入口切换 Project，应该先看到 World Engine 草稿确认，取消后当前 workspace 不被切换。

## Result

实际结果与本轮计划一致：只补 route/query 触发 Project 切换时的草稿保护入口，不改 World Engine 后端、不改草稿存储模型、不新增浏览器自动验收。
