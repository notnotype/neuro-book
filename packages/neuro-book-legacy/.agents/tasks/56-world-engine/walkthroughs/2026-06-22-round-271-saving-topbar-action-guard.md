# Round 271: Saving Topbar Action Guard

## Context

Round 269 / 270 已经阻止了 Slice Composer 保存中关闭 Workbench 或切换 Project。继续检查同一保存请求飞行窗口，发现主 Workbench 顶栏和空状态里仍有若干动作只看 `loading || actionBusy`：

- 刷新 timeline
- 新建 / 编辑 / 删除 Slice
- 示例世界
- 主体系统同步
- Drafts 草稿入口
- 空状态里的新建 / 示例 / 清空过滤

这些动作在 Slice Composer 正在保存时仍可能并发触发，造成“正在写入的 slice”和“刷新 / 删除 / 同步 / 载入其它上下文”交叉。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `workbenchActionBusy = loading || actionBusy || sliceComposerSaving`。
  - 顶栏刷新、新建、编辑、删除、示例世界改用 `workbenchActionBusy` 禁用。
  - 主体系统同步输入和按钮改用 `workbenchActionBusy` 禁用。
  - 空状态里的示例世界、新建 Slice、清空 subject 过滤改用 `workbenchActionBusy` 禁用。
  - Drafts 草稿入口在 `sliceComposerSaving` 时禁用。
  - Slice Composer、Subject Creator、底部 Mutation Editor、Inspector 的 `busy` prop 改传 `workbenchActionBusy`。
  - `openSliceComposer()`、`openSelectedSliceComposer()`、`showAllDraftSlices()` 在保存中给出提示并返回，补函数层 guard。

- `world-engine-ide-entry.test.ts`
  - 补充静态契约，要求主 Workbench 动作使用 `workbenchActionBusy`，Drafts 入口在保存中禁用。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续实跑可覆盖：Slice Composer 保存请求未完成时，顶栏刷新 / 新建 / 编辑 / 删除 / 示例世界 / Drafts 和主体同步入口应不可触发；保存完成后恢复。

## Result

实际结果与本轮计划一致：只收紧保存请求飞行中的并发 UI 入口，不改变后端 API、不改变普通查看入口。
