# 2026-06-20 Json Viewer Raw And Editor State

## Context

上一轮 Inspector State Snapshot 的 subject attrs 已改为复用公共 `JsonViewer`。继续检查时用户指出两处仍然停留在旧展示方式：

- Inspector 底部 `原始状态 JSON` 仍是 `<pre>` 文本。
- Mutation Editor 的 subject 视图 `此时状态` 仍是单层 attr/value 表格。

本轮继续保持 `/world-engine.workbench-preview` mock-only，不接真实 API，不改后端 DTO。

## Changes

- Inspector `原始状态 JSON` 改为 `JsonViewer`：
  - `rawSnapshotJson` 字符串改为 `rawSnapshotValue` 对象。
  - raw 区块使用 `<JsonViewer :value="rawSnapshotValue" :max-height="288" />`，保留 JsonViewer 工具栏，方便切换 tree / text / table、复制、展开和折叠。
- Mutation Editor subject 视图 `此时状态` 改为 `JsonViewer`：
  - 使用 `<JsonViewer v-if="activeSubjectState" :value="activeSubjectState.attrs" :main-menu-bar="false" :max-height="220" />`。
  - 保留无状态时的空提示。
  - 删除旧的 `stateRows()` 单层摘要 helper。
- 清理过期类型：
  - 删除仅供旧表格使用的 `WorldWorkbenchPreviewAttrRow`。
- 更新静态契约测试：
  - 断言 Inspector raw state 使用 `JsonViewer`。
  - 断言 Mutation Editor 引入并使用 `JsonViewer`。
  - 断言旧 `rawSnapshotJson`、`stateRows` 和 `WorldWorkbenchPreviewAttrRow` 不再存在。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。

## Browser Verification

- 本轮未自动做浏览器视觉验收。
- 后续如需浏览器确认，重点检查：
  - Inspector raw state 能用 JsonViewer 展开完整 `{ at, scope, subjects }`。
  - Mutation Editor subject 视图的 `此时状态` 能展开 object / array。
  - 底部 editor 面板高度内没有明显双层滚动压迫。

## Notes

- 本轮实际结果与用户反馈一致：状态相关 JSON 展示已统一到公共 `JsonViewer`。
- Mutation row 的 `切片前 / 切片后` 仍保留单行摘要，因为它服务于行内 diff 扫描，不是完整 JSON 检查区。
