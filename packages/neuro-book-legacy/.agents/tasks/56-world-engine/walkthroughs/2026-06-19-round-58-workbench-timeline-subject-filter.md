# Round 58 - Workbench timeline 当前 subject 过滤

## 背景

Workbench 的 timeline 已经能展示 slice，并能从 selected slice 查询单 subject / 多 subject 状态。继续从真实项目使用角度审查时，一个明显问题是：timeline 变长后，用户很难只看“当前 subject 相关的切面”。这会影响角色、地点、物品等 subject 的状态追踪体验。

本轮目标：在不新增后端 API 的前提下，让 Workbench timeline 支持按当前选中 subject 过滤。

## 本轮计划

1. 调研 timeline 当前列表渲染与 subject 选择关系。
2. 实现 timeline 仅当前 subject 过滤。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `timelineOnlySelectedSubject` 开关。
  - 新增 `visibleSlices`：开关关闭时显示全部 `slices`；开关打开且存在 selected subject 时，只显示 mutations 包含该 subjectId 的 slice。
  - 新增 `visibleMutationCount`，Timeline header 同时展示过滤后 / 总计的 slice 数与 mutation 数。
  - Timeline header 增加“当前 subject”checkbox。
  - Timeline 空态根据是否存在总 slices 区分“暂无 slice”和“当前 subject 暂无相关 slice”。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 `timelineOnlySelectedSubject`、`visibleSlices` 和“当前 subject”过滤入口。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 过滤只影响前端可见列表，不改变 `slices` 原始数据、selected slice、state query 或 re-settle API。
- 过滤依据是 slice mutations 中的 `subjectId`，与当前 list API `withMutations=true` 的数据一致。
- 如果没有 selected subject，checkbox 会禁用，避免出现无意义过滤状态。
- 本轮未自动做浏览器验证；项目规则要求必须用户明确确认后才能打开浏览器。

## Walkthrough

本轮原计划是增强 timeline 在真实项目里的可浏览性。实际实现范围与计划一致：只做前端过滤和统计展示，没有新增后端接口。这个改动让用户可以围绕一个 subject 快速浏览相关切面，为后续真实浏览器验收和用户视角试跑减少操作噪音。
