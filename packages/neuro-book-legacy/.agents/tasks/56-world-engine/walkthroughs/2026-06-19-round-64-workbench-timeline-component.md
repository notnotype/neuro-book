# Round 64 - Workbench Timeline 组件拆分

## 目标

第六十三轮给 Timeline 增加搜索过滤后，主 Workbench 又开始积累列表展示、搜索、过滤和空状态逻辑。本轮把 Timeline 区域抽成独立组件，保持主 Dialog 继续聚焦数据读取、选择状态和 API 动作。

## 计划

1. 审计 `WorldEngineWorkbenchDialog.vue` 中 Timeline 的状态和模板边界。
2. 新增 `WorldEngineTimeline.vue`，承接 Timeline 列表、当前 subject 过滤、搜索过滤、计数和空状态。
3. 父组件只通过 props 传入 slices、selected ids、busy 状态，通过 emits 接收 select/edit/seed 动作。
4. 更新 IDE 入口契约测试。
5. 运行相关测试和类型检查。

## 实现

- 新增 `app/components/novel-ide/world-engine/WorldEngineTimeline.vue`：
  - 接收 `slices`、`selectedSliceId`、`selectedSubjectId`、`loading`、`actionBusy`、`schemaLoaded`。
  - 内部维护 `timelineOnlySelectedSubject` 和 `timelineSearchText`。
  - 内部计算 `visibleSlices`、mutation 计数和 `timelineEmptyText`。
  - 保留按 slice id / time / title / summary / kind 和 mutation subject / attr / op / value 的搜索能力。
  - 通过 `select-slice`、`edit-slice`、`seed-demo` emit 回父组件。
- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 引入 `WorldEngineTimeline`。
  - 移除 Timeline 搜索、过滤、计数和空状态 computed。
  - 移除只服务 Timeline 的 `timelineSliceSearchText`。
  - 保留 `selectSlice`、`editSelectedSlice`、`seedDemoWorld` 等业务动作。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加读取 `WorldEngineTimeline.vue`。
  - 父组件断言 `WorldEngineTimeline` 接入。
  - Timeline 组件断言搜索、过滤、空状态和事件名。

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

- 实际实现符合计划，用户可见行为不变。
- `WorldEngineWorkbenchDialog.vue` 从 645 行降到 581 行。
- 新增 `WorldEngineTimeline.vue` 97 行。
- 根据项目约束，本轮未自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 影响范围

- 仅影响主 IDE World Engine Workbench 的前端组件结构。
- API、数据库、Agent 工具、Preview 行为未变。

## 后续

- 用户确认后做主 IDE Workbench 浏览器实跑，并从用户角度评估新建 Project、示例世界、Timeline 搜索、写入 / 编辑 slice、显式 re-settle 和 State Query 是否顺手。
- 若继续推进编码，下一步可补 Mutation Editor 的 object 子表单或批量 / 模板化 mutation。
