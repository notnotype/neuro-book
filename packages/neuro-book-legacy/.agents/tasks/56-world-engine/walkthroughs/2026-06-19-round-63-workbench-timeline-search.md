# Round 63 - Workbench Timeline 搜索过滤

## 目标

继续推进主 IDE World Engine Workbench 的可用性。当前 Timeline 已能按当前 subject 过滤，但 slice 多起来后仍需要靠滚动寻找事件；本轮增加搜索过滤，让用户能按事件标题、时间、摘要或 mutation 关键字段快速定位 slice。

## 计划

1. 读取当前 Workbench 的 Timeline 过滤逻辑。
2. 增加 Timeline 搜索状态和搜索文本投影。
3. 在 Timeline 顶部增加搜索输入和清空按钮。
4. 区分无数据、当前 subject 无结果、搜索无结果三种空状态。
5. 更新契约测试与任务文档。
6. 运行相关测试和类型检查。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `timelineSearchText`。
  - `visibleSlices` 同时支持当前 subject 过滤和搜索过滤。
  - 新增 `timelineSliceSearchText(slice)`，把 slice id / time / title / summary / kind 与 mutation subject / attr / op / value 压成可搜索文本。
  - 新增 `timelineEmptyText`，按不同过滤状态展示更准确的空状态。
  - Timeline 顶部新增搜索输入，支持一键清空。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加 `timelineSearchText`、`timelineSliceSearchText`、`timelineEmptyText`、搜索 placeholder 与搜索空状态文案断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 实际结果与计划出入

- 实际实现符合计划。
- 本轮增加搜索控件后，`WorldEngineWorkbenchDialog.vue` 从第六十二轮的 614 行回到 645 行；仍低于 800 行，但后续如果继续加 Timeline 能力，建议把 Timeline 区域再抽成子组件。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- 仅影响主 IDE World Engine Workbench 的 Timeline 前端过滤体验。
- API、数据库、Agent 工具、Preview 行为未变。

## 后续

- 用户确认后做主 IDE Workbench 浏览器实跑：新建 Project、运行示例世界、搜索 timeline、写入 / 编辑 slice、显式 re-settle、查询状态。
- 若 Timeline 继续加功能，优先拆出 `WorldEngineTimeline` 子组件，保持主 Dialog 可维护。
