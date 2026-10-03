# Round 95: collectionRemove 当前状态值下拉辅助

## 背景

第九十四轮修复了 `collectionRemove` 会被默认值刷新重置回 `collectionAdd` 的问题。继续审查主 IDE Workbench 时发现：虽然 State Query 已经能查到当前 subject 的 collection 状态，但 Mutation Builder 删除 collection 项时仍需要用户手写 value，例如 `subject://old-sword`。

这在真实写作流里容易慢半拍：作者通常是先看当前状态，再决定移除某个已有物品。Builder 应该能复用这份已查询状态。

## 变更

- 更新 `WorldEngineWorkbenchDialog.vue`：
  - 将 `stateResult` 传给 `WorldEngineMutationEditor`。
  - `slices` 与 `stateResult` 改为 `shallowRef`，避免递归 JSON DTO 被 Vue 类型系统深层展开。
- 更新 `WorldEngineMutationEditor.vue`：
  - 接收 `stateResult` prop，并传给 `WorldEngineMutationBuilder`。
  - 文件当前 799 行，仍低于 800 行约束。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 新增 `collectionValueOptions`，在 `builder.op === "collectionRemove"` 时读取当前 subject 的状态。
  - `stateValueAtPath()` 优先用完整 attr key 命中，失败后再按点分路径读取嵌套值。
  - 当当前状态里的 attr 值是数组时，value 控件切换为下拉，选项来自已有 collection 项。
- 更新 `world-engine-workbench.types.ts`：
  - `WorkbenchJsonValue` 改为复用完整递归 `JsonValue`，匹配后端实际可能返回的 object list / collection。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `stateResult` 传递与 `collectionValueOptions` / `stateValueAtPath` / 下拉提示文案的契约断言。

## 绕道记录

把 `WorkbenchJsonValue` 改成完整递归 JSON 后，`bun run typecheck` 首次报出 Vue 类型实例化过深。原因是 `ref<WorldSliceDto[]>` / `ref<SubjectStateDto[]>` 会尝试深层 unwrap 递归 JSON。修法是把这两类 API 快照改成 `shallowRef`，它们在 Workbench 中本来就是整块替换的数据，不需要深层响应式。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、17 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只增强主 IDE Workbench 的 Builder 输入辅助，不改变后端 collection reduce 语义、API、Project SQLite schema 或 Agent 工具。
- `collectionRemove` 可以复用当前 State Query 结果生成已有项下拉；若没有可用查询结果，仍回落到原有手写 value 控件。
- 没有自动做浏览器验证；后续真实验收时应重点走“创建示例世界 -> 查询 erina 状态 -> collectionRemove inventory 旧剑”。

## 后续

- 若浏览器验收确认这个流程好用，可继续为 `listAppend` / `collectionAdd` 做更明确的当前值对照提示。
