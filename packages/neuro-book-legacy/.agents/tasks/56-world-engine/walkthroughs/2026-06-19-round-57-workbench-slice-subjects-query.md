# Round 57 - Workbench selected slice 触及主体批量状态查询

## 背景

Round 56 让用户能从 selected slice 直接查询“当前选中 subject 在该时刻的状态”。继续审查 Workbench 体验时发现，一个 slice 往往同时修改多个 subject，例如角色移动、地点事件、物品状态会在同一切面里一起出现。只查当前 subject 仍不足以观察“这个切面发生后，所有被触及主体分别变成什么样”。

本轮目标：从 selected slice 的 mutations 中提取去重 subjectId，一次查询这些 subject 在该 slice 时刻 reduce 后的状态。

## 本轮计划

1. 调研 selected slice 多 subject 状态查询入口。
2. 实现 selected slice affected subjects 批量查询。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `querySelectedSliceSubjects()`。
  - 从 `selectedSlice.mutations` 中提取去重 subjectId。
  - 设置 `queryAt` 为 selected slice 的格式化时间。
  - 清空 `queryAttrs`，查询这些 subject 的完整状态；避免不同 subject type 共用一组 attr 过滤时造成误导。
  - 复用 `/api/projects/world-engine/state/query`，不新增后端接口或状态计算路径。
  - 在右侧 Selected Slice 卡片中增加“查询切面主体”按钮。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 Workbench 中存在 `querySelectedSliceSubjects` 和“查询切面主体”入口。

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

- 该入口仍走既有 `queryState` API，未绕过后端 subject 校验、attr path 校验或 `listLimit` 校验。
- 批量查询清空 attrs 过滤，返回完整状态，更适合跨 subject type 的 slice inspection。
- 空 mutations slice 会禁用按钮；如果运行时仍遇到空 subjectIds，会给出本地错误。
- 本轮未自动做浏览器验证；项目规则要求必须用户明确确认后才能打开浏览器。

## Walkthrough

本轮原计划是增强 selected slice 的多主体状态观察。实际实现范围与计划一致：没有改数据模型或 API，只在 Workbench 上补了一个从 timeline slice 到批量 `queryState` 的直连入口。
