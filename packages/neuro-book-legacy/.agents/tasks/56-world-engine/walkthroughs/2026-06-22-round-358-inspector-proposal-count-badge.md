# Round 358 - Inspector Proposal Count Badge

## 背景

Round 357 已经在 Slice Composer 保存成功后提示作者去右侧 Inspector 查看主体文件建议。继续从作者流看，还有一个小卡点：Inspector 的主体文件建议区域位于元信息、触及主体、主体系统摘要之后，作者打开右栏时不一定第一眼看到建议是否存在。

## 本轮目标

- 不改变主体文件建议生成逻辑。
- 不自动写入 `simulation/subjects`。
- 让当前切片是否有主体文件建议在 Inspector 顶部可见。

## 实现

- `WorldEngineWorkbenchPreviewInspector.vue`
  - 基于现有 `subjectFileProposals` 增加 `subjectFileProposalCount`。
  - 当数量大于 0 时，在 Inspector 顶栏 close 按钮旁显示 `N proposals` 徽标。
  - 徽标使用 `data-testid="subject-file-proposal-count"`，便于静态契约保护。

- 测试
  - `world-engine-workbench-preview.test.ts` 增加 Inspector 顶栏 proposal count 断言。
  - `world-engine-ide-entry.test.ts` 增加真实入口对同一徽标的静态契约断言。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮只增强 discoverability，没有增加 badge 到 timeline slice card，也没有自动展开 / 自动滚动到建议区域。
- P0 边界不变：只生成、展示、复制和打开目标路径，不自动写六文件。
