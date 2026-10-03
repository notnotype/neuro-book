# Round 368 - Proposal Copy Failure Notice

## 背景

主体文件建议 P0 流程里，复制是作者把 World Engine slice 落到 `simulation/subjects` 六文件的关键手动动作。Inspector 里已经有“复制建议 / 复制全部 / 复制 events.jsonl 行 / 复制 memory.jsonl 候选行 / 复制 state.md 审查提示”，但 `navigator.clipboard.writeText()` 如果因为浏览器权限、非安全上下文或系统限制失败，会直接抛错，作者只会感觉按钮没反应。

这不是边界输入问题，而是常用动作失败时缺少反馈。

## 本轮目标

- 复制失败时给作者明确错误提示。
- 不改变复制成功路径。
- 不自动写 `simulation/subjects` 六文件。

## 实现

- `WorldEngineWorkbenchPreviewInspector.vue`
  - `copySubjectFileProposalText()` 保留原有“不支持剪贴板”提示。
  - 对 `navigator.clipboard.writeText()` 增加 `try/catch`。
  - 写入失败时显示：`复制失败，请手动选择文本后复制。`

- `world-engine-ide-entry.test.ts` / `world-engine-workbench-preview.test.ts`
  - 增加静态契约断言，保护复制失败反馈。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮只补常用复制动作的失败反馈，没有增加新的 UI 区块或后端行为。
- 真实浏览器剪贴板权限场景仍需后续浏览器验收或人工复验。
