# Round 326 - Inspector Full State Busy Guard

## Context

继续从作者真实推演流程检查主 IDE Workbench。Round 325 已让左侧 Sidebar 的 subject 选择、`整体世界` 和 schema/calendar 路径按钮在 `workbenchActionBusy` 中禁用。

本轮发现右侧 Inspector 的 `展开完整世界状态` 会触发真实 `state` 查询，但此前只检查 `fullSnapshotLoading`，没有检查 Workbench 是否正在同步。作者在 timeline 回流、写入 / 删除 / 同步主体系统请求飞行中仍可能触发完整世界状态读取，导致读请求和当前上下文切换交错。

## Changes

- `WorldEngineWorkbenchPreviewInspector.vue`
  - `toggleFullState()` 在 `props.busy` 或 `props.fullSnapshotLoading` 时直接返回。
  - 抽出 `requestFullSnapshotIfNeeded()`，统一 toggle 与 watcher 的真实读取条件。
  - watcher 增加 `props.busy` 依赖：busy 中不发完整 state 请求；busy 结束后如果作者仍保持展开状态且尚未加载完整 state，会自动补发一次请求。
  - `展开完整世界状态` 按钮在 `props.busy || props.fullSnapshotLoading` 时禁用。
- `world-engine-ide-entry.test.ts`
  - 补充静态契约断言，锁住 full state 请求不会在 busy 中发出。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮只处理会打到真实 API 的完整世界状态读取；Inspector 关闭 / 展开面板这类本地布局动作仍保持可用。
