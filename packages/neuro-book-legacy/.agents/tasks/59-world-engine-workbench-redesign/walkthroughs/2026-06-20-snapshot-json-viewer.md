# 2026-06-20 Snapshot Json Viewer

## Context

上一轮为了让 Inspector 的 State Snapshot 支持多层 object / array 展示，在 `WorldEngineWorkbenchPreviewInspector.vue` 内部临时放了 `SnapshotTreeView`、`SnapshotTreeNode` 和递归构造 helper。用户指出这个 snapshot 显示组件应该抽成通用组件。

进一步检查后确认项目已经有公共 `app/components/common/JsonViewer.vue`，并且 `/world-engine.workbench-preview` 已在 route 根节点把 `--bg-main`、`--border-color`、`--text-main`、`--accent-main` 等变量映射到 World Engine 局部视觉变量。因此本轮按用户选择复用现有 `JsonViewer`，不再新增另一个通用 tree 组件。

## Changes

- Inspector 引入 `JsonViewer`：
  - 每个 subject 的 State Snapshot 内容改为 `<JsonViewer :value="state.attrs" :main-menu-bar="false" :max-height="0" />`。
  - 保留 subject 外层 `<details>`，focused subject 仍默认展开。
  - 保留下方 raw JSON 折叠区作为完整兜底。
- 删除 Inspector 内部 snapshot tree 临时代码：
  - 移除 `SnapshotTreeKind`、`SnapshotTreeNode`、`SnapshotTreeView`。
  - 移除 `snapshotTreeNodes()`、`buildSnapshotTreeNode()`。
  - 清理不再需要的 `defineComponent`、`h`、`PropType`、`VNode`、`WorkbenchJsonValue` import。
- 更新静态契约测试：
  - 不再断言 `SnapshotTree*` 和 `snapshot-tree-node`。
  - 改为断言 Inspector import 并使用公共 `JsonViewer`。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。

## Browser Verification

- 本轮未自动做浏览器视觉验收，遵守项目约束。
- 后续如需浏览器确认，重点检查：
  - State Snapshot 每个 subject 的 object / array / primitive / null 是否能在 JsonViewer 中展开。
  - focused subject 外层仍默认展开。
  - Inspector 内部滚动高度是否自然，不出现过重双层滚动。
  - raw JSON 折叠区仍可查看完整兜底状态。

## Notes

- 本轮保持 mock-only UI / UX 范围，不接真实 API，不改后端 DTO。
- 这次结果与计划一致：没有新增公共组件，而是复用既有 `JsonViewer`，减少 Workbench preview 内部自定义展示逻辑。
