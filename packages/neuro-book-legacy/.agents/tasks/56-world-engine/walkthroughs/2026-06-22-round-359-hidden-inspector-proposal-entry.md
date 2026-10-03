# Round 359 - Hidden Inspector Proposal Entry

## 背景

Round 357 在保存成功后提示作者去右侧 Inspector 查看主体文件建议；Round 358 在 Inspector 顶栏显示 `N proposals`。继续从真实作者流看，还有一个可发现性缺口：如果作者此前隐藏了 Inspector，保存提示会指向一个当前不可见的面板，作者需要自己找到恢复入口。

## 本轮目标

- 不自动展开 Inspector，避免保存后打断作者布局。
- 不改变主体文件建议生成逻辑。
- 在 Inspector 隐藏时，让恢复入口也能显示当前 slice 的主体文件建议数量。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 增加 `selectedSliceSubjectFileProposalCount`，复用现有 `buildWorldWorkbenchSubjectFileProposals()` 计算当前 selected slice 的 proposal 数量。
  - 增加 `inspectorButtonAttentionClass`，在 Inspector 隐藏且当前 slice 有 proposal 时，让顶栏 Inspector 按钮使用 accent 高亮；metadata 草稿仍保留 warning 优先级。
  - 顶栏 Inspector 按钮显示 proposal 数字徽标。
  - 右侧隐藏状态的 `world-inspector-restore-rail` 也显示 proposal 数字徽标。
  - `inspectorButtonTitle` 现在会同时提示 metadata 草稿和主体文件建议。

- `world-engine-ide-entry.test.ts`
  - 补真实 Dialog 静态契约断言，覆盖顶栏 proposal count、恢复 rail proposal count 和 title 文案。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮选择“不自动展开 Inspector”。原因是当前 P0 重点是让作者找到入口，而不是保存后强制改布局。
- 没有把 proposal count 加到 timeline slice card；如果真实浏览器验收发现作者仍漏掉，可以再补 slice card 级别标识。
