# Round 365 - Slice Card Proposal Entry

## 背景

Round 361 让 timeline slice card 显示 `files N` 主体文件建议数量，Round 364 又澄清了该数量按当前 focused subject 语境计算。继续按真实作者流检查时，下一步卡点变得很具体：作者看到 `files N` 后自然会点击它，但它此前只是静态徽标，点击卡片只能选中 slice，不能直接打开右侧 Inspector。

这会让“发现有主体文件建议”与“进入建议处理面”之间多一步猜测。

## 本轮目标

- 把 slice card 的 `files N` 从只读徽标改成可点击入口。
- 点击后选中对应 slice，并打开右侧 Inspector。
- 保持 P0 边界：只展示 / 复制建议，不自动写 `simulation/subjects` 六文件。

## 实现

- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 为 `files N` 增加按钮语义、lucide files 图标和 click 事件。
  - 新增 `openSubjectFileProposals` emit，表达“打开主体文件建议”的意图。

- `WorldEngineWorkbenchPreviewSliceList.vue`
  - 新增 `openInspectorPanel` prop，用于 proposal 入口，避免继续借用 Draft Queue 的 `openDraftInspector` 命名。
  - 接收到 `open-subject-file-proposals` 后先选中该 slice，再打开 Inspector。

- `WorldEngineWorkbenchDialog.vue`
  - 将已有 `openInspectorPanel` 显式传给 SliceList。

- `world-engine.workbench-preview.vue`
  - mock 沙盘同样传入 `openInspectorPanel`，保持真实 Workbench 与 mock Workbench 体验一致。

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 增加静态契约断言，防止 `files N` 退回只读徽标或只在 mock 中接通。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 原计划里浏览器真实验收仍等待用户明确允许，本轮只做一个作者流可发现性的小闭环。
- 本轮没有改变 proposal 计算规则；`files N` 仍按当前主体语境计算。
- 本轮没有自动写 `events.jsonl / memory.jsonl / state.md`，也没有接 Agent 工具。
