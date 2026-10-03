# 2026-06-20 Inspector Metadata Draft Diff

## Summary

- 本轮继续优化 `/world-engine.workbench-preview` mock-only 页面。
- 上轮主画布已经能预览 metadata draft，但最终应用 / 还原仍发生在右侧 Inspector。
- 本轮在 Inspector 的 Metadata 表单下新增 before/after diff，让用户提交前能明确看到哪些字段从已应用状态变成了草稿状态。

## Changes

- `WorldEngineWorkbenchPreviewInspector`
  - 新增本地类型 `MetadataDraftDiffRow`。
  - 新增 `metadataDraftDiffRows` computed，比较当前 slice 元信息与 Inspector 草稿中的 `time / kind / title / summary`。
  - Metadata 区块在 dirty 时显示 `Metadata Draft Diff` 面板。
  - Diff 面板按 `field / applied / draft` 三列展示变化字段，长文本截断但保留 title。
- `world-engine-workbench-preview.test.ts`
  - 补充 `MetadataDraftDiffRow`、`metadataDraftDiffRows`、`metadata-draft-diff` 和 `Metadata Draft Diff` 的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed，5 tests passed。
- `bun run typecheck`
  - 通过。
- in-app browser 交互验证：
  - 打开 `http://localhost:3000/world-engine.workbench-preview`。
  - `重置 mock` 后确认默认状态没有 `metadata-draft-diff`，也没有 `未应用修改`。
  - 修改首个 slice title 后，Inspector 出现 `Metadata Draft Diff`。
  - Diff 显示 `1 fields`、`field / applied / draft` 和 `title` 行。
  - 点击 `还原` 后 diff 消失，状态回到 `已同步`。
  - 浏览器日志无 warning / error。

## UI/UX Notes

- 这次补的是“提交前确认”而不是新增保存能力；`应用到预览` 和 `还原` 的行为没有变化。
- Diff 面板只在 dirty 时出现，避免默认 Inspector 被额外信息挤占。
- 主画布 `draft preview` 负责发现和扫读，右侧 `Metadata Draft Diff` 负责提交前审阅，两者分工更清楚。
- 浏览器自动化里输入框文本仍表现为追加测试字符串，但这不影响验证目标：diff 面板正确比较 applied 与 draft，并能随 `还原` 消失。
