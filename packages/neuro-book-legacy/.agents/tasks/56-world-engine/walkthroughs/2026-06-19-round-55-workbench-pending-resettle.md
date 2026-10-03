# Round 55 - Workbench pending re-settle 顶部动作

## 背景

Workbench 已经能在写入 / 编辑 slice 后根据 `SliceWriteResult.needsResettle` 填充右侧 re-settle 表单，并在通知里说明影响范围。但真实使用时，“补过去 / 编辑旧 slice”之后最关键的下一步就是显式 re-settle；如果只靠文字提示，用户容易漏掉右侧按钮。

本轮目标不是改变第一版契约。`writeSlice/editSlice` 仍然不自动重算未来 old，显式 `resettleTimeline` 仍是独立动作；本轮只把这个动作在 UI 上变成更清楚的待处理项。

## 本轮计划

1. 调研 Workbench 当前写入 / 编辑后的 re-settle 交互。
2. 增加 pending re-settle 状态和顶部 CTA。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `pendingResettle`，记录最近一次写入 / 编辑返回的 `from`、`subjectIds` 和 `affectedMutations`。
  - 当 `handleSliceSaved()` 收到 `needsResettle: true` 时，通知栏显示“立即重结算 N 条”按钮。
  - 按钮调用 `resettlePendingTimeline()`，先恢复保存结果里的 pending 范围，再复用现有 `resettleTimeline()`。
  - re-settle 成功、无需 re-settle 的写入、创建示例世界后都会清理 pending 状态。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 Workbench 中存在 `pendingResettle`、`resettlePendingTimeline` 和“立即重结算”入口。

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

- 没有改变后端 API，也没有把 re-settle 改成自动执行；第一版显式 re-settle 契约保持不变。
- 顶部按钮使用保存结果里的 pending 范围，不依赖右侧 Inspector 当前选中的 slice，避免用户保存后点选其他 slice 导致重算范围被带偏。
- 成功 re-settle 后会清理 pending 状态，避免同一个待处理动作在 UI 上反复出现。
- 本轮仍未做浏览器验证；项目规则要求浏览器验证需要用户明确确认。

## Walkthrough

本轮原计划是从 Workbench 状态查询 / re-settle 交互中找一个真实使用缺口。实际实现聚焦在 `needsResettle` 的可见待处理动作上，没有做自动重结算，也没有扩展 API。范围比“状态查询优化”更窄，但更直接推动“补过去后不漏重算”的核心闭环。
