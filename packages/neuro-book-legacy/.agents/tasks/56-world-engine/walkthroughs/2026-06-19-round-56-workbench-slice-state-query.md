# Round 56 - Workbench selected slice 时刻状态查询

## 背景

World Engine 的核心能力之一是回答“任意 instant 的世界状态是什么”。Workbench 已有 State Query，但用户从 timeline 选中一个 slice 后，需要手动复制该 slice 的时间到查询表单，体验不够顺。

本轮目标：让 timeline inspection 和状态查询直接串起来，选中一个 slice 后可以一键查看当前 subject 在该 slice 时刻 reduce 后的状态。

## 本轮计划

1. 调研 selected slice 与 State Query 的当前衔接。
2. 在右侧 Selected Slice 检查器里增加“查询此时状态”动作。
3. 补契约测试并运行相关测试、typecheck。
4. 更新任务 walkthrough、README 和 PROJECT-STATUS。

## 实现

- 更新 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue`：
  - 新增 `queryStateAtSelectedSlice()`。
  - 当存在 selected slice 时，把 `queryAt` 设置为该 slice 的格式化时间。
  - 若 attrs 查询为空，则默认填入当前 subject schema 的前 10 个 attr。
  - 复用现有 `querySelectedState()` 调用 `/api/projects/world-engine/state/query`，不新增状态计算路径。
  - 在右侧 Selected Slice 卡片中增加“查询此时状态”按钮。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - 覆盖 Workbench 中存在 `queryStateAtSelectedSlice` 和“查询此时状态”入口。

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

- 该入口只是填充 `queryAt` 并复用既有 `queryState` API，未绕过后端路径校验、subject 校验或 `listLimit` 校验。
- 查询对象仍是当前选中的 subject；这与 Workbench 左侧 subject-first 的交互模型一致。
- 本轮未自动做浏览器验证；项目规则要求必须用户明确确认后才能打开浏览器。

## Walkthrough

本轮原计划是围绕“任意 instant 状态”补 Workbench 交互。实际实现聚焦在 selected slice 到 State Query 的直连按钮，范围与计划一致。它不改变世界引擎模型，只减少用户从 timeline 观察某一刻状态时的手工复制步骤。
