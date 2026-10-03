# Round 59 - Workbench selected slice 触及主体快捷选择

## 背景

Round 57 / 58 已让 Workbench 可以从 selected slice 批量查询触及主体状态，并按当前 subject 过滤 timeline。继续审查 selected slice inspection 时发现：右侧 mutation 列表能看到 subjectId，但要切换到某个 subject 仍需要去左侧列表里找，尤其在主体较多时不顺手。

本轮目标：在 Selected Slice 检查器里把该 slice 触及的 subject 作为快捷 chip 展示，点击即可切换当前 subject，并把 State Query 的时间对齐到该 slice。

## 本轮计划

1. 调研 Selected Slice mutation 展示与 subject 选择关系。
2. 实现切面触及主体快捷选择。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `selectedSliceSubjectIds`，从 selected slice mutations 中提取去重 subjectId。
  - 新增 `selectSliceSubject(subjectId)`，复用现有 `selectSubject()` 切换当前 subject，并把 `queryAt` 设置为 selected slice 的时间。
  - 在右侧 Selected Slice 卡片中显示 subject chips，当前选中的 subject 会高亮。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 `selectedSliceSubjectIds`、`selectSliceSubject` 和 subject chip 图标入口。

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

- chip 点击只切换当前 subject，并同步 `queryAt`；不会自动发起请求，也不会改变 selected slice 或 re-settle 范围。
- subject chip 数据来自 selected slice mutations，与“查询切面主体”的 subjectId 来源一致。
- 本轮未自动做浏览器验证；项目规则要求必须用户明确确认后才能打开浏览器。

## Walkthrough

本轮原计划是减少多主体 slice inspection 中从 subjectId 到 subject 选择的操作成本。实际实现范围与计划一致，只做 Workbench 前端状态连接，不改 API 或模型。
