# Round 76: Editor mutations 提交护栏

## 背景

审查 Workbench Mutation Editor 时发现：`parseMutationJson()` 已经会拒绝非法 JSON 与空 mutations 数组，但编辑器的保存按钮只根据 `projectPath / busy / saving` 启停。用户删除最后一条 mutation 后会看到 `[]`，按钮仍可点击，点击后才收到错误。

这不破坏后端契约，但交互上容易让用户走到必然失败的提交。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `mutationValidation` computed，统一复用 `parseMutationJson(sliceForm.mutations)`。
  - `mutationLoadOptions` 改为复用 `mutationValidation`，避免重复解析。
  - `canSubmit` 增加 `mutationValidation.ok` 条件；非法 JSON 或空 mutations 时禁用保存按钮。
  - mutations textarea 下方增加校验错误提示，直接展示 `parseMutationJson()` 的错误信息。
  - `submitSlice()` 复用同一份 `mutationValidation` 结果。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `mutationValidation` 契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、15 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮不改变后端 API、slice 保存格式或 re-settle 语义。
- 前端现在会提前阻止必然失败的空 mutations / 非法 JSON 提交。
- 删除最后一条 mutation 后仍可在编辑器里暂存 `[]`，但保存按钮会禁用并显示错误，符合后端拒绝空 mutations 的契约。

## 后续

- 主 IDE Workbench 仍需要用户确认后做浏览器实测，覆盖真实 Project 的创建、写入、编辑、删除 mutation、保存、re-settle 和状态查询。
