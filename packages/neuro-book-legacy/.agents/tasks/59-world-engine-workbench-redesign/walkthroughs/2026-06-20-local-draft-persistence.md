# 2026-06-20 Local Draft Persistence

## Scope

本轮继续推进 `/world-engine.workbench-preview` 的 mock UI/UX，不接真实 API，不改后端 DTO。重点让 preview 的本地 mock 编辑更接近真实工作台体验：用户修改 slice metadata 或 mutation value 后，刷新页面不应立刻丢失草稿；`重置 mock` 则应该明确清除草稿并回到默认数据。

## Finding

当前页面已经支持：

- Inspector 修改 slice metadata。
- Mutation Editor 修改 mutation value。
- reset 回到 mock 世界。

但这些编辑只存在于 Vue 内存里。用户刷新页面、浏览器热更新或想临时离开页面时，刚做的 UI/UX 评估数据会丢失。对于一个“浏览器临时本地 mock”预览页，更合理的行为是：

- 编辑后自动保存到浏览器本地草稿。
- 刷新后自动恢复。
- 顶栏明确提示当前是临时 mock 还是已恢复草稿。
- reset 同时清掉本地草稿。

浏览器复测时还发现一个真实 UI bug：Inspector 的本地表单草稿只监听 `slice.id`，如果 reset 后仍选中同一个 slice，Inspector 的 `time/title/summary/kind` 输入框会保留旧草稿，导致“卡片已重置、表单没重置”的分叉。

## Changes

- route 页面新增 `WorldWorkbenchPreviewLocalDraft`，保存 preview mock 的最小可恢复状态：
  - `slices`
  - `selectedSliceId`
  - `selectedSubjectIds`
  - `focusedSubjectId`
  - `sidebarCollapsed`
  - `inspectorVisible`
  - `mutationEditorCollapsed`
  - `updatedAt`
- 新增 `localDraftStorageKey`，使用浏览器 `localStorage` 保存草稿。
- 新增 `restoreLocalDraft()`：
  - 页面 mounted 后读取浏览器草稿。
  - 校验草稿 version 和最小结构。
  - 恢复 slices / selection / panel 状态。
  - 使用 `reduceWorkbenchPreviewSnapshots()` 从恢复的 slices 重算 snapshots。
- 新增 `persistLocalDraft()`：
  - slice metadata 应用时立即保存。
  - mutation value 应用时立即保存。
  - 关键面板状态变化也会保存。
- `resetMockData()` 现在会清除 localStorage 草稿，并使用 `localDraftSuppressed` 防止 reset 过程被 watcher 立刻重新保存。
- 顶栏新增本地草稿状态 badge：
  - 默认显示 `浏览器临时 mock`。
  - 恢复或保存后显示 `浏览器草稿 HH:mm:ss`。
- 修复 `WorldEngineWorkbenchPreviewInspector` 草稿同步：
  - watch 范围从仅 `props.slice.id` 扩展为 `id/time/title/summary/kind`。
  - reset 或恢复同 id slice 时，Inspector 表单也会同步更新。
- 目标测试补充静态契约，覆盖 `localDraftStorageKey`、`restoreLocalDraft`、`persistLocalDraft`、`isLocalDraft`、`localDraftSuppressed`、`浏览器临时 mock`、`已恢复浏览器草稿`、`localStorage.removeItem(localDraftStorageKey)`，以及 Inspector watch 对 slice 字段的同步依赖。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 4 tests passed

## Browser Check

- 浏览器 smoke 使用当前 `/world-engine.workbench-preview` 标签完成：
  - 刷新加载最新代码。
  - 点击 `重置 mock`。
  - 确认顶部显示 `浏览器临时 mock`。
  - 确认 Inspector 表单恢复默认：
    - `time = C01:00:00`
    - `title = 世界初始化：雨城进入持续暴雨`
  - 修改 title 为 `世界初始化：本地草稿标题测试`，点击 `应用到预览`。
  - 确认页面显示 `浏览器草稿`，并显示应用成功提示。
  - 刷新页面。
  - 确认页面显示 `已恢复浏览器草稿`，title 仍为 `世界初始化：本地草稿标题测试`。
  - 再次点击 `重置 mock`。
  - 确认旧标题消失，默认 title 和默认 time 恢复。
  - 再次刷新。
  - 确认没有 `浏览器草稿`，仍显示 `浏览器临时 mock`，旧标题不再恢复。
  - 全程无横向溢出。
- dev logs 仍只有 2026-06-19 的旧 HMR / Vue error 残留；本轮 smoke 没发现阻断当前页面挂载、草稿保存/恢复或 reset 的新错误。

## UX Review

- 这轮让 preview 更适合真实 UI/UX 评估：用户可以连续调试 metadata / mutation value，不怕刷新丢掉现场。
- reset 语义更可信：它现在不仅重置内存状态，也清理浏览器草稿；Inspector 表单也会同步回默认值。
- 顶栏 badge 把“这是默认 mock”还是“正在看浏览器草稿”说清楚，避免用户误以为刷新后恢复的是后端数据。

## Plan Deviation

- 原计划只做本地持久化；浏览器验证过程中发现 Inspector 表单 reset 不同步的问题，本轮顺手修复并记录。
- 本轮没有把草稿持久化抽到 composable，因为它只服务 preview route，真实 API 接入时大概率会替换为真实 draft / save source。

## Next Notes

- 后续可以增加“导出 mock 草稿 JSON / 导入 mock 草稿 JSON”，方便把一次 UI/UX 评估现场交给真实 API 接入阶段复现。
- 如果继续扩展 review workflow，可以让本地草稿也保存当前 Review Focus，但目前 reset / slice 切换会清除 issue target，符合当前检查心智。
