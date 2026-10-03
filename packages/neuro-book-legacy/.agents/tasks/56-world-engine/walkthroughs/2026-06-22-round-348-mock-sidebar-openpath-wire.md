# Round 348 - Mock Sidebar OpenPath Wire

## User Request / Topic

- 继续推进 World Engine 作者真实使用流。
- Round 347 为左栏 subject 卡片增加了主体系统文件打开按钮。

## Finding

- 真实 Workbench 的 Sidebar 已接入 `@open-workspace-path="openWorkspacePathFromWorkbench"`。
- mock `/world-engine.workbench-preview` 只有 Inspector 接了 `openMockWorkspacePath()`；Sidebar 的新文件按钮会 emit，但页面没有监听。

## Implementation Walkthrough

- `world-engine.workbench-preview.vue`
  - 为 `WorldEngineWorkbenchPreviewSidebar` 增加 `@open-workspace-path="openMockWorkspacePath"`。
- `world-engine-workbench-preview.test.ts`
  - 收紧断言，要求页面里至少两处 `@open-workspace-path="openMockWorkspacePath"`，覆盖 Sidebar 与 Inspector。

## Verification / Test

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 结果：通过，1 个测试文件、6 个用例。

## Result

- mock 沙盘左栏 subject 文件按钮现在和 Inspector 文件按钮一样，会显示 mock path notice，不再静默无效。
