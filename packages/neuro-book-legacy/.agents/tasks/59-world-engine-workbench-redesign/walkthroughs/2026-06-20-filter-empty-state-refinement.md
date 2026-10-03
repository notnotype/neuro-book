# 2026-06-20 Filter Empty State Refinement

## Scope

本轮继续优化 `/world-engine.workbench-preview` mock 页面，不接真实 API，不改后端 DTO。重点处理上一轮浏览器评估后留下的可恢复性和空间管理问题。

## Changes

- `WorldEngineWorkbenchPreviewSliceList` 增加空状态恢复入口：
  - 搜索无结果时可清空搜索。
  - subject 过滤无结果时可取消 subject 过滤。
  - 可一键恢复完整时间线。
- `WorldEngineWorkbenchPreviewSidebar` 增加 subject 空状态恢复入口，可清空搜索和 type 过滤。
- `WorldEngineWorkbenchPreviewInspector` 补齐 `correction` kind 选项，并限制 State Snapshot 列表和 raw JSON 展开高度，避免完整世界视图挤压右侧上下文。
- `WorldEngineWorkbenchPreviewMutationEditor` 在折叠标题行展示当前 slice 的 mutation / subject 摘要，并在折叠时隐藏视图切换，减少无效控件噪音。
- mock 时间线新增 `slice-durability-correction`，用于覆盖真实工作流里常见的校正切片。
- preview 结构测试更新，固定 `correction`、空状态恢复入口和折叠态摘要的存在。

## Verification

- `bun run typecheck`
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`

两条验证均通过。

## Notes

- 浏览器视觉验收本轮未自动执行，保持当前任务计划里的“用户确认后再看”约束。
- 本轮没有改变真实 World Engine API、DTO 或主 IDE Workbench。
