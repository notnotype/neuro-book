# Round 87: Builder 插入所选 mutation 后方

## 背景

Workbench Mutation Builder 已经支持从 mutations JSON 选择任意 mutation、载入、替换所选、删除所选、上移 / 下移。继续从真实编辑体验看，多 mutation slice 还有一个明显摩擦点：

如果用户想把新 mutation 插到第 N 条后面，只能先追加到末尾，再反复上移。mutation 数量一多，这个流程很容易打断顺序思考。

本轮补一个“插入其后”动作，只改变前端编辑器里的 mutations JSON 组合，不改变后端 slice / mutation / re-settle 语义。

## 变更

- 更新 `world-engine-preview.ts`：
  - 新增 `insertMutationAfter()` 纯函数。
  - 插入成功后返回新 mutations 列表，并把选中索引指向新插入项。
- 更新 `WorldEngineMutationActionButtons.vue`：
  - 增加“插入其后”按钮。
  - 复用当前 mutation 选择状态；无可选 mutation 时禁用。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 透传 `insert-after-selected-mutation` 事件。
- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `insertAfterSelectedBuilderMutation()`。
  - 使用 Builder 当前内容构造 mutation，并插入到当前所选 mutation 后方。
- 更新测试：
  - `world-engine-preview.test.ts` 覆盖插入顺序、选中索引和非法索引错误。
  - `world-engine-ide-entry.test.ts` 增加按钮、事件和编辑器处理函数契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、16 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只增强 Workbench 前端编辑体验，未改 HTTP API、Project SQLite schema、Agent 工具或 reduce / re-settle 行为。
- 新插入动作复用现有 Builder 的 value 校验链路；非法 Builder value 仍会在进入 mutations JSON 前被拦截。
- 插入后自动选中新插入项，方便继续上移 / 下移或替换。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- 后续可继续考虑“插入其前”或批量模板化 mutation，但当前“插入其后 + 上移/下移”已经覆盖主要顺序编辑场景。
- 主 IDE Workbench 浏览器实测仍是关键验证。
