# Round 364 - Slice Card Proposal Context Copy

## 背景

Round 361 在 timeline slice card 上增加了 `files N` 徽标，用于提示当前 slice 有主体文件建议。继续审查语义时发现：对于 `world.events` 回退路径，proposal 数量依赖当前 `focusedSubjectId`，也就是“按当前主体语境”计算，而不是把 world slice 自动归属到所有角色。

如果徽标 title 只写“当前切片有主体文件建议”，后续浏览器验收或作者使用时可能误读为全局绝对属性。

## 本轮目标

- 澄清 slice card `files N` 的语义。
- 不改变 proposal 计算逻辑。
- 不自动写 `simulation/subjects`。

## 实现

- `WorldEngineWorkbenchPreviewSliceCard.vue`
  - 将 `files N` 徽标 title 改为：`按当前主体语境，当前切片有主体文件建议`。

- `world-engine-workbench-preview.test.ts`
  - 增加静态断言，保护该语义文案。

## 验证

```bash
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件、9 个用例通过。

本轮未运行浏览器验收。

## 与计划出入

- 本轮是文案和契约澄清，没有新增 UI 区块或后端行为。
- 这条语义需要在后续真实浏览器验收里重点观察：当 focused subject 改变时，`world.events` slice 的 `files N` 可能随语境变化，这是当前 P0 保守设计。
