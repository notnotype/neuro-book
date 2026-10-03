# Round 61 - Workbench State Summary 组件拆分

## 背景

Round 60 增加 State Query 摘要视图后，`WorldEngineWorkbenchDialog.vue` 达到 712 行。虽然仍低于项目 800 行警戒线，但 Workbench 还会继续产品化，如果继续把 State / Timeline / Inspector UI 都堆在一个文件里，后续维护成本会迅速上升。

本轮目标：把 State Query 摘要视图抽离成独立组件，保持行为不变，降低主 Workbench 体量。

## 本轮计划

1. 调研 State Summary 依赖类型与拆分边界。
2. 抽离 `WorldEngineStateSummary` 组件并接入 Workbench。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 新增 `app/components/novel-ide/world-engine/WorldEngineStateSummary.vue`：
  - 接收 `states: SubjectStateDto[]`。
  - 内部保留 `stateAttrEntries()` 和 `formatStateAttrValue()`。
  - 负责渲染 State Query 的 subject / attr 摘要。
- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 引入 `WorldEngineStateSummary`。
  - 删除本地摘要 helper 与摘要模板块。
  - 使用 `<WorldEngineStateSummary :states="stateResult" />`。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 增加读取 `WorldEngineStateSummary.vue`。
  - Workbench 侧断言接入组件。
  - StateSummary 侧断言摘要 helper 与 attr 计数入口存在。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

额外检查：

```powershell
(Get-Content -LiteralPath 'app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue').Count
```

结果：主 Workbench 从 712 行降到 683 行。

## 审查结论

- 这是纯前端组件拆分，不改变 State Query 的输入、API、返回或展示语义。
- `WorldEngineStateSummary` 无 API 请求、无父状态写入，拆分边界较干净。
- 后续如果 Timeline 或 Inspector 继续膨胀，可按同样方式拆子组件。
- 本轮未自动做浏览器验证；项目规则要求必须用户明确确认后才能打开浏览器。

## Walkthrough

本轮是为了保持 Workbench 可继续演进而做的维护性拆分。实际范围与计划一致：没有新增功能，也没有修改 world-engine 核心模型。行为仍由既有测试和 typecheck 兜底。
