# Round 108: Preview Builder 手写 attr path

## 背景

浏览器前继续审查独立 `/world-engine.preview`。本轮先检查文件体量：

- `app/pages/world-engine.preview.vue`：约 754 行，仍低于 800 行限制。
- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`：约 796 行，仍需避免继续向父编辑器追加复杂逻辑。
- `WorldEnginePreviewMutationBuilder.vue`：约 99 行。

审查发现 Workbench Mutation Builder 已支持手写 `memory.师门` 这类开放 object attr path，但独立 Preview 的简化 Builder 只有 schema attr 下拉。这样 Preview 用户无法直接试开放 object key，只能手改 mutations JSON。

## 变更

- 更新 `app/pages/world-engine.preview.vue`：
  - 引入并使用 `resolvePreviewAttrPath()`。
  - `mutationBuilderAttr`、`opOptionsForAttr()`、`refreshBuilderDefaults()` 都改为按完整 attr path 解析。
  - 手写开放 object key 后，op、value hint、默认值、object value 校验会继承根 object 的 `itemType` 投影。
- 更新 `app/components/novel-ide/world-engine/WorldEnginePreviewMutationBuilder.vue`：
  - 在 schema attr 下拉下方增加 attr path 输入。
  - 输入框挂 `datalist`，保留 schema attr 快速补全，也允许手写开放路径。
- 更新 `app/utils/world-engine-ide-entry.test.ts`：
  - contract scan 覆盖 Preview 页面使用 `resolvePreviewAttrPath()`。
  - contract scan 覆盖 Preview Builder 的 `attr path, e.g. memory.师门` 输入。

## 验证

```powershell
bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts
```

结果：2 个测试文件、19 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

```powershell
bunx vitest run "server/api/projects/world-engine/[...segments].test.ts"
```

结果：1 个测试文件、6 个测试通过。

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、36 个测试通过。

## 审查结论

- Preview 与 Workbench 在手写开放 object attr path 的核心能力上对齐。
- 页面体量仍低于 800 行，但后续继续扩展 Preview 时仍应优先放入子组件。
- 没有自动做浏览器验证；真实浏览器用户流仍等待用户明确允许。

## 后续

- 浏览器验收时应覆盖独立 Preview 里手写 `memory.师门`、`deepMemory.first` 的路径，并确认 value textarea / object 校验 / state query 都符合预期。
