# Round 84: Preview Mutation Builder value 类型提示

## 背景

第八十三轮已经统一了 Mutation Builder 的 value 类型读取：list / collection 优先使用 `itemType`。这已经影响到共享默认值生成，因此独立 `/world-engine.preview` 的 schema shortcut 也能拿到 itemType-aware 默认值。

继续审查 Preview 时发现，它的 Builder 仍是一个简化版文本输入。考虑到 `world-engine.preview.vue` 已经较长，本轮不把 Preview 改造成完整 schema-aware 控件，只补一个轻量可见提示，让用户知道当前 value 应该按什么类型填写。

## 变更

- 更新 `world-engine.preview.vue`：
  - 引入 `previewAttrValueType()`。
  - 增加 `mutationBuilderAttr` 与 `mutationBuilderValueHint`。
  - Builder 标题右侧展示 value 类型提示，例如 `list<ref(location)>`、`collection<ref(item)>`、`scalar:int`。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 Preview 页面读取。
  - 增加 `previewAttrValueType`、`mutationBuilderValueHint` 和 list/collection hint 模板断言。

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

- 本轮不改变 API、后端 schema、mutation JSON 结构、slice 保存或 re-settle 语义。
- Preview 仍是简化 Builder，不新增复杂控件；只是让 `itemType` 语义在 UI 上可见。
- `world-engine.preview.vue` 已超过 800 行，本轮记录这个风险；后续若继续改 Preview，应优先拆分组件。
- 主 IDE Workbench 仍未做浏览器真实验收；按照项目规则，需要用户确认后再执行。

## 后续

- Preview 后续扩展前建议先拆组件。
- 主 IDE Workbench 浏览器实测仍是关键验证：真实 Project、创建 subject、写多 mutation slice、编辑旧 slice、移动 / 删除 mutation、保存和显式 re-settle。
